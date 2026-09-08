import test from 'node:test';
import assert from 'node:assert/strict';

import { countWorkingDays } from '../services/leavePolicyService.js';
import { isScheduledWorkingDay } from '../services/workingDayService.js';

test('second, fourth and fifth Saturdays are working days for leave requests', () => {
  assert.equal(countWorkingDays('2026-09-12', '2026-09-12'), 1);
  assert.equal(countWorkingDays('2026-09-26', '2026-09-26'), 1);
  assert.equal(countWorkingDays('2026-10-31', '2026-10-31'), 1);
});

test('first and third Saturdays are weekly offs', () => {
  assert.equal(countWorkingDays('2026-09-05', '2026-09-05'), 0);
  assert.equal(countWorkingDays('2026-09-19', '2026-09-19'), 0);
});

test('Sunday remains excluded from leave working days', () => {
  assert.equal(countWorkingDays('2026-09-13', '2026-09-13'), 0);
});

test('configured holidays remain excluded, including Saturdays', () => {
  assert.equal(countWorkingDays('2026-09-12', '2026-09-12', new Set(['2026-09-12'])), 0);
});

test('attendance scheduler follows the same Saturday and holiday calendar', () => {
  assert.equal(isScheduledWorkingDay(new Date('2026-09-05T06:30:00.000Z')), false);
  assert.equal(isScheduledWorkingDay(new Date('2026-09-12T06:30:00.000Z')), true);
  assert.equal(isScheduledWorkingDay(new Date('2026-10-31T06:30:00.000Z')), true);
  assert.equal(isScheduledWorkingDay(new Date('2026-09-12T06:30:00.000Z'), new Set(['2026-09-12'])), false);
});
