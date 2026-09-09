import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { Employee } from '../models/Employee.js'
import { Attendance } from '../models/Attendance.js'
import { LeaveRequest } from '../models/LeaveRequest.js'
import { User } from '../models/User.js'
import { getAttendancePolicy } from '../services/attendancePolicyService.js'
import {
  getDailyAttendancePlan,
} from '../services/attendanceCalculationService.js'
import {
  startOfLocalDay,
  endOfLocalDay,
  atOrganizationTime,
  ORGANIZATION_TIMEZONE_OFFSET_MINUTES,
  organizationMonthBoundsFor,
} from '../utils/date.js'
import {
  organizationDateKey,
  isScheduledWorkingDay,
  holidayKeysBetween,
} from '../services/workingDayService.js'

const DAY_MS = 86_400_000

function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = {
    from: null,
    employeeCode: null,
    dryRun: false,
    verbose: false,
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--from' && i + 1 < args.length) {
      opts.from = args[++i]
    } else if (a.startsWith('--from=')) {
      opts.from = a.slice('--from='.length)
    } else if (a === '--employee' && i + 1 < args.length) {
      opts.employeeCode = args[++i]
    } else if (a.startsWith('--employee=')) {
      opts.employeeCode = a.slice('--employee='.length)
    } else if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--verbose') {
      opts.verbose = true
    } else if (a === '-h' || a === '--help') {
      printUsage()
      process.exit(0)
    }
  }
  if (!opts.from) {
    const now = new Date()
    const shifted = new Date(now.getTime() + ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
    const y = shifted.getUTCFullYear()
    const m = shifted.getUTCMonth()
    const back = new Date(Date.UTC(y, m - 11, 1) - ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
    const by = back.getUTCFullYear()
    const bm = back.getUTCMonth() + 1
    opts.from = `${by}-${String(bm).padStart(2, '0')}`
  }
  return opts
}

function printUsage() {
  console.log(`Usage: node recalculateAttendanceSummaries.js [options]

Options:
  --from YYYY-MM      Start month (default: 12 months back from today)
  --employee CODE     Specific employee code (default: all active)
  --dry-run           No DB writes, preview only
  --verbose           Log each updated document ID
  -h, --help          Show this help
`)
}

function addDays(date, n) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + Number(n))
  return result
}

function formatDate(d) {
  return organizationDateKey(d)
}

function pushHistory(rec, entry) {
  if (!rec.missingCheckout) rec.missingCheckout = {}
  if (!Array.isArray(rec.missingCheckout.history)) rec.missingCheckout.history = []
  rec.missingCheckout.history.push({
    timestamp: new Date(),
    status: entry.status || 'updated',
    message: entry.message || 'Backfill update',
    actor: entry.actor || 'recalculate-script',
    _id: false,
  })
}

async function inlineFinalizeAsLeave(attendance, employee, reason, policy, now) {
  if (attendance.missingCheckout?.finalizedAt) return null
  if (attendance.missingCheckout?.reviewAction && attendance.missingCheckout.reviewAction !== 'none') return null

  let managerId = null
  try {
    const empFull = await Employee.findById(employee._id).select('manager -_id').lean()
    managerId = empFull?.manager || null
  } catch (_) { }

  const reviewAction = reason.includes('expired') ? 'expired' : 'rejected'
  const leaveDoc = await LeaveRequest.create({
    employee: attendance.employee,
    reportingManager: managerId,
    startDate: attendance.date,
    endDate: attendance.date,
    leaveType: 'unpaid_leave',
    dayType: 'full_day',
    days: 1.0,
    workingDays: 1.0,
    reason,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: new Date(),
    conversionReason: reason,
    systemGenerated: true,
    workflow: { requiredSteps: [], currentStepIndex: 0, steps: [], nextRole: null },
  })

  attendance.status = 'absent'
  attendance.workingMinutes = 0
  attendance.completionStatus = 'finalized'
  attendance.exceptionStatus = `Absent – ${reason}`
  if (!attendance.missingCheckout) attendance.missingCheckout = {}
  attendance.missingCheckout.finalizedAt = new Date()
  attendance.missingCheckout.conversionReason = reason
  attendance.missingCheckout.leaveRequestId = leaveDoc._id
  attendance.missingCheckout.reviewAction = reviewAction
  attendance.missingCheckout.workingMinutesRestored = 0
  pushHistory(attendance, { status: 'finalized', message: `Finalized: ${reason}. Leave ID: ${leaveDoc._id}`, actor: 'recalculate-script' })
  return leaveDoc
}

