import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DARK_BROWN, EARTHY_CLAY, LIGHT_SAGE, SOFT_BLUSH, SOFT_WHITE } from '@/colors';
import {
  normalizeTaskChanges,
  normalizeTaskDetails,
  taskPostponement,
} from '@/domain/tasks/task-rules';
import type { Task, TaskDetails } from '@/domain/tasks/task-types';
import { HEADING_FONT_FAMILY } from '@/typography';

import { deadlineLabel, localCalendarDate } from './task-presentation';

export type TaskEditorSession =
  | { kind: 'create' }
  | { kind: 'edit' | 'postpone'; task: Task };

export type TaskEditorSubmission =
  | { kind: 'details'; details: TaskDetails }
  | { kind: 'postpone'; scheduledDate: string };

type TaskEditorProps = {
  session: TaskEditorSession;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (submission: TaskEditorSubmission) => Promise<boolean>;
};

export function TaskEditor({ session, pending, error, onCancel, onSave }: TaskEditorProps) {
  const task = 'task' in session ? session.task : null;
  const postpone = session.kind === 'postpone';
  const [draft, setDraft] = useState(() => ({
    title: task?.title ?? '',
    description: task?.description ?? '',
    scheduledDate: task?.scheduledDate ?? '',
    deadlineDate: task?.deadline?.kind === 'date' ? task.deadline.date : '',
  }));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [creationSubmitted, setCreationSubmitted] = useState(false);
  const timedDeadline = task?.deadline?.kind === 'timed' ? task.deadline : null;
  const incomplete = postpone ? !draft.scheduledDate.trim() : !draft.title.trim();
  const displayedError = creationSubmitted && !pending
    ? 'Task creation could not be confirmed. Your draft is still here. Saving it again is disabled to avoid creating a duplicate.'
    : validationError ?? error;

  const submit = async () => {
    if (pending || creationSubmitted) return;
    setValidationError(null);

    try {
      if (session.kind === 'postpone') {
        const scheduledDate = draft.scheduledDate.trim();
        taskPostponement(session.task, scheduledDate, localCalendarDate());
        await onSave({ kind: 'postpone', scheduledDate });
        return;
      }

      const input = {
        title: draft.title,
        description: draft.description,
        scheduledDate: draft.scheduledDate,
        // Existing timed deadlines remain intact until the native pickers are introduced.
        deadline: timedDeadline ?? (
          draft.deadlineDate.trim()
            ? { kind: 'date' as const, date: draft.deadlineDate }
            : null
        ),
      };
      const details = session.kind === 'edit'
        ? normalizeTaskChanges(session.task, input)
        : normalizeTaskDetails(input);

      if (session.kind === 'create') setCreationSubmitted(true);
      await onSave({ kind: 'details', details });
    } catch (failure) {
      setValidationError(failure instanceof Error ? failure.message : 'Check the task details and try again.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.heading}>
          {postpone ? 'Postpone task' : session.kind === 'create' ? 'New task' : 'Edit task'}
        </Text>

        {postpone ? (
          <Text style={styles.taskTitle}>{task?.title}</Text>
        ) : (
          <>
            <Text style={styles.label}>Title</Text>
            <TextInput
              accessibilityLabel="Task title"
              editable={!pending}
              onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
              placeholder="What needs doing?"
              placeholderTextColor={EARTHY_CLAY}
              style={styles.input}
              value={draft.title}
            />
            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              accessibilityLabel="Task description"
              editable={!pending}
              multiline
              onChangeText={(description) => setDraft((current) => ({ ...current, description }))}
              style={[styles.input, styles.description]}
              textAlignVertical="top"
              value={draft.description}
            />

            {timedDeadline ? (
              <>
                <Text style={styles.label}>Deadline</Text>
                <Text style={styles.help}>{deadlineLabel(timedDeadline)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>Deadline (optional)</Text>
                <TextInput
                  accessibilityLabel="Task deadline date"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending}
                  onChangeText={(deadlineDate) => setDraft((current) => ({ ...current, deadlineDate }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={EARTHY_CLAY}
                  style={styles.input}
                  value={draft.deadlineDate}
                />
              </>
            )}
          </>
        )}

        <Text style={styles.label}>{postpone ? 'New planned date' : 'Planned date (optional)'}</Text>
        <TextInput
          accessibilityLabel="Task planned date"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          onChangeText={(scheduledDate) => setDraft((current) => ({ ...current, scheduledDate }))}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={EARTHY_CLAY}
          style={styles.input}
          value={draft.scheduledDate}
        />
        <Text style={styles.help}>Dates use YYYY-MM-DD. Leave optional dates blank if they are not known.</Text>

        {displayedError ? <Text accessibilityRole="alert" style={styles.error}>{displayedError}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={onCancel}
          style={[styles.button, pending && styles.disabled]}
          testID="task-editor-cancel"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending || incomplete || creationSubmitted }}
          disabled={pending || incomplete || creationSubmitted}
          onPress={() => { void submit(); }}
          style={[styles.button, styles.saveButton, (pending || incomplete || creationSubmitted) && styles.disabled]}
          testID="task-editor-save"
        >
          {pending ? <ActivityIndicator accessibilityLabel="Saving task" color={DARK_BROWN} /> : (
            <Text style={styles.saveText}>{postpone ? 'Postpone' : 'Save'}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { paddingBottom: 24 },
  heading: { color: DARK_BROWN, fontFamily: HEADING_FONT_FAMILY, fontSize: 24, marginBottom: 16 },
  taskTitle: { color: DARK_BROWN, fontSize: 17, lineHeight: 25, marginBottom: 12 },
  label: { color: DARK_BROWN, fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: SOFT_WHITE, borderColor: SOFT_BLUSH, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, color: DARK_BROWN, fontSize: 16, minHeight: 48, padding: 12 },
  description: { minHeight: 110 },
  help: { color: EARTHY_CLAY, fontSize: 13, lineHeight: 20, marginTop: 8 },
  error: { color: DARK_BROWN, fontSize: 14, lineHeight: 21, marginTop: 20 },
  footer: { borderTopColor: SOFT_BLUSH, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, justifyContent: 'flex-end', paddingVertical: 12 },
  button: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 44, minWidth: 88, paddingHorizontal: 16 },
  saveButton: { backgroundColor: LIGHT_SAGE },
  saveText: { color: DARK_BROWN, fontSize: 15, fontWeight: '600' },
  cancelText: { color: EARTHY_CLAY, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
