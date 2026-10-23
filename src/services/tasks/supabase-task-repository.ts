import type { SupabaseClient } from '@supabase/supabase-js';

import {
  normalizeTaskChanges,
  normalizeTaskDetails,
  taskFocusChange,
  taskPostponement,
  taskStatusChange,
} from '../../domain/tasks/task-rules';
import type {
  Task,
  TaskChanges,
  TaskDetailsChanges,
  TaskDetailsInput,
  TaskStatus,
} from '../../domain/tasks/task-types';
import { getSupabaseClient } from '../auth/supabase-client';

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  deadline_date: string | null;
  deadline_at: string | null;
  deadline_time_zone: string | null;
  scheduled_date: string | null;
  status: TaskStatus;
  is_focused: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export class TaskWriteConflictError extends Error {
  constructor() {
    super('The task changed or is no longer available. Refresh and try again.');
    this.name = 'TaskWriteConflictError';
  }
}

function toTask(row: TaskRow): Task {
  const deadline = row.deadline_date !== null
    ? { kind: 'date' as const, date: row.deadline_date }
    : row.deadline_at !== null
      ? {
          kind: 'timed' as const,
          at: row.deadline_at,
          timeZone: row.deadline_time_zone ?? '',
        }
      : null;

  return {
    ...normalizeTaskDetails({
      title: row.title,
      description: row.description,
      deadline,
      scheduledDate: row.scheduled_date,
    }),
    id: row.id,
    status: row.status,
    isFocused: row.is_focused,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function toRow(changes: TaskChanges): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  const fields = [
    ['title', 'title'],
    ['description', 'description'],
    ['scheduledDate', 'scheduled_date'],
    ['status', 'status'],
    ['isFocused', 'is_focused'],
  ] as const;

  for (const [source, destination] of fields) {
    if (changes[source] !== undefined) {
      row[destination] = changes[source];
    }
  }

  if (changes.deadline !== undefined) {
    const deadline = changes.deadline;

    row.deadline_date = deadline?.kind === 'date'
      ? deadline.date
      : null;
    row.deadline_at = deadline?.kind === 'timed'
      ? deadline.at
      : null;
    row.deadline_time_zone = deadline?.kind === 'timed'
      ? deadline.timeZone
      : null;
  }

  return row;
}

export class SupabaseTaskRepository {
  constructor(
    private readonly ownerId: string,
    private readonly getClient: () => SupabaseClient = getSupabaseClient,
  ) {}

  async list(): Promise<Task[]> {
    const tasks: Task[] = [];
    let cursor: string | undefined;

    while (true) {
      let query = this.getClient()
        .from('everyday_tasks')
        .select('*')
        .eq('owner_id', this.ownerId)
        .order('id', { ascending: true })
        .limit(100);

      if (cursor !== undefined) {
        query = query.gt('id', cursor);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as TaskRow[];
      if (rows.length === 0) return tasks;

      tasks.push(...rows.map(toTask));
      cursor = rows[rows.length - 1].id;
    }
  }

  async get(id: string): Promise<Task | null> {
    const { data, error } = await this.getClient()
      .from('everyday_tasks')
      .select('*')
      .eq('owner_id', this.ownerId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data ? toTask(data as TaskRow) : null;
  }

  async create(input: TaskDetailsInput): Promise<Task> {
    const details = normalizeTaskDetails(input);

    const { data, error } = await this.getClient()
      .from('everyday_tasks')
      .insert({
        ...toRow(details),
        owner_id: this.ownerId,
      })
      .select('*')
      .single();

    if (error) throw error;
    return toTask(data as TaskRow);
  }

  async edit(
    task: Task,
    changes: TaskDetailsChanges,
  ): Promise<Task> {
    return this.saveChanges(
      task,
      normalizeTaskChanges(task, changes),
    );
  }

  async setStatus(task: Task, status: TaskStatus): Promise<Task> {
    return this.saveChanges(task, taskStatusChange(task, status));
  }

  async setFocus(task: Task, isFocused: boolean): Promise<Task> {
    return this.saveChanges(task, taskFocusChange(task, isFocused));
  }

  async postpone(
    task: Task,
    scheduledDate: string,
    today: string,
  ): Promise<Task> {
    return this.saveChanges(
      task,
      taskPostponement(task, scheduledDate, today),
    );
  }

  private async saveChanges(
    task: Task,
    changes: TaskChanges,
  ): Promise<Task> {
    if (
      !Number.isInteger(task.version) ||
      task.version < 1 ||
      task.version >= 2147483647
    ) {
      throw new Error('Invalid task version.');
    }

    const row = toRow(changes);

    if (Object.keys(row).length === 0) {
      const current = await this.get(task.id);

      if (!current || current.version !== task.version) {
        throw new TaskWriteConflictError();
      }

      return current;
    }

    const { data, error } = await this.getClient()
      .from('everyday_tasks')
      .update({
        ...row,
        version: task.version + 1,
      })
      .eq('owner_id', this.ownerId)
      .eq('id', task.id)
      .eq('version', task.version)
      .select('*')
      .maybeSingle();

    if (error?.code === '40001') {
      throw new TaskWriteConflictError();
    }
    if (error) throw error;
    if (!data) throw new TaskWriteConflictError();

    return toTask(data as TaskRow);
  }
}