async function main() {
  const opts = parseArgs(process.argv)
  console.log(`[recalculateAttendanceSummaries] Starting with options: ${JSON.stringify(opts)}`)

  const [fromYear, fromMonth] = opts.from.split('-').map(Number)
  if (!fromYear || !fromMonth || fromMonth < 1 || fromMonth > 12) {
    console.error('Invalid --from format, expected YYYY-MM')
    process.exit(2)
  }

  await connectDatabase()
  const policy = await getAttendancePolicy()
  const justificationDays = Number(policy.missingCheckoutJustificationDays) || 3
  const now = new Date()

  const monthStart = organizationMonthBoundsFor(fromYear, fromMonth).start
  const todayStart = startOfLocalDay(now)
  const todayEnd = endOfLocalDay(now)

  const employeeQuery = {
    employeeStatus: { $in: ['active', 'notice_period'] },
  }
  if (opts.employeeCode) {
    employeeQuery.employeeCode = opts.employeeCode
  }
  const employees = await Employee.find(employeeQuery).select('_id employeeCode firstName lastName joiningDate employeeStatus offboarding leavePlan user').lean()
  console.log(`[recalculate] Found ${employees.length} employees to process`)

  const counters = {
    processedEmployees: 0,
    updatedAttendanceRecords: 0,
    conversionsApplied: { expired: 0, rejectedAlready: 0 },
    skippedAlreadyFinalized: 0,
    dryRun: opts.dryRun,
  }

  for (const empLean of employees) {
    counters.processedEmployees++
    const empDoc = empLean

    let cursor = new Date(monthStart)
    while (cursor <= todayEnd) {
      const dayStart = startOfLocalDay(cursor)
      const dayKey = organizationDateKey(dayStart)

      const attendance = await Attendance.findOne({
        employee: empDoc._id,
        date: { $gte: dayStart, $lte: endOfLocalDay(cursor) },
      })

      if (attendance) {
        let changed = false
        let converted = null
        let skipFinalized = false

        const hasCheckIn = Boolean(attendance.checkIn?.time)
        const hasCheckOut = Boolean(attendance.checkOut?.time)
        const justStatus = attendance.missingCheckout?.justificationStatus
        const deadline = attendance.missingCheckout?.deadline
        const finalized = Boolean(attendance.missingCheckout?.finalizedAt)
        const reviewAction = attendance.missingCheckout?.reviewAction
        const isMissingStatus = attendance.status === 'missing_checkout'
        const missedCheckOutFlag = Boolean(attendance.missedCheckOut)

        if (hasCheckIn && !hasCheckOut && !finalized) {
          const jStatusNoneOrMissing = !justStatus || justStatus === 'none' || justStatus === undefined
          const isMissingCase = jStatusNoneOrMissing || isMissingStatus || missedCheckOutFlag

          if (isMissingCase && !(reviewAction && reviewAction !== 'none')) {
            if (!attendance.missingCheckout) attendance.missingCheckout = {}

            if (!attendance.missingCheckout.detectedAt) {
              attendance.missingCheckout.detectedAt = new Date()
            }

            const deadlineDate = addDays(dayStart, justificationDays + 1)
            const deadlineOrg = atOrganizationTime(deadlineDate, 0, 0)
            if (!attendance.missingCheckout.deadline) {
              attendance.missingCheckout.deadline = deadlineOrg
            }
            if (!justStatus || justStatus === 'none') {
              attendance.missingCheckout.justificationStatus = 'pending'
            }
            if (attendance.missingCheckout.workingMinutesBefore === undefined || attendance.missingCheckout.workingMinutesBefore === null) {
              attendance.missingCheckout.workingMinutesBefore = 0
            }
            if (!attendance.exceptionStatus || !attendance.exceptionStatus.includes('Missing Checkout')) {
              attendance.exceptionStatus = 'Missing Checkout – Justification Pending'
            }
            if (!isMissingStatus) {
              attendance.status = 'missing_checkout'
            }
            attendance.workingMinutes = 0
            attendance.missedCheckOut = true
            attendance.completionStatus = 'exception_pending'
            pushHistory(attendance, {
              status: 'pending',
              message: `Backfill: missing checkout detected. Justification window until ${formatDate(attendance.missingCheckout.deadline)}`,
            })
            changed = true
          }

          const curJustStatus = attendance.missingCheckout?.justificationStatus
          const curDeadline = attendance.missingCheckout?.deadline
          const curFinalized = Boolean(attendance.missingCheckout?.finalizedAt)
          const curReviewAction = attendance.missingCheckout?.reviewAction

          if (curJustStatus === 'pending' && curDeadline && now >= curDeadline && !curFinalized && !(curReviewAction && curReviewAction !== 'none')) {
            if (curJustStatus !== 'submitted' || !attendance.missingCheckout?.justificationRequestId) {
              if (opts.dryRun) {
                counters.conversionsApplied.expired++
                pushHistory(attendance, { status: 'finalized_dryrun', message: 'Would finalize as leave (expired)' })
                changed = true
              } else {
                converted = await inlineFinalizeAsLeave(attendance, empDoc, 'Missing checkout justification expired', policy, now)
                if (converted) {
                  counters.conversionsApplied.expired++
                  changed = true
                }
              }
            }
          }
        }

        if (finalized || (reviewAction && reviewAction !== 'none')) {
          skipFinalized = true
        }

        const eligibleForExpected = !['approved', 'hr_correction'].includes(attendance.status)
        const holidaySet = await holidayKeysBetween(dayStart, endOfLocalDay(cursor))
        const plan = await getDailyAttendancePlan(empDoc, dayStart, { policy, holidaysSetForYear: holidaySet })

        if (eligibleForExpected || attendance.expectedWorkingMinutes === undefined || attendance.expectedWorkingMinutes === null) {
          const currentExpected = Number(attendance.expectedWorkingMinutes) || 0
          const newExpected = plan.expectedWorkingMinutes
          if (Math.abs(currentExpected - newExpected) > 0.001) {
            attendance.expectedWorkingMinutes = newExpected
            changed = true
          }
        }

        if (changed) {
          counters.updatedAttendanceRecords++
          if (skipFinalized && !converted) {
            counters.skippedAlreadyFinalized++
          }
          if (opts.verbose) {
            console.log(`  [update] emp=${empDoc.employeeCode} date=${dayKey} doc=${attendance._id} changes=detected dryRun=${opts.dryRun}`)
          }
          if (!opts.dryRun) {
            await attendance.save()
          }
        }
      }

      cursor = new Date(cursor.getTime() + DAY_MS)
    }
  }

  console.log(`[recalculateAttendanceSummaries] Complete. Summary:`)
  console.log(JSON.stringify(counters, null, 2))
  await mongoose.disconnect()
}

main().catch(err => {
  console.error('[recalculateAttendanceSummaries] FATAL:', err?.message || err)
  console.error(err?.stack)
  mongoose.disconnect().catch(() => { })
  process.exit(1)
})
