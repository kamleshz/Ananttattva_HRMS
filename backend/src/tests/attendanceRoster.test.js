import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAttendanceRoster } from '../services/attendanceRosterService.js'

test('complete attendance roster includes absent weekdays and weekends',()=>{
  const employee={_id:'employee-1',firstName:'Asha',lastName:'Patil',joiningDate:new Date('2026-08-01T00:00:00.000Z'),shift:{name:'General Shift'}}
  const start=new Date('2026-08-14T18:30:00.000Z'),end=new Date('2026-08-17T18:30:00.000Z')
  const rows=buildAttendanceRoster({employees:[employee],records:[],start,end})
  assert.deepEqual(rows.map(row=>row.status),['absent','weekend','weekend'])
})

test('stored attendance replaces the generated roster placeholder',()=>{
  const employee={_id:'employee-1',firstName:'Asha',lastName:'Patil'}
  const date=new Date('2026-08-16T18:30:00.000Z'),record={_id:'attendance-1',employee,date,status:'present'}
  const rows=buildAttendanceRoster({employees:[employee],records:[record],start:date,end:new Date(date.getTime()+86400000)})
  assert.equal(rows.length,1)
  assert.equal(rows[0]._id,'attendance-1')
})
