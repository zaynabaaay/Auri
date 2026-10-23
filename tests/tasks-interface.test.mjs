import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';

import * as colors from '../src/colors.ts';
import * as presentation from '../src/features/tasks/task-presentation.ts';
import {
  TaskWriteConflictError,
} from '../src/services/tasks/supabase-task-repository.ts';

async function loadModule(path, dependencies) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  const module = { exports: {} };

  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });

  return module.exports;
}

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });

  return { promise, resolve, reject };
}

function task(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Prepare paperwork',
    description: null,
    deadline: null,
    scheduledDate: null,
    status: 'active',
    isFocused: false,
    completedAt: null,
    createdAt: '2026-10-23T10:00:00Z',
    updatedAt: '2026-10-23T10:00:00Z',
    version: 1,
    ...overrides,
  };
}

async function hookHarness(repository) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let current;
  let unmounted = false;
  let updatesAfterUnmount = 0;

  const react = {
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },

    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };

      return [slots[index].value, (update) => {
        if (unmounted) {
          updatesAfterUnmount += 1;
          return;
        }

        const previous = slots[index].value;
        const next = typeof update === 'function'
          ? update(previous)
          : update;

        if (!Object.is(previous, next)) {
          slots[index].value = next;
          dirty = true;
        }
      }];
    },

    useCallback(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];

      if (
        !previous ||
        dependencies.some((value, i) =>
          !Object.is(value, previous.dependencies[i]))
      ) {
        slots[index] = { value: callback, dependencies };
      }

      return slots[index].value;
    },

    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];

      if (
        !previous ||
        dependencies.some((value, i) =>
          !Object.is(value, previous.dependencies[i]))
      ) {
        slots[index] = { dependencies };

        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };

  const module = await loadModule(
    '../src/features/tasks/use-tasks.ts',
    {
      react,
      'expo-router': {
        useFocusEffect: (effect) => react.useEffect(effect, [effect]),
      },
      '@/services/tasks/supabase-task-repository': {
        TaskWriteConflictError,
      },
    },
  );

  function render() {
    assert.equal(unmounted, false);

    do {
      dirty = false;
      cursor = 0;
      effects = [];
      current = module.useTasks(repository);
      effects.forEach((effect) => effect());
    } while (dirty);

    return current;
  }

  render();

  return {
    get current() {
      return current;
    },

    get updatesAfterUnmount() {
      return updatesAfterUnmount;
    },

    render,

    async settle() {
      await new Promise(setImmediate);

      if (!unmounted) {
        render();
      }
    },

    unmount() {
      unmounted = true;
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

test('confirmed writes update the one collection used by both views', async () => {
  const original = task();
  const harness = await hookHarness({
    list: async () => [original],
  });

  await harness.settle();

  const saved = task({ isFocused: true, version: 2 });

  assert.equal(
    await harness.current.save(async () => saved),
    true,
  );

  harness.render();

  const collections = presentation.taskCollections(
    harness.current.tasks,
  );

  assert.equal(collections.active[0].version, 2);
  assert.equal(collections.focused[0], collections.active[0]);

  harness.unmount();
});

test('an older refresh cannot undo a confirmed write', async () => {
  const lateRead = deferred();
  let reads = 0;

  const harness = await hookHarness({
    list: () => ++reads === 1
      ? Promise.resolve([task()])
      : lateRead.promise,
  });

  await harness.settle();

  const refresh = harness.current.refresh();

  await harness.current.save(async () => task({
    isFocused: true,
    version: 2,
  }));

  lateRead.resolve([task()]);
  await refresh;
  harness.render();

  assert.equal(harness.current.tasks[0].version, 2);
  assert.equal(harness.current.tasks[0].isFocused, true);
  assert.equal(harness.current.loading, false);

  harness.unmount();
});

test('duplicate submissions are blocked before a React rerender', async () => {
  const harness = await hookHarness({
    list: async () => [task()],
  });

  await harness.settle();

  const write = deferred();
  let calls = 0;

  const operation = async () => {
    calls += 1;
    return write.promise;
  };

  const first = harness.current.save(operation);
  const second = await harness.current.save(operation);

  assert.equal(second, false);
  assert.equal(calls, 1);

  write.resolve(task({ version: 2 }));
  assert.equal(await first, true);

  harness.render();
  assert.equal(harness.current.pending, false);

  harness.unmount();
});

test('conflicts retain existing records and expose the refresh message', async () => {
  const original = task();
  const harness = await hookHarness({
    list: async () => [original],
  });

  await harness.settle();

  const failure = new TaskWriteConflictError();

  assert.equal(
    await harness.current.save(async () => { throw failure; }),
    false,
  );

  harness.render();

  assert.equal(harness.current.tasks[0], original);
  assert.equal(harness.current.error, failure.message);
  assert.equal(harness.current.pending, false);

  harness.unmount();
});

test('failed initial loading does not permit writes against an unloaded list', async () => {
  const harness = await hookHarness({
    list: async () => { throw new Error('Unavailable'); },
  });

  await harness.settle();

  let called = false;

  const result = await harness.current.save(async () => {
    called = true;
    return task();
  });

  assert.equal(result, false);
  assert.equal(called, false);
  assert.equal(harness.current.ready, false);
  assert.equal(harness.current.loading, false);

  harness.unmount();
});

test('late reads cannot update an unmounted account view', async () => {
  const read = deferred();
  const harness = await hookHarness({
    list: () => read.promise,
  });

  harness.unmount();
  read.resolve([task()]);

  await harness.settle();

  assert.equal(harness.updatesAfterUnmount, 0);
  assert.equal(harness.current.ready, false);
});

test('late writes cannot update an unmounted account view', async () => {
  const harness = await hookHarness({
    list: async () => [task()],
  });

  await harness.settle();

  const write = deferred();
  const saving = harness.current.save(() => write.promise);

  harness.render();
  assert.equal(harness.current.pending, true);

  harness.unmount();
  write.resolve(task({ version: 2 }));

  assert.equal(await saving, false);
  assert.equal(harness.updatesAfterUnmount, 0);
});

function walk(node) {
  if (!node || typeof node !== 'object') return [];

  if (typeof node.type === 'function') {
    return walk(node.type(node.props));
  }

  const children = [node.props?.children].flat(Infinity);

  return [node, ...children.flatMap(walk)];
}

const jsx = (type, props) => ({ type, props });

const uiDependencies = {
  'react/jsx-runtime': {
    jsx,
    jsxs: jsx,
  },
  'react-native': {
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    StyleSheet: {
      hairlineWidth: 1,
      absoluteFill: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      create: (styles) => styles,
    },
  },
  '@/colors': colors,
  '@/typography': {
    HEADING_FONT_FAMILY: 'Baskerville',
  },
  './task-presentation': presentation,
};

async function card(props) {
  const module = await loadModule(
    '../src/features/tasks/task-card.tsx',
    uiDependencies,
  );

  return walk(module.TaskCard(props));
}

async function menu(props) {
  const module = await loadModule(
    '../src/features/tasks/task-actions.tsx',
    uiDependencies,
  );

  return walk(module.TaskActions(props));
}

function buttonByLabel(nodes, label) {
  const button = nodes.find((node) =>
    node.type === 'Pressable' &&
    node.props.accessibilityLabel === label);

  assert.ok(button, `Missing button: ${label}`);
  return button;
}

function menuButton(nodes, label) {
  const button = nodes.find((node) =>
    node.type === 'Pressable' &&
    node.props.accessible !== false &&
    walk(node).some((child) =>
      child.type === 'Text' && child.props.children === label));

  assert.ok(button, `Missing menu action: ${label}`);
  return button;
}

function menuLabels(nodes) {
  return nodes
    .filter((node) =>
      node.type === 'Pressable' && node.props.accessible !== false)
    .map((button) =>
      walk(button).find((child) => child.type === 'Text').props.children);
}

function menuProps(value, events) {
  return {
    task: value,
    disabled: false,
    onClose: () => events.push(['close']),
    onEdit: (item) => events.push(['edit', item]),
    onPostpone: (item) => events.push(['postpone', item]),
    onStatus: (item, status) => events.push(['status', item, status]),
    onFocus: (item, selected) => events.push(['focus', item, selected]),
  };
}

test('overview shows completion and More without expanded working details', async () => {
  const calls = [];
  const value = task({ description: 'Bring the original documents.' });

  const nodes = await card({
    task: value,
    presentation: 'overview',
    disabled: false,
    onStatus: (item, status) => calls.push(['status', item, status]),
    onManage: (item) => calls.push(['manage', item]),
  });

  const buttons = nodes.filter((node) => node.type === 'Pressable');

  assert.equal(buttons.length, 2);

  const complete = buttonByLabel(
    nodes,
    `Complete task: ${value.title}`,
  );
  const more = buttonByLabel(
    nodes,
    `More actions: ${value.title}`,
  );

  assert.equal(complete.props.accessibilityRole, 'checkbox');
  assert.equal(complete.props.accessibilityState.checked, false);

  complete.props.onPress();
  more.props.onPress();

  assert.deepEqual(calls, [
    ['status', value, 'completed'],
    ['manage', value],
  ]);

  assert.equal(
    nodes.some((node) => node.props.children === value.description),
    false,
  );
});

test('Focus shows full working details and a primary completion button', async () => {
  const calls = [];
  const value = task({
    isFocused: true,
    description: 'Bring the original documents.',
  });

  const nodes = await card({
    task: value,
    presentation: 'focus',
    disabled: false,
    onStatus: (item, status) => calls.push(['status', item, status]),
    onManage: () => undefined,
  });

  const buttons = nodes.filter((node) => node.type === 'Pressable');

  assert.equal(buttons.length, 2);
  assert.ok(
    nodes.some((node) => node.props.children === value.description),
  );
  assert.ok(
    nodes.some((node) => node.props.children === 'Complete task'),
  );

  const complete = buttonByLabel(
    nodes,
    `Complete task: ${value.title}`,
  );

  assert.equal(complete.props.accessibilityRole, 'button');

  complete.props.onPress();

  assert.deepEqual(calls, [['status', value, 'completed']]);
});

test('both presentations provide their task to the same shared menu', async () => {
  const value = task();
  const snapshot = structuredClone(value);

  for (const mode of ['overview', 'focus']) {
    let selected;
    const events = [];

    const nodes = await card({
      task: value,
      presentation: mode,
      disabled: false,
      onStatus: (item, status) => events.push(['status', item, status]),
      onManage: (item) => { selected = item; },
    });

    buttonByLabel(nodes, `More actions: ${value.title}`).props.onPress();

    assert.equal(selected, value);

    const actions = await menu(menuProps(selected, events));

    assert.deepEqual(menuLabels(actions), [
      'Edit',
      'Add to Focus',
      'Postpone',
      'Dismiss',
      'Cancel',
    ]);
    assert.deepEqual(events, []);
  }

  assert.deepEqual(value, snapshot);
});

test('pending writes disable both visible card controls', async () => {
  for (const mode of ['overview', 'focus']) {
    const nodes = await card({
      task: task(),
      presentation: mode,
      disabled: true,
      onStatus: () => undefined,
      onManage: () => undefined,
    });

    const buttons = nodes.filter((node) => node.type === 'Pressable');

    assert.equal(buttons.length, 2);

    for (const button of buttons) {
      assert.equal(button.props.disabled, true);
      assert.equal(button.props.accessibilityState.disabled, true);
    }
  }
});

test('terminal cards expose More without a completion control', async () => {
  for (const status of ['completed', 'dismissed']) {
    const value = task({ status });

    const nodes = await card({
      task: value,
      presentation: 'overview',
      disabled: false,
      onStatus: () => undefined,
      onManage: () => undefined,
    });

    assert.equal(
      nodes.filter((node) => node.type === 'Pressable').length,
      1,
    );
    buttonByLabel(nodes, `More actions: ${value.title}`);
  }
});

test('the menu is absent when no task is selected', async () => {
  const nodes = await menu(menuProps(null, []));
  assert.deepEqual(nodes, []);
});

test('active menus show the correct Focus action', async () => {
  for (const selected of [false, true]) {
    const nodes = await menu(menuProps(
      task({ isFocused: selected }),
      [],
    ));

    assert.deepEqual(menuLabels(nodes), [
      'Edit',
      selected ? 'Remove from Focus' : 'Add to Focus',
      'Postpone',
      'Dismiss',
      'Cancel',
    ]);
  }
});

test('terminal menus offer only editing, reactivation, and cancellation', async () => {
  for (const status of ['completed', 'dismissed']) {
    const nodes = await menu(menuProps(task({ status }), []));

    assert.deepEqual(menuLabels(nodes), [
      'Edit',
      'Reactivate',
      'Cancel',
    ]);
  }
});

test('each menu action closes once and dispatches its intended callback once', async () => {
  const cases = [
    {
      value: task(),
      label: 'Edit',
      expected: (value) => ['edit', value],
    },
    {
      value: task(),
      label: 'Add to Focus',
      expected: (value) => ['focus', value, true],
    },
    {
      value: task({ isFocused: true }),
      label: 'Remove from Focus',
      expected: (value) => ['focus', value, false],
    },
    {
      value: task(),
      label: 'Postpone',
      expected: (value) => ['postpone', value],
    },
    {
      value: task(),
      label: 'Dismiss',
      expected: (value) => ['status', value, 'dismissed'],
    },
    {
      value: task({ status: 'completed' }),
      label: 'Reactivate',
      expected: (value) => ['status', value, 'active'],
    },
    {
      value: task({ status: 'dismissed' }),
      label: 'Reactivate',
      expected: (value) => ['status', value, 'active'],
    },
  ];

  for (const { value, label, expected } of cases) {
    const events = [];
    const nodes = await menu(menuProps(value, events));

    menuButton(nodes, label).props.onPress();

    assert.deepEqual(events, [
      ['close'],
      expected(value),
    ]);
  }
});

test('Cancel, backdrop, and platform dismissal close without mutation', async () => {
  for (const method of ['cancel', 'backdrop', 'platform']) {
    const events = [];
    const value = task({ isFocused: true });
    const snapshot = structuredClone(value);
    const nodes = await menu(menuProps(value, events));

    if (method === 'cancel') {
      menuButton(nodes, 'Cancel').props.onPress();
    } else if (method === 'backdrop') {
      const backdrop = nodes.find((node) =>
        node.type === 'Pressable' && node.props.accessible === false);

      assert.ok(backdrop);
      backdrop.props.onPress();
    } else {
      const modal = nodes.find((node) => node.type === 'Modal');

      assert.ok(modal);
      modal.props.onRequestClose();
    }

    assert.deepEqual(events, [['close']]);
    assert.deepEqual(value, snapshot);
  }
});

test('pending writes disable menu actions but still allow cancellation', async () => {
  const events = [];
  const props = menuProps(task(), events);
  const nodes = await menu({ ...props, disabled: true });

  for (const label of ['Edit', 'Add to Focus', 'Postpone', 'Dismiss']) {
    const button = menuButton(nodes, label);

    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
  }

  const cancel = menuButton(nodes, 'Cancel');

  assert.notEqual(cancel.props.disabled, true);
  cancel.props.onPress();

  assert.deepEqual(events, [['close']]);
});

test('a refreshed record updates menu labels and callback arguments', async () => {
  const original = task();
  const refreshed = task({
    title: 'Updated paperwork',
    isFocused: true,
    version: 2,
  });
  let reads = 0;

  const harness = await hookHarness({
    list: async () => [++reads === 1 ? original : refreshed],
  });

  await harness.settle();

  const selectedId = original.id;
  const events = [];

  const selectedTask = () => harness.current.tasks.find(
    (value) => value.id === selectedId,
  );

  const before = await menu(menuProps(selectedTask(), events));

  menuButton(before, 'Add to Focus');
  assert.deepEqual(events, []);

  await harness.current.refresh();
  harness.render();

  const after = await menu(menuProps(selectedTask(), events));

  assert.ok(after.some((node) =>
    node.type === 'Text' &&
    node.props.children === refreshed.title));

  menuButton(after, 'Remove from Focus').props.onPress();

  assert.deepEqual(events, [
    ['close'],
    ['focus', refreshed, false],
  ]);

  harness.unmount();
});
