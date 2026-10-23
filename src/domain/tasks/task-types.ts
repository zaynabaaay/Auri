export type TaskStatus = 'active' | 'completed' | 'dismissed';

export type TaskDeadline =
  | {
      kind: 'date';
      date: string;
    }
  | {
      kind: 'timed';
      at: string;
      timeZone: string;
    };

export type TaskDetails = {
  title: string;
  description: string | null;
  deadline: TaskDeadline | null;
  scheduledDate: string | null;
};

export type TaskDetailsInput = {
  title: string;
  description?: string | null;
  deadline?: TaskDeadline | null;
  scheduledDate?: string | null;
};

export type TaskDetailsChanges = Partial<TaskDetailsInput>;

export type Task = TaskDetails & {
  id: string;
  status: TaskStatus;
  isFocused: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TaskChanges = Partial<
  TaskDetails & Pick<Task, 'status' | 'isFocused'>
>;
