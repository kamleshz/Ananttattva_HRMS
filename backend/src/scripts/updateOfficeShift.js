import { connectDatabase } from '../config/db.js'
import { Employee } from '../models/Employee.js'

async function updateOfficeShift() {
  await connectDatabase()
  const result = await Employee.updateMany({}, {
    $set: {
      'shift.name': 'General Shift',
      'shift.startTime': '10:00',
      'shift.endTime': '18:30',
      'shift.graceMinutes': 15,
    },
  })
  console.log(`Updated office shift for ${result.modifiedCount} employee(s)`) 
  process.exit(0)
}

updateOfficeShift().catch(error => {
  console.error(error.message)
  process.exit(1)
})
