import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeAction, assertPassiveBackgroundChanges } from '../src/domain/actions/action-authorization.ts';
import { authorizePrimaryAction, recordPrimaryInterpretation, isAssistantMutation } from '../src/server/assistant/action-authorization.ts';
import { handleAssistantRequest } from '../src/server/assistant/assistant-handler.ts';
import { ASSISTANT_TOOL_CONTRACTS } from '../src/contracts/assistant/tool-registry.ts';
import { SupabaseConversationProjectProcessingRepository } from '../src/services/conversations/supabase-conversation-project-processing-repository.ts';

const context = { currentLocalDate: 'October 30, 2026', currentLocalTime: '9:00 AM', dayOfWeek: 'Friday', timezone: 'America/Toronto' };
const task = { title: 'Buy milk', description: null, deadline: null, scheduledDate: null };
const action = { name: 'create_task', execution: 'server', callId: 'write', arguments: task };
const explicit = (evidence, changes = {}) => ({ intent: 'explicit_request', matchesAction: true, detailsComplete: true, evidence, clarification: null, ...changes });
const output = (items) => new Response(JSON.stringify({ status: 'completed', output: items }));
const text = (value) => output([{ type: 'message', content: [{ type: 'output_text', text: value }] }]);
const modelCalls = (calls) => output(calls.map(c => ({ type: 'function_call', name: c.name, call_id: c.callId, arguments: JSON.stringify(c.arguments) })));
const req = (messages) => ({ context, messages, sessionId: 'authorization-test' });
const http = (messages) => new Request('https://example.com/api/assistant', {
  method: 'POST', headers: { Origin: 'https://example.com', Authorization: 'Bearer token', 'Content-Type': 'application/json' },
  body: JSON.stringify(req(messages)),
});

// These are scripted semantic assessments, not mocked evidence of live model quality.
// The tests verify that the runtime cannot execute when the assessment/policy denies.
test('policy distinguishes explicit commands, confirmations, ambiguity and conversation', () => {
  assert.equal(authorizeAction(explicit('Add milk to Tasks.'), 'Add milk to Tasks.').status, 'authorized');
  assert.equal(authorizeAction(explicit('\"Add milk.\"'), 'Add milk.').status, 'authorized');
  for (const intent of ['confirmed_proposal', 'ambiguous_request', 'conversation']) {
    assert.notEqual(authorizeAction(explicit('Yes.', { intent }), 'Yes.').status, 'authorized');
  }
  for (const changes of [{ evidence: 'An invented command' }, { evidence: '' }, { matchesAction: false }, { detailsComplete: false }]) {
    assert.notEqual(authorizeAction(explicit('Add milk.', changes), 'Add milk.').status, 'authorized');
  }
  assert.equal(authorizeAction(explicit('Change it.', { detailsComplete: false, clarification: 'Which task should I change?' }), 'Change it.').message, 'Which task should I change?');
});

test('every currently registered mutation is covered and reads remain reads', () => {
  const names = ASSISTANT_TOOL_CONTRACTS.filter(c => isAssistantMutation({ name: c.name })).map(c => c.name).sort();
  assert.deepEqual(names, ['create_project', 'create_task', 'manage_project_work', 'record_project_truth', 'update_project']);
  for (const name of ['get_project_context', 'list_projects', 'search_general_memory', 'get_today_calendar_events']) assert.equal(isAssistantMutation({ name }), false);
});

