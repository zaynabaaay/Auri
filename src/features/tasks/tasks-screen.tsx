import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  APP_BACKGROUND,
  DARK_BROWN,
  DARK_SAGE,
  EARTHY_CLAY,
  LIGHT_SAGE,
  SOFT_BLUSH,
} from '@/colors';
import type { Task } from '@/domain/tasks/task-types';
import { useAuth } from '@/features/auth/auth-provider';
import { SupabaseTaskRepository } from '@/services/tasks/supabase-task-repository';
import { HEADING_FONT_FAMILY } from '@/typography';

import { TaskActions } from './task-actions';
import { TaskCard } from './task-card';
import {
  TaskEditor,
  type TaskEditorSession,
  type TaskEditorSubmission,
} from './task-editor';
import { localCalendarDate, taskCollections } from './task-presentation';
import { useTasks } from './use-tasks';

type TaskSection = { key: string; title: string; data: Task[] };

function FocusSeparator() {
  return <View style={styles.separator} />;
}

export function TasksWorkspace({ userId }: { userId: string }) {
  const repository = useMemo(() => new SupabaseTaskRepository(userId), [userId]);
  const { tasks, ready, loading, pending, error, refresh, save } = useTasks(repository);
  const [view, setView] = useState<'focus' | 'all'>('focus');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editor, setEditor] = useState<TaskEditorSession | null>(null);
  const collections = useMemo(() => taskCollections(tasks), [tasks]);
  const menuTask = tasks.find((task) => task.id === menuId) ?? null;

  const sections: TaskSection[] = view === 'focus'
    ? collections.focused.length > 0
      ? [{ key: 'focus', title: '', data: collections.focused }]
      : []
    : [
        { key: 'active', title: 'Active', data: collections.active },
        { key: 'completed', title: 'Completed', data: collections.completed },
        { key: 'dismissed', title: 'Dismissed', data: collections.dismissed },
      ].filter((section) => section.data.length > 0);

  const submit = async (submission: TaskEditorSubmission): Promise<boolean> => {
    if (!editor) return false;

    const session = editor;
    const confirmed = await save((service) => {
      if (session.kind === 'postpone' && submission.kind === 'postpone') {
        return service.postpone(session.task, submission.scheduledDate, localCalendarDate());
      }

      if (submission.kind === 'details') {
        if (session.kind === 'create') return service.create(submission.details);
        if (session.kind === 'edit') return service.edit(session.task, submission.details);
      }

      return Promise.reject(new Error('Invalid task editor submission.'));
    });

    if (confirmed) {
      setEditor(null);
      if (session.kind === 'create') setView('all');
    }

    return confirmed;
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen} testID="tasks-screen">
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Tasks</Text>
        {!editor ? (
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading || pending }}
              disabled={loading || pending}
              onPress={() => { void refresh(); }}
              style={[styles.headerButton, (loading || pending) && styles.disabled]}
              testID="tasks-refresh"
            >
              <Text style={styles.actionText}>{loading && ready ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="New task"
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready || pending }}
              disabled={!ready || pending}
              onPress={() => setEditor({ kind: 'create' })}
              style={[styles.headerButton, (!ready || pending) && styles.disabled]}
              testID="tasks-new"
            >
              <Text style={styles.actionText}>+ New</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        {editor ? (
          <TaskEditor
            key={`${editor.kind}-${'task' in editor ? editor.task.id : 'new'}`}
            error={error}
            onCancel={() => setEditor(null)}
            onSave={submit}
            pending={pending}
            session={editor}
          />
        ) : (
          <>
            <View style={styles.tabs}>
              {(['focus', 'all'] as const).map((tab) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: view === tab }}
                  key={tab}
                  onPress={() => setView(tab)}
                  style={[styles.tab, view === tab && styles.selectedTab]}
                  testID={`tasks-view-${tab}`}
                >
                  <Text style={[styles.tabText, view === tab && styles.selectedText]}>
                    {tab === 'focus' ? 'Focus' : 'All Tasks'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
            {pending ? <Text accessibilityLiveRegion="polite" style={styles.notice}>Saving…</Text> : null}

            {!ready ? (
              <View style={styles.empty}>
                {loading ? (
                  <ActivityIndicator accessibilityLabel="Loading tasks" color={DARK_SAGE} />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => { void refresh(); }}
                    style={styles.headerButton}
                    testID="tasks-retry"
                  >
                    <Text style={styles.actionText}>Try again</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <SectionList<Task, TaskSection>
                contentContainerStyle={styles.list}
                ItemSeparatorComponent={view === 'focus' ? FocusSeparator : undefined}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(task) => task.id}
                ListEmptyComponent={(
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>
                      {view === 'focus' ? 'Nothing in Focus yet' : 'No tasks yet'}
                    </Text>
                    <Text style={styles.emptyText}>
                      {view === 'focus'
                        ? 'Choose tasks from All Tasks to work on here.'
                        : 'Create a task to get started.'}
                    </Text>
                    {view === 'focus' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setView('all')}
                        style={styles.chooseButton}
                        testID="tasks-choose-focus"
                      >
                        <Text style={styles.selectedText}>Choose tasks</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
                refreshControl={(
                  <RefreshControl
                    enabled={!pending}
                    onRefresh={() => { void refresh(); }}
                    refreshing={loading}
                    tintColor={DARK_SAGE}
                  />
                )}
                renderItem={({ item }) => (
                  <TaskCard
                    disabled={pending}
                    onManage={(task) => setMenuId(task.id)}
                    onStatus={(task, status) => { void save((service) => service.setStatus(task, status)); }}
                    presentation={view === 'focus' ? 'focus' : 'overview'}
                    task={item}
                  />
                )}
                renderSectionHeader={({ section }) => section.title ? (
                  <Text accessibilityRole="header" style={styles.sectionHeading}>
                    {section.title} ({section.data.length})
                  </Text>
                ) : null}
                sections={sections}
                stickySectionHeadersEnabled={false}
                style={styles.flex}
                testID="tasks-list"
              />
            )}
          </>
        )}
      </View>

      <TaskActions
        disabled={pending}
        onClose={() => setMenuId(null)}
        onEdit={(task) => setEditor({ kind: 'edit', task })}
        onFocus={(task, selected) => { void save((service) => service.setFocus(task, selected)); }}
        onPostpone={(task) => setEditor({ kind: 'postpone', task })}
        onStatus={(task, status) => { void save((service) => service.setStatus(task, status)); }}
        task={menuTask}
      />
    </SafeAreaView>
  );
}

export default function TasksScreen() {
  const { user } = useAuth();
  return user ? <TasksWorkspace key={user.id} userId={user.id} /> : null;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: APP_BACKGROUND, flex: 1 },
  flex: { flex: 1 },
  header: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between',
    minHeight: 64, paddingHorizontal: 18,
  },
  title: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 28 },
  headerActions: { alignItems: 'center', flexDirection: 'row' },
  headerButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 10 },
  actionText: { color: EARTHY_CLAY, fontSize: 14, fontWeight: '600' },
  body: { alignSelf: 'center', flex: 1, maxWidth: 720, paddingHorizontal: 18, width: '100%' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tab: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 44, paddingHorizontal: 18 },
  selectedTab: { backgroundColor: LIGHT_SAGE },
  tabText: { color: DARK_BROWN, fontSize: 15 },
  selectedText: { color: DARK_BROWN, fontSize: 15, fontWeight: '600' },
  notice: { borderBottomColor: SOFT_BLUSH, borderBottomWidth: StyleSheet.hairlineWidth, color: DARK_BROWN, paddingVertical: 12 },
  list: { flexGrow: 1, paddingBottom: 24 },
  separator: { height: 16 },
  sectionHeading: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 18, marginBottom: 4, marginTop: 16 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 36 },
  emptyTitle: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 22, textAlign: 'center' },
  emptyText: { color: DARK_BROWN, fontSize: 15, lineHeight: 23, marginTop: 10, textAlign: 'center' },
  chooseButton: { backgroundColor: LIGHT_SAGE, borderRadius: 12, justifyContent: 'center', marginTop: 20, minHeight: 44, paddingHorizontal: 18 },
  disabled: { opacity: 0.45 },
});
