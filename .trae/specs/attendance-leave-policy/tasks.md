# Attendance & Leave Policy Overhaul - Implementation Plan

Dependency order: Models → Constants/Service core → Scheduler & routes → Frontend UI → Exports/Reports → Scripts & tests.

## Task 1: Extend Mongoose models with attendance policy fields
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  1. OrganizationProfile singleton: add policy fields: `attendancePolicy.fullDayWorkingMinutes (default 510)`, `attendancePolicy.halfDayWorkingMinutes (default 255)`, `attendancePolicy.lateCutoff {hour:10,min:15}`, `attendancePolicy.checkoutReminder {hour:18,min:30}`, `attendancePolicy.autoDeductPaidLeaveOnMissingCheckout (default false)`, `attendancePolicy.missingCheckoutJustificationDays (default 3)`.
  2. Attendance model: replace bare `missedCheckOut:boolean` with `missingCheckout` subdoc: `{detectedAt, alertSentAt, deadline, justificationStatus: enum[pending, submitted, approved, rejected, expired, none], justificationRequestId, reviewerId, reviewAction, reviewNote, finalizedAt, conversionReason, leaveRequestId, workingMinutesBefore, workingMinutesRestored, history[]}`. Add `exceptionStatus` string field. Preserve existing `missedCheckOut` bool getter as derived alias for backwards compatibility (or virtual). Add compound sparse index `{employee, date, 'missingCheckout.justificationStatus'}`.
  3. AttendanceCorrectionRequest: add fields: `deadline (Date)`, `kind (enum: missing_checkout, other, default missing_checkout)`, `submittedWithinDeadline (bool)`, `isHrOverride (bool)`, `overrideBy (User ref)`.
  4. LeaveRequest: add `conversionReason (string)` field and `systemGenerated (bool, default false)`; update payments validation to accept these as read-only fields.
  5. Run `node --check` on all model files.
- **Acceptance Criteria Addressed**: AC-1, AC-8, AC-5, AC-6, AC-7
- **Test Requirements**:
  - `rule` TR-1.1: `node --check` exits 0 for all 4 changed model files.
  - `rubric` TR-1.2: Audit fields completeness; scale 0-2; anchors 0=<3 new fields added, 1=partial 4-7, 2=all declared; threshold >=2; evidence=source listing of Attendance.missingCheckout subdoc keys.
- **Notes**: No data-migration yet; old `missedCheckOut:true` records treated via default virtuals as `justificationStatus:'none'` until the recalc script (Task 6) runs.

## Task 2: Attendance constants getter + reusable calculation service
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  1. Create `attendancePolicyService.getAttendancePolicy()` async: reads OrganizationProfile singleton, upserts defaults if not present, returns merged policy object (minutes, cutoffs, flags, justificationDays).
  2. DEPRECATE local constants in attendanceService, missingCheckoutService, reportsRoutes — all consumers go via `getAttendancePolicy()`. Update constants file location; keep at top `attendancePolicyService.js`.
  3. NEW `attendanceCalculationService.js` (the reusable source-of-truth):
     - `getDailyAttendancePlan(employee, date, {holidaysSet, approvedLeaves, attendanceRecords})` → returns per-day plan object per FR-8 fields.
     - Uses `workingDayService.isScheduledWorkingDay(date, holidaysSet)`, employee joiningDate, termination/finalDate if any.
     - Holiday fetching helper `getOrganizationHolidayKeys(year)` returns Set of YYYY-MM-DD.
     - Approved leaves helper `getApprovedLeavesByDate(employeeId, start, end)` returns Map<dateKey, LeaveRecord[]> so service can distinguish full vs half day on each date.
     - Attendance data helper `getAttendanceRecords(employeeId, start, end)` returns Map<dateKey, AttendanceRecord> for approvedWorkingMinutes, exceptionStatus.
     - `getWeeklySummary(employee, weekStart /* Monday */)` returns: {originalScheduledMinutes, fullDayLeaveAdjustmentMinutes, halfDayLeaveAdjustmentMinutes, adjustedTargetMinutes, approvedWorkingMinutes, shortfallExcessMinutes, pendingExceptionsCount, complianceStatusText, dailyBreakdown[]}.
     - `getMonthlyLeaveSummary(employee, month, year)` → {fullDayLeaves, halfDayLeaves, totalLeaveDaysConsumed, leavesByType, workingDaysPlanned, minutesExpectedMonth, minutesWorkedMonth}.
     - `splitWeekByMonthIfNeeded(weekStart)` helper splits Mon-Sun into 1 or 2 month slices as existing `processWeeklyHoursCompliance` does.
  4. Internal unit: ALL minutes, NO hours arithmetic internally; hours helper only for display string formatting at API boundaries.
  5. All hardcoded 270 → HALF_DAY_MINUTES = policy.halfDayWorkingMinutes (255 default).
  6. `node --check attendanceCalculationService.js`, `attendancePolicyService.js`, update testPolicies basic sanity.
