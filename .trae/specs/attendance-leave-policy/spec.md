# Attendance & Leave Policy Overhaul - Product Requirements Document

## Overview
- **Summary**: Replace scattered attendance/leave calculations with one reusable calculation service; implement Missing Checkout justification workflow (3-day window + finalization); correct half-day minutes (270→255); ensure weekly targets exclude full/half-day leaves, holidays, weekly offs, joining-before, post-termination dates; separate weekly vs monthly leave accounting; add comprehensive audit trail, idempotent scheduler alerts, role-gated HR overrides; add 14 automated test cases.
- **Purpose**: Eliminate hardcoded constant drift, eliminate auto-credited working minutes on missing checkout, ensure correct weekly-hour compliance, separate weekly target reductions from monthly leave-balance fraction accumulation, avoid duplicate alerts/deductions.
- **Target Users**: Employees (self-attendance, justifications), Managers (review requests), HR Admin / Super Admin (approve/reject/override, reports), Finance (leave deductions / payroll integration via existing leave-request model).

## Goals
1. A single `attendanceCalculationService` supplies expected/approved minutes + period summaries and is the sole source of truth for all routes/reports/schedulers/frontend.
2. Missing checkout → zero confirmed working minutes until HR approval; 3-calendar-day justification window starting next day; email + in-app alert next day; auto-finalize as leave/absence on day 4; idempotent dedupe; full audit trail.
3. Half-day working minutes corrected to 255 min (4h15m); full-day kept 510 min (8h30m); configurable in attendance policy settings on OrganizationProfile.
4. Weekly target = sum of daily expected minutes for scheduled working days only, excluding holidays, weekly offs, approved full-day leave, joining-before dates, post-final-working dates, with approved half-day leaves reducing only that date's expected minutes by 255.
5. Weekly reporting aggregates daily results; monthly leave totals accumulate fractions independently of weekly reports.
6. Dashboard, MIS report, PDF, Excel, emails, scheduler compliance all consume the same calculated values from the reusable service.

## Non-Goals
- Rewrite the FastAPI (Python) biometric / auth side (out of scope, only Node.js attendance/leave side changes).
- Add a new leave-balance aggregate model; continue snapshot-per-request pattern (balanceBefore/balanceAfter on LeaveRequest).
- Rewrite existing FaceAttendanceRequest (manual fallback) review workflow.
- Rewrite existing leave approval workflow; only extend LeaveRequest to accept system-generated leave entries with conversionReason.

## Background & Context

### Existing Architecture Summary (discovered)
- **Schedulers**: `missingCheckoutService.startMissingCheckoutScheduler()` every 60s runs four passes: checkoutReminders at 18:30 IST, processMissingCheckouts for past dates, missing-checkin/escalation sweeps, weekly hours compliance. ScheduledEmail model with `key:unique` + 3 attempts + 15-min processing lock provides idempotent email delivery.
- **Notification model** lives in Recruitment.js (shared), has `dedupeKey:unique+sparse` compound index; used for attendance escalations today.
- **Attendance model** (backend/src/models/Attendance.js): has `missedCheckOut` bool, `autoCheckout{appliedAt,scheduledCheckoutTime,previousStatus}`, `correctionAudit[]`, `status` enum (includes `missing_checkout`), `workingMinutes`, `expectedWorkingMinutes`. Compound unique: `{employee, date}`.
- **AttendanceCorrectionRequest** model: stores requested checkout + reason; review decision; used only for missing-checkout correction today. Only accepts when `status==='missing_checkout' AND checkOut.source==='system_auto'`.
- **LeaveRequest** model: `dayType:{full_day,half_day}`, `workingDays`, `days`, `payments.{balanceBefore,balanceAfter,paidDays,unpaidDays,mode}`. Has multi-role workflow (manager/hr/super_admin).
- **Hardcoded values (scattered)**: 510 full-day min, **270 half-day min (WRONG — should be 255)** in 4 locations: `attendanceService.attendanceTarget`, `missingCheckoutService`, `reportsRoutes` constants, `Attendance.js` default.
- **`workingDayService.isScheduledWorkingDay(date, holidays)`**: returns false for Sunday, 1st/3rd Saturday of month, holidays.
- **OrganizationProfile** singleton: has `workingDays`, `workingHours` strings but NO numeric policy fields. Policy constants live in `attendancePolicyService.js` (late cutoff, late counts) and services hardcoded above.
- **`dashboardRoutes.employee()`** returns separate weekSummary. **`reportsRoutes.attendanceMis()`** classifies target buckets using own constants. **`missingCheckoutService.processWeeklyHoursCompliance()`** computes per-week targets. **`attendanceService.attendanceTarget()`** returns expected minutes. All four compute independently. → Duplicated logic = drift risk.

