import { authorizeAction, type ActionInterpretation, type ActionAuthorization } from '../../domain/actions/action-authorization';
import type { AssistantApiRequest, AssistantToolCall, AssistantToolStep } from '../../contracts/assistant';
import { ASSISTANT_PROJECT_WRITE_TOOL_NAMES } from '../../contracts/assistant';

export function isAssistantMutation(call: Pick<AssistantToolCall, 'name'>) {
  return call.name === 'create_task' ||
    (ASSISTANT_PROJECT_WRITE_TOOL_NAMES as readonly string[]).includes(call.name);
}

export type AssistantActionAuthorizer = (
  call: AssistantToolCall, request: AssistantApiRequest, steps: readonly AssistantToolStep[],
) => Promise<ActionAuthorization>;

export const actionInterpretationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['explicit_request', 'confirmed_proposal', 'ambiguous_request', 'conversation'] },
    matchesAction: { type: 'boolean' }, detailsComplete: { type: 'boolean' },
    evidence: { type: 'string' }, clarification: { type: ['string', 'null'] },
  },
  required: ['intent', 'matchesAction', 'detailsComplete', 'evidence', 'clarification'],
};

// Provenance for freshly parsed primary-model output only. Never serialized to
// clients, used as an approval record, or restored from tool continuations.
const interpretations = new WeakMap<AssistantToolCall, { request: AssistantApiRequest; value: ActionInterpretation; action: string }>();

export function recordPrimaryInterpretation(call: AssistantToolCall, request: AssistantApiRequest, raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as ActionInterpretation;
  if (!['explicit_request', 'confirmed_proposal', 'ambiguous_request', 'conversation'].includes(value.intent) ||
      typeof value.matchesAction !== 'boolean' || typeof value.detailsComplete !== 'boolean' ||
      typeof value.evidence !== 'string' || value.evidence.length > 4_000 ||
      !(value.clarification === null || (typeof value.clarification === 'string' && value.clarification.length <= 400))) return;
  interpretations.set(call, { request, value: { ...value }, action: JSON.stringify({ name: call.name, arguments: call.arguments }) });
}

export const authorizePrimaryAction: AssistantActionAuthorizer = async (call, request) => {
  const current = request.messages.at(-1);
  const assessment = interpretations.get(call);
  if (current?.role !== 'user' || !assessment || assessment.request !== request ||
      assessment.action !== JSON.stringify({ name: call.name, arguments: call.arguments })) {
    return { status: 'authorization_required', message: 'This action was not executed because its authorization could not be established.' };
  }
  return authorizeAction(assessment.value, current.content);
};

export function primaryArgumentsForReplay(call: AssistantToolCall) {
  if (!isAssistantMutation(call)) return call.arguments;
  return {
    action: call.arguments,
    interpretation: interpretations.get(call)?.value ?? {
      intent: 'conversation', matchesAction: false, detailsComplete: false,
      evidence: '', clarification: null,
    },
  };
}