- **Acceptance Criteria Addressed**: AC-9, AC-10, AC-11, AC-12, AC-13, AC-15, AC-16, AC-19, AC-20, NFR-1
- **Test Requirements**:
  - `rule` TR-2.1: `node --check` passes on 2 updated services + 1 new service.
  - `rule` TR-2.2: Grep for `\b270\b` in backend/src (excluding node_modules, recruitment, unrelated) returns 0 hits; allowed only in comments/non-attendance.
  - `rubric` TR-2.3: Service interface completeness; scale 0-2; 0=one aggregator missing, 1=API minor gaps, 2=all 3 public entry points present with correct field names per FR-8,10; threshold >=2; evidence=function signatures in source.

## Task 3: Rewrite missing checkout scheduler passes (idempotent, 3-day window + finalization)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  1. Replace current `processMissingCheckouts` behavior: NO MORE auto-closing with shift-end checkout. New behavior:
     - For past dates with `checkIn ∧ ¬checkOut`: set `missingCheckout.detectedAt = now`, `missingCheckout.justificationStatus='pending'`, `exceptionStatus='Missing Checkout - Justification Pending'`, `workingMinutes = 0`, `completionStatus = 'exception_pending'`. Preserve original checkIn.
     - Compute `missingCheckout.deadline` as date + justificationDays+1 calendar days 00:00 IST (for justificationDays default 3 → D+4 00:00 IST as end-of-window, i.e. window D+1..D+3 inclusive).
  2. Add NEW `processMissingCheckoutAlerts()` pass: on (attendance.date + 1 calendar day), send ONE in-app Notification + ONE ScheduledEmail to employee. Use dedupe keys `missing-checkout-alert:{empId}:{dateKey}` for both. Notification.message must include deadline, human-readable date, direct link fragment to correct. Send email with matching subject. BOTH must be sent atomically.
  3. Add NEW `processMissingCheckoutFinalization()` pass: for records whose `missingCheckout.justificationStatus='pending' AND today >= deadline` → call conversion helper `finalizeMissingCheckoutAsLeave(attendance, reason='Missing checkout justification expired')`.
  4. Extract `finalizeMissingCheckoutAsLeave(attendance, reason)` reusable helper:
     - Checks `organization.autoDeductPaidLeaveOnMissingCheckout` flag AND employee available paid leave balance (via `leavePolicyService`).
     - Creates LeaveRequest.systemGenerated with conversionReason exactly matching rules, startDate=endDate=attendance.date, dayType=full_day, payments mode=paid or unpaid, status=approved (no workflow).
     - On Attendance, sets status='absent' or 'on_leave' per decision, exceptionStatus final, `missingCheckout.finalizedAt, leaveRequestId, conversionReason, workingMinutesBefore=0, workingMinutesRestored=0`.
     - Uses dedupe key `missing-checkout-finalization:{empId}:{dateKey}` on an internal processing collection or via checking `missingCheckout.finalizedAt already set` — guaranteed idempotent.
  5. Existing `processCheckoutReminders` pass: continue as-is but read reminder hour+min from `getAttendancePolicy()` instead of hardcoded 18:30.
  6. Existing `processMissingCheckInsAndEscalations` pass: continue; ensure new `exceptionStatus` values feed into escalation miss-count correctly.
  7. Existing `processWeeklyHoursCompliance` pass: REPLACE its manual 510/270 math entirely → call `attendanceCalculationService.getWeeklySummary` for each employee in both month-slices; shortfall alert when approvedWorkingMinutes < adjustedTargetMinutes.
  8. Idempotency: every pass guarded by existing ScheduledEmail pattern plus Attendance-side state flags (fields set means already processed).
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-6, AC-7, AC-16, AC-26, NFR-2, NFR-3, NFR-4
- **Test Requirements**:
  - `rule` TR-3.1: `node --check missingCheckoutService.js` 0.
  - `rule` TR-3.2: Create 1 past missing checkout fixture, run scheduler passes 2x, assert 1 Notification + 1 ScheduledEmail (no dup).
  - `rule` TR-3.3: Run finalization pass 2x after deadline, assert exactly 1 LeaveRequest.created with correct conversionReason, counts identical.
  - `rubric` TR-3.4: Idempotency design; scale 0-2; 0=re-running creates duplicates, 1=one of {alert, finalize} lacks dedupe, 2=both passes are dedupe guarded; threshold >=2; evidence=source comments at each pass + state guard flags inspected.