### Critical Conflicts with New Rules
1. **HALF_DAY value drift**: 270 (4h30m) used today everywhere vs required 255 (4h15m) per business rules.
2. **Missing checkout auto-closes with working minutes**: Current `processMissingCheckouts()` writes `workingMinutes = floor((shiftEnd - checkIn)/60000)` immediately — violates "confirmed working minutes zero until HR approves".
3. **No justification deadline window**: 3-day employee window + 4th-day finalization not implemented.
4. **Duplicate logic in 4 calculation sites**: must unify to one reusable service.
5. **No in-app Notification for missing checkout**: only `ScheduledEmail` is queued; rules require BOTH in-app + email alert.
6. **No automatic leave/absence conversion**: on expired justification or rejection, no LeaveRequest is created.
7. **Unconfigurable hardcoded minutes**: not stored on OrganizationProfile.

## Functional Requirements
- **FR-1 — Policy constants**: Attendance minutes (full/half), late cutoff, checkout-reminder hour, auto-deduct-paid-leave flag are persisted on OrganizationProfile with documented defaults; getter on attendancePolicyService returns merged values; routes/services read from getter not local constants.
- **FR-2 — Missing Checkout Initial State**: Scheduler marks any past-date Attendance with checkIn∧¬checkOut as `missingCheckout.justificationStatus = 'pending'`, `workingMinutes = 0`, `completionStatus = 'exception_pending'`; preserves original checkIn.
- **FR-3 — Next-day alert**: On (attendance date + 1 calendar day, IST 09:00), employee receives one in-app Notification and one ScheduledEmail containing deadline, link to correct; scheduler uses dedupe keys so neither is sent twice.
- **FR-4 — Justification submission window**: Employee may submit AttendanceCorrectionRequest between date+1 inclusive and date+4 exclusive (IST); deadline stored on both Attendance.missingCheckout.deadline and correction request; submissions after deadline blocked with 422 unless reviewer is HR/Super Admin using authorized override endpoint.
- **FR-5 — Review actions**: HR/super approves → workingMinutes recomputed, status restored, correctionAudit appended, review notifications sent; HR/super rejects → date finalized as leave/absence (creates LeaveRequest if needed); employees cannot approve/reject own requests.
- **FR-6 — Deadline finalization (idempotent)**: Scheduler pass on date+4 (00:00 IST) auto-converts any still-pending missing-checkout record to leave/absence classification; uses ScheduledEmail-like unique key so no double deduction.
- **FR-7 — Leave conversion policy**: If paid-leave balance available AND `organization.autoDeductPaidLeaveOnMissingCheckout` flag enabled → deduct 1 full paid day. Else classify as unpaid / unauthorized leave. Store conversionReason on LeaveRequest (`Missing checkout justification expired` / `Justification rejected`).
- **FR-8 — Reusable calculation service**: `attendanceCalculationService` exposes `getDailyAttendancePlan(employee, date, opts)` → `{date, isWorkingDay, weeklyOff, holiday, isJoiningEligible, isFinalWorkingEligible, fullDayLeaveApproved, halfDayLeaveApproved, exceptionStatus, originalScheduledMinutes, fullDayLeaveAdjustmentMinutes, halfDayLeaveAdjustmentMinutes, expectedWorkingMinutes, approvedWorkingMinutes}`; and period aggregators `getWeeklySummary` and `getMonthlyLeaveSummary` returning exact totals specified in UI requirements.
- **FR-9 — 255-minute half-day**: All code paths use HALF_DAY_MINUTES = 255.
- **FR-10 — Weekly aggregation (correct leaves across weeks)**: For each date in week, service applies daily plan; Week 1 half-day reduces Week1 by 255 only; Week 2 half-day reduces Week2 by 255 only. Monthly totals add fractions independently.
- **FR-11 — Late approval recalculation**: When a LeaveRequest transitions to approved, a hook recomputes any weekly/monthly summaries for periods overlapping the leave dates so the numbers reflected in dashboard/reports remain consistent; recalculation is idempotent.
- **FR-12 — UI Weekly report columns**: AttendancePage Weekly tab shows Original scheduled target, Full-day leave adj, Half-day leave adj, Final adjusted target, Actual approved working hours, Shortfall/excess, Pending exceptions count, Final compliance status label.
- **FR-13 — UI Missing checkout widgets**: Row shows "Missing Checkout – Justification Pending"; deadline countdown badge opens Justification form; submit form collects Actual checkout time + reason; after submission shown as "Submitted – Awaiting Review"; rejected status and expired status both label clearly.
- **FR-14 — Validation correction approval time**: On correction approve, requested checkoutTime ≥ checkIn.time AND < end-of-following-day AND within 4h of shift end; otherwise 422 with reason codes.
- **FR-15 — Role gating overrides**: Only HR/Super Admin can POST `corrections/:id/override` (expired submit); reopen endpoint only HR/Super Admin.
- **FR-16 — Checkout reminder preserved**: Continue existing shift-end 18:30 IST reminder (FR-2 does not replace this pass); ensure reminder uses new policy constants for hour/min.
- **FR-17 — Reports & exports update**: dashboardRoutes weekSummary, reportsRoutes MIS + PDF, allowance reports unaffected; attendance Excel sheet reads new expected minute values from the unified service.
- **FR-18 — Scripts & tests**: `recalculateAttendanceSummaries.js` idempotent backfill; `testPolicies.js` plus new `attendanceCalculation.test.js` contains all 14 required tests.

