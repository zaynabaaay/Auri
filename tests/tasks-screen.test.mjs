import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';

import * as colors from '../src/colors.ts';
import * as rules from '../src/domain/tasks/task-rules.ts';
import * as presentation from '../src/features/tasks/task-presentation.ts';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function task(overrides = {}) {
  return {
    id: 'task-1', title: 'Prepare paperwork', description: 'Find the documents',
    deadline: null, scheduledDate: null, status: 'active', isFocused: true,
    completedAt: null, createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z', version: 1,
    ...overrides,
  };
}

const native = Object.fromEntries([
  'ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'RefreshControl',
  'ScrollView', 'SectionList', 'Text', 'TextInput', 'View',
].map((name) => [name, name]));

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}

function find(tree, predicate) {
  const node = nodes(tree).find(predicate);
  assert.ok(node, 'Expected rendered node');
  return node;
}

function byId(tree, id) {
  return find(tree, (node) => node.props?.testID === id);
}

async function mount(path, exportName, dependencies, props) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value;
      }];
    },
    useMemo(factory, values) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || values.some((value, i) => !Object.is(value, previous.values[i]))) {
        slots[index] = { values, value: factory() };
      }
      return slots[index].value;
    },
  };
  const jsx = (type, values, key) => ({ type, props: values, key });
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': {
      ...native, Platform: { OS: 'ios' },
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/colors': colors,
    '@/typography': { HEADING_FONT_FAMILY: 'Baskerville' },
    '@/domain/tasks/task-rules': rules,
    './task-presentation': presentation,
    ...dependencies,
  };
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, Error,
    require(name) {
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    },
  });

  return {
    render() {
      cursor = 0;
      return module.exports[exportName](props);
    },
  };
}

async function workspace(initial = {}) {
  const calls = [];
  let owner;
  const repository = {
    create: async (details) => {
      calls.push(['create', details]);
      return task({ ...details, id: 'new-task', isFocused: false });
    },
    edit: async (current, details) => {
      calls.push(['edit', current, details]);
      return task({ ...current, ...details, version: current.version + 1 });
    },
    postpone: async (current, date, today) => {
      calls.push(['postpone', current, date, today]);
      return task({ ...current, scheduledDate: date, version: current.version + 1 });
    },
    setStatus: async (current, status) => {
      calls.push(['status', current, status]);
      return task({ ...current, status, isFocused: false, version: current.version + 1 });
    },
    setFocus: async (current, selected) => {
      calls.push(['focus', current, selected]);
      return task({ ...current, isFocused: selected, version: current.version + 1 });
    },
  };
  const model = {
    tasks: [task()], ready: true, loading: false, pending: false, error: null,
    refresh: () => { calls.push(['refresh']); },
    save: async (operation) => {
      const saved = await operation(repository);
      model.tasks = [...model.tasks.filter((item) => item.id !== saved.id), saved];
      return true;
    },
    ...initial,
  };
  class Repository {
    constructor(id) { owner = id; }
  }
  const view = await mount(
    '../src/features/tasks/tasks-screen.tsx', 'TasksWorkspace',
    {
      '@/features/auth/auth-provider': { useAuth: () => ({ user: { id: OWNER } }) },
      '@/services/tasks/supabase-task-repository': { SupabaseTaskRepository: Repository },
      './use-tasks': { useTasks: () => model },
      './task-card': { TaskCard: 'TaskCard' },
      './task-actions': { TaskActions: 'TaskActions' },
      './task-editor': { TaskEditor: 'TaskEditor' },
    },
    { userId: OWNER },
  );
  const list = () => byId(view.render(), 'tasks-list');
  const card = (item = model.tasks[0]) => list().props.renderItem({ item });
  const menu = () => find(view.render(), (node) => node.type === 'TaskActions');
  const editor = () => find(view.render(), (node) => node.type === 'TaskEditor');
  return { view, model, calls, list, card, menu, editor, owner: () => owner };
}

