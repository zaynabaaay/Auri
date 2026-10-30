import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { getAssistantToolContract } from '../src/contracts/assistant/tool-registry.ts';
import { handleAssistantRequest } from '../src/server/assistant/assistant-handler.ts';
import { executeAssistantServerTool } from '../src/server/assistant/server-tool-executor.ts';
import { createAssistantTaskToolExecutor } from '../src/server/assistant/task-tool-executor.ts';
import { InvalidAccessTokenError } from '../src/server/auth/supabase-token-verifier.ts';
import { SupabaseTaskRepository } from '../src/services/tasks/supabase-task-repository.ts';
import { createAssistantApiClient } from '../src/services/assistant/assistant-api-client.ts';

const context = { accessToken: 'verified-token', userId: 'owner-a' };

const args = (changes = {}) => ({
  title: 'Renew passport',
  description: null,
  deadline: null,
  scheduledDate: null,
  ...changes,
});

const call = (changes = {}) => ({
  arguments: args(changes),
  callId: 'create-personal-task',
  execution: 'server',
  name: 'create_task',
});

function request(token = context.accessToken) {
  return new Request('https://example.com/api/assistant', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      Origin: 'https://example.com',
    },
    body: JSON.stringify({
      context: {
        currentLocalDate: 'October 29, 2026',
        currentLocalTime: '9:00 AM',
        dayOfWeek: 'Thursday',
        timezone: 'America/Toronto',
      },
      messages: [{ role: 'user', content: 'Add renewing my passport to Tasks.' }],
      sessionId: 'task-creation-test',
    }),
  });
}

test('Task arguments reject ownership and state supplied by the model', () => {
  const contract = getAssistantToolContract('create_task');

  assert.equal(contract.execution, 'server');
  assert.equal(contract.isArguments(args()), true);

  for (const extra of [
    { ownerId: 'another-owner' },
    { status: 'completed' },
    { isFocused: true },
    { projectId: 'project-a' },
  ]) {
    assert.equal(contract.isArguments({ ...args(), ...extra }), false);
  }
});

test('Task contract rejects malformed arguments and unconfirmed success results', () => {
  const contract = getAssistantToolContract('create_task');

  for (const value of [
    null, [], {}, args({ title: 42 }), args({ description: [] }),
    args({ deadline: { kind: 'date' } }),
    args({ deadline: { kind: 'timed', at: '2026-10-30T12:00:00Z' } }),
    args({ deadline: { kind: 'unknown', date: '2026-10-30' } }),
    args({ deadline: { kind: 'date', date: '2026-10-30', ownerId: 'other' } }),
  ]) {
    assert.equal(contract.isArguments(value), false);
  }

  for (const value of [
    { status: 'success' },
    { status: 'success', task: args() },
    { status: 'success', task: { id: '', ...args() } },
    { status: 'error', message: '' },
  ]) {
    assert.equal(contract.isResult(value), false);
  }
});

test('creation uses verified context and returns normalized saved details', async () => {
  let receivedContext;
  let receivedDetails;

  const execute = createAssistantTaskToolExecutor((verified) => {
    receivedContext = verified;
    return {
      create: async (details) => {
        receivedDetails = details;
        return { id: 'task-1', ...details };
      },
    };
  });

  const output = await execute(call({
    title: '  Renew passport  ',
    deadline: {
      kind: 'timed',
      at: '2026-11-01T09:00:00-05:00',
      timeZone: 'America/Toronto',
    },
  }), context);

  assert.deepEqual(receivedContext, context);
  assert.equal(receivedDetails.title, 'Renew passport');
  assert.equal(receivedDetails.deadline.at, '2026-11-01T14:00:00.000Z');
  assert.equal(output.result.status, 'success');
  assert.equal(output.result.task.id, 'task-1');
  assert.equal(getAssistantToolContract('create_task').isResult(output.result), true);
});

test('date-only deadlines and planned dates retain their distinct meanings', async () => {
  const execute = createAssistantTaskToolExecutor(() => ({
    create: async (details) => ({ id: 'task-1', ...details }),
  }));

  const output = await execute(call({
    deadline: { kind: 'date', date: '2026-10-31' },
    scheduledDate: '2026-10-30',
  }), context);

  assert.deepEqual(output.result.task.deadline, { kind: 'date', date: '2026-10-31' });
  assert.equal(output.result.task.scheduledDate, '2026-10-30');
  const undated = await execute(call(), context);
  assert.equal(undated.result.task.deadline, null);
  assert.equal(undated.result.task.scheduledDate, null);
});

