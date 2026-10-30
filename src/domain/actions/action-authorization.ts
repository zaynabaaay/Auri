/** Semantic interpretation is evidence, not a grant issued by a tool/model argument. */
export type ActionIntent =
  | 'explicit_request'
  | 'confirmed_proposal'
  | 'ambiguous_request'
  | 'conversation';

export type ActionInterpretation = {
  intent: ActionIntent;
  matchesAction: boolean;
  detailsComplete: boolean;
  evidence: string;
  clarification: string | null;
};

export type ActionAuthorization =
  | { status: 'authorized'; basis: 'explicit_request' }
  | { status: 'clarification_required' | 'authorization_required'; message: string };

export function authorizeAction(
  interpretation: ActionInterpretation,
  currentUserMessage: string,
): ActionAuthorization {
  const quote = interpretation.evidence.trim();
  // Interpreters sometimes add quotation marks around an otherwise exact quote.
  // Accept one balanced wrapper, never fuzzy or invented supporting evidence.
  const wrapped = (quote.startsWith('"') && quote.endsWith('"')) ||
    (quote.startsWith('“') && quote.endsWith('”'));
  const evidence = currentUserMessage === quote ? quote : wrapped ? quote.slice(1, -1) : quote;
  if (interpretation.intent === 'explicit_request' && interpretation.matchesAction &&
      interpretation.detailsComplete && evidence.trim() &&
      currentUserMessage === evidence) {
    return { status: 'authorized', basis: 'explicit_request' };
  }
  if (interpretation.intent === 'ambiguous_request' ||
      (interpretation.intent === 'explicit_request' && !interpretation.detailsComplete)) {
    return {
      status: 'clarification_required',
      message: interpretation.clarification?.trim() ||
        'Please clarify the action, the record it applies to, and any missing details.',
    };
  }
  return {
    status: 'authorization_required',
    message: interpretation.intent === 'confirmed_proposal'
      ? 'Proposal approvals are not available yet. Please state the action and target explicitly.'
      : 'This action was not executed. Please explicitly request the change you want me to make.',
  };
}

/** History extraction is never a second executor for old or inferred commands. */
export function assertPassiveBackgroundChanges(changes: Record<string, unknown>) {
  for (const [key, rows] of Object.entries(changes)) {
    if (!['workSessions', 'workSessionEntries'].includes(key) &&
        rows !== undefined && !(Array.isArray(rows) && rows.length === 0)) {
      throw new Error('Background processing cannot apply actionable changes without execution authorization.');
    }
  }
}