## Task 4: Attendance correction routes (deadline, HR override, validation, leave on reject)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  1. POST `/:id/correction` (employee submit):
     - Validate: employee is owner, record is missing-checkout pending, `now < attendance.missingCheckout.deadline`. If deadline expired → 422 with code `DEADLINE_EXPIRED` and message "justification deadline passed on DD/MM/YYYY".
     - Validate requestedCheckoutTime ≥ checkIn.time AND < end-of-next-day AND |requestedTime - shiftEnd| ≤ 4 hours (configurable max 4h after shift default). Else 422 with reason codes: `CHECKOUT_BEFORE_CHECKIN`, `CHECKOUT_OUTSIDE_RANGE`.
     - Populate `deadline`, `submittedWithinDeadline=true`, `kind='missing_checkout'` on AttendanceCorrectionRequest.
     - Flip Attendance `missingCheckout.justificationStatus='submitted'`, justificationRequestId = saved request id. Append missingCheckout.history entry.
  2. POST `/:id/correction/override` (HR/super_admin only):
     - Authorization: `role ∈ {hr_admin, admin, super_admin}` — employee role returns 403.
     - Creates correction bypassing the deadline; marks `isHrOverride=true`, overrideBy=userId.
     - Works for expired records too.
  3. PATCH `/corrections/:id/approve` (HR/super_admin):
     - Re-validate requestedCheckoutTime ≥ checkIn.time. If fails 422.
     - On success: apply new checkout time, set `workingMinutes = floor((checkout - checkIn)/60000)`, call `applyAttendanceCompletion(policy=updated)` via existing helper or new one, update completionStatus, mark checkOut.source='hr_correction'.
     - Mark Attendance missingCheckout: justificationStatus='approved', reviewerId, reviewAction='approved', reviewNote, workingMinutesRestored=actual, finalizedAt, restoredFromException via correctionAudit append.
     - NOT create leave conversion (correction approved wins).
     - Notify employee (Notification + email) of decision.
  4. PATCH `/corrections/:id/reject` (HR/super_admin):
     - Rejection triggers `finalizeMissingCheckoutAsLeave(attendance, reason='Justification rejected')` helper exactly as in scheduler. Append review.
     - Notify employee.
  5. PATCH `/corrections/:id/reopen` (HR/super_admin only):
     - For already-approved or rejected corrections, allows reopening (e.g. HR made mistake). Flips justificationStatus back to pending; no leave rollback automatic but HR may separately cancel leave; clear finalizedAt if leave was already applied; append history entry.
  6. GET endpoints: ensure correction listing for employee includes deadline, remaining time countdown, submittedWithinDeadline flag, isHrOverride flag, reviewer, timeline.
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5, AC-14, AC-21, AC-22
- **Test Requirements**:
  - `rule` TR-4.1: Dead-end HTTP test or internal function asserts `deadline expired` → 422, `checkout_before_checkin` →422, employee override →403, HR override →201.
  - `rule` TR-4.2: Approve path sets workingMinutes=Δ(checkin, approved checkout), no LeaveRequest generated.
  - `rule` TR-4.3: Reject path creates LeaveRequest with conversionReason exactly equal to string 'Justification rejected' (case sensitive).
  - `rubric` TR-4.4: Validation coverage; scale 0-2; anchors 0=<2 reason codes, 1=2 codes, 2=3 codes (DEADLINE/BEFORE/RANGE) with messages; threshold >=2.