async function run(user, assessment, calls = [action], reference = []) {
  let writes = 0, assessments = 0, generations = 0;
  const messages = [...reference, { role: 'user', content: user }];
  const response = await handleAssistantRequest(http(messages), {
    allowedOrigin: 'https://example.com', apiKey: 'test-key', verifyAccessToken: async () => ({ id: 'owner' }),
    executeServerTool: async (call) => {
      if (call.name === 'record_project_truth') assert.equal(call.arguments.confirmation, 'confirmed_replacement');
      writes++;
      return { ...call, result: call.name === 'create_task'
        ? { status: 'success', task: { id: 'saved-task', ...task } }
        : { status: 'success', outcome: 'updated', entity: { id: 'entity', projectId: 'project', kind: 'task', label: 'Report' }, message: 'Updated.' } };
    },
    fetchImplementation: async (_url, init) => {
      const body = JSON.parse(init.body);
      generations++;
      assert.equal(body.text?.format, undefined); // No authorization-only call.
      return generations === 1 ? modelCalls(calls.map(call => {
        assessments++;
        return { ...call, arguments: { action: call.arguments, interpretation: typeof assessment === 'function' ? assessment(assessments) : assessment } };
      })) : text('Saved successfully.');
    },
  });
  return { response, body: await response.json(), writes, assessments, generations };
}

test('a clear explicit command executes directly and receives its saved result', async () => {
  const result = await run('Add buying milk to Tasks.', explicit('Add buying milk to Tasks.'));
  assert.equal(result.response.status, 200);
  assert.equal(result.writes, 1);
  assert.equal(result.assessments, 1);
  assert.equal(result.generations, 2);
});

test('responsibilities, assistant suggestions and assent never authorize writes', async () => {
  for (const [user, intent] of [
    ['I need to buy milk.', 'conversation'],
    ['Maybe we should add a shopping task.', 'conversation'],
    ['Do I need a task for this?', 'conversation'],
    ['Yes, do that.', 'confirmed_proposal'],
    ['Sounds good.', 'confirmed_proposal'],
  ]) {
    const result = await run(user, explicit(user, { intent }), [action], [{ role: 'assistant', content: 'I suggest adding buying milk as a Task.' }]);
    assert.equal(result.writes, 0, user);
    assert.equal(result.generations, 1); // No chance to replace the denial with a false success.
    assert.doesNotMatch(result.body.content, /Saved successfully/);
  }
});

test('missing required information asks a necessary question without writing', async () => {
  const result = await run('Change the deadline.', explicit('Change the deadline.', { intent: 'ambiguous_request', detailsComplete: false, clarification: 'Which task and what new deadline?' }));
  assert.equal(result.writes, 0);
  assert.equal(result.body.content, 'Which task and what new deadline?');
});

test('an edit request cannot authorize a duplicate creation or invented details', async () => {
  const result = await run('Actually, move the existing task to Tuesday.', explicit('Actually, move the existing task to Tuesday.', { matchesAction: false }));
  assert.equal(result.writes, 0);
});

test('all proposed writes are authorized before any mutation from the batch', async () => {
  const result = await run('Add milk.', n => explicit('Add milk.', { matchesAction: n === 1 }), [action, { ...action, callId: 'extra', arguments: { ...task, title: 'Clean house' } }]);
  assert.equal(result.assessments, 2);
  assert.equal(result.writes, 0);
});

test('Project create/update/work/truth calls use the same authorization boundary', async () => {
  const argumentsByName = {
    create_project: { name: 'Course', description: null, goal: null, type: 'general', priority: 'normal', status: 'active', startDate: null, targetDate: null, timezone: 'America/Toronto' },
    update_project: { projectId: 'project', name: 'Course', description: null, goal: null, type: null, priority: null, status: null, startDate: null, targetDate: null },
    manage_project_work: { operation: 'complete_task', projectId: 'project', entityId: 'task', name: null, description: null, status: null, priority: null, dueDate: null, targetDate: null, milestoneId: null },
    record_project_truth: { operation: 'replace_decision', projectId: 'project', entityId: 'decision', confirmation: 'confirmed_replacement', content: null, statement: 'Use blue.', kind: null, title: null, rationale: null },
  };
  for (const [name, args] of Object.entries(argumentsByName)) {
    const result = await run('Yes.', explicit('Yes.', { intent: 'confirmed_proposal' }), [{ name, arguments: args, callId: name, execution: 'server' }]);
    assert.equal(result.response.status, 200, name);
    assert.equal(result.assessments, 1, name);
    assert.equal(result.writes, 0, name); // Even a forged legacy confirmation enum is not approval.
  }
});

