import { startOfLocalDay } from '../utils/date.js'

const DAY_MS=24*60*60*1000
const employeeId=value=>String(value?._id||value||'')
const plain=value=>value?.toObject?.()||value

export function buildAttendanceRoster({employees,records,start,end}){
  const byEmployeeAndDate=new Map(records.map(record=>{
    const item=plain(record)
    return [`${employeeId(item.employee)}:${new Date(item.date).getTime()}`,item]
  }))
  const rows=[],includedRecordIds=new Set()
  for(const employeeDocument of employees){
    const employee=plain(employeeDocument),joinedAt=employee.joiningDate?startOfLocalDay(employee.joiningDate):null
    for(let cursor=new Date(start);cursor<end;cursor=new Date(cursor.getTime()+DAY_MS)){
      if(joinedAt&&cursor<joinedAt)continue
      const key=`${employeeId(employee)}:${cursor.getTime()}`,record=byEmployeeAndDate.get(key)
      if(record){rows.push(record);includedRecordIds.add(String(record._id));continue}
      const organizationDay=new Date(cursor.getTime()+330*60*1000).getUTCDay()
      rows.push({_id:`roster-${employeeId(employee)}-${cursor.toISOString().slice(0,10)}`,employee,date:new Date(cursor),shift:employee.shift,status:[0,6].includes(organizationDay)?'weekend':'absent',attendanceMode:null,checkIn:null,checkOut:null,workingMinutes:0,lateMinutes:0,isRosterPlaceholder:true})
    }
  }
  for(const recordDocument of records){
    const record=plain(recordDocument)
    if(!includedRecordIds.has(String(record._id)))rows.push(record)
  }
  return rows.sort((left,right)=>new Date(right.date)-new Date(left.date)||`${left.employee?.firstName||''} ${left.employee?.lastName||''}`.localeCompare(`${right.employee?.firstName||''} ${right.employee?.lastName||''}`))
}
