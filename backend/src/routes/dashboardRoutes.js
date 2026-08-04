import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { startOfLocalDay } from '../utils/date.js'

const router = Router()
router.use(authenticate)

function upcomingBirthday(employee, today) {
  const dateOfBirth = new Date(employee.dateOfBirth)
  let nextDate = new Date(today.getFullYear(), dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate())
  if (nextDate < today) nextDate = new Date(today.getFullYear()+1, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate())
  const daysUntil = Math.round((nextDate-today)/(24*60*60*1000))
  return { employeeId:employee.id, firstName:employee.firstName, lastName:employee.lastName, profilePhoto:employee.profilePhoto, date:nextDate, daysUntil }
}

router.get('/employee', asyncHandler(async (req, res) => {
  const employee = req.user.employee
  const today = startOfLocalDay()
  const [attendance,birthdayEmployees] = await Promise.all([
    employee ? Attendance.findOne({employee:employee._id,date:today}) : null,
    Employee.find({employeeStatus:'active',dateOfBirth:{$ne:null}}).select('firstName lastName profilePhoto dateOfBirth'),
  ])
  const birthdays = birthdayEmployees.map(item=>upcomingBirthday(item,today)).filter(item=>item.daysUntil<=30).sort((a,b)=>a.daysUntil-b.daysUntil).slice(0,5)
  res.json({ success:true, data:{ user:{firstName:req.user.firstName,lastName:req.user.lastName,role:req.user.role}, employee, today:attendance, birthdays, tasks:[], holidays:[], away:[] } })
}))
router.get('/admin', authorize('super_admin','hr_admin'), asyncHandler(async (_req, res) => {
  const date = startOfLocalDay()
  const [total, present, late, wfh] = await Promise.all([Employee.countDocuments({employeeStatus:'active'}),Attendance.countDocuments({date,status:'present'}),Attendance.countDocuments({date,status:'late'}),Attendance.countDocuments({date,status:'wfh'})])
  res.json({success:true,data:{totalEmployees:total,presentToday:present,lateToday:late,wfhToday:wfh,notReported:Math.max(0,total-present-late-wfh)}})
}))
export default router
