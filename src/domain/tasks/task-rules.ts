import type {
  Task,
  TaskChanges,
  TaskDeadline,
  TaskDetails,
  TaskDetailsChanges,
  TaskDetailsInput,
  TaskStatus,
} from './task-types';

function requireCalendarDate(value: string): string {
  const normalized = value.trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    normalized.startsWith('0000-')
  ) {
    throw new Error('Use a valid date in YYYY-MM-DD format.');
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new Error('Use a valid date in YYYY-MM-DD format.');
  }

  return normalized;
}

function optionalCalendarDate(
  value: string | null | undefined,
): string | null {
  return value?.trim() ? requireCalendarDate(value) : null;
}

function normalizeDeadline(
  deadline: TaskDeadline | null | undefined,
): TaskDeadline | null {
  if (deadline == null) {
    return null;
  }

  if (deadline.kind === 'date') {
    return {
      kind: 'date',
      date: requireCalendarDate(deadline.date),
    };
  }

  const at = deadline.at.trim();
  const timestampPattern =
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

  if (!timestampPattern.test(at)) {
    throw new Error(
      'Timed deadlines require a timestamp with Z or an explicit UTC offset.',
    );
  }

  requireCalendarDate(at.slice(0, 10));

  const milliseconds = Date.parse(at);

  if (!Number.isFinite(milliseconds)) {
    throw new Error('Use a valid deadline timestamp.');
  }

  const normalizedAt = new Date(milliseconds).toISOString();
  requireCalendarDate(normalizedAt.slice(0, 10));

  let timeZone: string;

  try {
    timeZone = new Intl.DateTimeFormat('en-US', {
      timeZone: deadline.timeZone.trim(),
    }).resolvedOptions().timeZone;
  } catch {
    throw new Error('Use a valid deadline time zone.');
  }

  return {
    kind: 'timed',
    at: normalizedAt,
    timeZone,
  };
}

function requireActiveTask(task: Task): void {
  if (task.status !== 'active') {
    throw new Error('This action requires an active task.');
  }
}

export function normalizeTaskDetails(
  input: TaskDetailsInput,
): TaskDetails {
  const title = input.title.trim();

  if (!title) {
    throw new Error('Task title cannot be empty.');
  }

  return {
    title,
    description: input.description?.trim() || null,
    deadline: normalizeDeadline(input.deadline),
    scheduledDate: optionalCalendarDate(input.scheduledDate),
  };
}

export function normalizeTaskChanges(
  current: TaskDetails,
  changes: TaskDetailsChanges,
): TaskDetails {
  return normalizeTaskDetails({
    title: changes.title === undefined
      ? current.title
      : changes.title,
    description: changes.description === undefined
      ? current.description
      : changes.description,
    deadline: changes.deadline === undefined
      ? current.deadline
      : changes.deadline,
    scheduledDate: changes.scheduledDate === undefined
      ? current.scheduledDate
      : changes.scheduledDate,
  });
}

export function taskStatusChange(
  task: Task,
  status: TaskStatus,
): TaskChanges {
  if (task.status === status) {
    return {};
  }

  if (status === 'active') {
    return { status };
  }

  requireActiveTask(task);

  return {
    status,
    isFocused: false,
  };
}

export function taskFocusChange(
  task: Task,
  isFocused: boolean,
): TaskChanges {
  if (isFocused) {
    requireActiveTask(task);
  }

  return { isFocused };
}

export function taskPostponement(
  task: Task,
  scheduledDate: string,
  today: string,
): TaskChanges {
  requireActiveTask(task);

  const nextDate = normalizeTaskChanges(task, {
    scheduledDate,
  }).scheduledDate;
  const currentDate = requireCalendarDate(today);

  if (
    nextDate === null ||
    nextDate <= currentDate ||
    (task.scheduledDate !== null && nextDate <= task.scheduledDate)
  ) {
    throw new Error(
      'Choose a future date later than the current planned date.',
    );
  }

  return { scheduledDate: nextDate };
}
