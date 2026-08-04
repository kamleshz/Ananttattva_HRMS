import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { startOfLocalDay } from '../utils/date.js'

const router = Router()
router.use(authenticate)
router.get('/employee', asyncHandler(async (req, res) => {
  const employee = req.user.employee
  const attendance = employee ? await Attendance.findOne({employee:employee._id,date:startOfLocalDay()}) : null
  res.json({ success:true, data:{ user:{firstName:req.user.firstName,lastName:req.user.lastName,role:req.user.role}, employee, today:attendance, tasks:[], holidays:[], away:[] } })
}))
router.get('/admin', authorize('super_admin','hr_admin'), asyncHandler(async (_req, res) => {
  const date = startOfLocalDay()
  const [total, present, late, wfh] = await Promise.all([Employee.countDocuments({employeeStatus:'active'}),Attendance.countDocuments({date,status:'present'}),Attendance.countDocuments({date,status:'late'}),Attendance.countDocuments({date,status:'wfh'})])
  res.json({success:true,data:{totalEmployees:total,presentToday:present,lateToday:late,wfhToday:wfh,notReported:Math.max(0,total-present-late-wfh)}})
}))
export default router
