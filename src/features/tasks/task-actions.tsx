import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  DARK_BROWN,
  EARTHY_CLAY,
  SOFT_BLUSH,
  SOFT_WHITE,
} from '@/colors';
import type { Task, TaskStatus } from '@/domain/tasks/task-types';

type TaskActionsProps = {
  task: Task | null;
  disabled: boolean;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onPostpone: (task: Task) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  onFocus: (task: Task, selected: boolean) => void;
};

export function TaskActions({
  task,
  disabled,
  onClose,
  onEdit,
  onPostpone,
  onStatus,
  onFocus,
}: TaskActionsProps) {
  if (!task) return null;

  const actions = task.status === 'active'
    ? [
        { label: 'Edit', run: () => onEdit(task) },
        {
          label: task.isFocused ? 'Remove from Focus' : 'Add to Focus',
          run: () => onFocus(task, !task.isFocused),
        },
        { label: 'Postpone', run: () => onPostpone(task) },
        { label: 'Dismiss', run: () => onStatus(task, 'dismissed') },
      ]
    : [
        { label: 'Edit', run: () => onEdit(task) },
        { label: 'Reactivate', run: () => onStatus(task, 'active') },
      ];

  return (
    <Modal
      onRequestClose={onClose}
      transparent
      visible
    >
      <View style={styles.overlay}>
        <Pressable
          accessible={false}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />

        <ScrollView
          accessibilityViewIsModal
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.dialog}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={styles.title}
          >
            {task.title}
          </Text>

          {actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              key={action.label}
              onPress={() => {
                onClose();
                action.run();
              }}
              style={({ pressed }) => [
                styles.action,
                disabled && styles.disabled,
                pressed && !disabled && styles.pressed,
              ]}
            >
              <Text style={styles.actionText}>{action.label}</Text>
            </Pressable>
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.action}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    backgroundColor: DARK_BROWN,
    opacity: 0.25,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: SOFT_WHITE,
    borderColor: SOFT_BLUSH,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
    maxHeight: '100%',
    maxWidth: 420,
    width: '100%',
  },
  content: {
    padding: 18,
  },
  title: {
    color: DARK_BROWN,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 23,
    marginBottom: 12,
  },
  action: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  actionText: {
    color: DARK_BROWN,
    fontSize: 15,
  },
  cancelText: {
    color: EARTHY_CLAY,
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
