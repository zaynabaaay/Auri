import { assertPassiveBackgroundChanges } from '../../domain/actions/action-authorization';
import type {
  ConversationProjectCandidate,
  ConversationProjectPlanItem,
  ConversationWithMessages,
  PendingProjectCandidate,
} from '../../domain/conversations';
import type {
  Project,
  ProjectWorkSession,
} from '../../domain/projects';
import type { ProjectRepositoryChanges } from '../projects/project-repository';
import type { ProjectCommitPrecondition } from './conversation-project-processing-repository';

import type { ConversationProjectSnapshot } from './conversation-project-analyzer';

export type ConversationProjectResult = {
  candidates: PendingProjectCandidate[];
  changes: ProjectRepositoryChanges;
  preconditions: ProjectCommitPrecondition[];
};

function normalizedIdentity(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

const OVERRIDE_LANGUAGE = /\b(actually|instead|final(?:ly)?|now|changed my mind|replacing|no longer)\b/i;

function candidateIdentity(candidate: ConversationProjectCandidate) {
  return normalizedIdentity(candidate.subjectKey ?? candidate.title ?? candidate.content);
}

function logicalTarget(candidate: ConversationProjectCandidate) {
  return [candidate.target, candidate.knowledgeKind ?? '', candidateIdentity(candidate)].join(':');
}

function resolveIntraPlanConflicts(
  conversation: ConversationWithMessages,
  candidates: readonly ConversationProjectCandidate[],
) {
  const positionById = new Map(conversation.messages.map((message) => [message.id, message.position]));
  const messageById = new Map(conversation.messages.map((message) => [message.id, message]));
  const groups = new Map<string, ConversationProjectCandidate[]>();
  for (const candidate of candidates) {
    const key = logicalTarget(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()].flatMap((group) => {
    const distinct = new Set(group.map((candidate) => normalizedIdentity(candidate.content)));
    if (group.length < 2 || distinct.size < 2) return group;
    const ordered = [...group].sort((left, right) => {
      const leftPosition = Math.max(-1, ...left.evidenceMessageIds.map((id) => positionById.get(id) ?? -1));
      const rightPosition = Math.max(-1, ...right.evidenceMessageIds.map((id) => positionById.get(id) ?? -1));
      return leftPosition - rightPosition;
    });
    const latest = ordered.at(-1)!;
    const latestEvidence = latest.evidenceMessageIds
      .map((id) => messageById.get(id))
      .filter((message) => message?.role === 'user')
      .map((message) => message?.content ?? '')
      .join(' ');
    if (OVERRIDE_LANGUAGE.test(latestEvidence)) return [latest];
    return group.map((candidate) => ({
      ...candidate,
      classification: 'ambiguous' as const,
      usefulPending: true,
    }));
  });
}

export function conversationProjectSessionId(conversationId: string, projectId: string) {
  return `conversation:${conversationId}:project:${projectId}:session`;
}

function derivedId(
  conversationId: string,
  projectId: string,
  kind: string,
  index: number,
) {
  return `conversation:${conversationId}:project:${projectId}:${kind}:${index}`;
}

function pendingCandidate(
  conversation: ConversationWithMessages,
  projectId: string,
  sessionId: string,
  candidate: ConversationProjectCandidate,
  index: number,
): PendingProjectCandidate {
  return {
    content: candidate.content.trim(),
    conversationId: conversation.conversation.id,
    createdAt: conversation.conversation.completedAt,
    id: derivedId(conversation.conversation.id, projectId, 'pending', index),
    projectId,
    sessionId,
    status: 'pending',
  };
}

export function buildConversationProjectResult(input: {
  conversation: ConversationWithMessages;
  item: ConversationProjectPlanItem;
  project: Project;
  snapshot: ConversationProjectSnapshot;
}): ConversationProjectResult {
  const { conversation, item, project } = input;
  const conversationId = conversation.conversation.id;
  const sessionId = conversationProjectSessionId(conversationId, project.id);
  const occurredAt = conversation.conversation.completedAt;
  const relevantMessages = item.relevantMessageIds
    .map((id) => conversation.messages.find((message) => message.id === id))
    .filter((message) => message !== undefined);
  const relevantTimes = relevantMessages.map((message) => Date.parse(message.occurredAt));
  const startedAt = relevantTimes.length > 0
    ? new Date(Math.min(...relevantTimes)).toISOString()
    : conversation.conversation.startedAt;
  const endedAt = relevantTimes.length > 0
    ? new Date(Math.max(...relevantTimes)).toISOString()
    : occurredAt;
  const session: ProjectWorkSession = {
    createdAt: occurredAt,
    endedAt,
    id: sessionId,
    projectId: project.id,
    sourceConversationId: conversationId,
    startedAt,
    summary: item.summary.trim(),
    title: item.title.trim(),
    updatedAt: occurredAt,
  };
  const changes: ProjectRepositoryChanges = { workSessions: [session] };
  const pending: PendingProjectCandidate[] = [];
  const preconditions: ProjectCommitPrecondition[] = [];
  const seen = new Set<string>();
  resolveIntraPlanConflicts(conversation, item.candidates).forEach((candidate, index) => {
    if (!candidate.content.trim() || candidate.classification === 'already_known') return;
    const identity = `${logicalTarget(candidate)}:${normalizedIdentity(candidate.content)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    // A classified fact, task, or decision is not execution authorization.
    // Keep existing pending evidence; Phase 2 proposals must resolve it explicitly.
    pending.push(pendingCandidate(conversation, project.id, sessionId, candidate, index));
  });
  assertPassiveBackgroundChanges(changes);
  return { candidates: pending, changes, preconditions };
}