## Non-Functional Requirements
- **NFR-1 — Single source of truth**: No route/scheduler/frontend independently computes weekly expected minutes by multiplying 510/255; all paths call `attendanceCalculationService`.
- **NFR-2 — Idempotency**: Alerts, finalizations, leave deductions keyed on `{employeeId, attendanceDate, action}` unique identifiers; running scheduler twice produces identical outcome.
- **NFR-3 — Timezone correctness**: All date comparisons/keys use IST (UTC+5:30) via existing `atOrganizationTime` / `organizationDateKey` utilities; no raw `getUTCDate()` for business logic.
- **NFR-4 — Audit completeness**: Attendance.missingCheckout object stores {detectedAt, alertSentAt, deadline, justificationRequestId, reviewerId, reviewAction, reviewNote, finalizedAt, conversionReason, leaveRequestId, initialWorkingMinutes, restoredWorkingMinutes} timestamps and references.
- **NFR-5 — Backwards compatibility**: Existing pending AttendanceCorrectionRequest records remain reviewable; migration handled gracefully via defaults and nullable fields, no drop of existing data required.
- **NFR-6 — Performance**: getWeeklySummary for 1 employee × 1 week runs ≤ 3 DB queries (attendance, leave, holidays) and O(7) loop.
- **NFR-7 — Diagnostics**: `node --check` passes for all changed JS; `npm run check` (if exists) passes; 14 automated test cases all pass.

