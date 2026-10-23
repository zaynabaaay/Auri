import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import * as colors from '../src/colors.ts';
import { CHAT_MAX_WIDTH } from '../src/features/home/message-composer-layout.ts';

const source = await readFile(new URL('../src/features/home/home-conversation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

// Run the real component with controlled React commits and native layout events.
// This exercises its handlers/effect, not a separate copy of the scroll algorithm.
function harness(initialProps) {
  const hooks = [];
  const commands = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let tree;
  let props = { isResponding: false, messages: [], scrollRequest: null, ...initialProps };
  const nativeScroll = {
    scrollTo: (options) => commands.push({ kind: 'position', ...options }),
    scrollToEnd: (options) => commands.push({ kind: 'end', ...options }),
  };
  const react = {
    useRef(initial) {
      const index = cursor++;
      hooks[index] ??= { current: initial };
      return hooks[index];
    },
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (update) => {
        const next = typeof update === 'function' ? update(hooks[index].value) : update;
        if (!Object.is(next, hooks[index].value)) {
          hooks[index].value = next;
          dirty = true;
        }
      }];
    },
    useLayoutEffect(effect, dependencies) {
      const index = cursor++;
      if (!hooks[index] || dependencies.some((value, i) => !Object.is(value, hooks[index][i]))) {
        effects.push(effect);
      }
      hooks[index] = dependencies;
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (value) => value } },
    '@/colors': colors,
    '@/features/accessibility/use-reduced-motion': {},
    './message-composer-layout': { CHAT_MAX_WIDTH },
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });

  function render(update = {}) {
    props = { ...props, ...update };
    do {
      dirty = false;
      cursor = 0;
      effects = [];
      tree = module.exports.HomeConversation(props);
      tree.props.ref.current = nativeScroll;
      effects.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  function turn() {
    return tree.props.children.flat(Infinity).find((node) => node?.type === 'View');
  }
  render();
  return {
    commands,
    render,
    get tree() { return tree; },
    get minHeight() { return turn()?.props.style.minHeight; },
    viewport(height) {
      tree.props.onLayout({ nativeEvent: { layout: { height } } });
      render();
    },
    content(height) {
      tree.props.onContentSizeChange(720, height);
      render();
    },
    turn(y, height) {
      assert.ok(turn(), 'Expected a current exchange');
      turn().props.onLayout({ nativeEvent: { layout: { y, height } } });
      render();
    },
    drag() { tree.props.onScrollBeginDrag(); },
  };
}

const user = (id) => ({ id, role: 'user', content: id });
const assistant = (id) => ({ id, role: 'assistant', content: id });
const messages = [user('old'), assistant('old-reply'), user('new')];
const newExchange = () => harness({
  messages,
  scrollRequest: { kind: 'new-exchange', messageId: 'new' },
});

for (const order of [
  ['viewport', 'turn', 'content'], ['viewport', 'content', 'turn'],
  ['turn', 'viewport', 'content'], ['turn', 'content', 'viewport'],
  ['content', 'viewport', 'turn'], ['content', 'turn', 'viewport'],
]) {
  test(`a new exchange anchors once with layout order ${order.join(', ')}`, () => {
    const h = newExchange();
    const events = { viewport: () => h.viewport(600), turn: () => h.turn(624, 548), content: () => h.content(1200) };
    for (const event of order) events[event]();
    assert.deepEqual(h.commands, [{ kind: 'position', y: 600, animated: false }]);
    assert.equal(h.minHeight, 548);
  });
}

test('a short first exchange can reach the top without changing bubble spacing', () => {
  const h = harness({ messages: [user('first')], scrollRequest: { kind: 'new-exchange', messageId: 'first' } });
  h.viewport(600);
  h.turn(24, 548);
  h.content(600);
  assert.deepEqual(h.commands, [{ kind: 'position', y: 0, animated: false }]);
});

test('positioning waits for the new exchange minimum height and parent content', () => {
  const h = newExchange();
  h.viewport(600);
  h.content(1000);
  h.turn(624, 100);
  assert.deepEqual(h.commands, []);
  h.turn(624, 548);
  assert.deepEqual(h.commands, []);
  h.content(1200);
  assert.equal(h.commands.length, 1);
});

test('a reply, thinking-indicator change, and long response never force another scroll', () => {
  const h = newExchange();
  h.viewport(600);
  h.turn(624, 548);
  h.content(1200);
  h.render({ isResponding: true });
  h.render({ messages: [...messages, assistant('reply')], isResponding: false });
  h.turn(624, 1200);
  h.content(1852);
  assert.equal(h.commands.length, 1);
});

test('keyboard resizing and composer expansion update available space without scrolling', () => {
  const h = newExchange();
  h.viewport(600);
  h.turn(624, 548);
  h.content(1200);
  h.viewport(400);
  assert.equal(h.minHeight, 348);
  h.turn(624, 348);
  h.content(1000);
  h.viewport(320);
  assert.equal(h.minHeight, 268);
  h.turn(624, 268);
  h.content(920);
  h.viewport(600);
  h.turn(624, 548);
  h.content(1200);
  assert.equal(h.commands.length, 1);
});

test('only an explicit successful-send request positions the next exchange', () => {
  const h = newExchange();
  h.viewport(600);
  h.turn(624, 548);
  h.content(1200);
  h.render({ messages: [...messages, assistant('reply'), user('next')] });
  h.turn(1000, 548);
  h.content(1576);
  assert.equal(h.commands.length, 1, 'a stale request must not position another message');
  h.render({ scrollRequest: { kind: 'new-exchange', messageId: 'next' } });
  assert.deepEqual(h.commands[1], { kind: 'position', y: 976, animated: false });
});

test('restoration waits for restored content and shows its end exactly once', () => {
  const h = harness();
  h.viewport(600);
  h.content(600);
  h.render({ messages: [user('saved'), assistant('saved-reply')], scrollRequest: { kind: 'restore' } });
  assert.deepEqual(h.commands, []);
  h.turn(24, 1200);
  assert.deepEqual(h.commands, []);
  h.content(1252);
  assert.deepEqual(h.commands, [{ kind: 'end', animated: false }]);
  assert.equal(h.minHeight, 0, 'restoration must not add exchange padding');
  h.viewport(400);
  h.render({ messages: [user('saved'), assistant('recovered-reply')] });
  h.turn(24, 1500);
  h.content(1552);
  assert.equal(h.commands.length, 1);
});

test('short restored conversations retain their existing bottom-aligned presentation', () => {
  const h = harness({ messages: [user('saved')], scrollRequest: { kind: 'restore' } });
  h.viewport(600);
  h.content(600);
  h.turn(422, 150);
  assert.deepEqual(h.commands, [{ kind: 'end', animated: false }]);
  assert.equal(h.minHeight, 0);
  assert.equal(h.tree.props.contentContainerStyle.justifyContent, 'flex-end');
});

test('empty and assistant-only restoration does not require a user-message anchor', () => {
  for (const restoredMessages of [[], [assistant('saved-reply')]]) {
    const h = harness({ messages: restoredMessages, scrollRequest: { kind: 'restore' } });
    h.viewport(600);
    h.content(600);
    assert.deepEqual(h.commands, [{ kind: 'end', animated: false }]);
  }
});

test('user scrolling takes priority over an outstanding automatic request', () => {
  for (const scrollRequest of [{ kind: 'restore' }, { kind: 'new-exchange', messageId: 'new' }]) {
    const h = harness({ messages, scrollRequest });
    h.viewport(600);
    h.drag();
    h.turn(624, 548);
    h.content(1200);
    assert.deepEqual(h.commands, []);
  }
});

test('clearing a conversation cancels its pending scroll before the next conversation', () => {
  const h = newExchange();
  h.viewport(600);
  h.render({ messages: [], scrollRequest: null });
  h.content(600);
  assert.deepEqual(h.commands, []);
  h.render({ messages: [user('fresh')], scrollRequest: { kind: 'new-exchange', messageId: 'fresh' } });
  h.turn(24, 548);
  assert.deepEqual(h.commands, [{ kind: 'position', y: 0, animated: false }]);
});

test('all messages render once in chronological order with existing keyboard props', () => {
  const h = harness({ messages: [...messages, assistant('reply')] });
  const rendered = [];
  function visit(node) {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      if (node.type?.name === 'MessageItem') rendered.push(node.props.message.id);
      visit(node.props?.children);
    }
  }
  visit(h.tree);
  assert.deepEqual(rendered, ['old', 'old-reply', 'new', 'reply']);
  assert.equal(h.tree.props.keyboardDismissMode, 'interactive');
  assert.equal(h.tree.props.keyboardShouldPersistTaps, 'handled');
});
