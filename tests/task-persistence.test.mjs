import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import {
  SupabaseTaskRepository,
  TaskWriteConflictError,
} from '../src/services/tasks/supabase-task-repository.ts';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FIRST_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ID = '00000000-0000-4000-8000-000000000002';

function row(overrides = {}) {
  return {
    id: FIRST_ID,
    owner_id: OWNER,
    title: 'Prepare paperwork',
    description: null,
    deadline_date: null,
    deadline_at: null,
    deadline_time_zone: null,
    scheduled_date: null,
    status: 'active',
    is_focused: false,
    completed_at: null,
    created_at: '2026-10-23T10:00:00.000Z',
    updated_at: '2026-10-23T10:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function setup(respond) {
  const requests = [];

  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const entry = {
          method: request.method,
          url: new URL(request.url),
          body: request.method === 'GET'
            ? null
            : await request.json(),
        };

        requests.push(entry);

        const result = await respond(entry);

        return new Response(JSON.stringify(result.body), {
          status: result.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });

  return {
    repository: new SupabaseTaskRepository(OWNER, () => client),
    requests,
  };
}

test('create normalizes details and excludes caller-supplied metadata', async () => {
  const { repository, requests } = setup(() => ({
    body: row({ title: 'Prepare paperwork' }),
  }));

  const saved = await repository.create({
    title: '  Prepare paperwork  ',
    status: 'completed',
    isFocused: true,
    version: 99,
    owner_id: 'another-owner',
  });

  assert.equal(saved.status, 'active');
  assert.equal(saved.version, 1);

  assert.deepEqual(requests[0].body, {
    title: 'Prepare paperwork',
    description: null,
    scheduled_date: null,
    deadline_date: null,
    deadline_at: null,
    deadline_time_zone: null,
    owner_id: OWNER,
  });
});

test('fresh retrieval maps timed deadlines and remains owner-scoped', async () => {
  const { repository, requests } = setup(() => ({
    body: [row({
      deadline_at: '2026-11-01T14:00:00+00:00',
      deadline_time_zone: 'America/New_York',
    })],
  }));

  const task = await repository.get(FIRST_ID);

  assert.deepEqual(task.deadline, {
    kind: 'timed',
    at: '2026-11-01T14:00:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.equal(requests[0].url.searchParams.get('owner_id'), `eq.${OWNER}`);
  assert.equal(requests[0].url.searchParams.get('id'), `eq.${FIRST_ID}`);
});

test('list reads every page even when the server returns a smaller page', async () => {
  let page = 0;
  const pages = [
    [row()],
    [row({ id: SECOND_ID })],
    [],
  ];

  const { repository, requests } = setup(() => ({
    body: pages[page++],
  }));

  const tasks = await repository.list();

  assert.deepEqual(tasks.map((task) => task.id), [FIRST_ID, SECOND_ID]);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].url.searchParams.get('id'), `gt.${FIRST_ID}`);
  assert.equal(requests[2].url.searchParams.get('id'), `gt.${SECOND_ID}`);
});

test('detail edits cannot pass status or Focus through to persistence', async () => {
  const { repository, requests } = setup((request) => ({
    body: request.method === 'GET'
      ? [row({ is_focused: true })]
      : row({ title: 'Updated', is_focused: true, version: 2 }),
  }));

  const current = await repository.get(FIRST_ID);

  await repository.edit(current, {
    title: ' Updated ',
    status: 'completed',
    isFocused: false,
  });

  const write = requests[1];

  assert.equal(write.body.title, 'Updated');
  assert.equal('status' in write.body, false);
  assert.equal('is_focused' in write.body, false);
  assert.equal(write.body.version, 2);
  assert.equal(write.url.searchParams.get('version'), 'eq.1');
  assert.equal(write.url.searchParams.get('owner_id'), `eq.${OWNER}`);
});

test('status and Focus operations use domain rules before writing', async () => {
  const { repository, requests } = setup(() => ({
    body: [row({ status: 'completed', completed_at: '2026-10-23T11:00:00Z' })],
  }));

  const current = await repository.get(FIRST_ID);
  const reads = requests.length;

  await assert.rejects(repository.setFocus(current, true));
  await assert.rejects(repository.setStatus(current, 'dismissed'));
  await assert.rejects(
    repository.postpone(current, '2026-10-25', '2026-10-23'),
  );

  assert.equal(requests.length, reads);
});

test('postponement preserves Focus and does not write deadline fields', async () => {
  const { repository, requests } = setup((request) => ({
    body: request.method === 'GET'
      ? [row({ is_focused: true })]
      : row({
          is_focused: true,
          scheduled_date: '2026-10-25',
          version: 2,
        }),
  }));

  const current = await repository.get(FIRST_ID);
  const saved = await repository.postpone(
    current,
    '2026-10-25',
    '2026-10-23',
  );

  assert.equal(saved.isFocused, true);
  assert.deepEqual(requests[1].body, {
    scheduled_date: '2026-10-25',
    version: 2,
  });
});

test('zero matched rows and database version conflicts are reported', async () => {
  for (const failure of [
    { body: null },
    {
      status: 409,
      body: { code: '40001', message: 'Task version conflict.' },
    },
  ]) {
    const { repository } = setup((request) => ({
      ...(request.method === 'GET' ? { body: [row()] } : failure),
    }));

    const current = await repository.get(FIRST_ID);

    await assert.rejects(
      repository.setFocus(current, true),
      TaskWriteConflictError,
    );
  }
});

test('a repeated status request reads current data without writing', async () => {
  const { repository, requests } = setup(() => ({ body: [row()] }));
  const current = await repository.get(FIRST_ID);

  await repository.setStatus(current, 'active');

  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.method === 'GET'));
});

test('database errors are propagated without automatic write retries', async () => {
  const { repository, requests } = setup(() => ({
    status: 503,
    body: { code: 'unavailable', message: 'Temporarily unavailable.' },
  }));

  await assert.rejects(
    repository.create({ title: 'Task' }),
    (error) => error.code === 'unavailable',
  );

  assert.equal(requests.length, 1);
});