## Task 5: Integrate reusable service into dashboard + reports + exports; fix Frontend calculations
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  1. **dashboardRoutes.js** `/dashboard/employee` weekSummary:
     - Replace current weekSummary math with `attendanceCalculationService.getWeeklySummary(employee, thisMonday)` for current week (and previous if needed). Return same schema shape but populate adjustedTargetMinutes etc. so frontend week card numbers are correct. Preserve backward compatibility: if dashboard consumers depend on keys today, emit both old + new keys.
  2. **reportsRoutes.js** `attendanceMis()` monthly MIS:
     - Replace constants 510/270 at top → use policy service.
     - For per-record classification, use `getDailyAttendancePlan` results so bucket counts (full/half/incomplete, target-bucket) match policy.
     - Attendance MIS PDF labels (currently hardcoded 4h30m) read actual halfDayMinutes and print accordingly (4h15m at default 255).
  3. **attendanceRoutes.js** `/history` endpoint for AttendancePage:
     - Return per-row extra fields: expectedWorkingMinutes (per new daily plan), exceptionStatus, missingCheckout.deadline, missingCheckout.justificationStatus, corrections submission URL hints so AttendancePage KPI strip + table correctly label pending records and don't count "Missing Checkout Pending" as completed attendance.
  4. **attendanceRoutes.js** `/export` Excel:
     - Column headers add columns: "Original Target (min)", "Adjusted Target (min)", "Half-day Leave", "Full-day Leave" using values from the calculation service.
  5. **Frontend Pages.jsx AttendancePage changes**:
     - New weekly tab (or add columns to existing month view). For each Mon-Sun week in the selected month, render weekly summary table row showing AC-23 8 columns: Original scheduled target, full adj, half adj, adjusted target, actual, shortfall/excess, pending exceptions, compliance label. Compute client-side display values by using the service endpoint response; do NOT hardcode min arithmetic client-side; let the backend weekly response carry the values.
     - Status rendering: rows with missingCheckout.justificationStatus=pending show yellow status pill "Missing Checkout – Justification Pending" + deadline countdown badge (e.g. "2d left", "Expires 05/09"). submitted status shows blue "Submitted – Awaiting Review". approved/rejected green/red. expired gray-red.
     - Replace any hardcoded 510/270 references; Pages.jsx late cutoff constants (10:15) are display-only so keep as mirror of backend constants, but add comment "must match Organization attendancePolicy.lateCutoff".
     - Remove hardcoded target label in MIS ReportsPage: "Full day 8h 30m · Half day 4h 30m" → fetch `/reports/attendance-metadata` (new endpoint, tiny) OR just re-label to "Full {fullHours}h {fullMin}m · Half {halfHours}h {halfMin}m" using data from MIS summary response.
  6. **LeavePage monthly KPIs**:
     - Display 3 new numbers: full-day leaves count, half-day leaves count, total leave days consumed = full + 0.5*half. Render in a leave-balance-subsection strip.
  7. **Notifications**: In-app bell receives new missing-checkout alert, click routes to AttendancePage row or opens correction drawer with attendance date prefilled.
- **Acceptance Criteria Addressed**: AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-23, AC-24, AC-25
- **Test Requirements**:
  - `rule` TR-5.1: dashboardRoutes return includes adjustedTargetMinutes; for 4-working-day no-leave week it equals 2040.
  - `rule` TR-5.2: reportsRoutes half-day no longer contains 4h30m label when halfDayMinutes=255; PDF label says 4h15m.
  - `rule` TR-5.3: LeavePage totalLeaveDaysConsumed = full + half*0.5; TC-4 (cross-week halves) total 1.0.
  - `rubric` TR-5.4: Frontend UI fidelity per AC-23/AC-24; scale 0-2; anchors 0=fewer than 6 weekly columns + 2 missing status badges, 1=6-7 cols OK with missing status badges, 2=8 cols + 4 distinct status pills with deadline; threshold >=2; evidence JSX sections inspected.

