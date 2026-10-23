import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarDateLabel,
  deadlineLabel,
  localCalendarDate,
  taskCollections,
} from '../src/features/tasks/task-presentation.ts';

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    status: 'active',
    isFocused: false,
    createdAt: '2026-10-23T10:00:00.000Z',
    ...overrides,
  };
}

test('Focus and status collections derive from the same task records', () => {
  const first = task('first', { isFocused: true });
  const second = task('second');
  const completed = task('completed', { status: 'completed' });
  const dismissed = task('dismissed', { status: 'dismissed' });

  const collections = taskCollections([
    dismissed,
    second,
    completed,
    first,
  ]);

  assert.deepEqual(
    collections.active.map((value) => value.id),
    ['first', 'second'],
  );
  assert.deepEqual(collections.focused, [first]);
  assert.deepEqual(collections.completed, [completed]);
  assert.deepEqual(collections.dismissed, [dismissed]);

  assert.equal(collections.focused[0], collections.active[0]);
});

test('deriving collections does not mutate the source array', () => {
  const values = [
    task('later', { createdAt: '2026-10-24T10:00:00Z' }),
    task('earlier'),
  ];
  const original = [...values];

  const collections = taskCollections(values);

  assert.deepEqual(values, original);
  assert.deepEqual(
    collections.active.map((value) => value.id),
    ['earlier', 'later'],
  );
});

test('one or several selected tasks work without a separate Focus model', () => {
  const values = [
    task('first', { isFocused: true }),
    task('second', { isFocused: true }),
  ];

  assert.equal(taskCollections(values.slice(0, 1)).focused.length, 1);
  assert.equal(taskCollections(values).focused.length, 2);

  const changed = [
    { ...values[0], isFocused: false },
    values[1],
  ];

  assert.deepEqual(
    taskCollections(changed).focused.map((value) => value.id),
    ['second'],
  );
});

test('date-only deadlines stay calendar dates', () => {
  assert.equal(calendarDateLabel('2028-02-29', 'en-US'), 'Feb 29, 2028');

  assert.equal(
    deadlineLabel({
      kind: 'date',
      date: '2028-02-29',
    }, 'en-US'),
    'Feb 29, 2028',
  );
});

test('timed deadlines use their stored time zone', () => {
  const label = deadlineLabel({
    kind: 'timed',
    at: '2026-11-01T14:00:00.000Z',
    timeZone: 'America/New_York',
  }, 'en-US');

  assert.match(label, /9:00/);
  assert.match(label, /America\/New_York/);
});

test('postponement receives a local calendar date', () => {
  assert.equal(
    localCalendarDate(new Date(2026, 9, 23, 23, 59)),
    '2026-10-23',
  );
});
