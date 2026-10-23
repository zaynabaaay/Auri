import type {
  Task,
  TaskDeadline,
} from '@/domain/tasks/task-types';

export function taskCollections(tasks: readonly Task[]) {
  const ordered = [...tasks].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.id.localeCompare(right.id),
  );

  const active = ordered.filter((task) => task.status === 'active');

  return {
    active,
    focused: active.filter((task) => task.isFocused),
    completed: ordered.filter((task) => task.status === 'completed'),
    dismissed: ordered.filter((task) => task.status === 'dismissed'),
  };
}

export function calendarDateLabel(
  value: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function deadlineLabel(
  deadline: TaskDeadline,
  locale?: string,
): string {
  if (deadline.kind === 'date') {
    return calendarDateLabel(deadline.date, locale);
  }

  const label = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: deadline.timeZone,
  }).format(new Date(deadline.at));

  return `${label} (${deadline.timeZone})`;
}

export function localCalendarDate(date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
