import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHAT_MAX_WIDTH,
  MESSAGE_INPUT_MAX_HEIGHT,
  MESSAGE_INPUT_MIN_HEIGHT,
  messageInputHeight,
  messageInputScrollEnabled,
  messageSendEnabled,
} from '../src/features/home/message-composer-layout.ts';

test('conversation and composer share a responsive centered column without constraining the shell', async () => {
  const [home, conversation, composer, shell] = await Promise.all([
    readFile(new URL('../src/features/home/home-screen.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/home/home-conversation.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/home/message-composer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/(shell)/_layout.tsx', import.meta.url), 'utf8'),
  ]);

  assert.equal(CHAT_MAX_WIDTH, 720);
  for (const [source, styleName] of [[conversation, 'conversationContent'], [composer, 'composerShell']]) {
    assert.match(source, /import \{[\s\S]*CHAT_MAX_WIDTH[\s\S]*\} from '\.\/message-composer-layout'/);
    const style = source.match(new RegExp(`${styleName}: \\{([^}]+)\\}`))?.[1];
    assert.ok(style, `${styleName} must define the column directly`);
    assert.match(style, /alignSelf: 'center'/);
    assert.match(style, /maxWidth: CHAT_MAX_WIDTH/);
    assert.match(style, /width: '100%'/);
    assert.doesNotMatch(style, /(?:minWidth|flexBasis):/);
  }

  assert.match(conversation, /contentContainerStyle=\{styles\.conversationContent\}/);
  assert.match(composer, /<View style=\{styles\.composerShell\} testID="composer-shell">/);
  assert.match(conversation, /userMessage: \{\s*alignSelf: 'flex-end'/);
  assert.match(conversation, /assistantMessage: \{\s*alignSelf: 'flex-start'/);
  assert.match(conversation, /conversation: \{ flex: 1 \}/);
  assert.doesNotMatch(home.match(/header: \{([^}]+)\}/)?.[1] ?? '', /maxWidth|width:/);
  assert.doesNotMatch(shell, /CHAT_MAX_WIDTH|maxWidth:/);
});

test('the composer grows with wrapped content, caps its height, and then scrolls', () => {
  assert.equal(messageInputHeight(12), MESSAGE_INPUT_MIN_HEIGHT);
  assert.equal(messageInputHeight(67.2), 68);
  assert.equal(messageInputHeight(500), MESSAGE_INPUT_MAX_HEIGHT);
  assert.equal(messageInputHeight(Number.NaN), MESSAGE_INPUT_MIN_HEIGHT);
  assert.equal(messageInputScrollEnabled(68), false);
  assert.equal(messageInputScrollEnabled(MESSAGE_INPUT_MAX_HEIGHT), true);
});

test('send availability distinguishes empty, ready, and in-flight composer states', () => {
  const idle = {
    isFinishing: false,
    isResponding: false,
    isRestoring: false,
    isSavingMessage: false,
  };
  assert.equal(messageSendEnabled('', idle), false);
  assert.equal(messageSendEnabled('   ', idle), false);
  assert.equal(messageSendEnabled('Ready to send', idle), true);
  assert.equal(messageSendEnabled('No duplicate', { ...idle, isSavingMessage: true }), false);
  assert.equal(messageSendEnabled('Wait for Auri', { ...idle, isResponding: true }), false);
  assert.equal(messageSendEnabled('Still saving', { ...idle, isFinishing: true }), false);
  assert.equal(messageSendEnabled('Still restoring', { ...idle, isRestoring: true }), false);
});

test('the shared composer measures controlled text independently of native input events', async () => {
  const [source, homeSource] = await Promise.all([
    readFile(new URL(
      '../src/features/home/message-composer.tsx',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../src/features/home/home-screen.tsx',
      import.meta.url,
    ), 'utf8'),
  ]);
  const inputStart = source.indexOf('<TextInput');
  const inputSource = source.slice(inputStart, source.indexOf('/>', inputStart));

  assert.match(source, /multiline/);
  assert.doesNotMatch(source, /numberOfLines=/);
  assert.match(source, /style=\{styles\.inputFrame\}/);
  assert.match(source, /style=\{styles\.inputSizer\}/);
  assert.match(source, /\{draft \|\| ' '\}/);
  assert.match(source, /onLayout=\{\(\{ nativeEvent \}\) => onInputHeightChange\(nativeEvent\.layout\.height\)\}/);
  assert.doesNotMatch(inputSource, /onContentSizeChange=/);
  assert.match(source, /minWidth: 0/);
  assert.match(source, /width: '100%'/);
  assert.match(source, /scrollEnabled=\{messageInputScrollEnabled\(inputHeight\)\}/);
  assert.match(source, /disabled=\{!canSend\}/);
  assert.match(source, /accessibilityState=\{\{ busy: isBusy, disabled: !canSend \}\}/);
  assert.match(source, /onPress=\{onSend\}/);
  assert.doesNotMatch(inputSource, /placeholder=/);
  assert.match(homeSource, /<KeyboardAvoidingView[\s\S]*behavior=\{KEYBOARD_AVOIDING_BEHAVIOR\}/);
  assert.match(homeSource, /keyboardVerticalOffset=\{0\}/);
});