## Constraints
- **Technical**: Must reuse Mongoose models, Express routes, existing services pattern, ScheduledEmail queue, existing Notification model. Minutes (not ms, not hours) are the canonical internal unit.
- **Business**: Auto deduction allowed only if company policy explicitly enables it via the new flag (default OFF for safety). Leave conversion reason strings are exact values specified in BR 1 rule 5.
- **Dependencies**: Depend on existing `workingDayService`, `date.js` utils, `Holiday.find()` fetch pattern, `User.role` authorization; must coordinate with OrganizationProfile document always present (singleton), inserting defaults if missing on first read.

## Assumptions
- OrganizationProfile singleton key='organization' exists in env, otherwise we upsert defaults on the getter first-read.
- Existing `processWeeklyHoursCompliance` uses 'Mon-Sun previous week' boundary and month split — retain that boundary in new aggregator.
- AttendanceCorrectionRequest is reused for the justification submission; its existing status enum (pending/approved/rejected) is adequate; we add metadata fields (deadline, sourceType) instead of a new model.
- 24-hour format HH:MM for times in UI; existing picker components reused.

## Open Questions
- [ ] **Q1**: For missing checkout rejection, should a manager role also be able to reject, or strictly HR/super-admin? Spec currently says HR Admin or Super Admin. (Needs user confirmation before reopen logic.)
- [ ] **Q2**: Should auto-deduct-paid-leave-on-expiry default be enabled at Ananttattva, or leave it disabled until HR enables explicitly? Recommend disabled by default, requiring admin toggle.
- [ ] **Q3**: Final day 4 finalization at what IST hour — 00:00 (midnight) or 09:00? Affects employee's ability to submit on deadline day morning.

## Acceptance Criteria

### AC-1: Missing checkout initial state has zero working minutes
- **Type**: `rule`
- **Given**: An employee checked in on date D and never checked out
- **When**: The missing-checkout scheduler pass runs for the first time after date D
- **Then**: Attendance record status/exception marks "Missing Checkout – Justification Pending"; `workingMinutes === 0`; `expectedWorkingMinutes` still equals policy default for that day
- **Pass Condition**: Automated test (TC-7) inserts checkIn without checkOut, runs scheduler pass, asserts workingMinutes=0 + exceptionStatus=Pending + original checkIn time preserved
- **Evidence**: `attendanceCalculation.test.js` TC-7 output + backend node --check for Attendance model defaults updated

### AC-2: Next-day employee alert (email + in-app) delivered once
- **Type**: `rule`
- **Given**: Missing checkout pending on 1 Sep, today is 2 Sep 09:00 IST
- **When**: Scheduler alert pass runs
- **Then**: Exactly 1 Notification and 1 ScheduledEmail row created for that employee; dedupe key `missing-checkout-alert:empId:YYYY-MM-DD`; rerun scheduler does not duplicate
- **Pass Condition**: test inserts record → runs alert pass twice → counts === 1 each; dedupe key conflict prevented
- **Evidence**: TC-11 in tests + ScheduledEmail unique key verification

### AC-3: Justification 3-calendar-day window enforced
- **Type**: `rule`
- **Given**: Missing checkout on 1 Sep (deadline = 5 Sep 00:00 IST per rule 4-day boundary i.e. before 5th)
- **When**: Employee POSTs correction on 4 Sep (allowed) and on 5 Sep (blocked)
- **Then**: 4 Sep request creates AttendanceCorrectionRequest.status=pending; 5 Sep returns 422 with deadlineExpired reason code; UI shows countdown badge
- **Pass Condition**: Two HTTP calls to correction endpoint; second returns 422; unit test also verifies deadline date computed correctly for Sep 1
- **Evidence**: TC-10 + integration test logs

