import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import EmbeddedPostgres from 'embedded-postgres';
import pgPackage from 'pg';

const { Client } = pgPackage;
const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let embedded;
let admin;
let databaseDir;
let port;

async function availablePort() {
  const server = net.createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const result = address.port;

  await new Promise((resolve) => server.close(resolve));
  return result;
}

async function asUser(ownerId, run) {
  const connection = new Client({
    database: 'postgres',
    host: '127.0.0.1',
    password: 'tasks-test',
    port,
    user: 'postgres',
  });

  await connection.connect();

  try {
    await connection.query('set role authenticated');
    await connection.query(
      "select set_config('request.jwt.claim.sub', $1, false)",
      [ownerId],
    );
    return await run(connection);
  } finally {
    await connection.end();
  }
}

async function create(connection) {
  return (await connection.query(`
    insert into public.everyday_tasks(title)
    values ('  Prepare paperwork  ')
    returning *
  `)).rows[0];
}

async function update(connection, task, assignments) {
  return connection.query(`
    update public.everyday_tasks
    set ${assignments}, version = $2
    where id = $1 and version = $3
    returning *
  `, [task.id, task.version + 1, task.version]);
}

function hasCode(code) {
  return (error) => error.code === code;
}

before(async () => {
  databaseDir = await mkdtemp(path.join(os.tmpdir(), 'auri-tasks-'));
  port = await availablePort();

  embedded = new EmbeddedPostgres({
    databaseDir,
    password: 'tasks-test',
    persistent: false,
    port,
    user: 'postgres',
    onError: () => undefined,
    onLog: () => undefined,
  });

  await embedded.initialise();
  await embedded.start();

  admin = embedded.getPgClient();
  await admin.connect();

  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;

    create schema auth;
    create table auth.users(id uuid primary key);

    create function auth.uid()
    returns uuid
    language sql stable
    set search_path = ''
    as $$
      select nullif(
        pg_catalog.current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;

    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    insert into auth.users(id)
    values ('${OWNER_A}'), ('${OWNER_B}');
  `);

  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const matches = (await readdir(migrationDir))
    .filter((name) => name.endsWith('_create_everyday_tasks.sql'));

  assert.equal(matches.length, 1);

  await admin.query(await readFile(
    new URL(matches[0], migrationDir),
    'utf8',
  ));
});

after(async () => {
  await admin?.end();
  await embedded?.stop();

  if (databaseDir) {
    await rm(databaseDir, { recursive: true, force: true });
  }
});

test('creation uses server metadata and persists across connections', async () => {
  const saved = await asUser(OWNER_A, create);

  assert.equal(saved.title, 'Prepare paperwork');
  assert.equal(saved.owner_id, OWNER_A);
  assert.equal(saved.status, 'active');
  assert.equal(saved.is_focused, false);
  assert.equal(saved.version, 1);
  assert.equal(saved.completed_at, null);
  assert.ok(saved.created_at instanceof Date);

  await asUser(OWNER_A, async (connection) => {
    const result = await connection.query(
      'select * from public.everyday_tasks where id = $1',
      [saved.id],
    );

    assert.equal(result.rows[0].title, saved.title);
    assert.equal(result.rows[0].version, 1);
  });
});

test('another user cannot read, update, or forge ownership', async () => {
  const saved = await asUser(OWNER_A, create);

  await asUser(OWNER_B, async (connection) => {
    const read = await connection.query(
      'select * from public.everyday_tasks where id = $1',
      [saved.id],
    );

    assert.equal(read.rowCount, 0);

    const write = await update(connection, saved, "title = 'Changed'");
    assert.equal(write.rowCount, 0);

    await assert.rejects(connection.query(`
      insert into public.everyday_tasks(owner_id, title)
      values ($1, 'Forged')
    `, [OWNER_A]), hasCode('42501'));
  });

  await asUser(OWNER_A, async (connection) => {
    const result = await connection.query(
      'select title from public.everyday_tasks where id = $1',
      [saved.id],
    );
    assert.equal(result.rows[0].title, saved.title);
  });
});

test('ownership, server metadata, and deletion are not client-writable', async () => {
  await asUser(OWNER_A, async (connection) => {
    const saved = await create(connection);

    for (const assignment of [
      `owner_id = '${OWNER_B}'`,
      "created_at = '2000-01-01T00:00:00Z'",
      "updated_at = '2000-01-01T00:00:00Z'",
      "completed_at = '2000-01-01T00:00:00Z'",
      'id = gen_random_uuid()',
    ]) {
      await assert.rejects(
        update(connection, saved, assignment),
        hasCode('42501'),
      );
    }

    await assert.rejects(connection.query(
      'delete from public.everyday_tasks where id = $1',
      [saved.id],
    ), hasCode('42501'));

    await assert.rejects(connection.query(`
      insert into public.everyday_tasks(title, status)
      values ('Forged', 'completed')
    `), hasCode('42501'));
  });
});

test('anonymous requests have no task access', async () => {
  await admin.query('set role anon');

  try {
    await assert.rejects(
      admin.query('select * from public.everyday_tasks'),
      hasCode('42501'),
    );
    await assert.rejects(
      admin.query("insert into public.everyday_tasks(title) values ('Task')"),
      hasCode('42501'),
    );
  } finally {
    await admin.query('reset role');
  }
});

test('lifecycle rules preserve Focus on planning and clear completion on reactivation', async () => {
  await asUser(OWNER_A, async (connection) => {
    let current = await create(connection);

    current = (await update(
      connection, current, 'is_focused = true',
    )).rows[0];

    current = (await update(
      connection, current, "scheduled_date = '2026-11-02'",
    )).rows[0];

    assert.equal(current.is_focused, true);

    current = (await update(
      connection, current, "status = 'completed'",
    )).rows[0];

    assert.equal(current.is_focused, false);
    assert.ok(current.completed_at instanceof Date);

    const completedAt = current.completed_at.getTime();

    current = (await update(
      connection, current, "title = 'Updated paperwork'",
    )).rows[0];

    assert.equal(current.completed_at.getTime(), completedAt);

    await assert.rejects(
      update(connection, current, 'is_focused = true'),
      hasCode('23514'),
    );

    await assert.rejects(
      update(connection, current, "status = 'dismissed'"),
      hasCode('23514'),
    );

    current = (await update(
      connection, current, "status = 'active'",
    )).rows[0];

    assert.equal(current.completed_at, null);
    assert.equal(current.is_focused, false);

    current = (await update(
      connection, current, "status = 'dismissed'",
    )).rows[0];

    current = (await update(
      connection, current, "status = 'active'",
    )).rows[0];

    assert.equal(current.status, 'active');
    assert.equal(current.completed_at, null);
  });
});

test('invalid statuses, deadline shapes, and time zones are rejected', async () => {
  await asUser(OWNER_A, async (connection) => {
    const saved = await create(connection);

    for (const assignment of [
      "status = 'unknown'",
      "title = '   '",
      "deadline_at = '2026-11-01T14:00:00Z'",
      [
        "deadline_date = '2026-11-01'",
        "deadline_at = '2026-11-01T14:00:00Z'",
        "deadline_time_zone = 'UTC'",
      ].join(', '),
      [
        "deadline_at = '2026-11-01T14:00:00Z'",
        "deadline_time_zone = 'Not/A_Time_Zone'",
      ].join(', '),
    ]) {
      await assert.rejects(
        update(connection, saved, assignment),
        hasCode('23514'),
      );
    }

    let current = (await update(connection, saved, [
      "deadline_at = '2026-11-01T09:00:00-05:00'",
      "deadline_time_zone = 'America/New_York'",
    ].join(', '))).rows[0];

    assert.equal(
      current.deadline_at.toISOString(),
      '2026-11-01T14:00:00.000Z',
    );

    current = (await update(connection, current, [
      'deadline_at = null',
      'deadline_time_zone = null',
      "deadline_date = '2028-02-29'",
    ].join(', '))).rows[0];

    assert.ok(current.deadline_date instanceof Date);
    assert.deepEqual(
      [
        current.deadline_date.getFullYear(),
        current.deadline_date.getMonth() + 1,
        current.deadline_date.getDate(),
      ],
      [2028, 2, 29],
    );
  });
});

test('an outdated version filter cannot overwrite a committed update', async () => {
  await asUser(OWNER_A, async (connection) => {
    const original = await create(connection);

    const winner = (await update(
      connection,
      original,
      "title = 'Committed update'",
    )).rows[0];

    assert.equal(winner.version, original.version + 1);

    const stale = await update(
      connection,
      original,
      "title = 'Stale overwrite'",
    );

    assert.equal(stale.rowCount, 0);

    const stored = await connection.query(`
      select title, version
      from public.everyday_tasks
      where id = $1
    `, [original.id]);

    assert.deepEqual(stored.rows[0], {
      title: 'Committed update',
      version: winner.version,
    });
  });
});

test('the trigger rejects missing, jumped, and stale version tokens', async () => {
  await asUser(OWNER_A, async (connection) => {
    const original = await create(connection);

    await assert.rejects(connection.query(`
      update public.everyday_tasks
      set title = 'Blind write'
      where id = $1
    `, [original.id]), hasCode('40001'));

    await assert.rejects(connection.query(`
      update public.everyday_tasks
      set title = 'Version jump', version = 99
      where id = $1
    `, [original.id]), hasCode('40001'));

    const winner = (await update(
      connection,
      original,
      "title = 'Committed update'",
    )).rows[0];

    // Deliberately omit the version filter to test the trigger alone.
    await assert.rejects(connection.query(`
      update public.everyday_tasks
      set title = 'Stale overwrite', version = $2
      where id = $1
    `, [
      original.id,
      original.version + 1,
    ]), hasCode('40001'));

    const stored = await connection.query(`
      select title, version
      from public.everyday_tasks
      where id = $1
    `, [original.id]);

    assert.deepEqual(stored.rows[0], {
      title: 'Committed update',
      version: winner.version,
    });
  });
});

test('two writers using one version cannot both succeed', async () => {
  const saved = await asUser(OWNER_A, create);

  const results = await Promise.all([
    asUser(OWNER_A, (connection) =>
      update(connection, saved, "title = 'First writer'")),
    asUser(OWNER_A, (connection) =>
      update(connection, saved, "title = 'Second writer'")),
  ]);

  assert.deepEqual(
    results.map((result) => result.rowCount).sort(),
    [0, 1],
  );

  await asUser(OWNER_A, async (connection) => {
    const result = await connection.query(
      'select version from public.everyday_tasks where id = $1',
      [saved.id],
    );

    assert.equal(result.rows[0].version, 2);
  });
});
