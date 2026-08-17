import test from 'node:test'
import assert from 'node:assert/strict'
import { organizationExcelDate, organizationMonthBoundsFor } from '../utils/date.js'

test('attendance month bounds include the complete India business month',()=>{
  const {start,end}=organizationMonthBoundsFor(2026,8)
  assert.equal(start.toISOString(),'2026-07-31T18:30:00.000Z')
  assert.equal(end.toISOString(),'2026-08-31T18:30:00.000Z')
})

test('Excel attendance time preserves the India wall clock',()=>{
  assert.equal(organizationExcelDate('2026-08-14T04:30:00.000Z').toISOString(),'2026-08-14T10:00:00.000Z')
})