### AC-4: Approve checkout justification restores correct minutes
- **Type**: `rule`
- **Given**: Missing checkout, employee submitted checkout time 480 min after 10:00 checkIn (8h shift)
- **When**: HR Admin approves the correction
- **Then**: Attendance.workingMinutes = 480; checkOut.source='hr_correction'; correctionAudit appended; completionStatus recomputed; leave conversion NOT triggered
- **Pass Condition**: TC-8 result workingMinutes=480, not converted to leave
- **Evidence**: TC-8 + node logs on approval route

### AC-5: Reject justification finalizes day as leave with conversionReason
- **Type**: `rule`
- **Given**: Pending justification request
- **When**: HR/super approver rejects
- **Then**: Attendance marked absent/leave classification; LeaveRequest created (paid OR unpaid per policy flag and balance); conversionReason='Justification rejected' exactly
- **Pass Condition**: TC-9 asserts LeaveRequest exists with exact conversionReason string and status; no duplicate leaves on re-run of rejection flow
- **Evidence**: TC-9 + leaveRoutes createLeave direct call mock

### AC-6: Expired deadline (day 4) auto-converts; idempotent
- **Type**: `rule`
- **Given**: Missing checkout still pending on date D+4 00:00 IST
- **When**: Scheduler finalization pass runs twice
- **Then**: Attendance finalized once; exactly one LeaveRequest created with conversionReason='Missing checkout justification expired'; second scheduler pass is a no-op (dedupe)
- **Pass Condition**: TC-10 + TC-11 combined; dedupe key finalization:checked; count leaves=1
- **Evidence**: TC-10, TC-11 assertion logs

### AC-7: Auto deduct paid leave toggle behavior
- **Type**: `rule`
- **Given**: Employee has paid leave balance; policy flag autoDeductPaidLeaveOnMissingCheckout ON vs OFF
- **When**: Expired missing checkout finalizes
- **Then**: If ON → LeaveRequest payments.mode=paid (or partially_paid if insufficient), payments.days decremented from balance; if OFF → LeaveRequest as unpaid/unauthorized leave; flag OFF by default
- **Pass Condition**: Two unit-test branches verify ON and OFF branch
- **Evidence**: Unit test output for both branches

### AC-8: Audit trail completeness on Attendance document
- **Type**: `rubric`
- **Dimension**: Audit coverage of 8 required events per rule 1.6
- **Scale**: 0-2
- **Anchors**: 0 = <3 fields; 1 = 4-7 missing some timestamps/references; 2 = all 8 captured (detectedAt, alertSentAt, deadline, submittedTime+reason, reviewer+decision, finalizedAt, workingMinBefore, leaveConversionRef)
- **Pass Threshold**: >=2
- **Evidence**: DB Attendance.missingCheckout subdoc inspected after full TC-8 run; schema declared fields list checked in Attendance.js

### AC-9: AttendanceCalculationService used in all calculation paths
- **Type**: `rubric`
- **Dimension**: Single source of truth consolidation success
- **Scale**: 0-2
- **Anchors**: 0 = ≥3 sites still multiply 510/255 independently; 1 = 1-2 minor sites still need refactor; 2 = ZERO independent computations; weekly compliance, dashboard, reports, frontend all call service function
- **Pass Threshold**: >=2
- **Evidence**: Grep for `\b510\b|\b255\b|\b270\b` in backend/src/routes + frontend/src/Pages.jsx non-constant usages returns zero matches; allowed only in constants service

### AC-10: Half-day minutes correct value = 255 everywhere
- **Type**: `rule`
- **Given**: Any code path using half-day expected minutes
- **When**: Grep and runtime validation for half-day
- **Then**: All HALF_DAY_MINUTES references = 255; NO remaining 270 values in attendance calculations
- **Pass Condition**: grep -rn '270' backend/src excluding node_modules returns 0 attendance-related hits (recruitment/other unrelated OK); TC-3,4,5 all produce 29h45m / 38h15m expectations using 255
- **Evidence**: Grep output + runtime TC assertions

