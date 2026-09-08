import test from 'node:test';
import assert from 'node:assert/strict';

import { countWorkingDays } from '../services/leavePolicyService.js';

test('Saturday is available as a working day for leave requests', () => {
  assert.equal(countWorkingDays('2026-09-12', '2026-09-12'), 1);
});

test('Sunday remains excluded from leave working days', () => {
  assert.equal(countWorkingDays('2026-09-13', '2026-09-13'), 0);
});

test('configured holidays remain excluded, including Saturdays', () => {
  assert.equal(countWorkingDays('2026-09-12', '2026-09-12', new Set(['2026-09-12'])), 0);
});
