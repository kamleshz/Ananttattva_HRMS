import test from 'node:test';
import assert from 'node:assert/strict';

import { countWorkingDays } from '../services/leavePolicyService.js';

test('second and fourth Saturdays are working days for leave requests', () => {
  assert.equal(countWorkingDays('2026-09-12', '2026-09-12'), 1);
  assert.equal(countWorkingDays('2026-09-26', '2026-09-26'), 1);
});

test('first, third and fifth Saturdays are weekly offs', () => {
  assert.equal(countWorkingDays('2026-09-05', '2026-09-05'), 0);
  assert.equal(countWorkingDays('2026-09-19', '2026-09-19'), 0);
  assert.equal(countWorkingDays('2026-10-31', '2026-10-31'), 0);
});

test('Sunday remains excluded from leave working days', () => {
  assert.equal(countWorkingDays('2026-09-13', '2026-09-13'), 0);
});

test('configured holidays remain excluded, including Saturdays', () => {
  assert.equal(countWorkingDays('2026-09-12', '2026-09-12', new Set(['2026-09-12'])), 0);
});
