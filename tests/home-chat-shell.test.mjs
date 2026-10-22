import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { APP_BACKGROUND, MESSAGE_INPUT_BACKGROUND } from '../src/colors.ts';
import { messageSendEnabled } from '../src/features/home/message-composer-layout.ts';
import { finishConversationLifecycle } from '../src/services/conversations/conversation-finish-lifecycle.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function homeFinishHarness(service, process) {
  // Execute the actual Home handler with controlled I/O, without mocking its logic.
  const source = await read('../src/features/home/home-screen.tsx');
  const file = ts.createSourceFile('home-screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'finishConversation') {
      handler = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(handler);
  const state = {
    messages: [{ content: 'Existing conversation' }],
    activeConversation: { id: 'old-chat' },
    activeRequestId: { current: 0 },
    isResponding: false,
    isFinishing: false,
    isSavingMessage: false,
    isRestoring: false,
    persistenceError: null,
    completionNotice: null,
    finishError: null,
    conversationService: service,
    finishConversationLifecycle,
    processCompletedConversation: process,
    processConversationMemory: async () => undefined,
    setIsFinishing: (value) => { state.isFinishing = value; },
    setFinishError: (value) => { state.finishError = value; },
    setCompletionNotice: (value) => { state.completionNotice = value; },
    resetActiveConversation: () => {
      state.activeRequestId.current += 1;
      state.messages = [];
      state.activeConversation = { id: 'new-chat' };
    },
  };
  const code = ts.transpileModule(`(${handler.getText(file)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { state, finish: runInNewContext(code, state) };
}

test('saved Home chat releases Send while Project processing is still pending', async () => {
  const save = deferred();
  const background = deferred();
  const started = deferred();
  let saves = 0;
  const { state, finish } = await homeFinishHarness({
    finishConversation: () => { saves += 1; return save.promise; },
  }, () => { started.resolve(); return background.promise; });

  const pending = finish();
  assert.equal(messageSendEnabled('Hello', state), false, 'a real save must block Send');
  await finish();
  assert.equal(saves, 1, 'duplicate finalization must remain blocked');
  save.resolve({ conversation: { id: 'old-chat' } });
  await started.promise;
  assert.equal(state.completionNotice, 'Conversation saved to Chats.');
  assert.equal(state.messages.length, 0);
  assert.equal(messageSendEnabled('Hello', state), true, 'post-save processing must not lock the new chat');
  background.resolve({ status: 'processed' });
  await pending;
});

test('failed Home save preserves the transcript and releases the saving lock', async () => {
  const { state, finish } = await homeFinishHarness({
    finishConversation: async () => { throw new Error('save unavailable'); },
  }, async () => assert.fail('processing must not run after a failed save'));
  await finish();
  assert.equal(state.messages.length, 1);
  assert.equal(state.activeConversation.id, 'old-chat');
  assert.equal(state.completionNotice, null);
  assert.match(state.finishError, /Nothing was cleared/);
  assert.equal(messageSendEnabled('Hello', state), true);
});

test('late Project processing cannot unlock a newer save or overwrite its notices', async () => {
  const background = deferred();
  const started = deferred();
  const nextSave = deferred();
  let saves = 0;
  const { state, finish } = await homeFinishHarness({
    finishConversation: () => ++saves === 1
      ? Promise.resolve({ conversation: { id: 'old-chat' } }) : nextSave.promise,
  }, (id) => {
    if (id !== 'old-chat') return Promise.resolve({ status: 'processed' });
    started.resolve();
    return background.promise;
  });
  const first = finish();
  await started.promise;
  assert.equal(messageSendEnabled('Hello', state), true);

  // A new message advances the existing request generation before the next Finish.
  state.activeRequestId.current += 1;
  state.messages = [{ content: 'New conversation' }];
  const second = finish();
  assert.equal(saves, 2);
  assert.equal(messageSendEnabled('Hello', state), false);
  background.reject(new Error('old processing failed'));
  await first;
  assert.equal(messageSendEnabled('Hello', state), false, 'the newer save still owns its lock');
  assert.equal(state.completionNotice, null);
  assert.equal(state.finishError, null);
  nextSave.resolve({ conversation: { id: 'new-chat' } });
  await second;
  assert.equal(messageSendEnabled('Hello', state), true);
  assert.equal(state.completionNotice, 'Conversation saved to Chats.');
});

test('Home is a minimal conversation shell with the approved background without the dashboard clock', async () => {
  const home = await read('../src/features/home/home-screen.tsx');
  assert.match(home, /backgroundColor: APP_BACKGROUND/);
  assert.match(home, /<StatusBar style="dark"/);
  assert.match(home, /<Text style=\{styles\.headerTitle\}>Auri<\/Text>/);
  assert.doesNotMatch(home, /TIME_FORMATTER|DATE_FORMATTER|useCurrentDate|styles\.time|styles\.date/);
});

test('New Chat presents the existing safe finalization lifecycle', async () => {
  const home = await read('../src/features/home/home-screen.tsx');
  assert.match(home, /\{isFinishing \? 'Saving…' : 'New Chat'\}/);
  assert.match(home, /onNewChat=\{finishConversation\}/);
  assert.match(home, /finishConversationLifecycle\(\{/);
  assert.match(home, /process: processCompletedConversation/);
  assert.match(home, /processMemory: processConversationMemory/);
  assert.match(home, /reset: resetActiveConversation/);
  assert.doesNotMatch(home, />Finish</);
});

test('the menu opens an overlay Chats drawer with outside-tap close and saved-chat navigation', async () => {
  const [home, drawer] = await Promise.all([
    read('../src/features/home/home-screen.tsx'),
    read('../src/features/home/chats-drawer.tsx'),
  ]);
  assert.match(home, /testID="open-chats-drawer"/);
  assert.match(home, /setDrawerOpen\(true\)/);
  assert.match(drawer, /testID="chats-drawer-backdrop"/);
  assert.match(drawer, /onPress=\{onClose\}/);
  assert.match(drawer, /PanResponder\.create/);
  assert.match(drawer, /<ChatsList compact/);
  assert.match(home, /pathname: '\/history\/\[id\]'/);
  assert.match(home, /router\.push\('\/history'/);
});

test('drawer state is an overlay sibling and cannot remount or clear the controlled composer', async () => {
  const [home, drawer, composerSource] = await Promise.all([
    read('../src/features/home/home-screen.tsx'),
    read('../src/features/home/chats-drawer.tsx'),
    read('../src/features/home/message-composer.tsx'),
  ]);
  const composer = home.indexOf('<MessageComposer');
  const drawerStart = home.indexOf('<ChatsDrawer', composer);
  const keyboardEnd = home.indexOf('</KeyboardAvoidingView>', drawerStart);
  assert.ok(composer > 0 && drawerStart > composer && keyboardEnd > drawerStart);
  assert.equal((home.match(/<MessageComposer/g) ?? []).length, 1);
  assert.doesNotMatch(drawer, /setDraft|resetComposer|setActiveConversation/);
  assert.match(composerSource, /value=\{draft\}/);
});

test('the composer has no prompt placeholder and preserves draft text across blur and refocus', async () => {
  const composer = await read('../src/features/home/message-composer.tsx');
  const inputStart = composer.indexOf('<TextInput');
  const input = composer.slice(inputStart, composer.indexOf('/>', inputStart));
  assert.doesNotMatch(composer, /Ask anything/);
  assert.doesNotMatch(input, /placeholder=/);
  assert.match(input, /value=\{draft\}/);
  assert.doesNotMatch(input, /onBlur=/);
  assert.doesNotMatch(composer, /isFocused|composerFocused|setIsFocused/);
  assert.equal((composer.match(/<TextInput/g) ?? []).length, 1);
});

test('send states are visual, disabled while unavailable, and guarded during requests', async () => {
  const [home, composer] = await Promise.all([
    read('../src/features/home/home-screen.tsx'),
    read('../src/features/home/message-composer.tsx'),
  ]);
  assert.match(home, /messageSendEnabled\(draft/);
  assert.match(composer, /disabled=\{!canSend\}/);
  assert.match(composer, /accessibilityState=\{\{ busy: isBusy, disabled: !canSend \}\}/);
  assert.match(composer, /sendButtonDisabled/);
  assert.match(home, /isBusy=\{isSavingMessage \|\| isResponding\}/);
  assert.match(home, /if \(!text \|\| isResponding \|\| isSavingMessage/);
});

test('Auri uses a reduced-motion-aware inline thinking indicator without status copy', async () => {
  const [home, reducedMotion] = await Promise.all([
    read('../src/features/home/home-screen.tsx'),
    read('../src/features/accessibility/use-reduced-motion.ts'),
  ]);
  assert.doesNotMatch(home, /Responding…/);
  assert.match(home, /testID="thinking-indicator"/);
  assert.match(home, /accessibilityLabel="Auri is thinking"/);
  assert.match(home, /Animated\.loop/);
  assert.match(reducedMotion, /isReduceMotionEnabled/);
});

test('keyboard, safe-area, active restoration, and Chats routes remain wired', async () => {
  const [home, composer, chats, detail] = await Promise.all([
    read('../src/features/home/home-screen.tsx'),
    read('../src/features/home/message-composer.tsx'),
    read('../src/app/history/index.tsx'),
    read('../src/app/history/[id].tsx'),
  ]);
  assert.match(home, /<SafeAreaView/);
  assert.match(home, /<KeyboardAvoidingView[\s\S]*behavior=\{KEYBOARD_AVOIDING_BEHAVIOR\}/);
  assert.match(home, /keyboardVerticalOffset=\{0\}/);
  assert.match(home, /keyboardView: \{ flex: 1, position: 'relative' \}/);
  assert.doesNotMatch(home, /<View style=\{styles\.shell\}>/);
  assert.match(home, /conversationService\.getActiveConversation\(\)/);
  assert.match(composer, /keyboardAppearance="dark"/);
  assert.match(chats, /<ChatsList/);
  assert.match(detail, /record\.conversation\.title/);
  assert.match(chats, /backgroundColor: APP_BACKGROUND/);
  assert.match(detail, /backgroundColor: APP_BACKGROUND/);
});


test('approved page and message-input colours are shared across screens', async () => {
  assert.equal(APP_BACKGROUND, '#F8F5F0');
  assert.equal(MESSAGE_INPUT_BACKGROUND, '#FDF9F6');
  const screens = [
    'app/_layout.tsx', 'app/(shell)/_layout.tsx', 'app/+html.tsx',
    'app/account.tsx', 'app/calendar-test.tsx',
    'app/history/index.tsx', 'app/history/[id].tsx',
    'features/auth/auth-loading-screen.tsx', 'features/auth/sign-in-screen.tsx',
    'features/home/home-screen.tsx', 'features/home/chats-drawer.tsx',
    'features/projects/new-project-screen.tsx', 'features/projects/project-screen.tsx',
    'features/projects/projects-screen.tsx',
  ];
  for (const screen of screens) {
    const source = await read(`../src/${screen}`);
    assert.match(source, /backgroundColor: APP_BACKGROUND/, screen);
    assert.doesNotMatch(source, /#EAF4FF/, screen);
  }
  const composer = await read('../src/features/home/message-composer.tsx');
  assert.match(composer, /backgroundColor: MESSAGE_INPUT_BACKGROUND/);
  assert.match(composer, /input: \{\s+color: '#25364A'/);
  assert.doesNotMatch(composer, /#19191B|#F7F7F8/);
  const chats = await read('../src/features/chats/chats-list.tsx');
  assert.match(chats, /compactTitle: \{ fontSize:/);
});
