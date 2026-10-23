import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTaskChanges,
  normalizeTaskDetails,
  taskFocusChange,
  taskPostponement,
  taskStatusChange,
} from '../src/domain/tasks/task-rules.ts';

function task(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Prepare paperwork',
    description: null,
    deadline: {
      kind: 'date',
      date: '2026-10-30',
    },
    scheduledDate: null,
    status: 'active',
    isFocused: false,
    completedAt: null,
    createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

test('creation preserves unknown information as null', () => {
  assert.deepEqual(
    normalizeTaskDetails({ title: '  Prepare paperwork  ' }),
    {
      title: 'Prepare paperwork',
      description: null,
      deadline: null,
      scheduledDate: null,
    },
  );
});

test('date-only deadlines stay calendar dates', () => {
  const details = normalizeTaskDetails({
    title: 'Task',
    deadline: { kind: 'date', date: '2028-02-29' },
  });

  assert.deepEqual(details.deadline, {
    kind: 'date',
    date: '2028-02-29',
  });
});

test('timed deadlines normalize to UTC and retain their time zone', () => {
  const details = normalizeTaskDetails({
    title: 'Task',
    deadline: {
      kind: 'timed',
      at: '2026-11-01T09:00:00-05:00',
      timeZone: 'America/New_York',
    },
  });

  assert.deepEqual(details.deadline, {
    kind: 'timed',
    at: '2026-11-01T14:00:00.000Z',
    timeZone: 'America/New_York',
  });
});

test('explicit offsets distinguish repeated daylight-saving times', () => {
  const deadline = (at) => normalizeTaskDetails({
    title: 'Task',
    deadline: {
      kind: 'timed',
      at,
      timeZone: 'America/New_York',
    },
  }).deadline;

  assert.equal(
    deadline('2026-11-01T01:30:00-04:00').at,
    '2026-11-01T05:30:00.000Z',
  );
  assert.equal(
    deadline('2026-11-01T01:30:00-05:00').at,
    '2026-11-01T06:30:00.000Z',
  );
});

test('creation and updates reject the same invalid information', () => {
  const invalidChanges = [
    { title: ' ' },
    { scheduledDate: '2026-02-30' },
    { deadline: { kind: 'date', date: '2026-02-29' } },
    {
      deadline: {
        kind: 'timed',
        at: '2026-02-30T09:00:00Z',
        timeZone: 'UTC',
      },
    },
    {
      deadline: {
        kind: 'timed',
        at: '2026-10-24T09:00:00',
        timeZone: 'America/New_York',
      },
    },
    {
      deadline: {
        kind: 'timed',
        at: '2026-10-24T24:00:00Z',
        timeZone: 'UTC',
      },
    },
    {
      deadline: {
        kind: 'timed',
        at: '2026-10-24T09:00:00Z',
        timeZone: 'Not/A_Time_Zone',
      },
    },
  ];

  for (const changes of invalidChanges) {
    assert.throws(() =>
      normalizeTaskDetails({ title: 'Task', ...changes }),
    );
    assert.throws(() => normalizeTaskChanges(task(), changes));
  }
});

test('updates preserve omitted fields and explicitly clear nulls', () => {
  const original = task({
    description: 'Bring the originals.',
    scheduledDate: '2026-10-24',
  });

  const renamed = normalizeTaskChanges(original, {
    title: '  Bring paperwork  ',
    deadline: undefined,
  });

  assert.deepEqual(renamed, {
    title: 'Bring paperwork',
    description: original.description,
    deadline: original.deadline,
    scheduledDate: original.scheduledDate,
  });

  assert.deepEqual(
    normalizeTaskChanges(original, {
      description: null,
      deadline: null,
      scheduledDate: null,
    }),
    {
      title: original.title,
      description: null,
      deadline: null,
      scheduledDate: null,
    },
  );
});

test('updates apply the same normalization as creation', () => {
  const input = {
    title: '  Bring paperwork  ',
    description: '  Bring the originals.  ',
    deadline: {
      kind: 'timed',
      at: '2026-11-01T09:00:00-05:00',
      timeZone: 'America/New_York',
    },
    scheduledDate: ' 2026-10-24 ',
  };

  assert.deepEqual(
    normalizeTaskChanges(task(), input),
    normalizeTaskDetails(input),
  );
});

test('planned-date edits preserve Focus and the deadline', () => {
  const original = task({ isFocused: true });
  const updated = {
    ...original,
    ...normalizeTaskChanges(original, {
      scheduledDate: '2026-10-25',
    }),
  };

  assert.equal(updated.isFocused, true);
  assert.deepEqual(updated.deadline, original.deadline);
});

test('postponement preserves Focus and does not move the deadline', () => {
  const original = task({
    isFocused: true,
    scheduledDate: '2026-10-24',
  });
  const snapshot = structuredClone(original);

  const changes = taskPostponement(
    original,
    '2026-11-02',
    '2026-10-23',
  );

  assert.deepEqual(changes, { scheduledDate: '2026-11-02' });
  assert.equal({ ...original, ...changes }.isFocused, true);
  assert.deepEqual(original, snapshot);
});

test('postponement requires a valid later future date', () => {
  const original = task({ scheduledDate: '2026-10-24' });

  for (const date of [
    '',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-02-30',
  ]) {
    assert.throws(() =>
      taskPostponement(original, date, '2026-10-23'),
    );
  }
});

test('completion and dismissal remove Focus without mutating the task', () => {
  const original = task({ isFocused: true });
  const snapshot = structuredClone(original);

  for (const status of ['completed', 'dismissed']) {
    assert.deepEqual(taskStatusChange(original, status), {
      status,
      isFocused: false,
    });
  }

  assert.deepEqual(original, snapshot);
});

test('completed and dismissed tasks can return to active', () => {
  for (const status of ['completed', 'dismissed']) {
    const original = task({
      status,
      completedAt: status === 'completed'
        ? '2026-10-23T11:00:00.000Z'
        : null,
    });

    const changes = taskStatusChange(original, 'active');

    assert.deepEqual(changes, { status: 'active' });

    const reactivated = { ...original, ...changes };

    assert.equal(reactivated.isFocused, false);
    assert.deepEqual(taskFocusChange(reactivated, true), {
      isFocused: true,
    });
  }
});

test('repeating a status request is a no-op', () => {
  for (const status of ['active', 'completed', 'dismissed']) {
    assert.deepEqual(taskStatusChange(task({ status }), status), {});
  }
});

test('terminal tasks require reactivation before other active actions', () => {
  assert.throws(() =>
    taskStatusChange(task({ status: 'completed' }), 'dismissed'),
  );
  assert.throws(() =>
    taskStatusChange(task({ status: 'dismissed' }), 'completed'),
  );

  for (const status of ['completed', 'dismissed']) {
    const original = task({ status });

    assert.throws(() => taskFocusChange(original, true));
    assert.throws(() =>
      taskPostponement(original, '2026-10-25', '2026-10-23'),
    );
  }
});