### AC-11: Weekly target 4-day no leave = 34 hours
- **Type**: `rule`
- **Given**: 4 scheduled working days in Mon-Sun week, no holidays, no leaves, employee active and joined before Mon
- **When**: getWeeklySummary runs
- **Then**: Original scheduled target = 4*510 = 2040 min = 34h; full adj = 0; half adj = 0; adjusted target = 2040
- **Pass Condition**: TC-1 expectedMinutes=2040
- **Evidence**: TC-1 logs

### AC-12: 4-day week, 1 full-day leave → 25h30m target
- **Type**: `rule`
- **Given**: 4 working days, 1 approved full-day leave on Wednesday
- **When**: getWeeklySummary
- **Then**: Original=2040; fullDayLeaveAdj=−510; adjusted target=1530 min = 25h30m; weekly leave counted = 1.0 full
- **Pass Condition**: TC-2 assertion
- **Evidence**: TC-2 logs

### AC-13: 4-day week, 1 half-day leave → 29h45m adjusted target
- **Type**: `rule`
- **Given**: 4 working days, 1 approved half-day leave on Wednesday
- **When**: getWeeklySummary
- **Then**: adjusted target = 2040 − 255 = 1785 min = 29h45m; half adj = −255
- **Pass Condition**: TC-3 assertion 1785
- **Evidence**: TC-3 logs

### AC-14: Half-day leaves across separate weeks each reduce only their week
- **Type**: `rule`
- **Given**: Half-day leave in Week 1 (Wed) and another half-day in Week 2 (Fri)
- **When**: getWeeklySummary(week1) + getWeeklySummary(week2) + getMonthlyLeaveSummary
- **Then**: Week1 reduction = −255 only; Week2 reduction = −255 only; monthly total halfLeaveDays = 2; monthlyLeaveConsumed = 1.0 day
- **Pass Condition**: TC-4: week1.adjTarget = orig −255, week2.adjTarget = orig2 −255, monthlyLeave = 1.0 (1 day)
- **Evidence**: TC-4 logs

### AC-15: Two half-day leaves SAME week
- **Type**: `rule`
- **Given**: 2 half-day leaves on Tue + Thu same week (5 working days)
- **When**: getWeeklySummary + monthly summary
- **Then**: weekly halfAdj = −510 (2×255); monthly halfLeaveDays=2; monthlyLeaveConsumed=1.0; weekly totalLeave=1.0 (not written off as full-day label, fraction reported separately)
- **Pass Condition**: TC-5: halfAdjTotal=510, monthlyConsumed=1.0
- **Evidence**: TC-5 logs

### AC-16: Holiday + weekly off contribute zero expected minutes
- **Type**: `rule`
- **Given**: Tue is declared holiday, Sun is weekly off
- **When**: Daily plan is run
- **Then**: isHoliday=true expectedMinutes=0; isWeeklyOff=true expectedMinutes=0; weekly sum correctly excludes both
- **Pass Condition**: TC-6 for 2 dates asserts expectedMinutes=0 each
- **Evidence**: TC-6 logs

### AC-17: Missing checkout pending contributes zero approved working minutes in weekly summary
- **Type**: `rule`
- **Given**: Missing checkout state, workingMinutes DB is set to 0, status pending
- **When**: getWeeklySummary aggregates approvedWorkingMinutes
- **Then**: That date contributes 0 approved minutes; pendingExceptions count increments by 1; compliance status "Pending exceptions"
- **Pass Condition**: Weekly summary rows for missing-checkout dates: approved=0, pendingExceptions=n
- **Evidence**: TC-7 summary aggregate test

### AC-18: Late leave approval triggers period summary recalc idempotent
- **Type**: `rule`
- **Given**: Week report already generated Tue; Friday admin approves Wednesday full-day leave retroactive
- **When**: recalcAttendanceSummaries hook fires on LeaveRequest.status change
- **Then**: Weekly adjusted target reduces by 510; running recalc twice changes nothing; dashboard and MIS now show consistent numbers
- **Pass Condition**: TC-12
- **Evidence**: TC-12 logs