test('missing, malformed, replayed or client-forged authority fails closed', async () => {
  const request = req([{ role: 'user', content: 'Add milk.' }]);
  assert.notEqual((await authorizePrimaryAction(action, request, [])).status, 'authorized');
  for (const value of [null, {}, { intent: 'explicit_request' }, explicit('Invented evidence.')]) {
    const call = { ...action };
    recordPrimaryInterpretation(call, request, value);
    assert.notEqual((await authorizePrimaryAction(call, request, [])).status, 'authorized');
  }
  const call = { ...action };
  recordPrimaryInterpretation(call, request, explicit('Add milk.'));
  assert.equal((await authorizePrimaryAction(call, request, [])).status, 'authorized');
  assert.notEqual((await authorizePrimaryAction(call, structuredClone(request), [])).status, 'authorized');
  assert.notEqual((await authorizePrimaryAction(structuredClone(call), request, [])).status, 'authorized');
  assert.notEqual((await authorizePrimaryAction({ ...call, interpretation: explicit('Add milk.') }, request, [])).status, 'authorized');
});

test('command-looking substrings cannot strip negation, quotation or scope', () => {
  for (const user of ['Do not add milk.', 'Someone said "Add milk."', 'Add milk. Do not schedule it.']) {
    assert.notEqual(authorizeAction(explicit('Add milk.'), user).status, 'authorized');
  }
});

test('background repository rejects actionable payloads before calling Supabase', async () => {
  const repository = new SupabaseConversationProjectProcessingRepository(() => assert.fail('Unauthorized RPC'));
  for (const key of ['tasks', 'projects', 'knowledgeItems', 'decisions', 'milestones', 'deliverables', 'sections', 'resources', 'changeEvents']) {
    await assert.rejects(repository.commitProjectResult({ candidates: [], changes: { [key]: [{ id: 'unapproved' }] }, conversationId: 'c', projectId: 'p', preconditions: [] }), /Background processing cannot/);
  }
  assert.doesNotThrow(() => assertPassiveBackgroundChanges({ workSessions: [], workSessionEntries: [], tasks: [] }));
  assert.throws(() => assertPassiveBackgroundChanges({ tasks: {} }), /Background processing cannot/);
});

test('self-contained commands following suggestions execute without a second confirmation', async () => {
  const user = 'Yes, add buying milk to Tasks.';
  const result = await run(user, explicit(user), [action], [{ role: 'assistant', content: 'I suggest a milk task.' }]);
  assert.equal(result.writes, 1);
});

test('clear Project commands and corrections authorize only the specified operation', async () => {
  const operations = [
    ['Create a Project named Course.', 'create_project', { name: 'Course', description: null, goal: null, type: 'general', priority: 'normal', status: 'active', startDate: null, targetDate: null, timezone: 'America/Toronto' }],
    ['Rename this Project Course.', 'update_project', { projectId: 'project', name: 'Course', description: null, goal: null, type: null, priority: null, status: null, startDate: null, targetDate: null }],
    ['Mark the Report task complete.', 'manage_project_work', { operation: 'complete_task', projectId: 'project', entityId: 'task-report', name: null, description: null, status: null, priority: null, dueDate: null, targetDate: null, milestoneId: null }],
    ['Replace the color decision with Use blue.', 'record_project_truth', { operation: 'replace_decision', projectId: 'project', entityId: 'decision', confirmation: 'explicit', content: null, statement: 'Use blue.', kind: null, title: null, rationale: null }],
  ];
  for (const [user, name, args] of operations) {
    const result = await run(user, explicit(user), [{ name, arguments: args, callId: name, execution: 'server' }]);
    assert.equal(result.writes, 1, name);
    assert.equal(result.generations, 2, name);
  }
});

