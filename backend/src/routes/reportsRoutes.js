import { Router } from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { Attendance } from '../models/Attendance.js'
import { Employee } from '../models/Employee.js'
import { FaceAttendanceRequest } from '../models/FaceAttendanceRequest.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { dateFromKey, organizationDateKey, isScheduledWorkingDay, holidayKeysBetween } from '../services/workingDayService.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'

let _sharp = null
try { _sharp = (await import('sharp')).default } catch (_) { /* sharp optional */ }

const router=Router()
router.use(authenticate)

const MIS_ROLES=['super_admin','admin','hr_admin','finance_admin']
const DAY_MS=86_400_000

function resolveCompanyLogo() {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'assets', 'ananttattva-logo.svg'),
    fileURLToPath(new URL('../assets/ananttattva-logo.svg', import.meta.url)),
    path.resolve(process.cwd(), 'assets', 'ananttattva-logo.svg'),
    path.resolve(process.cwd(), 'src', 'assets', 'Screenshot 2026-09-08 121937.png'),
    path.resolve(process.cwd(), '..', 'frontend', 'public', 'ananttattva-logo.svg'),
    path.resolve(process.cwd(), '..', 'frontend', 'public', 'Screenshot 2026-09-08 121937.png'),
    path.resolve(process.cwd(), 'frontend', 'public', 'ananttattva-logo.svg'),
    fileURLToPath(new URL('../../../frontend/public/ananttattva-logo.svg', import.meta.url)),
    fileURLToPath(new URL('../../../frontend/public/Screenshot 2026-09-08 121937.png', import.meta.url)),
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch (_) { /* ignore */ }
  }
  return null
}
const COMPANY_LOGO = resolveCompanyLogo()

function resolveCompanyTrishulIcon() {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'assets', 'ananttattva-trishul-icon.svg'),
    fileURLToPath(new URL('../assets/ananttattva-trishul-icon.svg', import.meta.url)),
    path.resolve(process.cwd(), 'assets', 'ananttattva-trishul-icon.svg'),
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch (_) { /* ignore */ }
  }
  return null
}
const COMPANY_TRISHUL_ICON = resolveCompanyTrishulIcon()

async function iconPdfSource(iconPath) {
  if (!iconPath) return { ok: false }
  const ext = path.extname(iconPath).toLowerCase()
  try {
    if (ext === '.svg' && _sharp) {
      const png = await _sharp(iconPath).resize({ height: 72, withoutEnlargement: true }).png().toBuffer()
      return { ok: true, src: png, format: 'png' }
    }
    if (['.png','.jpg','.jpeg'].includes(ext)) {
      return { ok: true, src: iconPath, format: ext.slice(1) }
    }
    return { ok: false }
  } catch (err) {
    console.warn('[PDF] icon convert failed:', err.message)
    return { ok: false, reason: err.message }
  }
}

function formatMinutesToHoursMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

function monthRange(value){
  const match=String(value||'').match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if(!match)throw new Error('Month must use YYYY-MM format')
  const year=Number(match[1]),month=Number(match[2])-1
  return {start:new Date(Date.UTC(year,month,1)),end:new Date(Date.UTC(year,month+1,1)),label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month,1)))}
}

function reportRange(query){
  if(query.from&&query.to){const input=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(query),start=dateFromKey(input.from),endInclusive=dateFromKey(input.to);if(organizationDateKey(start)!==input.from||organizationDateKey(endInclusive)!==input.to)throw new HttpError(422,'Select valid report dates');if(endInclusive<start)throw new HttpError(422,'To date must be on or after From date');if(input.to>organizationDateKey())throw new HttpError(422,'Report dates cannot be in the future');if((endInclusive-start)/DAY_MS>366)throw new HttpError(422,'Report range cannot exceed 12 months');const end=new Date(endInclusive.getTime()+DAY_MS),label=`${input.from} to ${input.to}`;return{...input,start,end,label}}
  const range=monthRange(query.month);return{...range,from:organizationDateKey(range.start),to:organizationDateKey(new Date(range.end.getTime()-DAY_MS))}
}

/**
 * Build a per-employee map of date-key -> leave type for the given range.
 * Values:
 *   'full_day'  — approved full-day leave applied by employee
 *   'half_day'  — approved half-day leave applied by employee (not attendanceDayType half-day)
 *   undefined   — no leave, normal working day
 *
 * IMPORTANT: this map contains ONLY leaves the employee APPLIED via LeaveRequest.
 * It does NOT mix in attendance halfDayType='half_day' (the late 3-day rule).
 * That is preserved separately in INCOMPLETE HALF as requested.
 */
