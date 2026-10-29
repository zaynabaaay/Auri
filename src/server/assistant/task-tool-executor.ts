import type {
  AssistantTaskToolCall,
  AssistantTaskToolOutput,
  AssistantTaskToolResult,
} from '../../contracts/assistant';
import { normalizeTaskDetails } from '../../domain/tasks/task-rules';
import { SupabaseTaskRepository } from '../../services/tasks/supabase-task-repository';
import { createServerSupabaseClient } from '../projects/server-project-repository';

import type { AssistantServerToolContext } from './server-tool-executor';

type TaskRepositoryFactory = (
  context: AssistantServerToolContext,
) => Pick<SupabaseTaskRepository, 'create'>;

export function createAssistantTaskToolExecutor(
  createRepository: TaskRepositoryFactory = (context) => {
    const client = createServerSupabaseClient(context);
    return new SupabaseTaskRepository(context.userId, () => client);
  },
) {
  return async (
    call: AssistantTaskToolCall,
    context: AssistantServerToolContext,
  ): Promise<AssistantTaskToolOutput> => {
    let result: AssistantTaskToolResult;

    try {
      const details = normalizeTaskDetails(call.arguments);

      try {
        const saved = await createRepository(context).create(details);

        result = {
          status: 'success',
          task: {
            id: saved.id,
            title: saved.title,
            description: saved.description,
            deadline: saved.deadline,
            scheduledDate: saved.scheduledDate,
          },
        };
      } catch (error) {
        console.error('Task assistant creation failed.', error);
        result = {
          status: 'error',
          message:
            'Task creation could not be confirmed. ' +
            'Check All Tasks before trying again.',
        };
      }
    } catch (error) {
      result = {
        status: 'clarification_required',
        message: error instanceof Error
          ? error.message
          : 'Please clarify the task details.',
      };
    }

    return {
      callId: call.callId,
      execution: 'server',
      name: call.name,
      result,
    };
  };
}

export const executeAssistantTaskTool = createAssistantTaskToolExecutor();
