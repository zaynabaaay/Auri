import type { TaskDetails } from '../../domain/tasks/task-types';
import type {
  AssistantToolCall,
  AssistantToolContract,
  AssistantToolOutput,
} from './tool-contract';

export type CreateTaskToolArguments = TaskDetails;

export type AssistantTaskToolResult =
  | {
      status: 'success';
      task: TaskDetails & { id: string };
    }
  | {
      message: string;
      status: 'clarification_required' | 'error';
    };

export type AssistantTaskToolCall = AssistantToolCall<
  'create_task',
  'server',
  CreateTaskToolArguments
>;

export type AssistantTaskToolOutput = AssistantToolOutput<
  'create_task',
  'server',
  AssistantTaskToolResult
>;

function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value);
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function isDeadline(value: unknown) {
  return value === null ||
    (
      exact(value, ['kind', 'date']) &&
      value.kind === 'date' &&
      text(value.date, 10)
    ) ||
    (
      exact(value, ['kind', 'at', 'timeZone']) &&
      value.kind === 'timed' &&
      text(value.at, 100) &&
      text(value.timeZone, 100)
    );
}

function isArguments(value: unknown): value is CreateTaskToolArguments {
  return exact(value, ['title', 'description', 'deadline', 'scheduledDate']) &&
    text(value.title, 300) &&
    value.title.length > 0 &&
    (value.description === null || text(value.description, 2_000)) &&
    isDeadline(value.deadline) &&
    (value.scheduledDate === null || text(value.scheduledDate, 10));
}

function isResult(value: unknown): value is AssistantTaskToolResult {
  if (exact(value, ['status', 'message'])) {
    return (
      value.status === 'clarification_required' ||
      value.status === 'error'
    ) && text(value.message, 500) && value.message.length > 0;
  }

  if (
    !exact(value, ['status', 'task']) ||
    value.status !== 'success' ||
    !exact(value.task, [
      'id', 'title', 'description', 'deadline', 'scheduledDate',
    ]) ||
    !text(value.task.id, 200) ||
    value.task.id.length === 0
  ) return false;

  const { id, ...details } = value.task;
  return isArguments(details);
}

export const ASSISTANT_TASK_TOOL_CONTRACTS: readonly AssistantToolContract<
  'create_task',
  'server',
  CreateTaskToolArguments,
  AssistantTaskToolResult
>[] = [{
  execution: 'server',
  isArguments,
  isResult,
  name: 'create_task',
  openAI: {
    description:
      'Create one standalone personal Task in All Tasks. Use for a clear ' +
      'personal to-do or request to add a Task, never tentative discussion. ' +
      'Use null for unknown optional details. Project work items belong to ' +
      'manage_project_work instead. This does not schedule notifications.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'deadline', 'scheduledDate'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        description: { type: ['string', 'null'], maxLength: 2_000 },
        scheduledDate: {
          type: ['string', 'null'],
          maxLength: 10,
          description:
            'Planned work date in YYYY-MM-DD, or null. Not a deadline.',
        },
        deadline: {
          description:
            'Explicit deadline, or null. Do not invent a time for a date.',
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'date'],
              properties: {
                kind: { type: 'string', enum: ['date'] },
                date: { type: 'string', maxLength: 10 },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'at', 'timeZone'],
              properties: {
                kind: { type: 'string', enum: ['timed'] },
                at: {
                  type: 'string',
                  maxLength: 100,
                  description: 'ISO timestamp with Z or an explicit UTC offset.',
                },
                timeZone: {
                  type: 'string',
                  maxLength: 100,
                  description: 'IANA time zone for the stated deadline.',
                },
              },
            },
          ],
        },
      },
    },
    strict: true,
    type: 'function',
  },
}];