function buildLeaveAppliedMap(range, approvedLeaves) {
  const result = new Map()
  for (const leave of approvedLeaves) {
    const empKey = String(leave.employee)
    const lo = leave.startDate instanceof Date ? leave.startDate : new Date(leave.startDate)
    const hi = leave.endDate instanceof Date ? leave.endDate : new Date(leave.endDate)
    for (let day = new Date(lo); day <= hi; day = new Date(day.getTime() + DAY_MS)) {
      const dk = organizationDateKey(day)
      if (dk < organizationDateKey(range.start)) continue
      if (dk > organizationDateKey(new Date(range.end.getTime() - DAY_MS))) continue
      const key = `${empKey}|${dk}`
      const prev = result.get(key)
      if (leave.dayType === 'full_day' || prev === 'full_day') result.set(key, 'full_day')
      else if (leave.dayType === 'half_day') result.set(key, 'half_day')
    }
  }
  return result
}

function buildEarlyLeaveMinutesMap(range, approvedLeaves) {
  const result = new Map()
  for (const leave of approvedLeaves) {
    if (leave.dayType !== 'early_leave' || !leave.earlyLeaveMinutes) continue
    const empKey = String(leave.employee)
    const lo = leave.startDate instanceof Date ? leave.startDate : new Date(leave.startDate)
    const hi = leave.endDate instanceof Date ? leave.endDate : new Date(leave.endDate)
    for (let day = new Date(lo); day <= hi; day = new Date(day.getTime() + DAY_MS)) {
      const dk = organizationDateKey(day)
      if (dk < organizationDateKey(range.start)) continue
      if (dk > organizationDateKey(new Date(range.end.getTime() - DAY_MS))) continue
      const key = `${empKey}|${dk}`
      const prev = Number(result.get(key) || 0)
      result.set(key, Math.max(prev, Number(leave.earlyLeaveMinutes)))
    }
  }
  return result
}