test('invalid calendar input requests clarification without a write', async () => {
  let writes = 0;
  const execute = createAssistantTaskToolExecutor(() => ({
    create: async () => {
      writes += 1;
      throw new Error('Unexpected write');
    },
  }));

  for (const changes of [
    { title: ' ' },
    { deadline: { kind: 'date', date: '2026-02-30' } },
    { scheduledDate: '2026-02-30' },
    { deadline: { kind: 'timed', at: '2026-10-30T12:00:00', timeZone: 'UTC' } },
    { deadline: { kind: 'timed', at: '2026-10-30T12:00:00Z', timeZone: 'Invalid/Zone' } },
  ]) {
    const output = await execute(call(changes), context);
    assert.equal(output.result.status, 'clarification_required');
  }
  assert.equal(writes, 0);
});

test('an unconfirmed database operation is never reported as success', async () => {
  let writes = 0;
  const execute = createAssistantTaskToolExecutor(() => ({
    create: async () => {
      writes += 1;
      throw new Error('Connection lost');
    },
  }));

  const output = await execute(call(), context);

  assert.equal(output.result.status, 'error');
  assert.equal(writes, 1);
  assert.match(output.result.message, /could not be confirmed/);
});

test('the actual server dispatcher routes create_task only to the Task executor', async () => {
  const expectedCall = call();
  const expectedOutput = {
    callId: expectedCall.callId,
    execution: 'server',
    name: 'create_task',
    result: { status: 'success', task: { id: 'task-1', ...args() } },
  };
  let taskCalls = 0;
  const wrongRoute = async () => assert.fail('Task creation reached a different executor');
  const executors = {
    history: wrongRoute,
    memory: wrongRoute,
    project: wrongRoute,
    projectWrite: wrongRoute,
    task: async (receivedCall, receivedContext) => {
      taskCalls += 1;
      assert.equal(receivedCall, expectedCall);
      assert.equal(receivedContext, context);
      return expectedOutput;
    },
  };

  const output = await executeAssistantServerTool(expectedCall, context, executors);
  assert.equal(output, expectedOutput);
  assert.equal(taskCalls, 1);
  await assert.rejects(
    executeAssistantServerTool({ ...expectedCall, execution: 'client' }, context, executors),
    /No server executor/,
  );
  assert.equal(taskCalls, 1);
});

test('Task executor uses the existing Supabase insert and verified owner', async () => {
  let savedRow;
  const client = createClient('https://example.supabase.co', 'test-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${context.accessToken}` },
      fetch: async (input, init) => {
        const outgoing = new Request(input, init);
        assert.equal(new URL(outgoing.url).pathname, '/rest/v1/everyday_tasks');
        assert.equal(outgoing.method, 'POST');
        assert.equal(outgoing.headers.get('Authorization'), `Bearer ${context.accessToken}`);
        savedRow = await outgoing.json();
        return new Response(JSON.stringify({
          ...savedRow, id: 'task-1', status: 'active', is_focused: false,
          completed_at: null, created_at: '2026-10-29T13:00:00Z',
          updated_at: '2026-10-29T13:00:00Z', version: 1,
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  const execute = createAssistantTaskToolExecutor((verified) =>
    new SupabaseTaskRepository(verified.userId, () => client));

  const output = await execute(call(), context);
  assert.equal(output.result.status, 'success');
  assert.equal(savedRow.owner_id, context.userId);
  assert.equal('status' in savedRow, false);
  assert.equal('is_focused' in savedRow, false);
});

test('the assistant loop receives the saved result before confirmation', async () => {
  let writes = 0;
  let modelRequests = 0;

  const execute = createAssistantTaskToolExecutor((verified) => {
    assert.deepEqual(verified, context);
    return {
      create: async (details) => {
        writes += 1;
        return { id: 'task-1', ...details };
      },
    };
  });

  const response = await handleAssistantRequest(request(), {
    allowedOrigin: 'https://example.com',
    apiKey: 'test-key',
    verifyAccessToken: async () => ({ id: context.userId }),
    authorizeAction: async () => ({ status: 'authorized', basis: 'explicit_request' }),
    executeServerTool: execute,
    fetchImplementation: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      modelRequests += 1;

      if (modelRequests === 1) {
        assert.equal(writes, 0);
        assert.ok(body.tools.some(({ name }) => name === 'create_task'));

        return new Response(JSON.stringify({
          output: [{
            type: 'function_call',
            name: 'create_task',
            call_id: 'create-personal-task',
            arguments: JSON.stringify(args()),
          }],
        }));
      }

      assert.equal(writes, 1);
      const result = body.input.find(
        (item) => item.type === 'function_call_output',
      );
      assert.equal(JSON.parse(result.output).status, 'success');

      return new Response(JSON.stringify({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'Added renewing your passport to All Tasks.',
          }],
        }],
      }));
    },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'completed');
  assert.equal(modelRequests, 2);
  assert.equal(writes, 1);
});

test('missing or invalid authentication prevents Task execution', async () => {
  for (const token of [null, 'invalid-token']) {
    const response = await handleAssistantRequest(request(token), {
      allowedOrigin: 'https://example.com',
      apiKey: 'test-key',
      verifyAccessToken: async () => { throw new InvalidAccessTokenError(); },
      executeServerTool: async () => assert.fail('Unauthenticated Task write'),
      fetchImplementation: async () => assert.fail('Unauthenticated model request'),
    });
    assert.equal(response.status, 401);
  }
});

test('malformed model Task arguments are rejected before execution', async () => {
  const response = await handleAssistantRequest(request(), {
    allowedOrigin: 'https://example.com',
    apiKey: 'test-key',
    verifyAccessToken: async () => ({ id: context.userId }),
    executeServerTool: async () => assert.fail('Malformed Task write'),
    fetchImplementation: async () => new Response(JSON.stringify({
      output: [{
        type: 'function_call', name: 'create_task', call_id: 'malformed',
        arguments: JSON.stringify({ ...args(), ownerId: 'another-owner' }),
      }],
    })),
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'assistant_unavailable');
});

test('database failure reaches the model as error without retrying creation', async () => {
  let writes = 0;
  let requests = 0;
  const execute = createAssistantTaskToolExecutor(() => ({
    create: async () => {
      writes += 1;
      throw new Error('Database unavailable');
    },
  }));
  const response = await handleAssistantRequest(request(), {
    allowedOrigin: 'https://example.com',
    apiKey: 'test-key',
    verifyAccessToken: async () => ({ id: context.userId }),
    authorizeAction: async () => ({ status: 'authorized', basis: 'explicit_request' }),
    executeServerTool: execute,
    fetchImplementation: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'create_task', call_id: 'failed-create',
          arguments: JSON.stringify(args()),
        }] }));
      }
      const output = body.input.find((item) => item.type === 'function_call_output');
      assert.equal(JSON.parse(output.output).status, 'error');
      assert.match(body.instructions, /Only confirm personal Task creation after create_task returns status success/);
      assert.match(body.instructions, /Do not automatically retry an unconfirmed creation/);
      return new Response(JSON.stringify({ output: [{
        type: 'message', content: [{ type: 'output_text', text: 'Task creation could not be confirmed.' }],
      }] }));
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, 'Task creation could not be confirmed.');
  assert.equal(writes, 1);
  assert.equal(requests, 2);
});