### AC-19: Joining date in middle of week
- **Type**: `rule`
- **Given**: Joining date = Wednesday; 5-day Mon-Fri week; no holidays
- **When**: getWeeklySummary
- **Then**: Mon, Tue contribute 0; Wed, Thu, Fri contribute 510 each → original = 1530 min; employee responsible only from joining date
- **Pass Condition**: TC-13 expectedMinutes = 1530
- **Evidence**: TC-13 logs

### AC-20: Week straddling two calendar months
- **Type**: `rule`
- **Given**: Half-day leave on 31 Aug (Mon, week 1 of Mon-Sun boundary Aug 31 – Sep 6); another half-day 1 Sep (Tue same week)
- **When**: weekly summary + Aug monthly summary + Sep monthly summary
- **Then**: weekly halfAdj = 2×255 = −510; monthlyAug.halfLeaveDays = 1; monthlySep.halfLeaveDays = 1; each month independently counts
- **Pass Condition**: TC-14
- **Evidence**: TC-14 logs

### AC-21: Approved checkout time must be after check-in
- **Type**: `rule`
- **Given**: Correction request with checkoutTime = checkIn.time - 1 minute
- **When**: HR attempts to approve
- **Then**: Route returns 422 with reason=checkout_earlier_than_checkin; record unchanged
- **Pass Condition**: AC-14 direct HTTP test or unit branch returns 422
- **Evidence**: Route validator test logs

### AC-22: Role-based HR override
- **Type**: `rule`
- **Given**: Expired deadline, Employee POSTs vs HR/super POST override endpoint
- **When**: Two calls
- **Then**: Employee call → 403; HR/super override endpoint → 201 creates correction bypassing deadline with override flag recorded in audit
- **Pass Condition**: TC (role-based test) HTTP 403 for employee role, 201 for HR
- **Evidence**: Route auth middleware + override endpoint tests

### AC-23: UI weekly report columns rendered with correct numbers
- **Type**: `rubric`
- **Dimension**: UI fidelity to reporting requirements table
- **Scale**: 0-2
- **Anchors**: 0 = <5 columns present; 1 = 6-7 columns, labels approximate; 2 = all 8 specified columns present (original/fullAdj/halfAdj/adjusted/actual/shortfallExcess/pendingExceptions/complianceLabel), colors match tone rules
- **Pass Threshold**: >=2
- **Evidence**: Snapshot of weekly table + JSX column names reviewed

### AC-24: UI missing checkout status badges & deadline countdown
- **Type**: `rubric`
- **Dimension**: Clarity of missing checkout state visualization
- **Scale**: 0-2
- **Anchors**: 0 = status not distinct; 1 = yellow badge only; 2 = four distinct states each render correctly (Pending yellow + deadline badge, Submitted blue/awaiting, Approved green, Rejected red + Expired red/gray) with visible text and click-to-justify action
- **Pass Threshold**: >=2
- **Evidence**: 4 state screenshots or JSX return branches inspected

### AC-25: Monthly leave report column counts
- **Type**: `rubric`
- **Dimension**: Monthly leave reporting fidelity
- **Scale**: 0-2
- **Anchors**: 0 = no full/half distinction; 1 = one label; 2 = 3 numbers displayed (full-day count, half-day count, total units consumed = full + half*0.5)
- **Pass Threshold**: >=2
- **Evidence**: Leave page KPIs numbers match service function monthlyLeaveSummary

### AC-26: Shift-end checkout reminder still works
- **Type**: `rule`
- **Given**: Today 18:30 IST, employee checked in but no checkout
- **When**: processCheckoutReminders pass runs
- **Then**: Reminder email queued; working-minute calculation service not yet invoked (pure reminder)
- **Pass Condition**: ScheduledEmail count increments; rerun same minute does not create duplicate
- **Evidence**: Checkout reminder existing scheduler test pass logs
