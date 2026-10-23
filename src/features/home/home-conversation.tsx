import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ASSISTANT_MESSAGE_BACKGROUND, MESSAGE_TEXT_COLOR, USER_MESSAGE_BACKGROUND } from '@/colors';
import type { ConversationMessage } from '@/domain/conversations';
import { useReducedMotion } from '@/features/accessibility/use-reduced-motion';

import { CHAT_MAX_WIDTH } from './message-composer-layout';

export type ConversationScrollRequest =
  | { kind: 'restore' }
  | { kind: 'new-exchange'; messageId: string };

type HomeConversationProps = {
  isResponding: boolean;
  messages: ConversationMessage[];
  scrollRequest: ConversationScrollRequest | null;
};

function MessageItem({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';

  return (
    <View style={isUser ? styles.userMessage : styles.assistantMessage}>
      <Text style={isUser ? styles.userMessageText : styles.assistantMessageText}>
        {message.content}
      </Text>
    </View>
  );
}

export function HomeConversation({
  isResponding,
  messages,
  scrollRequest,
}: HomeConversationProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const appliedRequest = useRef<ConversationScrollRequest | null>(null);
  const [layout, setLayout] = useState({
    viewportHeight: 0,
    contentHeight: 0,
    turnId: null as string | null,
    turnY: 0,
    turnHeight: 0,
  });

  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const latestUserId = messages[latestUserIndex]?.id ?? null;
  const previousMessages = latestUserIndex < 0 ? messages : messages.slice(0, latestUserIndex);
  const currentMessages = latestUserIndex < 0 ? [] : messages.slice(latestUserIndex);
  const { paddingTop, paddingBottom } = styles.conversationContent;
  const positionNewExchange = scrollRequest?.kind === 'new-exchange' &&
    scrollRequest.messageId === latestUserId;
  const turnMinHeight = positionNewExchange
    ? Math.max(0, layout.viewportHeight - paddingTop - paddingBottom)
    : 0;

  useLayoutEffect(() => {
    const scrollView = scrollViewRef.current;
    if (!scrollView || !scrollRequest || appliedRequest.current === scrollRequest ||
      layout.viewportHeight <= 0 || layout.contentHeight <= 0) return;

    // The current exchange and its parent content can report layout in either order.
    if (latestUserId !== null && (layout.turnId !== latestUserId ||
      layout.contentHeight + 1 < layout.turnY + layout.turnHeight + paddingBottom)) return;

    if (scrollRequest.kind === 'restore') {
      scrollView.scrollToEnd({ animated: false });
    } else {
      if (scrollRequest.messageId !== latestUserId || layout.turnHeight + 1 < turnMinHeight) return;
      const y = Math.max(0, layout.turnY - paddingTop);
      if (layout.contentHeight + 1 < y + layout.viewportHeight) return;
      scrollView.scrollTo({ y, animated: false });
    }
    appliedRequest.current = scrollRequest;
  }, [scrollRequest, layout, latestUserId, paddingTop, paddingBottom, turnMinHeight]);

  return (
    <ScrollView
      contentContainerStyle={styles.conversationContent}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onLayout={({ nativeEvent }) => {
        const viewportHeight = nativeEvent.layout.height;
        setLayout((current) => current.viewportHeight === viewportHeight
          ? current : { ...current, viewportHeight });
      }}
      onContentSizeChange={(_, contentHeight) => {
        setLayout((current) => current.contentHeight === contentHeight
          ? current : { ...current, contentHeight });
      }}
      onScrollBeginDrag={() => {
        // An intentional user scroll takes priority over an outstanding request.
        appliedRequest.current = scrollRequest;
      }}
      ref={scrollViewRef}
      showsVerticalScrollIndicator={false}
      style={styles.conversation}
      testID="conversation-scroll"
    >
      {previousMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {latestUserId ? (
        <View
          key={latestUserId}
          onLayout={({ nativeEvent }) => {
            const { y: turnY, height: turnHeight } = nativeEvent.layout;
            setLayout((current) => current.turnId === latestUserId &&
              current.turnY === turnY && current.turnHeight === turnHeight
              ? current : { ...current, turnId: latestUserId, turnY, turnHeight });
          }}
          style={{ minHeight: turnMinHeight }}
        >
          {currentMessages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
          {isResponding ? <ThinkingIndicator /> : null}
        </View>
      ) : (
        isResponding ? <ThinkingIndicator /> : null
      )}
    </ScrollView>
  );
}

function ThinkingIndicator() {
  const [progress] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(0.5);
      return;
    }
    const animation = Animated.loop(Animated.timing(progress, {
      duration: 1050,
      toValue: 1,
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  return (
    <View
      accessibilityLabel="Auri is thinking"
      accessibilityLiveRegion="polite"
      style={styles.thinkingIndicator}
      testID="thinking-indicator"
    >
      {[0, 1, 2].map((index) => (
        <Animated.View
          key={index}
          style={[
            styles.thinkingDot,
            {
              opacity: reducedMotion ? 0.55 : progress.interpolate({
                inputRange: [0, 0.08 + index * 0.18, 0.38 + index * 0.18, 1],
                outputRange: [0.25, 0.25, 0.9, 0.25],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  conversation: { flex: 1 },
  conversationContent: {
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'flex-end',
    maxWidth: CHAT_MAX_WIDTH,
    paddingBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    width: '100%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: USER_MESSAGE_BACKGROUND,
    borderRadius: 18,
    marginTop: 20,
    maxWidth: '82%',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  userMessageText: { color: MESSAGE_TEXT_COLOR, fontSize: 16, lineHeight: 23 },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: ASSISTANT_MESSAGE_BACKGROUND,
    borderRadius: 18,
    marginTop: 25,
    maxWidth: '94%',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  assistantMessageText: {
    color: MESSAGE_TEXT_COLOR,
    fontSize: 17,
    letterSpacing: -0.1,
    lineHeight: 27,
  },
  thinkingIndicator: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 5,
    height: 28,
    marginTop: 22,
    paddingHorizontal: 2,
  },
  thinkingDot: { backgroundColor: '#929297', borderRadius: 3, height: 6, width: 6 },
});