test('mixed Task and Calendar continuation preserves the saved Task without replay', async () => {
  let writes = 0;
  let calendarCalls = 0;
  let modelRequests = 0;
  const execute = createAssistantTaskToolExecutor(() => ({
    create: async (details) => {
      writes += 1;
      return { id: 'task-1', ...details };
    },
  }));
  const modelFetch = async (_url, init) => {
    modelRequests += 1;
    const body = JSON.parse(String(init.body));
    if (modelRequests === 1) {
      return new Response(JSON.stringify({ output: [
        { type: 'function_call', name: 'create_task', call_id: 'mixed-task', arguments: JSON.stringify(args()) },
        { type: 'function_call', name: 'get_today_calendar_events', call_id: 'mixed-calendar', arguments: JSON.stringify({ includeLocations: false }) },
      ] }));
    }
    const outputs = body.input.filter((item) => item.type === 'function_call_output');
    assert.equal(outputs.length, 2);
    assert.ok(outputs.every((item) => JSON.parse(item.output).status === 'success'));
    return new Response(JSON.stringify({ output: [{
      type: 'message', content: [{ type: 'output_text', text: 'Added the Task. Your calendar is empty today.' }],
    }] }));
  };
  const client = createAssistantApiClient(async (_url, init) =>
    handleAssistantRequest(new Request('https://example.com/api/assistant', {
      ...init,
      headers: { ...init.headers, Origin: 'https://example.com' },
    }), {
      allowedOrigin: 'https://example.com', apiKey: 'test-key',
      verifyAccessToken: async () => ({ id: context.userId }),
      authorizeAction: async () => ({ status: 'authorized', basis: 'explicit_request' }),
      executeServerTool: execute, fetchImplementation: modelFetch,
    }), async (calendarCall) => {
    calendarCalls += 1;
    assert.equal(writes, 1);
    return {
      callId: calendarCall.callId, name: calendarCall.name, execution: 'client',
      result: { events: [], status: 'success' },
    };
  }, async () => context.accessToken);

  const body = await request().json();
  const content = await client(body, new AbortController().signal);
  assert.equal(content, 'Added the Task. Your calendar is empty today.');
  assert.equal(writes, 1);
  assert.equal(calendarCalls, 1);
  assert.equal(modelRequests, 2);
});
