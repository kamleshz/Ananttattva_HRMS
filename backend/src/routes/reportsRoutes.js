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
import { dateFromKey, organizationDateKey } from '../services/workingDayService.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'

let _sharp = null
try { _sharp = (await import('sharp')).default } catch (_) { /* sharp optional */ }

const router=Router()
router.use(authenticate)

const MIS_ROLES=['super_admin','admin','hr_admin','finance_admin']
const DAY_MS=86_400_000

function resolveCompanyLogo() {
  // PREFER backend LOCAL ASSET FIRST because Render/Docker backend process does NOT
  // include frontend/public folder. Backend/src/assets is copied into backend image
  // so ALWAYS available at runtime — no ENOENT, logo renders in PDF always.
  const candidates = [
    // 1) Backend bundled asset (src/assets copied into Docker — #1 priority)
    path.resolve(process.cwd(), 'src', 'assets', 'ananttattva-logo.svg'),
    fileURLToPath(new URL('../assets/ananttattva-logo.svg', import.meta.url)),
    path.resolve(process.cwd(), 'assets', 'ananttattva-logo.svg'),
    // 2) Legacy PNG in backend assets (if user copies JPG/PNG later)
    path.resolve(process.cwd(), 'src', 'assets', 'Screenshot 2026-09-08 121937.png'),
    // 3) Monorepo local dev (only works if backend launched from project-root parent)
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

async function logoPdfSource(logoPath) {
  if (!logoPath) return { ok: false }
  const ext = path.extname(logoPath).toLowerCase()
  try {
    if (ext === '.svg' && _sharp) {
      const png = await _sharp(logoPath).resize({ width: 700, withoutEnlargement: true }).png().toBuffer()
      return { ok: true, src: png, format: 'png' }
    }
    if (['.png','.jpg','.jpeg'].includes(ext)) {
      return { ok: true, src: logoPath, format: ext.slice(1) }
    }
    if (ext === '.svg') {
      return { ok: false, reason: 'sharp missing' }
    }
    return { ok: false, reason: 'unsupported format' }
  } catch (err) {
    console.warn('[PDF] logo convert failed:', err.message)
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
  const result = new Map() // key = `${employeeId}|${dateKey}`
  for (const leave of approvedLeaves) {
    const empKey = String(leave.employee)
    const iterDay = new Date(Date.max ? 0 : leave.startDate.getTime ? leave.startDate : new Date(leave.startDate))
    const lo = leave.startDate instanceof Date ? leave.startDate : new Date(leave.startDate)
    const hi = leave.endDate instanceof Date ? leave.endDate : new Date(leave.endDate)
    for (let day = new Date(lo); day <= hi; day = new Date(day.getTime() + DAY_MS)) {
      const dk = organizationDateKey(day)
      if (dk < organizationDateKey(range.start)) continue
      if (dk > organizationDateKey(new Date(range.end.getTime() - DAY_MS))) continue
      const key = `${empKey}|${dk}`
      const prev = result.get(key)
      // Priority: full_day > half_day. If both overlap on same date, treat as full_day.
      if (leave.dayType === 'full_day' || prev === 'full_day') result.set(key, 'full_day')
      else if (leave.dayType === 'half_day') result.set(key, 'half_day')
    }
  }
  return result
}

async function attendanceMis(query){
  const range=reportRange(query)
  const [employees,records,approvedLeaves,policy]=await Promise.all([
    Employee.find({employeeStatus:{$in:['active','notice_period']}}).select('employeeCode firstName lastName department designation').sort({firstName:1,lastName:1}).lean(),
    Attendance.find({date:{$gte:range.start,$lt:range.end}}).select('employee date workingMinutes lateMinutes status halfDayReason checkIn checkOut attendanceDayType expectedWorkingMinutes completionStatus missedCheckOut').lean(),
    LeaveRequest.find({status:'approved',dayType:{$in:['full_day','half_day']},startDate:{$lt:range.end},endDate:{$gte:range.start}}).select('employee startDate endDate dayType').lean(),
    getAttendancePolicy(),
  ])
  const FULL_DAY_MINUTES=policy.fullDayWorkingMinutes
  const HALF_DAY_MINUTES=policy.halfDayWorkingMinutes
  const leaveAppliedMap=buildLeaveAppliedMap(range, approvedLeaves)
  const byEmployee=new Map()
  for(const record of records){const key=String(record.employee);const list=byEmployee.get(key)||[];list.push(record);byEmployee.set(key,list)}
  const rows=employees.map(employee=>{
    const empId = String(employee._id)
    const items=byEmployee.get(empId)||[]
    const completed=items.filter(item=>item.checkIn?.time&&item.checkOut?.time)
    const itemByDate = new Map()
    for (const c of completed) itemByDate.set(organizationDateKey(c.date), c)

    // leaveAppliedHalfDayByDate set: keys = dateKeys where employee applied half-day via LeaveRequest (NOT attendance day-type)
    const leaveAppliedFullDayKeys = new Set()
    const leaveAppliedHalfDayKeys = new Set()
    const rangeFrom = organizationDateKey(range.start)
    const rangeTo = organizationDateKey(new Date(range.end.getTime() - DAY_MS))
    for (let day = new Date(range.start); day < range.end; day = new Date(day.getTime() + DAY_MS)) {
      const dk = organizationDateKey(day)
      if (dk < rangeFrom || dk > rangeTo) continue
      const t = leaveAppliedMap.get(`${empId}|${dk}`)
      if (t === 'full_day') leaveAppliedFullDayKeys.add(dk)
      else if (t === 'half_day') leaveAppliedHalfDayKeys.add(dk)
    }

    const classified=completed.map(item=>{
      const dk = organizationDateKey(item.date)
      const leaveAppliedHalf = leaveAppliedHalfDayKeys.has(dk)
      // halfDay = either (a) attendanceDayType half (late 3-day-rule etc) OR (b) APPLIED half-day leave.
      // BUT incompleteHalfDays below only counts (a) attendanceDayType half-day < half-day target — explicitly as requested by user "consider only half-day which user applied in leave".
      const halfDay=item.attendanceDayType==='half_day'||leaveAppliedHalf
      const target=halfDay?HALF_DAY_MINUTES:FULL_DAY_MINUTES
      return{...item,halfDay,target,leaveAppliedFull:leaveAppliedFullDayKeys.has(dk),leaveAppliedHalf}
    })

    // Raw Completed Working Hours = sum of actual punches (user can still see he worked those hours even if on full leave)
    const totalMinutes=classified.reduce((sum,item)=>sum+Number(item.workingMinutes||0),0)

    // Classified completed days (backward compat + user requested distinction):
    // fullDays = items where target=FULL day (no applied leave half-day AND attendanceDayType not half)
    // halfDays = items WHERE user APPLIED HALF-DAY LEAVE (leaveAppliedHalf=true).
    //   Note: explicit user instruction: "Consider only half-day which user is applied in leave".
    //   The attendanceDayType='half_day' (late 3-day rule) is counted via separate INCOMPLETE HALF if applicable.
    const fullDays = classified.filter(item=>!item.leaveAppliedHalf && item.attendanceDayType!=='half_day').length
    const halfDaysAppliedLeave = classified.filter(item=>item.leaveAppliedHalf).length
    const halfDays = halfDaysAppliedLeave // strictly comply "do not misjudge 2 half day types"
    // Incomplete half = only attendance half (late 3-day) items below half-day target.
    // Applied half-day leaves are compared against half-day target and NOT punished as "incomplete" if
    // actual was lower than target (because user is officially on half-leave).
    const incompleteHalfDays=classified.filter(item=>
      !item.leaveAppliedHalf &&
      item.attendanceDayType==='half_day' &&
      Number(item.workingMinutes||0)<HALF_DAY_MINUTES
    ).length

    const lateAt1015=items.filter(item=>Number(item.lateMinutes)>0&&Number(item.lateMinutes)<=15).length
    const lateAt1030=items.filter(item=>Number(item.lateMinutes)>15).length
    const legacyLate=items.filter(item=>!Number(item.lateMinutes)&&(item.status==='late'||item.halfDayReason==='three_late_arrivals')).length

    // COMPLIED WORKING MINUTES (leave-aware + capped by full/half day target per user rules):
    // Rules:
    // 1) If employee APPLIED full-day leave → DO NOT CONSIDER that day (entirely skip — no credit, no debit)
    // 2) If employee APPLIED half-day leave (via LeaveRequest) → cap actual working minutes AT HALF_DAY_MINUTES (255).
    //    If user clocked more than 255, they only get 255 for complied tally (since half leave applied).
    //    If they clocked less (e.g. only morning 180) → they get actual 180 (shortfall is theirs own, but not capped upward).
    // 3) Normal day (no leave applied) → cap actual AT FULL_DAY_MINUTES target so extra overtime doesn't double inflate complied figure.
    // 4) Skip weekend / holiday day if no punches: handled implicitly because completed list only has punches.
    let compliedMinutes = 0
    let leaveAppliedFullDaysSkipped = 0
    for (const item of classified) {
      const actual = Number(item.workingMinutes||0)
      if (item.leaveAppliedFull) { leaveAppliedFullDaysSkipped++; continue /* Rule 1 */ }
      if (item.leaveAppliedHalf) { compliedMinutes += Math.min(actual, HALF_DAY_MINUTES); continue /* Rule 2 */ }
      compliedMinutes += Math.min(actual, FULL_DAY_MINUTES) /* Rule 3 */
    }

    // Summary counters: how many leave days were applied by employee (used for MIS cards summary)
    const leaveAppliedFullDaysCount = leaveAppliedFullDayKeys.size
    const leaveAppliedHalfDaysCount = leaveAppliedHalfDayKeys.size

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
      totalMinutes,
      compliedMinutes,
      leaveAppliedFullDays: leaveAppliedFullDaysCount,
      leaveAppliedHalfDays: leaveAppliedHalfDaysCount,
      lessThanTarget:classified.filter(item=>!item.leaveAppliedFull && Number(item.workingMinutes||0)<item.target).length,
      equalToTarget:classified.filter(item=>!item.leaveAppliedFull && Number(item.workingMinutes||0)===item.target).length,
      moreThanTarget:classified.filter(item=>!item.leaveAppliedFull && Number(item.workingMinutes||0)>item.target).length
    }
  })
  const summary=rows.reduce((result,row)=>({
    employees:result.employees+1,
    lateArrivals:result.lateArrivals+row.lateArrivals,
    completedDays:result.completedDays+row.completedDays,
    fullDays:result.fullDays+row.fullDays,
    halfDays:result.halfDays+row.halfDays,
    incompleteHalfDays:result.incompleteHalfDays+row.incompleteHalfDays,
    totalMinutes:result.totalMinutes+row.totalMinutes,
    compliedMinutes:(result.compliedMinutes||0)+row.compliedMinutes,
    leaveAppliedFullDays:(result.leaveAppliedFullDays||0)+row.leaveAppliedFullDays,
    leaveAppliedHalfDays:(result.leaveAppliedHalfDays||0)+row.leaveAppliedHalfDays,
    lessThanTarget:result.lessThanTarget+row.lessThanTarget,
    equalToTarget:result.equalToTarget+row.equalToTarget,
    moreThanTarget:result.moreThanTarget+row.moreThanTarget
  }),{employees:0,lateArrivals:0,completedDays:0,fullDays:0,halfDays:0,incompleteHalfDays:0,totalMinutes:0,compliedMinutes:0,leaveAppliedFullDays:0,leaveAppliedHalfDays:0,lessThanTarget:0,equalToTarget:0,moreThanTarget:0})
  return {from:range.from,to:range.to,label:range.label,targetMinutes:{fullDay:FULL_DAY_MINUTES,halfDay:HALF_DAY_MINUTES},fullDayHoursMinutes:formatMinutesToHoursMinutes(FULL_DAY_MINUTES),halfDayHoursMinutes:formatMinutesToHoursMinutes(HALF_DAY_MINUTES),summary,rows,policy}
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
        summary: {employees:0,lateArrivals:0,completedDays:0,fullDays:0,halfDays:0,incompleteHalfDays:0,totalMinutes:0,compliedMinutes:0,leaveAppliedFullDays:0,leaveAppliedHalfDays:0,lessThanTarget:0,equalToTarget:0,moreThanTarget:0},
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
      const logo = await logoPdfSource(COMPANY_LOGO)
      if (logo.ok) {
        doc.image(logo.src, PAGE_LEFT, 20, { width: 170 })
      } else {
        // Branded fallback — mimic logo with colored text (no blank top-left)
        doc.save()
        doc.fillColor('#f97316').font('Helvetica-Bold').fontSize(26).text('ANANT', PAGE_LEFT + 10, 22, { characterSpacing: -0.5 })
        doc.fillColor('#111827').font('Helvetica').fontSize(22).text('TATTVA', PAGE_LEFT + 12, 46, { characterSpacing: 2 })
        doc.strokeColor('#0f766e').lineWidth(1.2).moveTo(PAGE_LEFT + 4, 70).lineTo(PAGE_LEFT + 166, 70).stroke()
        doc.restore()
      }
    } catch (logoErr) {
      console.warn('[PDF] logo embed skipped:', logoErr.message)
      doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(20).text('ANANTTATTVA', PAGE_LEFT, 28)
    }

    doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(18).text('HRMS ATTENDANCE MIS DASHBOARD', PAGE_LEFT, 78)
    doc.fillColor('#64748b').font('Helvetica').fontSize(10).text(`${report.label} | Targets: Full ${report.fullDayHoursMinutes}, Half (Applied Leave) ${report.halfDayHoursMinutes}`, PAGE_LEFT, 102)

    // 13 columns — width sum = EXACT 782, right edge = 812 (no overflow, no clipped cols).
    // Format: [label, x, width]
    const columns=[
      ['Employee',30,146],
      ['ID',176,46],
      ['Department',222,120],
      ['10:15',342,40],
      ['10:30',382,40],
      ['Full',422,40],
      ['Half (App)',462,46],
      ['Incomplete',508,54],
      ['Completed\nHours',562,60],
      ['Complied\nHours',622,60],
      ['Leave <8:30',682,44],
      ['Leave=8:30',726,44],
      ['Leave>8:30',770,42],  // ends at 812 (A4 right-margin line)
    ]
    // Group header label boxes (top band):
    // LATE ARRIVAL    = x 342 → 422, width = 80
    // COMPLETED DAYS  = x 422 → 562, width = 140
    const drawHeader=(headerY)=>{
      doc.rect(PAGE_LEFT,headerY,PAGE_USABLE,46).fill('#0f766e')
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
      columns.forEach(([label,x,width],index)=>{
        const subline = index>=3 && index<=7  // cols 4..8 (10:15 through Incomplete) sit below group
        const topline = index>=9 && index<=12 // cols 10..13 (hours & leave) only single-line
        const yOffset = subline ? 28 : topline ? 9 : 18
        doc.text(label,x+3,headerY+yOffset,{width:width-6,align:index>=3?'center':'left',lineGap:1})
      })
      // Group titles (top of 2-row header)
      doc.fontSize(8).font('Helvetica-Bold')
      doc.text('LATE ARRIVAL',342,headerY+7,{width:80,align:'center'})
      doc.text('COMPLETED DAYS',422,headerY+7,{width:140,align:'center'})
    }
    let y=130
    drawHeader(y)
    y+=46
    for(const [index,row] of report.rows.entries()){
      if(y>520){doc.addPage();y=35;drawHeader(y);y+=46}
      doc.rect(PAGE_LEFT,y,PAGE_USABLE,25).fill(index%2?'#f8fafc':'#ffffff')
      doc.fillColor('#334155').font('Helvetica').fontSize(8.5)
      const values=[
        row.name,row.employeeCode,row.department,
        String(row.lateAt1015),String(row.lateAt1030),
        String(row.fullDays),String(row.halfDays),String(row.incompleteHalfDays),
        `${Math.floor(row.totalMinutes/60)}h ${String(row.totalMinutes%60).padStart(2,'0')}m`,
        `${Math.floor(row.compliedMinutes/60)}h ${String(row.compliedMinutes%60).padStart(2,'0')}m`,
        String(row.lessThanTarget),String(row.equalToTarget),String(row.moreThanTarget)
      ]
      columns.forEach(([,x,width],i)=>doc.text(values[i],x+4,y+8,{width:width-8,ellipsis:true}))
      y+=25
    }
    doc.fillColor('#64748b').fontSize(7.8).text(`Target comparison uses ${report.fullDayHoursMinutes} (full days) and ${report.halfDayHoursMinutes} (ONLY for APPLIED half-day leave — late 3-day half handled via Incomplete Half separately).  ·  COMPLIED HOURS: Full-day applied leave = skip entirely; Applied half-day = cap actual @ half target; Normal = cap actual @ full target.`,PAGE_LEFT,560,{width:PAGE_USABLE})
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