## Task 6: Idempotent recalculation + 14 automated tests
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  1. NEW script `backend/src/scripts/recalculateAttendanceSummaries.js`:
     - Iterates all active employees; for each, recomputes summaries from a start-of-history date (default = min joining date among employees OR command line --from=YYYY-MM).
     - Re-applies: missingCheckout detection (Task 3 pass-1 logic) idempotently; deadline population; finalization of any long-overdue records; updates Attendance.expectedWorkingMinutes to match new policy.
     - Does NOT overwrite existing HR-corrected working minutes — only fills zeroes where system auto filled incorrectly and status allows.
     - CLI flags: `--from YYYY-MM`, `--employee employeeCode`, `--dry-run`.
     - Print JSON summary `{processedEmployees, updatedAttendanceRecords, conversionsApplied, skippedAlreadyFinalized, dryRun}`.
  2. NEW tests `backend/src/scripts/attendanceCalculation.test.js` (or inside testPolicies.js — reuse test runner pattern). Implement TC-1..TC-14:
     - TC-1: 4 working days, no leaves → original 2040 = 34h target.
     - TC-2: 4 working days, 1 full-day leave approved Wed → adjusted 1530 = 25h30m.
     - TC-3: 4 working days, 1 half-day leave → adjusted 1785 = 29h45m.
     - TC-4: Week1 half-day Wed, Week2 half-day Fri → each week adjTarget reduces by exactly 255 only, monthly leave consumed total = 1.0.
     - TC-5: Same week Tue+Thu half days (5-day week, 2 halfs) → halfAdjTotal=510, weeklyHalfDays=2, monthlyLeaveConsumed=1.0, not combined into full.
     - TC-6: Holiday + Sunday → expectedMinutes = 0 for both; weekly sum excludes both.
     - TC-7: Missing checkout pending state → workingMinutes=0, status Pending. Weekly summary approved=0 for that date, pendingExceptions +=1.
     - TC-8: Missing checkout + approved 480 min checkout after checkIn → workingMinutes=480 restored, no leave created.
     - TC-9: Missing checkout + justification rejected → creates 1 LeaveRequest with conversionReason='Justification rejected' exact string.
     - TC-10: Missing checkout with no action submitted, cross deadline → scheduler finalizer runs, creates 1 LeaveRequest with conversionReason='Missing checkout justification expired', date=attendance.date.
     - TC-11: Scheduler alerts/finalization run twice → counts of Notifications, ScheduledEmails, LeaveRequests all identical to run-1 (no doubles).
     - TC-12: Leave approved retroactively for past week already computed → weekly adjusted target updates by 510 decrease on affected week; recalc twice yields stable values.
     - TC-13: Employee joining date = Wednesday, 5-day week Mon-Fri → original expected 1530 min (Wed/Thu/Fri only).
     - TC-14: Week boundary Aug31-Sep6 (Mon-Sun). Half day 31 Aug (month slice 1), half day 1 Sep (slice 2). Weekly halfAdj=510; monthlyAug.halfLeaveDays=1; monthlySep.halfLeaveDays=1; NO cross-week pairing.
  3. Update `backend/src/scripts/testPolicies.js` assertions: replace any 270 references to 255 in allowance tests (currently attendance tests not there; extend with TC subset so testPolicies still runs standalone).
- **Acceptance Criteria Addressed**: AC-1 through AC-26 (all), NFR-5, NFR-6, NFR-7
- **Test Requirements**:
  - `rule` TR-6.1: `node src/scripts/attendanceCalculation.test.js` exits 0 with TC-1..TC-14 pass count 14.
  - `rule` TR-6.2: `node src/scripts/testPolicies.js` (policy sanity) still passes (no regressions).
  - `rule` TR-6.3: `node src/scripts/recalculateAttendanceSummaries.js --dry-run --from 2025-01` runs to completion (schema valid, safe no-op if empty DB).
  - `rubric` TR-6.4: Test coverage fidelity; scale 0-2; anchors 0=<10 TCs, 1=10-13 TCs, 2=all 14 with correct expected values; threshold >=2; evidence=test output listing TC-1..TC-14 pass.

## Task 7: Leave approval hook retroactively recalculates periods; syntax lint pass
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  1. After LeaveRequest status changes via approval → on 'approved' transition, call `attendanceCalculationService.recalculateAffectedPeriods(leave)`.
     - This recomputes internal cache if any; more importantly, it logs a recalculation audit. For reports/dashboard endpoints that call service live each time, no extra DB state is needed (they always compute fresh). If any scheduler-generated "lastWeeklyAuditKey" caches are referenced, clear/invalidate them so the next scheduler pass will regenerate correctly.
     - Implementation: on leaveRoutes approval success, add a small function call `invalidateWeeklyAuditKeysForLeaveDates(leave)` → removes ScheduledEmail docs with weekly_hours_shortfall keys for overlapping periods (or marks them for re-send). If no docs, no-op.
  2. Ensure AttendanceCorrectionRequest approve/reject paths in Task 4 also call the same invalidation hook for weekly shortfall.
  3. Final syntax check pass: run `node --check` on ALL changed files: models (4), services (4+), routes (4+), scripts (2+). Record evidence.
  4. Run the dev server briefly (or at minimum `node -e "import('./backend/src/services/attendanceCalculationService.js').then(()=>process.exit(0))"` to ensure ES modules import without circular deps.
- **Acceptance Criteria Addressed**: NFR-1 (recalculation ensures unified service consumption), AC-18 (late approval), NFR-7
- **Test Requirements**:
  - `rule` TR-7.1: `node --check` passes on each changed file.
  - `rule` TR-7.2: Import check of new service exits 0 (no circular deps).
  - `rubric` TR-7.3: Hook completeness; scale 0-2; anchors 0=no hooks, 1=hook present only on 1 of {leave approve, correction approve, correction reject}, 2=hooks on all 3; threshold >=2; evidence handler callbacks inspected.