async function attendanceMis(query){
  const range=reportRange(query)
  const holidayKeys = await holidayKeysBetween(range.start, new Date(range.end.getTime() - DAY_MS))
  const [employees,records,approvedLeaves,policy]=await Promise.all([
    Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('employeeCode firstName lastName department designation dateOfJoining employeeStatus').sort({firstName:1,lastName:1}).lean(),
    Attendance.find({date:{$gte:range.start,$lt:range.end}}).select('employee date workingMinutes lateMinutes status halfDayReason checkIn checkOut attendanceDayType expectedWorkingMinutes completionStatus missedCheckOut').lean(),
    LeaveRequest.find({status:'approved',dayType:{$in:['full_day','half_day','early_leave']},startDate:{$lt:range.end},endDate:{$gte:range.start}}).select('employee startDate endDate dayType earlyLeaveMinutes').lean(),
    getAttendancePolicy(),
  ])
  const FULL_DAY_MINUTES=policy.fullDayWorkingMinutes
  const HALF_DAY_MINUTES=policy.halfDayWorkingMinutes
  const leaveAppliedMap=buildLeaveAppliedMap(range, approvedLeaves)
  const earlyLeaveMinutesMap=buildEarlyLeaveMinutesMap(range, approvedLeaves)
  const byEmployee=new Map()
  for(const record of records){const key=String(record.employee);const list=byEmployee.get(key)||[];list.push(record);byEmployee.set(key,list)}

  // Precompute scheduled working date-keys in range (across all employees same calendar).
  // Uses isScheduledWorkingDay logic built-in: Sun off, 1st/3rd Sat off, 2nd/4th/5th Sat on, Mon-Fri on, not in holidayKeys (public hols off).
  const scheduledWorkingDateKeys = []
  for (let day = new Date(range.start); day < range.end; day = new Date(day.getTime() + DAY_MS)) {
    if (isScheduledWorkingDay(day, holidayKeys)) scheduledWorkingDateKeys.push(organizationDateKey(day))
  }
  const scheduledWorkingSet = new Set(scheduledWorkingDateKeys)

  const rows=employees.map(employee=>{
    const empId = String(employee._id)
    const items=byEmployee.get(empId)||[]
    const completed=items.filter(item=>item.checkIn?.time&&item.checkOut?.time)
    const itemByDate = new Map()
    for (const c of completed) itemByDate.set(organizationDateKey(c.date), c)

    const leaveAppliedFullDayKeys = new Set()
    const leaveAppliedHalfDayKeys = new Set()
    const leaveAppliedEarlyMinutesByDate = new Map()
    const rangeFrom = organizationDateKey(range.start)
    const rangeTo = organizationDateKey(new Date(range.end.getTime() - DAY_MS))
    for (let day = new Date(range.start); day < range.end; day = new Date(day.getTime() + DAY_MS)) {
      const dk = organizationDateKey(day)
      if (dk < rangeFrom || dk > rangeTo) continue
      const t = leaveAppliedMap.get(`${empId}|${dk}`)
      if (t === 'full_day') leaveAppliedFullDayKeys.add(dk)
      else if (t === 'half_day') leaveAppliedHalfDayKeys.add(dk)
      const earlyMin = Number(earlyLeaveMinutesMap.get(`${empId}|${dk}`) || 0)
      if (earlyMin > 0) leaveAppliedEarlyMinutesByDate.set(dk, earlyMin)
    }

    const classified=completed.map(item=>{
      const dk = organizationDateKey(item.date)
      const leaveAppliedHalf = leaveAppliedHalfDayKeys.has(dk)
      const earlyMin = Number(leaveAppliedEarlyMinutesByDate.get(dk) || 0)
      const halfDay=item.attendanceDayType==='half_day'||leaveAppliedHalf
      let target
      if (leaveAppliedHalf) target = HALF_DAY_MINUTES
      else if (earlyMin > 0) target = Math.max(0, FULL_DAY_MINUTES - earlyMin)
      else target = FULL_DAY_MINUTES
      return{...item,halfDay,target,leaveAppliedFull:leaveAppliedFullDayKeys.has(dk),leaveAppliedHalf,leaveAppliedEarlyMinutes:earlyMin}
    })

    // TOTAL WORKING HOURS (EXPECTED) per calendar + employee approved leaves.
    // Rule (per user): count every scheduled-working day in filter range:
    //  - If employee applied APPROVED full-day leave → target 0 (remove from expected)
    //  - If employee applied APPROVED half-day leave → target = HALF_DAY_MINUTES (only half expected).
    //  - If employee applied APPROVED early leave → target = FULL_DAY_MINUTES - earlyLeaveMinutes.
    //  - Otherwise normal working day → FULL_DAY_MINUTES.
    let expectedWorkingMinutes = 0
    let fullWorkingDaysExpected = 0
    let halfWorkingDaysExpected = 0
    let earlyLeaveWorkingDaysExpected = 0
    let fullLeaveDaysSkippedFromExpected = 0
    for (const dk of scheduledWorkingDateKeys) {
      if (leaveAppliedFullDayKeys.has(dk)) { fullLeaveDaysSkippedFromExpected++; continue }
      if (leaveAppliedHalfDayKeys.has(dk)) { expectedWorkingMinutes += HALF_DAY_MINUTES; halfWorkingDaysExpected++; continue }
      const earlyMin = Number(leaveAppliedEarlyMinutesByDate.get(dk) || 0)
      if (earlyMin > 0) {
        expectedWorkingMinutes += Math.max(0, FULL_DAY_MINUTES - earlyMin)
        earlyLeaveWorkingDaysExpected++
        continue
      }
      expectedWorkingMinutes += FULL_DAY_MINUTES
      fullWorkingDaysExpected++
    }

    // Raw completed punches (kept for debug but not primary UI col now)
    const rawActualMinutes=classified.reduce((sum,item)=>sum+Number(item.workingMinutes||0),0)

    // Classified completed days (backward compat + user requested distinction):
    // fullDays = items where target=FULL day (no applied leave half-day AND attendanceDayType not half)
    // halfDays = items WHERE user APPLIED HALF-DAY LEAVE (leaveAppliedHalf=true).
    //   Note: explicit user instruction: "Consider only half-day which user is applied in leave".
    //   The attendanceDayType='half_day' (late 3-day rule) is counted via separate INCOMPLETE HALF if applicable.
    const fullDays = classified.filter(item=>!item.leaveAppliedHalf && Number(item.leaveAppliedEarlyMinutes||0)===0 && item.attendanceDayType!=='half_day').length
    const halfDaysAppliedLeave = classified.filter(item=>item.leaveAppliedHalf).length
    const halfDays = halfDaysAppliedLeave
    const incompleteHalfDays=classified.filter(item=>
      !item.leaveAppliedHalf &&
      item.attendanceDayType==='half_day' &&
      Number(item.workingMinutes||0)<HALF_DAY_MINUTES
    ).length
    const earlyLeaveDays = leaveAppliedEarlyMinutesByDate.size
    let earlyLeaveTotalMinutes = 0
    for (const m of leaveAppliedEarlyMinutesByDate.values()) earlyLeaveTotalMinutes += Number(m || 0)

    const lateAt1015=items.filter(item=>Number(item.lateMinutes)>0&&Number(item.lateMinutes)<=15).length
    const lateAt1030=items.filter(item=>Number(item.lateMinutes)>15).length
    const legacyLate=items.filter(item=>!Number(item.lateMinutes)&&(item.status==='late'||item.halfDayReason==='three_late_arrivals')).length

    // COMPLETED WORKING HOURS (ACTUAL leave-aware) = 4-rule system:
    // 1) full-day leave → skip entirely
    // 2) half-day leave → cap at HALF_DAY_MINUTES
    // 3) early-leave day → cap at (FULL_DAY_MINUTES - earlyLeaveMinutes) — user's requested "Deduct from target" rule
    // 4) normal day → cap at FULL_DAY_MINUTES
    let completedWorkingMinutes = 0
    for (const item of classified) {
      const actual = Number(item.workingMinutes||0)
      if (item.leaveAppliedFull) continue
      if (item.leaveAppliedHalf) { completedWorkingMinutes += Math.min(actual, HALF_DAY_MINUTES); continue }
      const earlyMin = Number(item.leaveAppliedEarlyMinutes||0)
      if (earlyMin > 0) { completedWorkingMinutes += Math.min(actual, Math.max(0, FULL_DAY_MINUTES - earlyMin)); continue }
      completedWorkingMinutes += Math.min(actual, FULL_DAY_MINUTES)
    }

    const leaveAppliedFullDaysCount = leaveAppliedFullDayKeys.size
    const leaveAppliedHalfDaysCount = leaveAppliedHalfDayKeys.size

    const lessThanTarget=classified.filter(item=>!item.leaveAppliedFull && Number(item.workingMinutes||0)<item.target).length
    const equalToTarget=classified.filter(item=>!item.leaveAppliedFull && Number(item.workingMinutes||0)===item.target).length
    const moreThanTarget=classified.filter(item=>!item.leaveAppliedFull && Number(item.workingMinutes||0)>item.target).length

    return {
      employeeId:employee._id,
      employeeCode:employee.employeeCode,
      name:`${employee.firstName} ${employee.lastName}`.trim(),
      department:employee.department||'General',
      designation:employee.designation||'Employee',
      lateAt1015:lateAt1015+legacyLate,
      lateAt1030,
      lateArrivals:lateAt1015+lateAt1030+legacyLate,
      completedDays:classified.length,
      fullDays,halfDays,incompleteHalfDays,
      earlyLeaveDays,earlyLeaveTotalMinutes,
      expectedWorkingMinutes,
      completedWorkingMinutes,
      actualWorkedMinutes: rawActualMinutes,
      fullLeaveDaysSkippedExpected: fullLeaveDaysSkippedFromExpected,
      expectedBreakdown: { fullWorkingDaysExpected, halfWorkingDaysExpected, earlyLeaveWorkingDaysExpected, fullLeaveDaysSkipped: fullLeaveDaysSkippedFromExpected },
      leaveAppliedFullDays: leaveAppliedFullDaysCount,
      leaveAppliedHalfDays: leaveAppliedHalfDaysCount,
      lessThanTarget,
      equalToTarget,
      moreThanTarget
    }
  })
  const summary=rows.reduce((result,row)=>({
    employees:result.employees+1,
    lateArrivals:result.lateArrivals+row.lateArrivals,
    completedDays:result.completedDays+row.completedDays,
    fullDays:result.fullDays+row.fullDays,
    halfDays:result.halfDays+row.halfDays,
    incompleteHalfDays:result.incompleteHalfDays+row.incompleteHalfDays,
    earlyLeaveDays:(result.earlyLeaveDays||0)+(row.earlyLeaveDays||0),
    earlyLeaveTotalMinutes:(result.earlyLeaveTotalMinutes||0)+(row.earlyLeaveTotalMinutes||0),
    expectedWorkingMinutes: (result.expectedWorkingMinutes||0) + row.expectedWorkingMinutes,
    completedWorkingMinutes:(result.completedWorkingMinutes||0) + row.completedWorkingMinutes,
    actualWorkedMinutes:(result.actualWorkedMinutes||0) + (row.actualWorkedMinutes||0),
    leaveAppliedFullDays:(result.leaveAppliedFullDays||0)+row.leaveAppliedFullDays,
    leaveAppliedHalfDays:(result.leaveAppliedHalfDays||0)+row.leaveAppliedHalfDays,
    lessThanTarget:result.lessThanTarget+row.lessThanTarget,
    equalToTarget:result.equalToTarget+row.equalToTarget,
    moreThanTarget:result.moreThanTarget+row.moreThanTarget
  }),{employees:0,lateArrivals:0,completedDays:0,fullDays:0,halfDays:0,incompleteHalfDays:0,earlyLeaveDays:0,earlyLeaveTotalMinutes:0,expectedWorkingMinutes:0,completedWorkingMinutes:0,actualWorkedMinutes:0,leaveAppliedFullDays:0,leaveAppliedHalfDays:0,lessThanTarget:0,equalToTarget:0,moreThanTarget:0})
  return {from:range.from,to:range.to,label:range.label,targetMinutes:{fullDay:FULL_DAY_MINUTES,halfDay:HALF_DAY_MINUTES},fullDayHoursMinutes:formatMinutesToHoursMinutes(FULL_DAY_MINUTES),halfDayHoursMinutes:formatMinutesToHoursMinutes(HALF_DAY_MINUTES),summary,rows,policy,scheduledWorkingDays:scheduledWorkingDateKeys.length}
}

