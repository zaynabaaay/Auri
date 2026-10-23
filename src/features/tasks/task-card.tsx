import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DARK_BROWN,
  EARTHY_CLAY,
  LIGHT_SAGE,
  SOFT_BLUSH,
  SOFT_WHITE,
} from '@/colors';
import type { Task, TaskStatus } from '@/domain/tasks/task-types';
import { HEADING_FONT_FAMILY } from '@/typography';

import {
  calendarDateLabel,
  deadlineLabel,
} from './task-presentation';

type TaskCardProps = {
  task: Task;
  presentation: 'overview' | 'focus';
  disabled: boolean;
  onStatus: (task: Task, status: TaskStatus) => void;
  onManage: (task: Task) => void;
};

export function TaskCard({
  task,
  presentation,
  disabled,
  onStatus,
  onManage,
}: TaskCardProps) {
  const overview = presentation === 'overview';
  const active = task.status === 'active';

  const completeControl = active ? (
    <Pressable
      accessibilityLabel={`Complete task: ${task.title}`}
      accessibilityRole={overview ? 'checkbox' : 'button'}
      accessibilityState={{
        disabled,
        ...(overview ? { checked: false } : {}),
      }}
      disabled={disabled}
      onPress={() => onStatus(task, 'completed')}
      style={({ pressed }) => [
        overview ? styles.completeIcon : styles.completeButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {overview ? (
        <View style={styles.completionCircle} />
      ) : (
        <Text style={styles.completeText}>Complete task</Text>
      )}
    </Pressable>
  ) : null;

  return (
    <View
      style={[styles.container, overview ? styles.overview : styles.focus]}
      testID={`task-card-${task.id}`}
    >
      <View style={styles.heading}>
        {overview ? completeControl : null}

        <View style={styles.copy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              overview ? styles.overviewTitle : styles.focusTitle,
            ]}
          >
            {task.title}
          </Text>

          {overview && task.isFocused && active ? (
            <Text style={styles.focusIndicator}>In Focus</Text>
          ) : null}
        </View>

        <Pressable
          accessibilityLabel={`More actions: ${task.title}`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onManage(task)}
          style={({ pressed }) => [
            styles.moreButton,
            disabled && styles.disabled,
            pressed && !disabled && styles.pressed,
          ]}
        >
          <Text style={styles.moreText}>⋯</Text>
        </Pressable>
      </View>

      {!overview && task.description ? (
        <Text style={styles.description}>{task.description}</Text>
      ) : null}

      {task.deadline ? (
        <Text style={styles.metadata}>
          Deadline: {deadlineLabel(task.deadline)}
        </Text>
      ) : null}

      {task.scheduledDate ? (
        <Text style={styles.metadata}>
          Planned: {calendarDateLabel(task.scheduledDate)}
        </Text>
      ) : null}

      {!active ? (
        <Text style={styles.metadata}>
          {task.status === 'completed' ? 'Completed' : 'Dismissed'}
        </Text>
      ) : null}

      {!overview && completeControl ? (
        <View style={styles.footer}>{completeControl}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderColor: SOFT_BLUSH,
  },
  overview: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  focus: {
    backgroundColor: SOFT_WHITE,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
  },
  heading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: DARK_BROWN,
    fontFamily: HEADING_FONT_FAMILY,
    fontWeight: '500',
  },
  overviewTitle: {
    fontSize: 17,
    lineHeight: 25,
    paddingTop: 8,
  },
  focusTitle: {
    fontSize: 24,
    lineHeight: 32,
  },
  focusIndicator: {
    color: EARTHY_CLAY,
    fontSize: 12,
    marginTop: 4,
  },
  completeIcon: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  completionCircle: {
    borderColor: EARTHY_CLAY,
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    width: 20,
  },
  moreButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  moreText: {
    color: DARK_BROWN,
    fontSize: 26,
  },
  description: {
    color: DARK_BROWN,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 16,
  },
  metadata: {
    color: DARK_BROWN,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  footer: {
    alignItems: 'flex-start',
    marginTop: 20,
  },
  completeButton: {
    backgroundColor: LIGHT_SAGE,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  completeText: {
    color: DARK_BROWN,
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