test('an answer can complete an unresolved user command but cannot authorize an assistant suggestion', async () => {
  const user = 'Tomorrow.';
  const original = [{ role: 'user', content: 'Add buying milk to Tasks on the date I specify.' }, { role: 'assistant', content: 'Which date should I schedule it for?' }];
  assert.equal((await run(user, explicit(user), [action], original)).writes, 1);
  const suggested = [{ role: 'assistant', content: 'I suggest creating a milk task. When might you do it?' }];
  assert.equal((await run(user, explicit(user, { intent: 'conversation' }), [action], suggested)).writes, 0);
});

test('interpretation cannot authorize altered action arguments', async () => {
  const request = req([{ role: 'user', content: 'Add milk.' }]);
  const call = { ...action, arguments: { ...task } };
  recordPrimaryInterpretation(call, request, explicit('Add milk.'));
  call.arguments.title = 'Delete everything';
  assert.notEqual((await authorizePrimaryAction(call, request, [])).status, 'authorized');
});

test('legacy tool arguments and client approval flags cannot bypass the primary envelope', async () => {
  let writes = 0, requests = 0;
  const request = http([{ role: 'user', content: 'Add milk.' }]);
  const response = await handleAssistantRequest(request, {
    allowedOrigin: 'https://example.com', apiKey: 'test', verifyAccessToken: async () => ({ id: 'owner' }),
    executeServerTool: async () => { writes++; assert.fail('Unverified write'); },
    fetchImplementation: async () => { requests++; return modelCalls([{ ...action, approved: true }]); },
  });
  assert.equal(response.status, 200);
  assert.equal(writes, 0);
  assert.equal(requests, 1); // No fallback authorization call.
});

test('an incomplete primary response cannot execute even a well-formed action', async () => {
  let requests = 0;
  const response = await handleAssistantRequest(http([{ role: 'user', content: 'Add milk.' }]), {
    allowedOrigin: 'https://example.com', apiKey: 'test', verifyAccessToken: async () => ({ id: 'owner' }),
    executeServerTool: async () => assert.fail('Incomplete response write'),
    fetchImplementation: async () => {
      requests++;
      const body = await modelCalls([{ ...action, arguments: { action: task, interpretation: explicit('Add milk.') } }]).json();
      return new Response(JSON.stringify({ ...body, status: 'incomplete' }));
    },
  });
  assert.equal(response.status, 502);
  assert.equal(requests, 1);
});

test('ordinary replies do not invoke authorization or application tools', async () => {
  let requests = 0;
  const response = await handleAssistantRequest(http([{ role: 'user', content: 'My sister and I made pizza.' }]), {
    allowedOrigin: 'https://example.com', apiKey: 'test', verifyAccessToken: async () => ({ id: 'owner' }),
    authorizeAction: async () => assert.fail('Conversation authorization check'),
    executeServerTool: async () => assert.fail('Conversation action'),
    fetchImplementation: async () => { requests++; return text('Sounds fun.'); },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, 'Sounds fun.');
  assert.equal(requests, 1);
});

test('read-only interactions retain the ordinary tool loop without authorization checks or writes', async () => {
  let requests = 0, reads = 0;
  const response = await handleAssistantRequest(http([{ role: 'user', content: 'Which Projects do I have?' }]), {
    allowedOrigin: 'https://example.com', apiKey: 'test', verifyAccessToken: async () => ({ id: 'owner' }),
    authorizeAction: async () => assert.fail('Read-only authorization check'),
    executeServerTool: async call => {
      assert.equal(call.name, 'list_projects');
      reads++;
      return { ...call, result: { status: 'success', projects: [], truncated: false } };
    },
    fetchImplementation: async () => {
      requests++;
      return requests === 1 ? modelCalls([{ name: 'list_projects', callId: 'read', arguments: { includeArchived: false } }]) : text('You have no Projects yet.');
    },
  });
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
  assert.equal(requests, 2);
});