async function editor(session = { kind: 'create' }, overrides = {}) {
  const submissions = [];
  const props = {
    session, pending: false, error: null, onCancel: () => undefined,
    onSave: async (value) => { submissions.push(value); return true; },
    ...overrides,
  };
  const view = await mount('../src/features/tasks/task-editor.tsx', 'TaskEditor', {}, props);
  const input = (label) => find(view.render(), (node) =>
    node.type === 'TextInput' && node.props.accessibilityLabel === label);
  const submit = async () => {
    byId(view.render(), 'task-editor-save').props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { view, input, submit, submissions, props };
}

test('navigation retains Auri and Projects and adds Tasks with the existing palette', async () => {
  function TabHost() {}
  TabHost.Screen = 'TabScreen';
  const view = await mount('../src/app/(shell)/_layout.tsx', 'default', {
    'expo-router': { Tabs: TabHost },
  }, {});
  const tree = view.render();
  assert.deepEqual(
    nodes(tree).filter((node) => node.type === 'TabScreen').map((node) => node.props.name),
    ['index', 'projects/index', 'tasks/index'],
  );
  assert.equal(tree.props.screenOptions.tabBarHideOnKeyboard, true);
  assert.equal(tree.props.screenOptions.tabBarActiveTintColor, colors.DARK_SAGE);
});

test('workspace scopes the repository to the signed-in user and distinguishes Focus presentation', async () => {
  const screen = await workspace();
  screen.view.render();
  assert.equal(screen.owner(), OWNER);
  assert.equal(screen.card().props.presentation, 'focus');
  byId(screen.view.render(), 'tasks-view-all').props.onPress();
  assert.equal(screen.card().props.presentation, 'overview');
});

test('All Tasks separates active, completed, and dismissed records', async () => {
  const screen = await workspace({ tasks: [
    task(), task({ id: 'done', status: 'completed', isFocused: false }),
    task({ id: 'dismissed', status: 'dismissed', isFocused: false }),
  ] });
  byId(screen.view.render(), 'tasks-view-all').props.onPress();
  assert.deepEqual(Array.from(screen.list().props.sections, (section) => section.key), [
    'active', 'completed', 'dismissed',
  ]);
});

test('initial loading, failure, and retry states do not enable creation prematurely', async () => {
  const screen = await workspace({ tasks: [], ready: false, loading: true });
  assert.equal(byId(screen.view.render(), 'tasks-new').props.disabled, true);
  find(screen.view.render(), (node) => node.props?.accessibilityLabel === 'Loading tasks');
  screen.model.loading = false;
  screen.model.error = 'Unable to load';
  byId(screen.view.render(), 'tasks-retry').props.onPress();
  assert.deepEqual(screen.calls, [['refresh']]);
});

test('empty Focus links to All Tasks and refreshing keeps cached tasks visible', async () => {
  const screen = await workspace({ tasks: [] });
  byId(screen.list().props.ListEmptyComponent, 'tasks-choose-focus').props.onPress();
  assert.equal(byId(screen.view.render(), 'tasks-view-all').props.accessibilityState.selected, true);
  screen.model.tasks = [task()];
  screen.model.loading = true;
  assert.equal(screen.list().props.sections[0].data.length, 1);
  assert.equal(screen.list().props.refreshControl.props.refreshing, true);
});

test('creating a task closes the editor and displays the returned task in All Tasks', async () => {
  const screen = await workspace();
  byId(screen.view.render(), 'tasks-new').props.onPress();
  const details = rules.normalizeTaskDetails({ title: 'New task' });
  await screen.editor().props.onSave({ kind: 'details', details });
  assert.deepEqual(screen.calls, [['create', details]]);
  assert.equal(byId(screen.view.render(), 'tasks-view-all').props.accessibilityState.selected, true);
  assert.ok(screen.list().props.sections[0].data.some((item) => item.id === 'new-task'));
});

test('unconfirmed save keeps the editor open', async () => {
  const screen = await workspace({ save: async () => false });
  byId(screen.view.render(), 'tasks-new').props.onPress();
  assert.equal(await screen.editor().props.onSave({
    kind: 'details', details: rules.normalizeTaskDetails({ title: 'Draft' }),
  }), false);
  assert.equal(screen.editor().props.session.kind, 'create');
});

test('completion updates All Tasks and removes the task from Focus', async () => {
  const screen = await workspace();
  screen.card().props.onStatus(screen.model.tasks[0], 'completed');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(screen.list().props.sections.length, 0);
  byId(screen.view.render(), 'tasks-view-all').props.onPress();
  assert.equal(screen.list().props.sections[0].key, 'completed');
});

test('Focus selection, dismissal, and reactivation use repository actions and synchronize views', async () => {
  const screen = await workspace({ tasks: [task({ isFocused: false })] });
  let current = screen.model.tasks[0];
  screen.menu().props.onFocus(current, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(screen.list().props.sections[0].data[0].isFocused, true);
  current = screen.model.tasks[0];
  screen.menu().props.onStatus(current, 'dismissed');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(screen.list().props.sections.length, 0);
  current = screen.model.tasks[0];
  screen.menu().props.onStatus(current, 'active');
  await new Promise((resolve) => setImmediate(resolve));
  byId(screen.view.render(), 'tasks-view-all').props.onPress();
  assert.equal(screen.list().props.sections[0].key, 'active');
});

test('selected menu resolves fresh task data rather than retaining an obsolete snapshot', async () => {
  const screen = await workspace();
  screen.card().props.onManage(screen.model.tasks[0]);
  const refreshed = task({ version: 2, title: 'Updated' });
  screen.model.tasks = [refreshed];
  assert.equal(screen.menu().props.task, refreshed);
});

for (const kind of ['edit', 'postpone']) {
  test(`${kind} dispatches through the existing repository with the editor snapshot`, async () => {
    const screen = await workspace();
    const original = screen.model.tasks[0];
    if (kind === 'edit') screen.menu().props.onEdit(original);
    else screen.menu().props.onPostpone(original);
    const submission = kind === 'edit'
      ? { kind: 'details', details: rules.normalizeTaskDetails({ title: 'Edited' }) }
      : { kind: 'postpone', scheduledDate: '2099-12-31' };
    await screen.editor().props.onSave(submission);
    assert.equal(screen.calls[0][0], kind);
    assert.equal(screen.calls[0][1], original);
  });
}

test('pending writes disable task actions, refresh, and creation', async () => {
  const screen = await workspace({ pending: true });
  assert.equal(screen.card().props.disabled, true);
  assert.equal(screen.menu().props.disabled, true);
  assert.equal(byId(screen.view.render(), 'tasks-new').props.disabled, true);
  assert.equal(byId(screen.view.render(), 'tasks-refresh').props.disabled, true);
});

test('editor normalizes details and accepts calendar dates without inventing deadlines', async () => {
  const form = await editor();
  form.input('Task title').props.onChangeText('  Paperwork  ');
  form.input('Task description').props.onChangeText('  Notes  ');
  form.input('Task planned date').props.onChangeText('2028-02-29');
  await form.submit();
  assert.deepEqual(structuredClone(form.submissions), [{ kind: 'details', details: {
    title: 'Paperwork', description: 'Notes', deadline: null, scheduledDate: '2028-02-29',
  } }]);
});

test('invalid calendar dates remain correctable without consuming the creation attempt', async () => {
  const form = await editor();
  form.input('Task title').props.onChangeText('Paperwork');
  form.input('Task deadline date').props.onChangeText('2026-02-30');
  await form.submit();
  assert.equal(form.submissions.length, 0);
  assert.equal(byId(form.view.render(), 'task-editor-save').props.disabled, false);
  form.input('Task deadline date').props.onChangeText('2028-02-29');
  await form.submit();
  assert.equal(form.submissions[0].details.deadline.date, '2028-02-29');
});

test('editing preserves an existing timed deadline and its timezone', async () => {
  const deadline = { kind: 'timed', at: '2026-11-01T05:30:00.000Z', timeZone: 'America/New_York' };
  const form = await editor({ kind: 'edit', task: task({ deadline }) });
  form.input('Task title').props.onChangeText('Updated');
  await form.submit();
  assert.deepEqual(form.submissions[0].details.deadline, deadline);
});

test('postponement validates through domain rules and keeps the selected task unchanged', async () => {
  const original = task({ scheduledDate: '2099-01-01' });
  const form = await editor({ kind: 'postpone', task: original });
  form.input('Task planned date').props.onChangeText('2098-12-31');
  await form.submit();
  assert.equal(form.submissions.length, 0);
  form.input('Task planned date').props.onChangeText('2099-01-02');
  await form.submit();
  assert.deepEqual(structuredClone(form.submissions), [{ kind: 'postpone', scheduledDate: '2099-01-02' }]);
  assert.equal(original.scheduledDate, '2099-01-01');
  assert.equal(original.isFocused, true);
});

for (const throws of [false, true]) {
  test(`uncertain creation ${throws ? 'exception' : 'result'} preserves the draft and blocks a second submission`, async () => {
    let attempts = 0;
    const form = await editor({ kind: 'create' }, {
      onSave: async () => {
        attempts += 1;
        if (throws) throw new Error('Connection lost');
        return false;
      },
    });
    form.input('Task title').props.onChangeText('  Keep this draft  ');
    await form.submit();
    assert.equal(form.input('Task title').props.value, '  Keep this draft  ');
    assert.equal(byId(form.view.render(), 'task-editor-save').props.disabled, true);
    await form.submit();
    assert.equal(attempts, 1);
    form.input('Task description').props.onChangeText('Retained notes');
    await form.submit();
    assert.equal(attempts, 1);
  });
}

test('failed edit preserves the draft and remains retryable with version protection', async () => {
  let attempts = 0;
  const form = await editor({ kind: 'edit', task: task() }, {
    onSave: async () => { attempts += 1; return false; },
  });
  form.input('Task title').props.onChangeText('Updated draft');
  await form.submit();
  assert.equal(form.input('Task title').props.value, 'Updated draft');
  assert.equal(byId(form.view.render(), 'task-editor-save').props.disabled, false);
  await form.submit();
  assert.equal(attempts, 2);
});

test('pending editor disables inputs and cancellation and guards programmatic saves', async () => {
  const form = await editor({ kind: 'edit', task: task() }, { pending: true });
  assert.equal(form.input('Task title').props.editable, false);
  assert.equal(byId(form.view.render(), 'task-editor-cancel').props.disabled, true);
  assert.equal(byId(form.view.render(), 'task-editor-save').props.disabled, true);
  await form.submit();
  assert.equal(form.submissions.length, 0);
});
