# Action authorization — Phase 1

## Inventory (before implementation)

- Personal Tasks: `features/tasks/tasks-screen.tsx` + `use-tasks.ts` call `SupabaseTaskRepository.create/edit/setStatus/setFocus/postpone`. Explicit form submissions/button actions, owner-scoped writes and version checks; retain these.
- Projects: `new-project-screen.tsx`, `project-screen.tsx` call `ProjectService.createProject/updateProject`. `project-sections-manager.tsx` adds/renames/reorders/archives/restores sections. Explicit UI actions; retain these.
- Assets/resources: `project-section-assets.tsx` + `ProjectAssetService` upload/finalize, rename, archive/restore, add/remove/replace placements. File selection and UI actions authorize these existing operations. Reconciliation may finalize an already requested upload; it must not invent another operation.
- Assistant: `create_task`, `create_project`, `update_project`, `manage_project_work` (task/milestone/deliverable creation/update/completion), `record_project_truth` (knowledge/question/decision creation/replacement). Handler -> server tool dispatcher -> Task executor or Project write executor -> existing domain services/repositories. This is the foreground authorization boundary, including injected executors.
- Completed conversations: Finish/New Chat -> process-conversation -> `ConversationProjectProcessor` -> reconciler -> processing repository -> `commit_conversation_project_result`. Previously created tasks/accepted knowledge/decisions and replaced truth from classifications. Cached processing plans and stale-state retries take this path too.
- Domain methods not all exposed by current UI/tools: Project completion, knowledge acceptance/supersession, decision supersession, work-session closure, resource/section updates, atomic commit helpers. They remain domain primitives, not autonomous callers; new AI entrypoints must use the authorization boundary.
- Supporting persistence: conversation/outbox saves, completed History, work sessions/entries, processing plans/checkpoints/pending candidates, Project recency and default overview repair. These preserve history or infrastructure; they do not authorize new actionable items.
- Passive general memory: `process-memory` -> MemoryProcessor/analyzer -> memory RPCs. Retain preference/state extraction, provenance, corrections and claims unchanged. A memory or historical statement never grants execution permission.
- Repositories/SQL/RLS enforce ownership and domain integrity. They do not interpret natural language. This phase changes application entrypoints, not grants or database schema, and does not claim to protect an old deployed client or arbitrary direct owner-authenticated database writes.

## Policy

The pure domain policy distinguishes explicit requests, proposal confirmations, ambiguity and conversation. The primary model emits its interpretation alongside the exact action in a strict mutation-tool envelope. There is no separate authorization model, keyword detector, or authorization-only API request. Only a sufficiently specified, evidence-grounded explicit request can execute in Phase 1. A current answer can complete an unresolved user command; it cannot turn an assistant-originated suggestion into permission.

The provider validates action arguments and interpretation structure. Application enforcement requires verbatim full-current-user evidence (not a command-looking substring), matching/completeness flags, and in-process provenance tying the newly parsed action to this exact request. Missing or malformed metadata, conversation, ambiguity, confirmations and cloned/replayed client authority fail closed. Interpretations are attached only to newly parsed primary output via a WeakMap, never serialized as an approval record. Historical tool calls are replayed in the envelope shape; missing historical interpretation is neutral, not execution authority.

This is semantic understanding by the primary model, not independent proof of user intent. A well-formed misclassification of the entire current message is a remaining risk; deterministic checks cannot prove arbitrary natural-language meaning. No keyword list pretends to solve that problem.
For corrections, reference context may resolve an existing entity; a create operation is not authorized as a substitute for an edit. Required ambiguity must be clarified. Missing optional details stay null/default; the interpreter checks for invented dates, targets and extra changes. Semantic interpretation remains probabilistic; invalid/unavailable interpretation fails closed. The application policy decides execution; model confirmation enums and client approval flags are not authority. No unconditional extra call is added for reads or ordinary text responses.

No temporary yes/no approval tokens or conversation-local approved flags are implemented. Proposal confirmation is a distinct non-executable intent until Phase 2 can resolve an owner-scoped durable proposal/version and authorize its stored operations. The user may instead issue an explicit sufficiently specified command. Phase 2 should add that trusted resolution at the same policy boundary, not loosen it to accept model/client approval assertions.

Completed-chat processing is historical capture, not an action executor. It may store work-session history and pending extraction candidates, but cannot create/replace actionable records, even for a cached plan or an earlier explicit command. Without execution receipts it cannot know whether a foreground command was already carried out; replaying it would risk duplicates and stale corrections. Existing pending candidates are evidence, not executable proposals or an alternative approval mechanism. Phase 2 can consume evidence through the real proposal/receipt flow.

Direct UI and internal domain functions remain unchanged. Foreground denied actions return an honest clarification/authorization message immediately, without running any mutation from that model batch or trusting a later model success claim. Ordinary generation and passive memory behavior remain unchanged.

## Deferred

Durable proposals/approval UI, idempotency across requests, execution receipts, document ingestion, personal Task read/update tools and comprehensive free-text success-claim enforcement remain future work. Do not deploy without reviewing the intentional change from automatic background truth promotion to pending historical evidence.

## Phase 2 approval integration

The existing server-only `AssistantActionAuthorizer` dependency is the authority boundary for a future button endpoint: verify the authenticated owner, persisted proposal ID/version, exact operation payload, expiry/status, and replay/idempotency state, then execute the stored operations through domain services. That path must not regenerate actions or call AI to approve them. No client boolean, bare conversational yes, or model interpretation can substitute for the persisted proof. The default chat gate intentionally does not implement this future grant source or create a temporary approval store.
