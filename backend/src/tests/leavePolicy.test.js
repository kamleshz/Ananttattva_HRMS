import test from 'node:test';
import assert from 'node:assert/strict';

import { countWorkingDays } from '../services/leavePolicyService.js';
import { isScheduledWorkingDay } from '../services/workingDayService.js';
import { hoursAndMinutes, previousClosedWeek, splitPeriodByMonth } from '../services/missingCheckoutService.js';

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

test('weekly compliance closes the previous Monday to Sunday week', () => {
  const { start, end } = previousClosedWeek(new Date('2026-09-08T06:30:00.000Z'));
  assert.equal(start.toISOString(), '2026-08-30T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-09-06T18:30:00.000Z');
});

test('a week crossing September is split at the month boundary', () => {
  const { start, end } = previousClosedWeek(new Date('2026-09-08T06:30:00.000Z'));
  const periods = splitPeriodByMonth(start, end);
  assert.deepEqual(periods.map(item => [item.start.toISOString(), item.end.toISOString()]), [
    ['2026-08-30T18:30:00.000Z', '2026-08-31T18:30:00.000Z'],
    ['2026-08-31T18:30:00.000Z', '2026-09-06T18:30:00.000Z'],
  ]);
});

test('September weekly targets follow the Saturday policy', () => {
  const targetFor = (start, end) => {
    let minutes = 0;
    for (let day = new Date(start); day < new Date(end); day = new Date(day.getTime() + 86_400_000)) {
      if (isScheduledWorkingDay(day)) minutes += 510;
    }
    return minutes;
  };
  assert.equal(hoursAndMinutes(targetFor('2026-08-31T18:30:00.000Z', '2026-09-06T18:30:00.000Z')), '34h 00m');
  assert.equal(hoursAndMinutes(targetFor('2026-09-06T18:30:00.000Z', '2026-09-13T18:30:00.000Z')), '51h 00m');
  assert.equal(hoursAndMinutes(targetFor('2026-09-13T18:30:00.000Z', '2026-09-20T18:30:00.000Z')), '42h 30m');
});