router.get('/attendance-mis',authorize(...MIS_ROLES),asyncHandler(async(req,res)=>{
  try {
    const data = await attendanceMis(req.query)
    res.json({success:true,data})
  } catch (err) {
    console.error('[attendanceMis JSON] error:', err.message, err.stack)
    const message = err instanceof HttpError ? err.message : (err.message || 'Failed to generate report')
    res.status(err instanceof HttpError ? err.statusCode : 200).json({
      success: false,
      message,
      data: {
        from: req.query.from || '', to: req.query.to || '', label: 'Report unavailable',
        targetMinutes: { fullDay: 510, halfDay: 255 },
        fullDayHoursMinutes: '8h 30m', halfDayHoursMinutes: '4h 15m',
        summary: {employees:0,lateArrivals:0,completedDays:0,fullDays:0,halfDays:0,incompleteHalfDays:0,earlyLeaveDays:0,earlyLeaveTotalMinutes:0,expectedWorkingMinutes:0,completedWorkingMinutes:0,actualWorkedMinutes:0,leaveAppliedFullDays:0,leaveAppliedHalfDays:0,lessThanTarget:0,equalToTarget:0,moreThanTarget:0},
        rows: [], policy: null
      }
    })
  }
}))
router.get('/attendance-mis.pdf',authorize(...MIS_ROLES),asyncHandler(async(req,res)=>{
  let report
  try {
    report = await attendanceMis(req.query)
  } catch (err) {
    console.error('[attendanceMis PDF] report generation error:', err.message)
    const message = err instanceof HttpError ? err.message : (err.message || 'Failed to generate report')
    return res.status(err instanceof HttpError ? err.statusCode : 500).json({ success: false, message })
  }
  try {
    const doc=new PDFDocument({size:'A4',layout:'landscape',margin:30})
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="attendance-mis-${report.from}-to-${report.to}.pdf"`);doc.pipe(res)

    // --- Logo: company logo always appears ---
    // A4 landscape = 842 x 595, margins = 30 each side → usable width = 782 (30 to 812)
    const PAGE_LEFT = 30
    const PAGE_RIGHT = 812
    const PAGE_USABLE = PAGE_RIGHT - PAGE_LEFT // 782
    try {
      // Composite logo rendering (100% tofu-free on Render Docker + all systems):
      //   • Trishul + separator icon = pure vector paths, converted to PNG via sharp
      //     (no fonts involved). Matches exact design: spear + open "3"-curve trishul,
      //     2 beads, thick vertical "|" separator bar.
      //   • Brand words = drawn via PDFKit built-in Helvetica (PDF spec guarantees
      //     Latin glyphs; does NOT depend on system fontconfig).
      // This avoids the earlier sharp + SVG <text> failure where ANANT/TATTVA rendered
      // as empty boxes (tofus) because the container lacked usable font files.
      // NOTE: User's actual logo does NOT have an emerald underline stroke below
      // brand words — so we intentionally removed the old #0f766e accent line.
      doc.save()
      const trishul = await iconPdfSource(COMPANY_TRISHUL_ICON)
      const ICON_X = PAGE_LEFT
      const ICON_Y = 14
      let textStartX = ICON_X + 12
      if (trishul.ok) {
        try {
          doc.image(trishul.src, ICON_X, ICON_Y, { height: 72 })
          // New corrected logo icon aspect ratio ~ 440:220 (w:h = 2:1); height 72 → width ≈ 144pt
          textStartX = ICON_X + 156
        } catch (imgErr) {
          console.warn('[PDF] trishul icon image embed failed:', imgErr.message)
          textStartX = PAGE_LEFT + 12
        }
      }
      // Brand words always drawn via Helvetica (no tofus). Match corrected logo 2 layout:
      // ANANT orange BOLD tall top + TATTVA black below-right, larger size (matches corrected 2nd image proportions)
      doc.fillColor('#f97316').font('Helvetica-Bold').fontSize(30)
        .text('ANANT', textStartX, 16, { characterSpacing: 2, lineGap: 0 })
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(25)
        .text('TATTVA', textStartX + 38, 52, { characterSpacing: 10, lineGap: 0 })
      doc.restore()
    } catch (logoErr) {
      console.warn('[PDF] composite logo render fallback triggered:', logoErr.message)
      doc.save()
      doc.fillColor('#f97316').font('Helvetica-Bold').fontSize(30)
        .text('ANANT', PAGE_LEFT + 10, 16, { characterSpacing: 2 })
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(25)
        .text('TATTVA', PAGE_LEFT + 48, 52, { characterSpacing: 10 })
      doc.restore()
    }

    doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(18).text('HRMS ATTENDANCE MIS DASHBOARD', PAGE_LEFT, 96)
    doc.fillColor('#64748b').font('Helvetica').fontSize(10).text(`${report.label} | Targets: Full ${report.fullDayHoursMinutes}, Half (Applied Leave) ${report.halfDayHoursMinutes}`, PAGE_LEFT, 120)

    // 13 columns (removed Completed — kept only Expected + Working Hours decimals like Excel) — width sum EXACT 782 (right edge 812).
    // Format: [label, x, width]
    const columns=[
      ['Employee',30,132],
      ['ID',162,42],
      ['Department',204,110],
      ['10:15',314,40],
      ['10:30',354,40],
      ['Full',394,40],
      ['Half (App)',434,44],
      ['Incomplete',478,52],
      ['Expected\nHours',530,60],
      ['Working\nHours',590,60],
      ['Leave <8:30',650,40],
      ['Leave=8:30',690,40],
      ['Leave>8:30',730,82],
    ]
    // Group header label boxes (top band):
    // LATE ARRIVAL    = x 314 → 394, width = 80
    // COMPLETED DAYS  = x 394 → 530, width = 136
    const drawHeader=(headerY)=>{
      doc.rect(PAGE_LEFT,headerY,PAGE_USABLE,46).fill('#0f766e')
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
      columns.forEach(([label,x,width],index)=>{
        const subline = index>=3 && index<=7  // cols 4..8 (10:15 through Incomplete) sit below group
        const topline = index>=8 && index<=12 // cols 9..13 (hours + leave) single-line
        const yOffset = subline ? 28 : topline ? 9 : 18
        doc.text(label,x+3,headerY+yOffset,{width:width-6,align:index>=3?'center':'left',lineGap:1})
      })
      // Group titles (top of 2-row header)
      doc.fontSize(8).font('Helvetica-Bold')
      doc.text('LATE ARRIVAL',314,headerY+7,{width:80,align:'center'})
      doc.text('COMPLETED DAYS',394,headerY+7,{width:136,align:'center'})
    }
    let y=148
    drawHeader(y)
    y+=46
    for(const [index,row] of report.rows.entries()){
      if(y>520){doc.addPage();y=53;drawHeader(y);y+=46}
      doc.rect(PAGE_LEFT,y,PAGE_USABLE,25).fill(index%2?'#f8fafc':'#ffffff')
      doc.fillColor('#334155').font('Helvetica').fontSize(8.5)
      const actualWorkedMin = Number(row.actualWorkedMinutes||0)
      const workingDec = (Math.round((actualWorkedMin / 60) * 100) / 100).toFixed(2)
      const expectedDec = (Math.round((Number(row.expectedWorkingMinutes||0) / 60) * 100) / 100).toFixed(2)
      const values=[
        row.name,row.employeeCode,row.department,
        String(row.lateAt1015),String(row.lateAt1030),
        String(row.fullDays),String(row.halfDays),String(row.incompleteHalfDays),
        `${expectedDec} hrs`,
        `${workingDec} hrs`,
        String(row.lessThanTarget),String(row.equalToTarget),String(row.moreThanTarget)
      ]
      columns.forEach(([,x,width],i)=>doc.text(values[i],x+4,y+8,{width:width-8,ellipsis:true}))
      y+=25
    }
    doc.fillColor('#64748b').fontSize(7.6).text(`Target comparison uses ${report.fullDayHoursMinutes} (full days) and ${report.halfDayHoursMinutes} (ONLY for APPLIED half-day leave — late 3-day half handled via Incomplete Half separately).  ·  EXPECTED HOURS = calendar scheduled-working days (Sun/1st/3rd Sat/public holidays excluded) minus approved leaves (full=0, half=half target, early leave=full−earlyMin).  ·  WORKING HOURS (Excel-match decimals): Raw CheckIn → CheckOut sum rounded to 2 dp, overtime included — same as attendance export "Working Hours" col.`,PAGE_LEFT,560,{width:PAGE_USABLE})
    doc.end()
  } catch (pdfErr) {
    console.error('[attendanceMis PDF] render error:', pdfErr.message, pdfErr.stack)
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: pdfErr.message || 'Failed to generate PDF' })
    } else {
      try { doc && doc.end() } catch (_) { /* ignore */ }
    }
  }
}))
router.get('/biometric-health',authorize('super_admin','hr_admin','it_admin'),asyncHandler(async(req,res)=>{
  const input=z.object({from:z.coerce.date().optional(),to:z.coerce.date().optional(),reason:z.string().max(80).optional(),riskLevel:z.enum(['normal','high']).optional()}).parse(req.query)
  const from=input.from||new Date(new Date().getFullYear(),new Date().getMonth(),1),to=input.to||new Date(),match={requestedAt:{$gte:from,$lte:to},...(input.reason&&{reasonCode:input.reason}),...(input.riskLevel&&{riskLevel:input.riskLevel})}
  const [summary,reasons,frequentEmployees,devices,successCount]=await Promise.all([
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:null,total:{$sum:1},pending:{$sum:{$cond:[{$eq:['$status','pending']},1,0]}},approved:{$sum:{$cond:[{$eq:['$status','approved']},1,0]}},rejected:{$sum:{$cond:[{$eq:['$status','rejected']},1,0]}},highRisk:{$sum:{$cond:[{$eq:['$riskLevel','high']},1,0]}}}}]),
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:'$reasonCode',count:{$sum:1}}},{$sort:{count:-1}}]),
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:'$employee',count:{$sum:1},lastRequest:{$max:'$requestedAt'}}},{$sort:{count:-1}},{$limit:20},{$lookup:{from:'employees',localField:'_id',foreignField:'_id',as:'employee'}},{$unwind:'$employee'},{$project:{count:1,lastRequest:1,'employee.employeeCode':1,'employee.firstName':1,'employee.lastName':1,'employee.department':1}}]),
    FaceAttendanceRequest.aggregate([{$match:match},{$group:{_id:{deviceType:'$deviceDetails.deviceType',technicalError:'$biometricAttempt.technicalErrorCode'},count:{$sum:1}}},{$sort:{count:-1}},{$limit:20}]),
    Attendance.countDocuments({date:{$gte:from,$lte:to},$or:[{'checkIn.source':'biometric'},{'checkOut.source':'biometric'}]}),
  ])
  const totals=summary[0]||{total:0,pending:0,approved:0,rejected:0,highRisk:0},denominator=totals.total+successCount
  res.json({success:true,data:{range:{from,to},...totals,biometricSuccess:successCount,failureRate:denominator?Number((totals.total/denominator*100).toFixed(1)):0,reasons,frequentEmployees,devices}})
}))
export default router
