import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Filter,
  IndianRupee,
  Mail,
  MapPin,
  Network,
  Plane,
  Plus,
  ReceiptText,
  Search,
  ScanFace,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useNavigate } from "./router.jsx";
import {
  adminApi,
  allowanceApi,
  attendanceApi,
  biometricApi,
  employeeApi,
  holidayApi,
  leaveApi,
  workArrangementApi,
  SERVER_FACE_ENABLED,
} from "./services/api.js";
import BiometricEnrollment from "./BiometricEnrollment.jsx";
import "./allowance-policy.css";

const formatDate = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
const formatTime = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const capitalize = (value) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

function addMonthsISO(dateIso, monthsToAdd) {
  if (!dateIso || !Number.isFinite(Number(monthsToAdd))) return "";
  const raw = new Date(dateIso);
  if (Number.isNaN(raw.getTime())) return "";
  const targetMonthIndex = raw.getMonth() + Number(monthsToAdd);
  const targetYear = raw.getFullYear() + Math.floor(targetMonthIndex / 12);
  const clampedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTarget = new Date(targetYear, clampedMonth + 1, 0).getDate();
  const day = Math.min(raw.getDate(), lastDayOfTarget);
  const result = new Date(targetYear, clampedMonth, day);
  return result.toISOString().slice(0, 10);
}
const expectedProbationEnd = (joiningDateIso, durationMonths) =>
  addMonthsISO(joiningDateIso, durationMonths);

function PageHeader({ eyebrow = "My Space", title, description, action }) {
  return (
    <div className="page-title-row">
      <div>
        <p className="breadcrumb">
          Home <span>›</span> {title}
        </p>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function StateMessage({ children, error = false }) {
  return (
    <div className={`state-message ${error ? "error" : ""}`}>{children}</div>
  );
}
function StatusBadge({ status, label }) {
  return <span className={`data-status ${status}`}>{label || capitalize(status)}</span>;
}
const INDIA_TIME_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function derivedLateMinutes(record) {
  if (!record?.checkIn?.time || record.attendanceMode === "wfh") return 0;
  const parts = Object.fromEntries(
    INDIA_TIME_PARTS.formatToParts(new Date(record.checkIn.time))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  const minutesAfterCutoff = (parts.hour * 60 + parts.minute) - (10 * 60 + 15);
  return Math.max(Number(record.lateMinutes) || 0, minutesAfterCutoff, 0);
}
const punctualityFor = (record) => !record?.checkIn?.time
  ? null
  : (derivedLateMinutes(record) > 0 || record.status === "late" || record.halfDayReason === "three_late_arrivals")
    ? "late"
    : "on_time";
const punctualityLabel = (record, long = false) => {
  const status = punctualityFor(record);
  if (status !== "late") return status === "on_time" ? "On time" : "—";
  const minutes = derivedLateMinutes(record);
  return `Late${minutes ? ` · ${minutes}${long ? " minutes" : "m"}` : ""}`;
};

export function MySpacePage() {
  const navigate = useNavigate();
  const items = [
    {
      title: "Attendance",
      text: "Review your punches, hours and monthly history.",
      icon: Clock3,
      path: "/attendance",
      tone: "teal",
    },
    {
      title: "Leave",
      text: "View balances and apply for time away.",
      icon: Plane,
      path: "/leave",
      tone: "purple",
    },
    {
      title: "Requests",
      text: "Track leave and attendance requests.",
      icon: FileCheck2,
      path: "/requests",
      tone: "amber",
    },
  ];
  return (
    <>
      <PageHeader
        title="My Space"
        description="Everything related to your workday and personal requests."
      />
      <div className="feature-grid">
        {items.map(({ title, text, icon: Icon, path, tone }) => (
          <button
            className="feature-card"
            key={title}
            onClick={() => navigate(path)}
          >
            <span className={`feature-icon ${tone}`}>
              <Icon size={21} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
            <ArrowRight size={18} />
          </button>
        ))}
      </div>
      <section className="content-card overview-panel">
        <div>
          <p className="eyebrow">This month</p>
          <h2>Your work snapshot</h2>
        </div>
        <div className="compact-metrics">
          <div>
            <span>Present</span>
            <strong>21</strong>
          </div>
          <div>
            <span>Late</span>
            <strong>3</strong>
          </div>
          <div>
            <span>Leave</span>
            <strong>2</strong>
          </div>
          <div>
            <span>Average hours</span>
            <strong>8h 21m</strong>
          </div>
        </div>
      </section>
    </>
  );
}

export function AttendancePage({ user }) {
  const now = new Date(),
    [month, setMonth] = useState(now.getMonth() + 1),
    [year, setYear] = useState(now.getFullYear()),
    [records, setRecords] = useState([]),
    [corrections, setCorrections] = useState([]),
    [faceRequests, setFaceRequests] = useState([]),
    [correctionRecord, setCorrectionRecord] = useState(null),
    [correctionForm, setCorrectionForm] = useState({ requestedCheckoutTime: "", reason: "" }),
    [selected, setSelected] = useState(null),
    [viewingPhoto, setViewingPhoto] = useState(null),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [correctionBusy, setCorrectionBusy] = useState(false),
    [arrangements, setArrangements] = useState([]),
    [arrangementOpen, setArrangementOpen] = useState(false),
    [arrangementBusy, setArrangementBusy] = useState(false),
    [arrangementForm, setArrangementForm] = useState(() => { const date=new Date().toISOString().slice(0,10); return {type:"wfh",startDate:date,endDate:date,startTime:"09:00",endTime:"18:30",reason:"",clientName:"",destination:{name:"",address:"",latitude:"",longitude:"",allowedRadiusMeters:250}} }),
    [error, setError] = useState("");
  const canExport = ["super_admin", "admin", "hr_admin", "finance_admin", "it_admin"].includes(user.role);
  const canViewAllAttendance = canExport;
  const canReviewCorrections = ["super_admin", "admin", "hr_admin"].includes(user.role);
  const canReviewFaceRequests = ["super_admin", "admin", "hr_admin", "manager"].includes(user.role);
  const canReviewArrangements = ["super_admin", "admin", "hr_admin", "it_admin", "manager"].includes(user.role);
  const previousMonth = () => {
    if (month === 1) { setMonth(12); setYear(value => value - 1); }
    else setMonth(value => value - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(value => value + 1); }
    else setMonth(value => value + 1);
  };
  useEffect(() => {
    (canViewAllAttendance ? attendanceApi.allHistory(month, year) : attendanceApi.history(month, year))
      .then(setRecords)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month, year, canViewAllAttendance]);
  useEffect(() => {
    attendanceApi
      .corrections(canReviewCorrections ? "all" : "mine")
      .then(setCorrections)
      .catch((e) => setError(e.message));
  }, [canReviewCorrections]);
  useEffect(() => {
    attendanceApi
      .manualRequests(canReviewFaceRequests ? "all" : "mine")
      .then(setFaceRequests)
      .catch((e) => setError(e.message));
  }, [canReviewFaceRequests]);
  useEffect(() => {
    const scope=["super_admin","admin","hr_admin","it_admin"].includes(user.role)?"all":user.role==="manager"?"team":"mine";
    workArrangementApi.list(scope).then(setArrangements).catch((e)=>setError(e.message));
  }, [user.role]);
  const summary = useMemo(
    () =>
      records.reduce(
        (result, item) => ({
          ...result,
          [item.status]: (result[item.status] || 0) + 1,
          punctualityLate: result.punctualityLate + (punctualityFor(item) === "late" ? 1 : 0),
        }),
        { punctualityLate: 0 },
      ),
    [records],
  );
  async function downloadExcel() {
    setExporting(true);
    setError("");
    try {
      const { blob, fileName } = await attendanceApi.exportExcel(month, year);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }
  function openCorrection(record) {
    const checkout = new Date(record.checkOut?.time || record.date);
    checkout.setMinutes(checkout.getMinutes() - checkout.getTimezoneOffset());
    setCorrectionForm({ requestedCheckoutTime: checkout.toISOString().slice(0, 16), reason: "" });
    setCorrectionRecord(record);
  }
  async function submitCorrection(event) {
    event.preventDefault();
    setCorrectionBusy(true);
    setError("");
    try {
      const created = await attendanceApi.requestCorrection(correctionRecord._id, correctionForm);
      setCorrections((items) => [created, ...items]);
      setCorrectionRecord(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCorrectionBusy(false);
    }
  }
  async function reviewCorrection(request, decision) {
    const reviewNote = decision === "reject" ? window.prompt("Please enter the rejection reason") : "";
    if (decision === "reject" && !reviewNote) return;
    setCorrectionBusy(true);
    setError("");
    try {
      const updated = await attendanceApi.reviewCorrection(request._id, decision, reviewNote);
      setCorrections((items) => items.map((item) => item._id === updated._id ? updated : item));
      if (updated.attendance?._id) setRecords((items) => items.map((item) => item._id === updated.attendance._id ? { ...item, ...updated.attendance } : item));
    } catch (e) {
      setError(e.message);
    } finally {
      setCorrectionBusy(false);
    }
  }
  async function reviewFaceRequest(request, decision) {
    const reviewNote = decision === "reject" ? window.prompt("Please enter the rejection reason") : "";
    if (decision === "reject" && !reviewNote) return;
    setCorrectionBusy(true);
    setError("");
    try {
      const updated = await attendanceApi.reviewManualRequest(request._id, decision, reviewNote);
      setFaceRequests((items) => items.map((item) => item._id === updated._id ? updated : item));
      if (updated.attendance && decision === "approve") {
        const refreshed = canViewAllAttendance ? await attendanceApi.allHistory(month, year) : await attendanceApi.history(month, year);
        setRecords(refreshed);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCorrectionBusy(false);
    }
  }
  async function submitArrangement(event) {
    event.preventDefault();setArrangementBusy(true);setError("");
    try {
      const payload={...arrangementForm};
      if(payload.destination.latitude===""||payload.destination.longitude==="")throw new Error(`Use current location to capture the approved ${payload.type==="wfh"?"work-from-home location":"destination"}`)
      payload.destination={...payload.destination,name:payload.type==="wfh"?"Approved WFH location":payload.destination.name,latitude:Number(payload.destination.latitude),longitude:Number(payload.destination.longitude),allowedRadiusMeters:Number(payload.destination.allowedRadiusMeters)};
      const created=await workArrangementApi.create(payload);setArrangements(items=>[created,...items]);setArrangementOpen(false);
    } catch(e){setError(e.message)} finally{setArrangementBusy(false)}
  }
  function captureDestination(){
    if(!navigator.geolocation){setError("Location is not supported by this browser");return}
    setArrangementBusy(true);setError("");
    navigator.geolocation.getCurrentPosition(({coords})=>{setArrangementForm(form=>({...form,destination:{...form.destination,latitude:coords.latitude.toFixed(6),longitude:coords.longitude.toFixed(6)}}));setArrangementBusy(false)},()=>{setError("Unable to capture the destination. Enable precise location and retry.");setArrangementBusy(false)},{enableHighAccuracy:true,maximumAge:0,timeout:12000});
  }
  async function reviewArrangement(request,decision){
    const reviewNote=decision==="reject"?window.prompt("Please enter the rejection reason"):"";if(decision==="reject"&&!reviewNote)return;
    setArrangementBusy(true);setError("");try{const updated=await workArrangementApi.review(request._id,decision,reviewNote);setArrangements(items=>items.map(item=>item._id===updated._id?{...item,...updated}:item))}catch(e){setError(e.message)}finally{setArrangementBusy(false)}
  }
  const pendingCorrectionIds = new Set(corrections.filter((item) => item.status === "pending").map((item) => String(item.attendance?._id || item.attendance)));
  const pendingArrangements = arrangements.filter((item) => item.status === "pending");
  const pendingFaceRequests = faceRequests.filter((item) => item.status === "pending");
  const orderedArrangements = [...arrangements].sort((left,right) => Number(right.status === "pending") - Number(left.status === "pending"));
  return (
    <>
      <PageHeader
        title="Attendance"
        description={canViewAllAttendance ? "Monthly attendance, shift hours and punch details for all employees." : "Your monthly attendance, shift hours and daily punch details."}
        action={
          <div className="attendance-page-actions">
          <div className="month-control">
            <button
              onClick={previousMonth}
            >
              ‹
            </button>
            <span>
              {new Intl.DateTimeFormat("en", { month: "long" }).format(
                new Date(year, month - 1),
              )}{" "}
              {year}
            </span>
            <button
              onClick={nextMonth}
            >
              ›
            </button>
          </div>
          {canExport && <button className="secondary-button attendance-export-button" disabled={exporting} onClick={downloadExcel}>
            <Download size={15} /> {exporting ? "Preparing…" : "Download Excel"}
          </button>}
          <button className="primary-button" onClick={()=>setArrangementOpen(true)}><MapPin size={15}/> Request work mode</button>
          </div>
        }
      />
      <div className="summary-strip">
        <div>
          <span>Present</span>
          <strong>{summary.present || 0}</strong>
        </div>
        <div>
          <span>Late</span>
          <strong>{summary.punctualityLate}</strong>
        </div>
        <div>
          <span>WFH</span>
          <strong>{summary.wfh || 0}</strong>
        </div>
        <div>
          <span>Total records</span>
          <strong>{records.length}</strong>
        </div>
      </div>
      {canReviewArrangements && <div className={`work-approval-banner ${pendingArrangements.length ? "has-pending" : ""}`}>
        <div><span>Work-mode approval queue</span><strong>{pendingArrangements.length ? `${pendingArrangements.length} request${pendingArrangements.length === 1 ? "" : "s"} waiting for review` : "No pending work-mode requests"}</strong><small>Review work-from-home, client-location and field-visit requests.</small></div>
        <button className="secondary-button" onClick={()=>document.getElementById("work-mode-approvals")?.scrollIntoView({behavior:"smooth",block:"start"})}>Review requests <ArrowRight size={15}/></button>
      </div>}
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Attendance log</p>
            <h2>Daily records</h2>
          </div>
          <button className="secondary-button">
            <Filter size={15} /> Filter
          </button>
        </div>
        {loading ? (
          <StateMessage>Loading attendance…</StateMessage>
        ) : error ? (
          <StateMessage error>{error}</StateMessage>
        ) : records.length === 0 ? (
          <StateMessage>No attendance records for this month.</StateMessage>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {canViewAllAttendance && <th>Employee</th>}
                  <th>Date</th>
                  <th>Shift</th>
                  <th>First in</th>
                  <th>Last out</th>
                  <th>Proof</th>
                  <th>Hours</th>
                  <th>Attendance</th>
                  <th>Punctuality</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {records.map((item) => (
                  <tr key={item._id}>
                    {canViewAllAttendance && <td className="attendance-employee-cell"><strong>{item.employee ? `${item.employee.firstName || ""} ${item.employee.lastName || ""}`.trim() : "Deleted employee"}</strong>{item.employee?.employeeCode && <small>{item.employee.employeeCode}</small>}</td>}
                    <td>
                      <strong>{formatDate(item.date)}</strong>
                    </td>
                    <td>General shift</td>
                    <td>{formatTime(item.checkIn?.time)}</td>
                    <td>{formatTime(item.checkOut?.time)}</td>
                    <td>
                      <div className="proof-thumbnails">
                        {item.checkIn?.photo && (
                          <button
                            title="View check-in photo"
                            onClick={() =>
                              setViewingPhoto({
                                src: item.checkIn.photo,
                                label: `Check-in · ${formatTime(item.checkIn.time)}`,
                              })
                            }
                          >
                            <img
                              src={item.checkIn.photo}
                              alt="Check-in proof"
                            />
                          </button>
                        )}
                        {item.checkOut?.photo && (
                          <button
                            title="View check-out photo"
                            onClick={() =>
                              setViewingPhoto({
                                src: item.checkOut.photo,
                                label: `Check-out · ${formatTime(item.checkOut.time)}`,
                              })
                            }
                          >
                            <img
                              src={item.checkOut.photo}
                              alt="Check-out proof"
                            />
                          </button>
                        )}
                        {!item.checkIn?.photo && <span>—</span>}
                      </div>
                    </td>
                    <td>
                      {Math.floor(item.workingMinutes / 60)}h{" "}
                      {item.workingMinutes % 60}m
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{punctualityFor(item) ? <StatusBadge status={punctualityFor(item)} label={punctualityLabel(item)} /> : <span>—</span>}</td>
                    <td>
                      <div className="attendance-row-actions">
                        <button className="table-action" onClick={() => setSelected(item)}>View</button>
                        {item.status === "missing_checkout" && item.checkOut?.source === "system_auto" && !canReviewCorrections && !pendingCorrectionIds.has(String(item._id)) && (
                          <button className="correction-button" onClick={() => openCorrection(item)}>Correct checkout</button>
                        )}
                        {pendingCorrectionIds.has(String(item._id)) && <StatusBadge status="pending" />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {(faceRequests.length > 0 || canReviewFaceRequests) && (
        <section className="content-card attendance-corrections-card" id="face-checkin-approvals">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Biometric attendance exceptions</p>
              <h2>{canReviewFaceRequests ? `Manual attendance approvals${pendingFaceRequests.length ? ` (${pendingFaceRequests.length})` : ""}` : "My manual attendance requests"}</h2>
            </div>
          </div>
          {faceRequests.length === 0 ? <StateMessage>No manual attendance requests.</StateMessage> : (
            <div className="attendance-correction-list face-request-list">
              {faceRequests.map((request) => (
                <article key={request._id}>
                  <span className="approval-avatar face-request-photo" title={request.biometricAttempt?.photoAvailable ? "Private proof available" : "No proof photo attached"}>
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <strong>{request.employee?.firstName ? `${request.employee.firstName} ${request.employee.lastName || ""}` : "My attendance request"} · {request.action?.replace('_','-')}</strong>
                    <span>{formatDate(request.requestedAt || request.attemptedAt)} · Requested {formatTime(request.requestedAt || request.attemptedAt)} · Match {Math.round((request.faceMatchScore || 0) * 100)}%</span>
                    <p>{request.reasonLabel || request.reason}{request.remarks ? ` — ${request.remarks}` : ''} · {request.locationVerified?'Location verified':'Location exception'} · {request.riskLevel || 'normal'} risk</p>
                    {request.reviewNote && <small>Review note: {request.reviewNote}</small>}
                  </div>
                  <StatusBadge status={request.status} />
                  {canReviewFaceRequests && request.status === "pending" && <div className="correction-review-actions">
                    <button className="reject-button" disabled={correctionBusy} onClick={() => reviewFaceRequest(request, "reject")}>Reject</button>
                    <button className="approve-button" disabled={correctionBusy} onClick={() => reviewFaceRequest(request, "approve")}><Check size={13} /> Approve {request.action?.replace('_','-')}</button>
                  </div>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="content-card work-arrangements-card" id="work-mode-approvals">
        <div className="section-heading">
          <div><p className="eyebrow">Flexible attendance</p><h2>{canReviewArrangements ? "Work-mode approvals" : "My work-mode requests"}</h2></div>
          <button className="secondary-button" onClick={()=>setArrangementOpen(true)}><Plus size={15}/> New request</button>
        </div>
        {orderedArrangements.length===0?<StateMessage>No work-from-home, client-location, or field-visit requests yet.</StateMessage>:<div className="attendance-correction-list work-arrangement-list">{orderedArrangements.map(request=><article key={request._id}>
          <div><strong>{request.employee?.firstName?`${request.employee.firstName} ${request.employee.lastName||""}`:"My request"} · {request.type.replaceAll("_"," ")}</strong><span>{formatDate(request.startDate)} to {formatDate(request.endDate)} · {request.startTime}–{request.endTime}</span><p>{request.reason}{request.clientName?` · ${request.clientName}`:""}</p></div>
          <StatusBadge status={request.status}/>
          {canReviewArrangements&&request.status==="pending"&&<div className="correction-review-actions"><button className="reject-button" disabled={arrangementBusy} onClick={()=>reviewArrangement(request,"reject")}>Reject</button><button className="approve-button" disabled={arrangementBusy} onClick={()=>reviewArrangement(request,"approve")}><Check size={13}/> Approve</button></div>}
        </article>)}</div>}
      </section>
      {corrections.length > 0 && (
        <section className="content-card attendance-corrections-card">
          <div className="section-heading">
            <div><p className="eyebrow">Attendance corrections</p><h2>{canReviewCorrections ? "Correction approvals" : "My correction requests"}</h2></div>
          </div>
          <div className="attendance-correction-list">
            {corrections.map((request) => (
              <article key={request._id}>
                <div>
                  <strong>{request.employee?.firstName ? `${request.employee.firstName} ${request.employee.lastName || ""}` : "My attendance"}</strong>
                  <span>{formatDate(request.attendance?.date)} · Requested checkout {formatTime(request.requestedCheckoutTime)}</span>
                  <p>{request.reason}</p>
                </div>
                <StatusBadge status={request.status} />
                {canReviewCorrections && request.status === "pending" && <div className="correction-review-actions">
                  <button className="reject-button" disabled={correctionBusy} onClick={() => reviewCorrection(request, "reject")}>Reject</button>
                  <button className="approve-button" disabled={correctionBusy} onClick={() => reviewCorrection(request, "approve")}><Check size={13} /> Approve</button>
                </div>}
              </article>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <AttendanceDetailDrawer
          record={selected}
          close={() => setSelected(null)}
          viewPhoto={setViewingPhoto}
        />
      )}{" "}
      {viewingPhoto && (
        <PhotoViewer photo={viewingPhoto} close={() => setViewingPhoto(null)} />
      )}
      {arrangementOpen&&<div className="drawer-layer"><button className="drawer-backdrop" onClick={()=>setArrangementOpen(false)}/><aside className="form-drawer work-arrangement-drawer"><div className="drawer-heading"><div><p className="eyebrow">Flexible attendance</p><h2>Request a work mode</h2></div><button aria-label="Close work mode request" onClick={()=>setArrangementOpen(false)}><X size={20}/></button></div><form onSubmit={submitArrangement}><div className="work-arrangement-form-body">
        <label>Work mode *<select value={arrangementForm.type} onChange={e=>setArrangementForm({...arrangementForm,type:e.target.value})}><option value="wfh">Work from home</option><option value="client_location">Client location</option><option value="field_visit">Field visit / travelling</option></select></label>
        <div className="form-row"><label>From date *<input required type="date" value={arrangementForm.startDate} onChange={e=>setArrangementForm({...arrangementForm,startDate:e.target.value})}/></label><label>To date *<input required type="date" min={arrangementForm.startDate} value={arrangementForm.endDate} onChange={e=>setArrangementForm({...arrangementForm,endDate:e.target.value})}/></label></div>
        <div className="form-row"><label>Allowed from *<input required type="time" value={arrangementForm.startTime} onChange={e=>setArrangementForm({...arrangementForm,startTime:e.target.value})}/></label><label>Allowed until *<input required type="time" value={arrangementForm.endTime} onChange={e=>setArrangementForm({...arrangementForm,endTime:e.target.value})}/></label></div>
        {arrangementForm.type!=="wfh"&&<><label>Client / visit name *<input required value={arrangementForm.clientName} onChange={e=>setArrangementForm({...arrangementForm,clientName:e.target.value})} placeholder="Client or destination name"/></label><label>Destination address<input value={arrangementForm.destination.address} onChange={e=>setArrangementForm({...arrangementForm,destination:{...arrangementForm.destination,address:e.target.value}})} placeholder="Visit address"/></label></>}
        <button type="button" className="secondary-button location-capture-button" disabled={arrangementBusy} onClick={captureDestination}><MapPin size={15}/> {arrangementForm.destination.latitude?`Current location saved: ${arrangementForm.destination.latitude}, ${arrangementForm.destination.longitude}`:arrangementForm.type==="wfh"?"Use my current location for WFH":"Use my current location as destination"}</button>
        <label>Approved location radius (metres)<input required type="number" min="25" max="10000" value={arrangementForm.destination.allowedRadiusMeters} onChange={e=>setArrangementForm({...arrangementForm,destination:{...arrangementForm.destination,allowedRadiusMeters:e.target.value}})}/></label>
        <label>Reason *<textarea required minLength="10" maxLength="1000" rows="5" value={arrangementForm.reason} onChange={e=>setArrangementForm({...arrangementForm,reason:e.target.value})} placeholder="Explain why this work arrangement is required"/></label>
        <div className="arrangement-policy-note"><ShieldCheck size={17}/><span>Attendance is enabled only after approval. GPS, live face verification, and the enrolled identity match remain mandatory.</span></div></div>
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setArrangementOpen(false)}>Cancel</button><button className="primary-button" disabled={arrangementBusy}>{arrangementBusy?"Submitting…":"Send for approval"}</button></div>
      </form></aside></div>}
      {correctionRecord && (
        <div className="drawer-layer">
          <button className="drawer-backdrop" onClick={() => setCorrectionRecord(null)} />
          <aside className="form-drawer attendance-correction-drawer">
            <div className="drawer-heading">
              <div><p className="eyebrow">Missing checkout</p><h2>Request attendance correction</h2></div>
              <button onClick={() => setCorrectionRecord(null)}><X size={20} /></button>
            </div>
            <form onSubmit={submitCorrection}>
              <div className="auto-checkout-note"><Clock3 size={17} /><div><strong>System Auto Checkout</strong><span>The record was closed at the configured shift end because no checkout was received.</span></div></div>
              <label>Actual checkout date and time *<input required type="datetime-local" value={correctionForm.requestedCheckoutTime} onChange={(e) => setCorrectionForm({ ...correctionForm, requestedCheckoutTime: e.target.value })} /></label>
              <label>Correction reason *<textarea required minLength="10" maxLength="1000" rows="5" value={correctionForm.reason} onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })} placeholder="Explain why checkout was missed and confirm the actual checkout time" /></label>
              <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setCorrectionRecord(null)}>Cancel</button><button className="primary-button" disabled={correctionBusy}>{correctionBusy ? "Submitting…" : "Send correction request"}</button></div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

function AttendanceDetailDrawer({ record, close, viewPhoto }) {
  const location =
    record.checkIn?.latitude != null
      ? `${record.checkIn.latitude.toFixed(6)}, ${record.checkIn.longitude.toFixed(6)}`
      : "Not captured";
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={close} />
      <aside className="attendance-detail-drawer">
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">Attendance details</p>
            <h2>{formatDate(record.date)}</h2>
          </div>
          <button onClick={close}>
            <X size={20} />
          </button>
        </div>
        <div className="attendance-detail-status">
          <StatusBadge status={record.status} />
          {punctualityFor(record) && <StatusBadge status={punctualityFor(record)} label={punctualityLabel(record, true)} />}
          <span>{record.checkOut?.source === "system_auto" ? "System Auto Checkout · Configured shift end" : record.checkOut?.source === "hr_correction" ? "HR-approved corrected checkout" : "General shift · 10:00 AM – 6:30 PM"}</span>
        </div>
        <div className="attendance-time-grid">
          <div>
            <span>Check in</span>
            <strong>{formatTime(record.checkIn?.time)}</strong>
          </div>
          <div>
            <span>Check out</span>
            <strong>{formatTime(record.checkOut?.time)}</strong>
          </div>
          <div>
            <span>Effective hours</span>
            <strong>
              {Math.floor(record.workingMinutes / 60)}h{" "}
              {record.workingMinutes % 60}m
            </strong>
          </div>
          <div>
            <span>Location</span>
            <strong>
              {record.locationVerified ? "Verified" : "Unverified"}
            </strong>
          </div>
        </div>
        <section className="attendance-photos">
          <div>
            <div className="photo-heading">
              <span>Check-in photo</span>
              <small>{formatTime(record.checkIn?.time)}</small>
            </div>
            {record.checkIn?.photo ? (
              <button
                className="photo-view-button"
                onClick={() =>
                  viewPhoto({
                    src: record.checkIn.photo,
                    label: `Check-in · ${formatTime(record.checkIn.time)}`,
                  })
                }
              >
                <img
                  src={record.checkIn.photo}
                  alt="Employee check-in capture"
                />
                <span>View full photo</span>
              </button>
            ) : (
              <div className="photo-empty">
                <UserRound size={25} /> No check-in photo
              </div>
            )}
          </div>
          <div>
            <div className="photo-heading">
              <span>Check-out photo</span>
              <small>{formatTime(record.checkOut?.time)}</small>
            </div>
            {record.checkOut?.photo ? (
              <button
                className="photo-view-button"
                onClick={() =>
                  viewPhoto({
                    src: record.checkOut.photo,
                    label: `Check-out · ${formatTime(record.checkOut.time)}`,
                  })
                }
              >
                <img
                  src={record.checkOut.photo}
                  alt="Employee check-out capture"
                />
                <span>View full photo</span>
              </button>
            ) : (
              <div className="photo-empty">
                <UserRound size={25} /> No check-out photo
              </div>
            )}
          </div>
        </section>
        <div className="location-detail">
          <span>Captured coordinates</span>
          <strong>{location}</strong>
          {record.checkIn?.address && <small>{record.checkIn.address}</small>}
        </div>
      </aside>
    </div>
  );
}

function PhotoViewer({ photo, close }) {
  useEffect(() => {
    const escape = (event) => event.key === "Escape" && close();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);
  return (
    <div className="photo-lightbox">
      <button className="photo-lightbox-backdrop" onClick={close} />
      <div className="photo-lightbox-content">
        <div>
          <span>{photo.label}</span>
          <button onClick={close} aria-label="Close photo">
            <X size={21} />
          </button>
        </div>
        <img src={photo.src} alt={photo.label} />
      </div>
    </div>
  );
}

function LeaveDrawer({ close, saved, balance }) {
  const defaultLeaveType = balance?.plan?.canApplyPaidLeave ? "paid_leave" : "unpaid_leave";
  const [form, setForm] = useState({
      leaveType: defaultLeaveType,
      startDate: "",
      endDate: "",
      reason: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canApplyPaid = Boolean(balance?.plan?.canApplyPaidLeave);
  const workingDays = useMemo(() => {
    if (!form.startDate || !form.endDate) return 0;
    const s = new Date(form.startDate); const e = new Date(form.endDate);
    if (e < s) return 0;
    let count = 0; const cur = new Date(s);
    while (cur <= e) { const d = cur.getDay(); if (d !== 0 && d !== 6) count += 1; cur.setDate(cur.getDate() + 1); }
    return count;
  }, [form.startDate, form.endDate]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDateObj = form.startDate ? new Date(form.startDate) : null;
  const calendarNoticeDays = startDateObj ? Math.max(0, Math.ceil((startDateObj - today) / (1000 * 60 * 60 * 24))) : 0;
  const isLongLeave = workingDays >= 4;
  const longLeaveNoticeOk = !isLongLeave || calendarNoticeDays >= 10;
  const approvalChain = useMemo(() => isLongLeave ? ["Manager", "HR", "Super Admin"] : ["Manager", "HR"], [isLongLeave]);
  const paymentPreview = useMemo(() => {
    const mode = form.leaveType === "unpaid_leave" ? "unpaid" : "paid";
    if (mode === "unpaid") return { mode: "unpaid", paid: 0, unpaid: workingDays };
    const available = Number(balance?.paidAvailable || 0);
    const paid = Math.min(available, workingDays);
    const unpaid = Math.max(0, workingDays - paid);
    return { mode: unpaid === workingDays ? "unpaid" : paid === workingDays ? "paid" : "partially_paid", paid, unpaid };
  }, [workingDays, form.leaveType, balance]);
  async function submit(event) {
    event.preventDefault();
    if (form.leaveType === "paid_leave" && !canApplyPaid) {
      setError("Paid leaves are locked until your probation is confirmed. Please select unpaid leave.");
      return;
    }
    if (isLongLeave && !longLeaveNoticeOk) {
      setError(`4+ working days require applying at least 10 days in advance. You are ${10 - calendarNoticeDays} day(s) short.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      saved(await leaveApi.create(form));
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={close} />
      <aside className="form-drawer leave-drawer">
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">New request</p>
            <h2>Apply for leave</h2>
          </div>
          <button onClick={close} aria-label="Close"><X size={20} /></button>
        </div>

        {!canApplyPaid && (
          <div className="leave-policy-banner probation-banner">
            <Clock3 size={16} />
            <div>
              <strong>Paid leave eligibility</strong>
              <span>{balance?.plan?.blockedReason || "Paid leaves unlock once HR confirms your probation. You can still apply for unpaid leave."}</span>
            </div>
          </div>
        )}

        <form onSubmit={submit}>
          <label>
            Leave type
            <select
              value={form.leaveType}
              onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
            >
              <option value="paid_leave" disabled={!canApplyPaid}>Paid leave ({balance?.paidAvailable ?? 0} available)</option>
              <option value="unpaid_leave">Unpaid leave</option>
            </select>
          </label>
          <div className="form-row">
            <label>
              From
              <input
                type="date"
                required
                value={form.startDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                required
                value={form.endDate}
                min={form.startDate || new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </label>
          </div>

          {(workingDays > 0 || form.startDate) && (
            <div className="leave-preview-card">
              <div className="leave-preview-row">
                <span>Working days</span>
                <strong>{workingDays} day{workingDays === 1 ? "" : "s"}</strong>
              </div>
              <div className="leave-preview-row">
                <span>Payment split</span>
                <strong>
                  {paymentPreview.paid > 0 && `${paymentPreview.paid} paid`}
                  {paymentPreview.unpaid > 0 && `${paymentPreview.paid ? " · " : ""}${paymentPreview.unpaid} unpaid`}
                  {!paymentPreview.paid && !paymentPreview.unpaid && "—"}
                </strong>
              </div>
              <div className="leave-preview-row">
                <span>Advance notice</span>
                <strong className={isLongLeave && !longLeaveNoticeOk ? "error" : ""}>
                  {calendarNoticeDays} day{calendarNoticeDays === 1 ? "" : "s"}
                </strong>
              </div>
              <div className="leave-preview-row approval-chain-row">
                <span>Approval chain</span>
                <div className="approval-chain">
                  {approvalChain.map((role, idx) => (
                    <span key={role} className={`chain-step ${idx === 0 ? "current" : ""}`}>
                      {role}
                    </span>
                  ))}
                </div>
              </div>
              {isLongLeave && !longLeaveNoticeOk && (
                <p className="leave-rule-error">
                  4+ leaves must be applied 10 days before. Your leave starts in {calendarNoticeDays} day(s).
                </p>
              )}
            </div>
          )}

          <label>
            Reason
            <textarea
              required
              minLength={5}
              rows="5"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Tell your manager why you need time away, plus coverage plan if possible."
            />
          </label>
          {error && <StateMessage error>{error}</StateMessage>}
          <div className="drawer-actions">
            <button type="button" className="secondary-button" onClick={close}>Cancel</button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function LeaveRequestCard({ item, currentUser, onReview }) {
  const canReview = ["super_admin", "admin", "hr_admin", "manager"].includes(currentUser?.role);
  const pending = item.status === "pending";
  const nextRole = item.workflow?.nextRole;
  const isMyTurn = (
    pending && (
      (currentUser?.role === "manager" && nextRole === "manager") ||
      (currentUser?.role === "hr_admin" && nextRole === "hr_admin") ||
      (["super_admin", "admin"].includes(currentUser?.role) && nextRole === "super_admin")
    )
  );
  const [note, setNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(null);
  async function review(decision) {
    if (decision === "reject" && note.trim().length < 3) {
      alert("A rejection reason is required.");
      return;
    }
    setReviewBusy(decision);
    try {
      await onReview(item._id, decision, note);
      setNote("");
    } finally {
      setReviewBusy(null);
    }
  }
  const leaveTypeLabel = item.leaveType === "paid_leave" ? "Paid leave" : item.leaveType === "unpaid_leave" ? "Unpaid leave" : capitalize(item.leaveType);
  const payments = item.payments || {};
  const workflowSteps = item.workflow?.steps || [];
  const requiredSteps = item.workflow?.requiredSteps || [];
  const employeeName = item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : "";
  return (
    <article className="leave-request-card">
      <header className="leave-card-header">
        <div className="leave-card-left">
          <span className={`request-icon ${item.leaveType === "unpaid_leave" ? "unpaid" : ""}`}>
            <Plane size={17} />
          </span>
          <div>
            <strong>{leaveTypeLabel}</strong>
            {employeeName && <small>by {employeeName}</small>}
            <span>
              {formatDate(item.startDate)} – {formatDate(item.endDate)} · {item.workingDays || item.days} working day{(item.workingDays || item.days) === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="leave-card-right">
          <StatusBadge status={item.status} />
          {item.policySnapshot?.longLeave?.isLongLeave && (
            <span className="soft-badge purple">Long leave · 3-level</span>
          )}
        </div>
      </header>

      <div className="leave-card-body">
        <p className="leave-reason">{item.reason}</p>

        {(payments.paidDays || payments.unpaidDays) && (
          <div className="leave-payment-strip">
            {payments.paidDays > 0 && <span><i className="paid-dot" /> {payments.paidDays} paid</span>}
            {payments.unpaidDays > 0 && <span><i className="unpaid-dot" /> {payments.unpaidDays} unpaid</span>}
            <span className="balance-note">Balance: {payments.balanceAfter ?? "—"} left</span>
          </div>
        )}

        {requiredSteps.length > 0 && (
          <div className="workflow-timeline">
            {requiredSteps.map((role, idx) => {
              const step = workflowSteps.find(s => s.role === role) || { status: "pending" };
              const label = { manager: "Manager", hr_admin: "HR", super_admin: "Admin / Super Admin" }[role] || capitalize(role);
              return (
                <div key={role} className={`wf-step wf-${step.status}`}>
                  <i className={`wf-dot ${step.status}`} />
                  <span className="wf-label">{label}</span>
                  {idx < requiredSteps.length - 1 && <span className="wf-connector" />}
                </div>
              );
            })}
          </div>
        )}

        {pending && nextRole && (
          <p className="next-approver-line">
            Next: <strong>{nextRole === "manager" ? "Manager" : nextRole === "hr_admin" ? "HR Admin" : "Admin / Super Admin"}</strong>
          </p>
        )}

      </div>

      {canReview && isMyTurn && (
        <footer className="leave-card-actions">
          <textarea
            rows="2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a comment (required when rejecting)"
          />
          <div className="action-buttons-row">
            <button className="reject-button" disabled={Boolean(reviewBusy)} onClick={() => review("reject")}>
              {reviewBusy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button className="approve-button" disabled={Boolean(reviewBusy)} onClick={() => review("approve")}>
              <Check size={14} /> {reviewBusy === "approve" ? "Approving…" : "Approve"}
            </button>
          </div>
        </footer>
      )}
    </article>
  );
}

export function LeavePage({ user }) {
  const [requests, setRequests] = useState([]),
    [balance, setBalance] = useState(null),
    [drawer, setDrawer] = useState(false),
    [scope, setScope] = useState("mine"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const scopes = useMemo(() => {
    const items = [{ value: "mine", label: "My leave" }];
    if (user?.role === "manager") items.push({ value: "team", label: "Team" });
    if (["hr_admin", "admin", "super_admin"].includes(user?.role)) {
      items.push({ value: "approvals", label: "Approvals" });
      items.push({ value: "all", label: "All" });
    }
    return items;
  }, [user?.role]);
  useEffect(() => {
    let active = true;
    Promise.all([
      leaveApi.balance(),
      leaveApi.list(scope),
    ]).then(([b, r]) => {
      if (!active) return;
      if (b) setBalance(b);
      if (Array.isArray(r)) setRequests(r);
    }).catch(e => {
      if (active) setError(e.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [scope]);
  async function review(id, decision, reviewNote) {
    try {
      const updated = await leaveApi.review(id, decision, reviewNote);
      setRequests(value => value.map(item => item._id === id ? { ...item, ...updated } : item));
    } catch (e) {
      setError(e.message);
    }
  }
  const paidPct = balance && balance.paidEntitled > 0 ? Math.min(100, Math.round((balance.paidUsed / balance.paidEntitled) * 100)) : 0;
  const probationConfirmed = Boolean(balance?.probation?.confirmationStatus === "confirmed");
  return (
    <>
      <PageHeader
        eyebrow="Time off"
        title="Leave"
        description="Plan time away and track your leave applications."
        action={
          <button className="primary-button" onClick={() => setDrawer(true)}>
            <Plus size={16} /> Apply leave
          </button>
        }
      />

      {scopes.length > 1 && (
        <div className="leave-scope-tabs">
          {scopes.map(tab => (
            <button key={tab.value} className={scope === tab.value ? "active" : ""} onClick={() => { setLoading(true); setError(""); setScope(tab.value); }}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {!probationConfirmed && balance && (
        <div className="probation-notice-card">
          <Clock3 size={18} />
          <div>
            <strong>Probation in progress</strong>
            <span>{balance.plan?.blockedReason || "Your paid leave balance unlocks once HR confirms your probation."}</span>
          </div>
        </div>
      )}

      <div className="leave-balances">
        <div>
          <span className="balance-icon teal"><Plane size={18} /></span>
          <span>Paid leave {balance?.plan?.fyLabel ? `· ${balance.plan.fyLabel}` : ""}</span>
          <strong>
            {balance?.paidAvailable ?? 0} <small>days</small>
          </strong>
          <div className="balance-meter">
            <i style={{ width: `${paidPct}%` }} />
          </div>
          <small>Used {balance?.paidUsed ?? 0} · Entitled {balance?.paidEntitled ?? 0}</small>
        </div>
        <div>
          <span className="balance-icon purple"><FileText size={18} /></span>
          <span>Unpaid leave taken</span>
          <strong>
            {balance?.unpaidApprovedCount ?? 0} <small>request(s)</small>
          </strong>
          <small style={{ visibility: "hidden" }}>—</small>
        </div>
        <div>
          <span className="balance-icon amber"><UsersRound size={18} /></span>
          <span>Reporting to</span>
          <strong style={{ fontSize: 14 }}>
            {balance?.manager ? `${balance.manager.firstName} ${balance.manager.lastName}` : "Not assigned"}
          </strong>
          {balance?.manager && <small>{balance.manager.employeeCode}</small>}
        </div>
      </div>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>{scope === "mine" ? "My leave requests" : scope === "team" ? "Team leave requests" : scope === "approvals" ? "Leave for your review" : "All leave requests"}</h2>
          </div>
        </div>
        {error && <StateMessage error>{error}</StateMessage>}
        {loading ? (
          <StateMessage>Loading requests…</StateMessage>
        ) : requests.length === 0 ? (
          <StateMessage>
            No leave requests yet. Your applications will appear here.
          </StateMessage>
        ) : (
          <div className="request-list leave-cards-list">
            {requests.map((item) => (
              <LeaveRequestCard
                key={item._id}
                item={item}
                currentUser={user}
                onReview={review}
              />
            ))}
          </div>
        )}
      </section>

      {drawer && (
        <LeaveDrawer
          balance={balance}
          close={() => setDrawer(false)}
          saved={(request) => {
            setRequests(value => [request, ...value]);
            leaveApi.balance().then(setBalance).catch(() => {});
          }}
        />
      )}
    </>
  );
}

export function RequestsPage({ user }) {
  const canReview = ["super_admin", "admin", "hr_admin", "manager"].includes(user.role);
  const [requests, setRequests] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    leaveApi
      .list(canReview ? "all" : "mine")
      .then(setRequests)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [canReview]);
  async function review(id, decision, note = "") {
    try {
      const updated = await leaveApi.review(id, decision, note);
      setRequests((value) =>
        value.map((item) => (item._id === id ? { ...item, ...updated } : item)),
      );
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Requests"
        description={
          canReview
            ? "Review employee requests and keep work moving."
            : "Track the progress of requests you have submitted."
        }
      />
      <section className="content-card request-inbox">
        {error && <StateMessage error>{error}</StateMessage>}
        {loading ? (
          <StateMessage>Loading inbox…</StateMessage>
        ) : requests.length === 0 ? (
          <StateMessage>
            You’re all caught up. There are no requests to show.
          </StateMessage>
        ) : (
          <div className="request-list leave-cards-list">
            {requests.map((item) => (
              <LeaveRequestCard
                key={item._id}
                item={item}
                currentUser={user}
                onReview={review}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function PeoplePage({ user }) {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  function load(search = "") {
    setLoading(true);
    employeeApi
      .list(search)
      .then(setEmployees)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    employeeApi
      .list()
      .then(setEmployees)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  function search(event) {
    event.preventDefault();
    load(query);
  }
  async function exportEmployees() {
    setExporting(true);
    setError("");
    try {
      const { blob, fileName } = await employeeApi.exportExcel();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExporting(false);
    }
  }
  const canManagePeople = ['super_admin','admin','hr_admin'].includes(user?.role);
  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="People"
        description={`${employees.length} employees in your organization.`}
        action={canManagePeople ?
          <div className="attendance-page-actions">
            <button className="secondary-button" disabled={exporting} onClick={exportEmployees}>
              <Download size={16} /> {exporting ? "Exporting…" : "Export Excel"}
            </button>
            <button className="primary-button" onClick={() => navigate("/people/new")}>
              <Plus size={16} /> Add employee
            </button>
          </div>
        : null}
      />
      <section className="content-card">
        <div className="people-toolbar">
          <form onSubmit={search}>
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email or employee ID"
            />
          </form>
          <button className="secondary-button">
            <Filter size={15} /> Filters
          </button>
        </div>
        {error ? (
          <StateMessage error>{error}</StateMessage>
        ) : loading ? (
          <StateMessage>Loading employees…</StateMessage>
        ) : (
          <div className="employee-grid">
            {employees.map((employee) => (
              <article className="employee-card" key={employee._id}>
                <span className="employee-avatar">
                  {employee.firstName[0]}
                  {employee.lastName[0]}
                </span>
                <div>
                  <h3>
                    {employee.firstName} {employee.lastName}
                  </h3>
                  <p>{employee.employeeCode}</p>
                </div>
                <StatusBadge status={employee.employeeStatus} />
                <dl>
                  <div>
                    <dt>Department</dt>
                    <dd>{employee.department}</dd>
                  </div>
                  <div>
                    <dt>Designation</dt>
                    <dd>{employee.designation}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{employee.workLocation}</dd>
                  </div>
                </dl>
                {canManagePeople && <div className="employee-card-actions"><button onClick={() => navigate(`/people/${employee._id}/edit`)}>Edit details <ArrowRight size={14} /></button><button onClick={() => navigate(`/people/${employee._id}/biometrics`)}>Re-enroll face <ArrowRight size={14} /></button></div>}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function EmployeeEditPage({ employeeId, user }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [managers, setManagers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmModal, setConfirmModal] = useState(false);
  const [confirmForm, setConfirmForm] = useState({ reviewNote: "", confirmationDate: new Date().toISOString().slice(0, 10), updateEmploymentType: true });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    Promise.all([employeeApi.get(employeeId), employeeApi.list()])
      .then(([employee, list]) => {
        const joining = employee.joiningDate ? new Date(employee.joiningDate).toISOString().slice(0, 10) : "";
        const probationBase = employee.probation || { durationMonths: 3, expectedEndDate: null, confirmationStatus: "in_probation", confirmedAt: null, confirmationNote: "" };
        const autoExpected = probationBase.expectedEndDate
          ? new Date(probationBase.expectedEndDate).toISOString().slice(0, 10)
          : expectedProbationEnd(joining, probationBase.durationMonths || 3);
        setForm({
          ...employee,
          dateOfBirth: employee.dateOfBirth ? new Date(employee.dateOfBirth).toISOString().slice(0, 10) : "",
          joiningDate: joining,
          gender: employee.gender || "not_specified",
          shift: employee.shift || { name: "General Shift", startTime: "10:00", endTime: "18:30", graceMinutes: 15 },
          probation: { ...probationBase, expectedEndDate: autoExpected || probationBase.expectedEndDate },
          leavePlan: employee.leavePlan || { annualPaidLeaves: 18, cycleStartMonth: 4, accrualMode: "grant_on_confirmation" },
          manager: employee.manager ? (typeof employee.manager === "object" ? employee.manager._id : employee.manager) : "",
        });
        setManagers(list.filter(item => String(item._id) !== String(employeeId)));
      })
      .catch(requestError => setError(requestError.message));
  }, [employeeId]);
  const update = (field, value) => setForm(current => {
    const next = { ...current, [field]: value };
    if (field === "joiningDate" && next.probation) {
      const auto = expectedProbationEnd(value, next.probation.durationMonths);
      if (auto) next.probation = { ...next.probation, expectedEndDate: auto };
    }
    return next;
  });
  const updateNested = (root, field, value) => setForm(current => {
    const nextRoot = { ...current[root], [field]: value };
    const next = { ...current, [root]: nextRoot };
    if (root === "probation" && field === "durationMonths" && next.joiningDate) {
      const auto = expectedProbationEnd(next.joiningDate, value);
      if (auto) next.probation = { ...next.probation, expectedEndDate: auto };
    }
    return next;
  });
  const confirmProbationStatus = employeeApi && employeeApi.confirmProbation;
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        employeeCode: form.employeeCode.trim().toUpperCase(),
        firstName: form.firstName,
        lastName: form.lastName,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender,
        officialEmail: form.officialEmail,
        personalEmail: form.personalEmail || "",
        mobile: form.mobile || "",
        department: form.department || "General",
        designation: form.designation || "Employee",
        branch: form.branch || "Head Office",
        workLocation: form.workLocation || "Main Office",
        joiningDate: form.joiningDate,
        employmentType: form.employmentType,
        employeeStatus: form.employeeStatus,
        manager: form.manager || null,
        probation: form.probation,
        leavePlan: form.leavePlan,
        shift: { ...form.shift, graceMinutes: Number(form.shift.graceMinutes) },
      };
      await employeeApi.update(employeeId, payload);
      navigate("/people");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmProbation() {
    setConfirming(true);
    setError("");
    try {
      const updated = await employeeApi.confirmProbation(employeeId, confirmForm);
      setForm(current => ({ ...current, probation: updated.probation, employmentType: updated.employmentType }));
      setConfirmModal(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setConfirming(false);
    }
  }
  if (error && !form) return <><button className="back-link" onClick={() => navigate("/people")}><ArrowLeft size={15} /> Back to employees</button><StateMessage error>{error}</StateMessage></>;
  if (!form) return <StateMessage>Loading employee details…</StateMessage>;
  const probationStatus = form.probation?.confirmationStatus || "in_probation";
  const confirmed = probationStatus === "confirmed";
  const canConfirm = ["super_admin", "hr_admin"].includes(user?.role) && !confirmed && confirmProbationStatus;
  const selectedManager = typeof form.manager === "object" ? form.manager?._id : form.manager;
  return (
    <>
      <button className="back-link" onClick={() => navigate("/people")}>
        <ArrowLeft size={15} /> Back to employees
      </button>
      <PageHeader
        eyebrow="People · Employee record"
        title={`Edit ${form.firstName} ${form.lastName}`}
        description={`${form.employeeCode} · Update personal, employment and shift details.`}
      />
      <form className="onboarding-form employee-edit-form" onSubmit={save}>
        <aside className="onboarding-steps">
          <div className="active"><span>01</span><div><strong>Personal details</strong><small>Identity and contact information</small></div></div>
          <div><span>02</span><div><strong>Job & Manager</strong><small>Reporting, role, probation</small></div></div>
          <div><span>03</span><div><strong>Shift & Leave plan</strong><small>Schedule and benefits</small></div></div>
        </aside>
        <div className="onboarding-content">
          <section className="form-section">
            <div className="form-section-title">
              <span><UserRound size={18} /></span>
              <div><h2>Personal details</h2><p>Fields used in the employee profile and workforce dashboard.</p></div>
            </div>
            <div className="field-grid">
              <label>Employee number *<input required value={form.employeeCode} onChange={e => update("employeeCode", e.target.value.toUpperCase())} /></label>
              <label>Gender *
                <select required value={form.gender} onChange={e => update("gender", e.target.value)}>
                  <option value="not_specified">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non_binary">Non-binary</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </label>
              <label>First name *<input required value={form.firstName} onChange={e => update("firstName", e.target.value)} /></label>
              <label>Last name *<input required value={form.lastName} onChange={e => update("lastName", e.target.value)} /></label>
              <label>Date of birth<input type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={e => update("dateOfBirth", e.target.value)} /></label>
              <label>Mobile<input value={form.mobile || ""} onChange={e => update("mobile", e.target.value)} /></label>
              <label>Official email *<input required type="email" value={form.officialEmail} onChange={e => update("officialEmail", e.target.value)} /></label>
              <label>Personal email<input type="email" value={form.personalEmail || ""} onChange={e => update("personalEmail", e.target.value)} /></label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title">
              <span><BriefcaseBusiness size={18} /></span>
              <div><h2>Job & Manager</h2><p>Reporting structure and employment configuration.</p></div>
            </div>
            <div className="field-grid">
              <label>Department<input value={form.department || ""} onChange={e => update("department", e.target.value)} /></label>
              <label>Designation<input value={form.designation || ""} onChange={e => update("designation", e.target.value)} /></label>
              <label>Branch<input value={form.branch || ""} onChange={e => update("branch", e.target.value)} /></label>
              <label>Work location<input value={form.workLocation || ""} onChange={e => update("workLocation", e.target.value)} /></label>
              <label>Joining date *<input required type="date" value={form.joiningDate} onChange={e => update("joiningDate", e.target.value)} /></label>
              <label>Employment type
                <select value={form.employmentType} onChange={e => update("employmentType", e.target.value)}>
                  <option value="permanent">Permanent</option>
                  <option value="probation">Probation</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                  <option value="consultant">Consultant</option>
                </select>
              </label>
              <label>Employee status
                <select value={form.employeeStatus} onChange={e => update("employeeStatus", e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="notice_period">Notice period</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </label>
              <label>Reporting manager
                <select value={selectedManager || ""} onChange={e => update("manager", e.target.value || null)}>
                  <option value="">No manager assigned</option>
                  {managers.map(m => (
                    <option key={m._id} value={m._id}>
                      {m.firstName} {m.lastName} · {m.designation || "Employee"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <div className="field-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
                <label>
                  Probation duration (months)
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={form.probation?.durationMonths ?? 3}
                    disabled={confirmed}
                    onChange={e => updateNested("probation", "durationMonths", Math.max(1, Math.min(24, Number(e.target.value) || 0)))}
                  />
                </label>
                <label>
                  Expected probation end (auto-calculated)
                  <input
                    type="date"
                    value={form.probation?.expectedEndDate || expectedProbationEnd(form.joiningDate, form.probation?.durationMonths || 3)}
                    disabled
                    aria-readonly="true"
                    title="Joining date + probation duration months"
                  />
                </label>
              </div>
              <div className={`probation-card ${confirmed ? "confirmed" : ""}`}>
                <div className="probation-card-header">
                  <div>
                    <p className="eyebrow">Probation tracking</p>
                    <h3>{form.probation?.durationMonths || 0} months · Ends {form.probation?.expectedEndDate ? formatDate(form.probation.expectedEndDate) : "—"}</h3>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <StatusBadge status={confirmed ? "approved" : "pending"} label={confirmed ? "Confirmed" : capitalize(probationStatus.replace("_", " "))} />
                    {canConfirm && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => {
                          const autoDate = expectedProbationEnd(form.joiningDate, form.probation?.durationMonths || 3);
                          const today = new Date().toISOString().slice(0, 10);
                          setConfirmForm({
                            reviewNote: confirmForm.reviewNote,
                            confirmationDate: autoDate || today,
                            updateEmploymentType: confirmForm.updateEmploymentType ?? true,
                          });
                          setConfirmModal(true);
                        }}
                      >
                        <Check size={14} /> Confirm probation
                      </button>
                    )}
                  </div>
                </div>
                <div className="probation-meta">
                  <div>
                    <span>Status</span>
                    <strong>{capitalize(probationStatus.replaceAll("_", " "))}</strong>
                  </div>
                  <div>
                    <span>Confirmed on</span>
                    <strong>{form.probation?.confirmedAt ? formatDate(form.probation.confirmedAt) : "—"}</strong>
                  </div>
                  <div>
                    <span>Confirmation note</span>
                    <strong>{form.probation?.confirmationNote || "No notes yet."}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title">
              <span><Clock3 size={18} /></span>
              <div><h2>Shift & Leave plan</h2><p>Working schedule and annual paid leave configuration.</p></div>
            </div>
            <div className="field-grid">
              <label>Shift name<input required value={form.shift.name} onChange={e => updateNested("shift", "name", e.target.value)} /></label>
              <label>Grace period (minutes)<input required type="number" min="0" max="180" value={form.shift.graceMinutes} onChange={e => updateNested("shift", "graceMinutes", e.target.value)} /></label>
              <label>Start time<input required type="time" value={form.shift.startTime} onChange={e => updateNested("shift", "startTime", e.target.value)} /></label>
              <label>End time<input required type="time" value={form.shift.endTime} onChange={e => updateNested("shift", "endTime", e.target.value)} /></label>
              <label>Annual paid leaves<input type="number" min="0" max="60" value={form.leavePlan.annualPaidLeaves} onChange={e => updateNested("leavePlan", "annualPaidLeaves", Number(e.target.value))} /></label>
              <label>FY start month
                <select value={form.leavePlan.cycleStartMonth} onChange={e => updateNested("leavePlan", "cycleStartMonth", Number(e.target.value))}>
                  {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((label, idx) => (
                    <option key={idx + 1} value={idx + 1}>{label}</option>
                  ))}
                </select>
              </label>
              <label>Accrual mode
                <select value={form.leavePlan.accrualMode} onChange={e => updateNested("leavePlan", "accrualMode", e.target.value)}>
                  <option value="grant_on_confirmation">Grant on probation confirmation (pro-rated)</option>
                  <option value="monthly_1_5">Monthly accrual 1.5 days</option>
                </select>
              </label>
            </div>
          </section>

          {error && <StateMessage error>{error}</StateMessage>}
          <div className="onboarding-actions">
            <button type="button" className="secondary-button" onClick={() => navigate("/people")}>Cancel</button>
            <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save employee details"}</button>
          </div>
        </div>
      </form>

      {confirmModal && (
        <div className="drawer-layer">
          <button className="drawer-backdrop" onClick={() => !confirming && setConfirmModal(false)} />
          <aside className="form-drawer">
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">HR action</p>
                <h2>Confirm probation</h2>
              </div>
              <button onClick={() => !confirming && setConfirmModal(false)} disabled={confirming}>
                <X size={20} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
              <div style={{ padding: 14, background: "#f2f8f6", border: "1px solid #dce9e5", borderRadius: 10 }}>
                <p style={{ fontSize: 9.5, margin: 0, color: "#52706a" }}>Employee</p>
                <strong style={{ fontSize: 11 }}>{form.firstName} {form.lastName} · {form.employeeCode}</strong>
              </div>
              <label>
                Confirmation date
                <input type="date" value={confirmForm.confirmationDate} onChange={e => setConfirmForm({ ...confirmForm, confirmationDate: e.target.value })} />
              </label>
              <label>
                Note for the employee
                <textarea rows="4" value={confirmForm.reviewNote} onChange={e => setConfirmForm({ ...confirmForm, reviewNote: e.target.value })} placeholder="Share confirmation highlights or welcome note (optional)" />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row", cursor: "pointer" }}>
                <input type="checkbox" checked={confirmForm.updateEmploymentType} onChange={e => setConfirmForm({ ...confirmForm, updateEmploymentType: e.target.checked })} />
                <span style={{ fontSize: 10.5 }}>Mark employment type as Permanent after confirmation</span>
              </label>
              {error && <StateMessage error>{error}</StateMessage>}
              <div className="drawer-actions">
                <button type="button" className="secondary-button" onClick={() => setConfirmModal(false)} disabled={confirming}>Cancel</button>
                <button type="button" className="primary-button" onClick={confirmProbation} disabled={confirming}>
                  {confirming ? "Confirming…" : "Confirm probation"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export function OrganizationChartPage() {
  const [employees,setEmployees]=useState([]),[search,setSearch]=useState(''),[department,setDepartment]=useState(''),[collapsed,setCollapsed]=useState(()=>new Set()),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;employeeApi.organizationChart().then(items=>{if(active)setEmployees(items)}).catch(requestError=>{if(active)setError(requestError.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
  const chart=useMemo(()=>{
    const employeeById=new Map(employees.map(item=>[String(item._id),item]));
    const normalizedSearch=search.trim().toLowerCase();
    const directMatches=employees.filter(item=>(!department||item.department===department)&&(!normalizedSearch||`${item.firstName||''} ${item.lastName||''} ${item.employeeCode||''} ${item.designation||''} ${item.department||''}`.toLowerCase().includes(normalizedSearch)));
    const visibleIds=new Set();
    directMatches.forEach(item=>{let current=item,guard=0;while(current&&guard++<=employees.length){const id=String(current._id);if(visibleIds.has(id))break;visibleIds.add(id);current=current.manager?employeeById.get(String(current.manager)):null}});
    const visible=employees.filter(item=>visibleIds.has(String(item._id)));
    const children=new Map();
    visible.forEach(item=>{const managerId=item.manager&&visibleIds.has(String(item.manager))?String(item.manager):'root';children.set(managerId,[...(children.get(managerId)||[]),item])});
    children.forEach(items=>items.sort((left,right)=>`${left.firstName||''} ${left.lastName||''}`.localeCompare(`${right.firstName||''} ${right.lastName||''}`)));
    let roots=children.get('root')||[];if(!roots.length&&visible.length)roots=visible;
    return {children,roots,visible,directMatchIds:new Set(directMatches.map(item=>String(item._id)))};
  },[employees,search,department]);
  const departments=useMemo(()=>[...new Set(employees.map(item=>item.department).filter(Boolean))].sort(),[employees]);
  const toggleBranch=id=>setCollapsed(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
  const clearFilters=()=>{setSearch('');setDepartment('')};
  const treeNode=(employee,level=0,trail=new Set())=>{
    const id=String(employee._id),nextTrail=new Set(trail).add(id),reports=(chart.children.get(id)||[]).filter(item=>!nextTrail.has(String(item._id))),isCollapsed=collapsed.has(id),isMatch=chart.directMatchIds.has(id);
    return <li key={id}><div className={`org-node${isMatch&&(search||department)?' is-match':''}`}><article className="org-person-card"><div className="org-card-top"><span className="org-level-label">Level {level+1}</span><i className={`org-status status-${employee.employeeStatus||'inactive'}`}>{capitalize(employee.employeeStatus)}</i></div><div className="org-person-main">{employee.profilePhoto?<img src={employee.profilePhoto} alt=""/>:<span className="org-avatar">{`${employee.firstName?.[0]||''}${employee.lastName?.[0]||''}`}</span>}<div><strong>{`${employee.firstName||''} ${employee.lastName||''}`.trim()||'Employee information unavailable'}</strong><small>{employee.designation||'Designation not assigned'}</small></div></div><div className="org-person-meta"><span>{employee.department||'Department not assigned'}</span><span>{employee.employeeCode||'No employee ID'}</span><span>{employee.workLocation||'Location not assigned'}</span></div><div className="org-report-count"><Network size={13}/><span>{reports.length} direct {reports.length===1?'report':'reports'}</span></div></article>{reports.length>0&&<button type="button" className="org-branch-toggle" onClick={()=>toggleBranch(id)} aria-label={`${isCollapsed?'Expand':'Collapse'} reports for ${employee.firstName||'employee'}`} aria-expanded={!isCollapsed}>{isCollapsed?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>}</div>{reports.length>0&&!isCollapsed&&<ul>{reports.map(item=>treeNode(item,level+1,nextTrail))}</ul>}</li>;
  };
  return <><PageHeader eyebrow="Team · Reporting structure" title="Organization Chart" description="Explore leadership, managers and reporting relationships across Ananttattva Private Limited."/><section className="card org-chart-card"><div className="org-chart-toolbar"><label><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search name, employee ID or role"/></label><select value={department} onChange={event=>setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(item=><option key={item}>{item}</option>)}</select>{(search||department)&&<button type="button" className="org-clear-filter" onClick={clearFilters}>Clear filters</button>}</div>{!loading&&!error&&<div className="org-chart-summary"><div><strong>{chart.visible.length}</strong><span>People shown</span></div><div><strong>{chart.roots.length}</strong><span>Top-level leaders</span></div><div><strong>{new Set(chart.visible.map(item=>item.department).filter(Boolean)).size}</strong><span>Departments</span></div><p><i/> Reporting line <small>Use the arrow below a manager to collapse or expand their team.</small></p></div>}{error?<StateMessage error>{error}</StateMessage>:loading?<StateMessage>Building organization tree…</StateMessage>:chart.visible.length?<div className="org-tree-viewport"><div className="org-forest">{chart.roots.map(root=><ul className="org-tree" key={root._id}>{treeNode(root)}</ul>)}</div></div>:<div className="empty-state"><Network size={28}/><strong>No organization relationships found</strong><span>{search||department?'No employees match the current filters.':'Assign reporting managers from employee profiles to build the chart.'}</span>{(search||department)&&<button className="secondary-button" onClick={clearFilters}>Clear filters</button>}</div>}</section></>;
}

export function EmployeeOnboardingPage({ user }) {
  const navigate = useNavigate();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(() => ({
    employeeCode: `EMP${String(Date.now()).slice(-5)}`,
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "not_specified",
    officialEmail: "",
    personalEmail: "",
    mobile: "",
    department: "",
    designation: "",
    branch: "Head Office",
    workLocation: "Main Office",
    joiningDate: todayIso,
    employmentType: "probation",
    employeeStatus: "active",
    manager: "",
    temporaryPassword: "Welcome@123",
    role: "employee",
    profilePhoto: "",
    biometricTemplate: [],
    biometricSamples: [],
    probation: { durationMonths: 3, confirmationStatus: "in_probation" },
    leavePlan: { annualPaidLeaves: 18, cycleStartMonth: 4, accrualMode: "grant_on_confirmation" },
    shift: { name: "General Shift", startTime: "10:00", endTime: "18:30", graceMinutes: 15 },
  }));
  const [managers, setManagers] = useState([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    employeeApi.list().then(setManagers).catch(() => setManagers([]));
  }, []);
  const update = (field, value) =>
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "joiningDate" && next.probation) {
        const auto = expectedProbationEnd(value, next.probation.durationMonths || 3);
        if (auto) next.probation = { ...next.probation, expectedEndDate: auto };
      }
      return next;
    });
  const updateNested = (root, field, value) =>
    setForm(current => {
      const nextRoot = { ...current[root], [field]: value };
      const next = { ...current, [root]: nextRoot };
      if (root === "probation" && field === "durationMonths" && next.joiningDate) {
        const auto = expectedProbationEnd(next.joiningDate, value);
        if (auto) next.probation = { ...next.probation, expectedEndDate: auto };
      }
      return next;
    });
  async function submit(event) {
    event.preventDefault();
    if (!SERVER_FACE_ENABLED && (!form.profilePhoto || form.biometricTemplate.length < 128 || form.biometricSamples.length !== 3)) {
      setError(
        "Biometric face enrollment is required before creating the employee.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const {biometricTemplate,biometricSamples,profilePhoto,...nonBiometricForm}=form;
      const payload = {
        ...(SERVER_FACE_ENABLED?nonBiometricForm:{...nonBiometricForm,profilePhoto,biometricTemplate,biometricSamples}),
        manager: form.manager || null,
        employmentType: form.employmentType,
        employeeStatus: form.employeeStatus,
      };
      if (form.employmentType === "probation" && !form.probation.expectedEndDate && form.joiningDate) {
        const auto = expectedProbationEnd(form.joiningDate, form.probation.durationMonths || 3);
        if (auto) payload.probation = { ...form.probation, expectedEndDate: auto };
      }
      const created=await employeeApi.create(payload);
      navigate(SERVER_FACE_ENABLED?`/people/${created._id}/biometrics`:"/people");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!form.profilePhoto && !SERVER_FACE_ENABLED)
    return (
      <>
        <button className="back-link" onClick={() => navigate("/people")}>
          <ArrowLeft size={15} /> Back to employees
        </button>
        <PageHeader
          eyebrow="People · Onboarding"
          title="Enroll employee face"
          description="Capture a live reference face before entering employment and account details."
        />
        <section className="content-card biometric-step-card">
          <BiometricEnrollment
            value={form}
            onChange={(data) => setForm((current) => ({ ...current, ...data }))}
          />
          <div className="biometric-privacy-note">
            <ShieldCheck size={17} />
            <p>
              <strong>Biometric privacy</strong>
              <span>
                The face-recognition embedding is used only for attendance identity
                verification. Restrict access and apply your organization’s
                retention policy.
              </span>
            </p>
          </div>
        </section>
      </>
    );
  return (
    <>
      <button className="back-link" onClick={() => navigate("/people")}>
        <ArrowLeft size={15} /> Back to employees
      </button>
      <PageHeader
        eyebrow="People · Onboarding"
        title="Add employee"
        description="Create the employee profile, set reporting, and secure login account together."
      />
      <form className="onboarding-form" onSubmit={submit}>
        <aside className="onboarding-steps">
          <div className="active">
            <span>01</span>
            <div>
              <strong>Personal</strong>
              <small>Identity and contacts</small>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <strong>Work setup</strong>
              <small>Manager, role, branch</small>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <strong>Benefits</strong>
              <small>Probation & leave plan</small>
            </div>
          </div>
          <div>
            <span>04</span>
            <div>
              <strong>Account</strong>
              <small>Role, password, shift</small>
            </div>
          </div>
        </aside>
        <div className="onboarding-content">
          <section className="form-section">
            <div className="form-section-title">
              <span>
                <UserRound size={18} />
              </span>
              <div>
                <h2>Personal details</h2>
                <p>Employee’s core identity and contact information.</p>
              </div>
            </div>
            <div className="field-grid">
              <label>
                Employee number *
                <input
                  required
                  value={form.employeeCode}
                  onChange={(e) =>
                    update("employeeCode", e.target.value.toUpperCase())
                  }
                />
              </label>
              <span />
              <label>
                First name *
                <input
                  required
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                />
              </label>
              <label>
                Last name *
                <input
                  required
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                />
              </label>
              <label>
                Date of birth *
                <input
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                />
              </label>
              <label>
                Gender *
                <select required value={form.gender} onChange={(e) => update("gender", e.target.value)}>
                  <option value="not_specified">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non_binary">Non-binary</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </label>
              <label>
                Mobile
                <input value={form.mobile || ""} placeholder="e.g. +91 98765 43210" onChange={(e) => update("mobile", e.target.value)} />
              </label>
              <label>
                Personal email
                <input type="email" value={form.personalEmail || ""} placeholder="name@example.com" onChange={(e) => update("personalEmail", e.target.value)} />
              </label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title">
              <span>
                <BriefcaseBusiness size={18} />
              </span>
              <div>
                <h2>Work setup</h2>
                <p>Reporting manager, employment type and branch.</p>
              </div>
            </div>
            <div className="field-grid">
              <label>
                Department
                <input
                  value={form.department}
                  placeholder="e.g. Product & Technology"
                  onChange={(e) => update("department", e.target.value)}
                />
              </label>
              <label>
                Designation
                <input
                  value={form.designation}
                  placeholder="e.g. Software Engineer"
                  onChange={(e) => update("designation", e.target.value)}
                />
              </label>
              <label>
                Branch
                <input value={form.branch || ""} placeholder="e.g. Head Office" onChange={(e) => update("branch", e.target.value)} />
              </label>
              <label>
                Work location
                <input value={form.workLocation || ""} placeholder="e.g. Main Office / WFO" onChange={(e) => update("workLocation", e.target.value)} />
              </label>
              <label>
                Joining date *
                <input type="date" required value={form.joiningDate} onChange={(e) => update("joiningDate", e.target.value)} />
              </label>
              <label>
                Reporting manager
                <select value={form.manager || ""} onChange={(e) => update("manager", e.target.value || null)}>
                  <option value="">No manager assigned</option>
                  {managers.map(m => (
                    <option key={m._id} value={m._id}>{m.firstName} {m.lastName} · {m.designation || "Employee"}</option>
                  ))}
                </select>
              </label>
              <label>
                Employment type
                <select value={form.employmentType} onChange={(e) => update("employmentType", e.target.value)}>
                  <option value="probation">Probation</option>
                  <option value="permanent">Permanent</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                  <option value="consultant">Consultant</option>
                </select>
              </label>
              <label>
                Employee status
                <select value={form.employeeStatus} onChange={(e) => update("employeeStatus", e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="notice_period">Notice period</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title">
              <span>
                <CalendarDays size={18} />
              </span>
              <div>
                <h2>Probation & Leave plan</h2>
                <p>Probation period and annual paid leave configuration.</p>
              </div>
            </div>
            <div className="field-grid">
              <label>
                Probation duration (months)
                <input type="number" min="1" max="24" value={form.probation.durationMonths} onChange={(e) => updateNested("probation", "durationMonths", Math.max(1, Math.min(24, Number(e.target.value) || 0)))} />
              </label>
              <label>
                Expected probation end (auto)
                <input
                  type="date"
                  value={form.probation.expectedEndDate || expectedProbationEnd(form.joiningDate, form.probation.durationMonths || 3)}
                  disabled
                  aria-readonly="true"
                  title="Joining date + probation duration months"
                />
              </label>
              <label>
                Probation start status
                <select value={form.probation.confirmationStatus} onChange={(e) => updateNested("probation", "confirmationStatus", e.target.value)}>
                  <option value="in_probation">In probation</option>
                  <option value="pending_confirmation">Pending confirmation</option>
                  <option value="confirmed">Confirmed (pre-join)</option>
                </select>
              </label>
              <label>
                Annual paid leaves
                <input type="number" min="0" max="60" value={form.leavePlan.annualPaidLeaves} onChange={(e) => updateNested("leavePlan", "annualPaidLeaves", Number(e.target.value))} />
              </label>
              <label>
                FY start month
                <select value={form.leavePlan.cycleStartMonth} onChange={(e) => updateNested("leavePlan", "cycleStartMonth", Number(e.target.value))}>
                  {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((label, idx) => (
                    <option key={idx + 1} value={idx + 1}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="policy-note">
              <Clock3 size={16} />
              <div>
                <strong>Leave policy note</strong>
                <span>Paid leaves are prorated at 1.5 days/month from probation confirmation until FY end (March). 4+ working-day leaves require 10-day advance notice plus Manager → HR → Super Admin approvals.</span>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title">
              <span>
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2>Account & Shift</h2>
                <p>Application role, credentials and attendance schedule.</p>
              </div>
            </div>
            <div className="field-grid">
              <label>
                Official email *
                <div className="field-with-icon">
                  <Mail size={15} />
                  <input
                    type="email"
                    required
                    value={form.officialEmail}
                    onChange={(e) => update("officialEmail", e.target.value)}
                  />
                </div>
              </label>
              <label>
                Application role *
                <select
                  value={form.role}
                  onChange={(e) => update("role", e.target.value)}
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="hr_admin">HR Admin</option>
                  {["super_admin", "admin"].includes(user.role) && (
                    <option value="admin">Admin</option>
                  )}
                  <option value="finance_admin">Finance Admin</option>
                  <option value="it_admin">IT Admin</option>
                  {user.role === "super_admin" && (
                    <option value="super_admin">Super Admin</option>
                  )}
                </select>
              </label>
              <label>
                Temporary password *
                <input
                  required
                  minLength={8}
                  value={form.temporaryPassword}
                  onChange={(e) => update("temporaryPassword", e.target.value)}
                />
                <small>Employee must change this after first login.</small>
              </label>
              <label>
                Shift name
                <input value={form.shift.name} onChange={(e) => updateNested("shift", "name", e.target.value)} />
              </label>
              <label>
                Shift start
                <input type="time" value={form.shift.startTime} onChange={(e) => updateNested("shift", "startTime", e.target.value)} />
              </label>
              <label>
                Shift end
                <input type="time" value={form.shift.endTime} onChange={(e) => updateNested("shift", "endTime", e.target.value)} />
              </label>
              <label>
                Grace minutes
                <input type="number" min="0" max="180" value={form.shift.graceMinutes} onChange={(e) => updateNested("shift", "graceMinutes", Number(e.target.value))} />
              </label>
            </div>
          </section>

          {error && <StateMessage error>{error}</StateMessage>}
          <div className="onboarding-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate("/people")}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Creating employee…" : "Complete onboarding"}{" "}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

export function EmployeeBiometricPage({ employeeId }) {
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [enrollment, setEnrollment] = useState({ profilePhoto: "", biometricTemplate: [], biometricSamples: [] });
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    employeeApi.get(employeeId).then(setEmployee).catch((requestError) => setError(requestError.message));
    if (SERVER_FACE_ENABLED) biometricApi.employeeStatus(employeeId).then(setStatus).catch((requestError) => setError(requestError.message));
    else employeeApi.getBiometrics(employeeId).then((data) => setExistingPhotos(data.photos || [])).catch((requestError) => setError(requestError.message));
  }, [employeeId]);

  async function runAdminAction(action) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "reset") {
        if (!window.confirm("Reset this employee's UniFace access? Legacy biometric data will be preserved.")) return;
        const result = await biometricApi.reset(employeeId);
        setNotice(result?.message || "Biometric access reset. Live re-enrollment is now required.");
      } else {
        const result = await biometricApi.migrate(employeeId);
        setNotice(result?.message || "Migration completed.");
      }
      setStatus(await biometricApi.employeeStatus(employeeId));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!enrollment.profilePhoto || enrollment.biometricSamples.length !== 3 || (!SERVER_FACE_ENABLED&&enrollment.biometricTemplate.length<128)) return;
    setBusy(true);
    setError("");
    try {
      if(SERVER_FACE_ENABLED)await biometricApi.enroll({employeeId,challengeId:enrollment.challengeId,completedSteps:enrollment.completedSteps,samples:enrollment.biometricSamples.map(({pose,photo})=>({pose,photo}))});
      else await employeeApi.updateBiometrics(employeeId, enrollment);
      navigate("/people");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="back-link" onClick={() => navigate("/people")}><ArrowLeft size={15}/> Back to employees</button>
    <PageHeader eyebrow="People · Security" title="Re-enroll employee face" description={employee ? `Capture a new secure identity template for ${employee.firstName} ${employee.lastName} (${employee.employeeCode}).` : "Loading employee…"}/>
    <section className="content-card biometric-step-card">
      {SERVER_FACE_ENABLED && status && <div className="existing-biometric-photos"><div><strong>UniFace biometric status</strong><span>{status.enrolled ? "Encrypted server-side identity is active." : "Server-side identity is not active."}</span></div><div className="biometric-status-grid"><span><b>Migration</b>{status.migrationStatus.replaceAll("_", " ")}</span><span><b>Model</b>{status.modelVersion || "Not enrolled"}</span><span><b>Embedding</b>{status.embeddingDimension ? `${status.embeddingDimension} dimensions` : "Unavailable"}</span><span><b>Enrolled</b>{status.enrolledAt ? new Date(status.enrolledAt).toLocaleString() : "Not enrolled"}</span><span><b>Last updated</b>{status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "Unavailable"}</span><span><b>30-day exceptions</b>{status.recentVerificationFailureCount} failed · {status.manualAttendanceCount} manual</span></div><div className="onboarding-actions">{status.migrationStatus === "migration_required" && <button type="button" className="secondary-button" disabled={busy} onClick={() => runAdminAction("migrate")}>Migrate trusted photos</button>}{status.enrolled && <button type="button" className="secondary-button" disabled={busy} onClick={() => runAdminAction("reset")}>Reset face access</button>}</div></div>}
      {existingPhotos.length>0&&<div className="existing-biometric-photos"><div><strong>Current enrollment photos</strong><span>Visible only to authorized HR and Admin users.</span></div><div className="enrollment-photo-grid">{existingPhotos.map((sample,index)=><figure key={sample.pose}><img src={sample.photo} alt={`Current biometric angle ${index+1}`}/><figcaption>{sample.pose==='front'?'Straight':`Side angle ${index}`}</figcaption></figure>)}</div></div>}
      <BiometricEnrollment value={enrollment} onChange={setEnrollment} employeeId={employeeId}/>
      <div className="biometric-privacy-note"><ShieldCheck size={17}/><p><strong>Identity replacement</strong><span>The previous biometric template will be replaced. Complete this step only while the named employee is physically present.</span></p></div>
      {error && <p className="attendance-error">{error}</p>}
      {notice && <p className="success-message">{notice}</p>}
      {enrollment.biometricSamples.length === 3 && <button type="button" className="primary-button" disabled={busy} onClick={save}>{busy ? "Saving secure identity…" : "Save new three-angle identity"}</button>}
    </section>
  </>;
}

export function ReportsPage() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [biometricReport, setBiometricReport] = useState(null);
  useEffect(() => {
    adminApi
      .dashboard()
      .then(setData)
      .catch((e) => setError(e.message));
    if (SERVER_FACE_ENABLED) biometricApi.healthReport(30).then(setBiometricReport).catch(() => {});
  }, []);
  const cards = data
    ? [
        ["Total employees", data.totalEmployees, UsersRound],
        ["Present today", data.presentToday, Check],
        ["Late today", data.lateToday, Clock3],
        ["Not reported", data.notReported, UserRound],
        ["Male employees", data.demographics?.male || 0, UserRound],
        ["Female employees", data.demographics?.female || 0, UserRound],
        ["Gender not specified", data.demographics?.notSpecified || 0, UserRound],
      ]
    : [];
  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="A concise view of organization attendance and workforce activity."
        action={
          <button className="secondary-button">
            <FileText size={15} /> Export report
          </button>
        }
      />
      {error ? (
        <StateMessage error>{error}</StateMessage>
      ) : !data ? (
        <StateMessage>Loading report…</StateMessage>
      ) : (
        <>
          <div className="report-metrics">
            {cards.map(([label, value, Icon]) => (
              <div key={label}>
                <span>
                  <Icon size={18} />
                </span>
                <p>{label}</p>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <section className="content-card report-chart">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Today</p>
                <h2>Attendance distribution</h2>
              </div>
            </div>
            <div className="bar-list">
              {[
                ["Present", data.presentToday, "green"],
                ["Late", data.lateToday, "amber"],
                ["WFH", data.wfhToday, "blue"],
                ["Not reported", data.notReported, "gray"],
              ].map(([label, value, tone]) => (
                <div key={label}>
                  <span>{label}</span>
                  <div>
                    <i
                      className={tone}
                      style={{
                        width: `${Math.max(2, (value / Math.max(1, data.totalEmployees)) * 100)}%`,
                      }}
                    />
                  </div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
          {biometricReport && <section className="content-card report-chart"><div className="section-heading"><div><p className="eyebrow">Last 30 days</p><h2>Biometric health</h2></div></div><div className="report-metrics">{[["Success rate", `${biometricReport.metrics.biometricSuccessRate}%`],["Face match failures", `${biometricReport.metrics.faceMatchFailureRate}%`],["Liveness failures", `${biometricReport.metrics.livenessFailureRate}%`],["Camera failures", `${biometricReport.metrics.cameraFailureRate}%`],["Manual fallback", `${biometricReport.metrics.manualFallbackRate}%`],["Re-enrollment required", biometricReport.metrics.employeesRequiringReEnrollment],["Old templates", biometricReport.metrics.employeesUsingOldTemplate],["Migrated to UniFace", biometricReport.metrics.employeesMigratedToUniFace]].map(([label,value])=><div key={label}><span><ScanFace size={18}/></span><p>{label}</p><strong>{value}</strong></div>)}</div></section>}
        </>
      )}
    </>
  );
}

export function HolidaysPage({ user }) {
  const canManage = ["super_admin", "admin", "hr_admin"].includes(user.role);
  const [holidays, setHolidays] = useState([]),
    [calendarMonth, setCalendarMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [drawer, setDrawer] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    date: "",
    type: "public",
    description: "",
  });
  useEffect(() => {
    holidayApi
      .list(calendarMonth.getFullYear())
      .then(setHolidays)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [calendarMonth]);
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - mondayOffset);
    return Array.from(
      { length: 42 },
      (_, index) =>
        new Date(
          gridStart.getFullYear(),
          gridStart.getMonth(),
          gridStart.getDate() + index,
        ),
    );
  }, [calendarMonth]);
  const holidaysByDate = useMemo(() => {
    const entries = new Map();
    holidays.forEach((holiday) => {
      const date = new Date(holiday.date);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const existing = entries.get(key) || [];
      entries.set(key, [...existing, holiday]);
    });
    return entries;
  }, [holidays]);
  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const created = await holidayApi.create(form);
      setHolidays((items) =>
        [...items, created].sort((a, b) => new Date(a.date) - new Date(b.date)),
      );
      setDrawer(false);
      setForm({ name: "", date: "", type: "public", description: "" });
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    if (!window.confirm("Remove this holiday from the organization calendar?"))
      return;
    try {
      await holidayApi.remove(id);
      setHolidays((items) => items.filter((item) => item._id !== id));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Holiday calendar"
        description={`Company holidays for ${new Date().getFullYear()}.`}
        action={
          canManage && (
            <button className="primary-button" onClick={() => setDrawer(true)}>
              <Plus size={16} /> Add holiday
            </button>
          )
        }
      />
      {error && <StateMessage error>{error}</StateMessage>}
      <section className="content-card holiday-calendar-card">
        <div className="holiday-calendar-toolbar">
          <div>
            <p className="eyebrow">Monthly view</p>
            <h2>
              {calendarMonth.toLocaleString("en-IN", {
                month: "long",
                year: "numeric",
              })}
            </h2>
          </div>
          <div>
            <button
              aria-label="Previous month"
              onClick={() =>
                setCalendarMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              <ArrowLeft size={16} />
            </button>
            <button
              className="calendar-today-button"
              onClick={() => {
                const today = new Date();
                setCalendarMonth(
                  new Date(today.getFullYear(), today.getMonth(), 1),
                );
              }}
            >
              Today
            </button>
            <button
              aria-label="Next month"
              onClick={() =>
                setCalendarMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <div className="holiday-calendar-weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="holiday-calendar-grid">
          {calendarDays.map((date) => {
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            const dayHolidays = holidaysByDate.get(key) || [];
            const isOutside = date.getMonth() !== calendarMonth.getMonth();
            const today = new Date();
            const isToday =
              date.getFullYear() === today.getFullYear() &&
              date.getMonth() === today.getMonth() &&
              date.getDate() === today.getDate();
            return (
              <div
                className={`holiday-calendar-day${isOutside ? " outside" : ""}${isToday ? " today" : ""}${dayHolidays.length ? " has-holiday" : ""}`}
                key={date.toISOString()}
              >
                <span>{date.getDate()}</span>
                {dayHolidays.slice(0, 2).map((holiday) => (
                  <div
                    className={`calendar-holiday-label ${holiday.type}`}
                    key={holiday._id}
                    title={holiday.name}
                  >
                    {holiday.name}
                  </div>
                ))}
                {dayHolidays.length > 2 && (
                  <small>+{dayHolidays.length - 2} more</small>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="content-card holiday-page-card">
        {loading ? (
          <StateMessage>Loading holidays…</StateMessage>
        ) : holidays.length === 0 ? (
          <StateMessage>
            No holidays added yet.
            {canManage && " Use Add holiday to create the calendar."}
          </StateMessage>
        ) : (
          <div className="holiday-list-page">
            {holidays.map((holiday) => {
              const date = new Date(holiday.date);
              return (
                <article key={holiday._id}>
                  <div className="holiday-date-large">
                    <strong>{date.getDate()}</strong>
                    <span>{date.toLocaleString("en", { month: "short" })}</span>
                  </div>
                  <div className="holiday-info">
                    <div>
                      <StatusBadge status={holiday.type} />
                      <span>
                        {date.toLocaleString("en", { weekday: "long" })}
                      </span>
                    </div>
                    <h3>{holiday.name}</h3>
                    <p>{holiday.description || "Organization holiday"}</p>
                  </div>
                  {canManage && (
                    <button
                      className="holiday-delete"
                      onClick={() => remove(holiday._id)}
                      title="Remove holiday"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {drawer && (
        <div className="drawer-layer">
          <button
            className="drawer-backdrop"
            onClick={() => setDrawer(false)}
          />
          <aside className="form-drawer">
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Organization calendar</p>
                <h2>Add holiday</h2>
              </div>
              <button onClick={() => setDrawer(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit}>
              <label>
                Holiday name *
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Independence Day"
                />
              </label>
              <label>
                Date *
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
              <label>
                Holiday type
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="public">Public holiday</option>
                  <option value="company">Company holiday</option>
                  <option value="optional">Optional holiday</option>
                </select>
              </label>
              <label>
                Description
                <textarea
                  rows="4"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="Optional note for employees"
                />
              </label>
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDrawer(false)}
                >
                  Cancel
                </button>
                <button className="primary-button">Add to calendar</button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

function readProof(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Proof file is required"));
    if (file.size > 2_800_000)
      return reject(new Error("Proof must be smaller than 2.8 MB"));
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.type,
      )
    )
      return reject(new Error("Upload a JPG, PNG, WebP or PDF proof"));
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        fileName: file.name,
        mimeType: file.type,
        data: reader.result,
      });
    reader.onerror = () => reject(new Error("Unable to read proof file"));
    reader.readAsDataURL(file);
  });
}

function ProofViewer({ proof, close }) {
  return (
    <div className="proof-viewer">
      <button className="photo-lightbox-backdrop" onClick={close} />
      <div className="proof-viewer-content">
        <div>
          <span>{proof.fileName}</span>
          <button onClick={close}>
            <X size={20} />
          </button>
        </div>
        {proof.mimeType === "application/pdf" ? (
          <iframe title={proof.fileName} src={proof.data} />
        ) : (
          <img src={proof.data} alt="Allowance proof" />
        )}
      </div>
    </div>
  );
}

export function AllowancesPage({ user }) {
  const canViewAll = ["super_admin", "admin", "hr_admin"].includes(user.role);
  const [claims, setClaims] = useState([]),
    [drawer, setDrawer] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [proof, setProof] = useState(null);
  const [monthlyUsage, setMonthlyUsage] = useState({
    limit: 2000,
    used: 0,
    remaining: 2000,
  });
  const [specialClaim, setSpecialClaim] = useState(null);
  const [specialForm, setSpecialForm] = useState({ explanation: "", proof: null });
  const [form, setForm] = useState({
    travelDate: "",
    travelLocation: "",
    travelAllowance: "",
    extraAllowance: "",
    extraAllowanceReason: "",
    proof: null,
  });
  useEffect(() => {
    allowanceApi
      .list(canViewAll ? "all" : "mine")
      .then(setClaims)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [canViewAll]);
  useEffect(() => {
    if (!form.travelDate) {
      return;
    }
    let active = true;
    allowanceApi
      .monthlyUsage(form.travelDate)
      .then((usage) => active && setMonthlyUsage(usage))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [form.travelDate]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const encodedProof = await readProof(form.proof);
      const created = await allowanceApi.create({
        travelDate: form.travelDate,
        travelLocation: form.travelLocation,
        travelAllowance: Number(form.travelAllowance),
        extraAllowance: Number(form.extraAllowance || 0),
        extraAllowanceReason: form.extraAllowanceReason,
        proof: encodedProof,
      });
      setClaims((items) => [created, ...items]);
      setDrawer(false);
      setForm({
        travelDate: "",
        travelLocation: "",
        travelAllowance: "",
        extraAllowance: "",
        extraAllowanceReason: "",
        proof: null,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function viewProof(id) {
    try {
      setProof(await allowanceApi.proof(id));
    } catch (e) {
      setError(e.message);
    }
  }
  function replaceClaim(updated) {
    setClaims((items) => items.map((item) => item._id === updated._id ? { ...item, ...updated, employee: item.employee } : item));
  }
  async function submitSpecialApproval(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await allowanceApi.requestSpecialApproval(specialClaim._id, {
        explanation: specialForm.explanation,
        proof: await readProof(specialForm.proof),
      });
      replaceClaim(updated);
      setSpecialClaim(null);
      setSpecialForm({ explanation: "", proof: null });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reviewSpecialApproval(claim, decision) {
    const reviewNote = decision === "reject" ? window.prompt("Please enter the rejection reason") : "";
    if (decision === "reject" && !reviewNote) return;
    setBusy(true);
    setError("");
    try {
      replaceClaim(await allowanceApi.reviewSpecialApproval(claim._id, decision, reviewNote));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function viewSpecialProof(id) {
    try {
      setProof(await allowanceApi.specialApprovalProof(id));
    } catch (e) {
      setError(e.message);
    }
  }
  const allowanceTotal = claims.reduce(
    (sum, item) => sum + item.totalAmount,
    0,
  );
  const acceptableTotal = claims.reduce(
    (sum, item) => sum + (item.acceptableAmount ?? item.totalAmount),
    0,
  );
  const nonAcceptableTotal = claims.reduce(
    (sum, item) => sum + (item.nonAcceptableAmount ?? 0),
    0,
  );
  const draftTotal = Number(form.travelAllowance || 0) + Number(form.extraAllowance || 0);
  const draftAcceptable = Math.min(draftTotal, monthlyUsage.remaining);
  const draftNonAcceptable = Math.max(0, draftTotal - draftAcceptable);
  return (
    <>
      <PageHeader
        eyebrow="My Space · Expenses"
        title="Allowances"
        description="Submit travel and extra allowance claims with supporting proof."
        action={
          <button className="primary-button" onClick={() => setDrawer(true)}>
            <Plus size={16} /> Add allowance
          </button>
        }
      />
      <div className="allowance-summary">
        <div>
          <span>
            <ReceiptText size={18} />
          </span>
          <p>{canViewAll ? "Employee records" : "My records"}</p>
          <strong>{claims.length}</strong>
        </div>
        <div>
          <span>
            <Clock3 size={18} />
          </span>
          <p>Total claimed</p>
          <strong>₹{allowanceTotal.toLocaleString("en-IN")}</strong>
        </div>
        <div>
          <span>
            <IndianRupee size={18} />
          </span>
          <p>Acceptable amount</p>
          <strong className="acceptable-value">₹{acceptableTotal.toLocaleString("en-IN")}</strong>
        </div>
        <div>
          <span>
            <IndianRupee size={18} />
          </span>
          <p>Not acceptable</p>
          <strong className="non-acceptable-value">₹{nonAcceptableTotal.toLocaleString("en-IN")}</strong>
        </div>
      </div>
      {error && <StateMessage error>{error}</StateMessage>}
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Claims</p>
            <h2>
              {canViewAll ? "All employee allowances" : "My allowance history"}
            </h2>
          </div>
        </div>
        {loading ? (
          <StateMessage>Loading allowance claims…</StateMessage>
        ) : claims.length === 0 ? (
          <StateMessage>No allowance claims submitted yet.</StateMessage>
        ) : (
          <div className="data-table-wrap allowance-table-wrap">
            <table className="data-table allowance-table">
              <thead>
                <tr>
                  {canViewAll && <th>Employee</th>}
                  <th>Travel date</th>
                  <th>Travel location</th>
                  <th>Travel</th>
                  <th>Extra</th>
                  <th>Extra allowance details</th>
                  <th>Total</th>
                  <th>Acceptable</th>
                  <th>Not acceptable</th>
                  <th>Special approval</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim._id}>
                    {canViewAll && (
                      <td>
                        <strong>
                          {claim.employee?.firstName || claim.employee?.lastName
                            ? `${claim.employee.firstName || ""} ${claim.employee.lastName || ""}`.trim()
                            : `${user.firstName} ${user.lastName}`}
                        </strong>
                        {claim.employee?.employeeCode && (
                          <small>{claim.employee.employeeCode}</small>
                        )}
                      </td>
                    )}
                    <td>{formatDate(claim.travelDate)}</td>
                    <td>
                      <span className="allowance-location">
                        <MapPin size={13} /> {claim.travelLocation}
                      </span>
                    </td>
                    <td>₹{claim.travelAllowance.toLocaleString("en-IN")}</td>
                    <td>₹{claim.extraAllowance.toLocaleString("en-IN")}</td>
                    <td className="allowance-reason-cell">
                      {claim.extraAllowanceReason || "—"}
                    </td>
                    <td>
                      <strong>
                        ₹{claim.totalAmount.toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td><strong className="acceptable-value">₹{(claim.acceptableAmount ?? claim.totalAmount).toLocaleString("en-IN")}</strong></td>
                    <td><strong className={(claim.nonAcceptableAmount ?? 0) > 0 ? "non-acceptable-value" : "muted-value"}>₹{(claim.nonAcceptableAmount ?? 0).toLocaleString("en-IN")}</strong></td>
                    <td>
                      {claim.status !== "rejected" && (claim.nonAcceptableAmount ?? 0) > 0 && (!claim.specialApproval?.status || ["not_requested", "rejected"].includes(claim.specialApproval.status)) && (
                        <button className="special-approval-button" onClick={() => setSpecialClaim(claim)}>
                          <ShieldCheck size={13} /> Special approval
                        </button>
                      )}
                      {claim.specialApproval?.status === "pending" && (
                        <div className="special-approval-actions">
                          <StatusBadge status="pending" />
                          <small className="special-approval-reason">{claim.specialApproval.explanation}</small>
                          <button onClick={() => viewSpecialProof(claim._id)}>View request</button>
                          {canViewAll && <>
                            <button className="approve" disabled={busy} onClick={() => reviewSpecialApproval(claim, "approve")}>Approve</button>
                            <button className="reject" disabled={busy} onClick={() => reviewSpecialApproval(claim, "reject")}>Reject</button>
                          </>}
                        </div>
                      )}
                      {claim.specialApproval?.status === "approved" && <StatusBadge status="approved" />}
                    </td>
                    <td>
                      <button
                        className="table-proof-button"
                        onClick={() => viewProof(claim._id)}
                      >
                        <FileText size={13} /> View proof
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {drawer && (
        <div className="drawer-layer">
          <button
            className="drawer-backdrop"
            onClick={() => setDrawer(false)}
          />
          <aside className="form-drawer allowance-drawer">
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">New claim</p>
                <h2>Add allowance</h2>
              </div>
              <button onClick={() => setDrawer(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit}>
              <label>
                1. Travel date *
                <input
                  required
                  type="date"
                  value={form.travelDate}
                  onChange={(e) =>
                    setForm({ ...form, travelDate: e.target.value })
                  }
                />
              </label>
              <label>
                2. Travel location *
                <input
                  required
                  value={form.travelLocation}
                  onChange={(e) =>
                    setForm({ ...form, travelLocation: e.target.value })
                  }
                  placeholder="e.g. Mumbai office to Pune client site"
                />
              </label>
              <label>
                3. Travel allowance (₹) *
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.travelAllowance}
                  onChange={(e) =>
                    setForm({ ...form, travelAllowance: e.target.value })
                  }
                />
              </label>
              <label>
                4. Extra allowance (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.extraAllowance}
                  onChange={(e) =>
                    setForm({ ...form, extraAllowance: e.target.value })
                  }
                />
              </label>
              <label>
                5. Extra allowance reason
                <textarea
                  required={Number(form.extraAllowance || 0) > 0}
                  rows="3"
                  maxLength="500"
                  value={form.extraAllowanceReason}
                  onChange={(e) =>
                    setForm({ ...form, extraAllowanceReason: e.target.value })
                  }
                  placeholder="Write the purpose and details of the extra allowance"
                />
                <small>
                  Required when an extra allowance amount is entered.
                </small>
              </label>
              <label>
                6. Proof *
                <div className="proof-upload">
                  <Upload size={18} />
                  <input
                    required
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) =>
                      setForm({ ...form, proof: e.target.files[0] })
                    }
                  />
                  <span>
                    {form.proof
                      ? form.proof.name
                      : "Upload receipt, ticket or PDF"}
                  </span>
                </div>
              </label>
              <div className="allowance-limit-note">Monthly acceptable allowance limit: <strong>₹2,000</strong>. Any excess is recorded as not acceptable.</div>
              <div className="claim-total-preview allowance-split-preview">
                <div><span>Claim total</span><strong>₹{draftTotal.toLocaleString("en-IN")}</strong></div>
                <div><span>Acceptable</span><strong className="acceptable-value">₹{draftAcceptable.toLocaleString("en-IN")}</strong></div>
                <div><span>Not acceptable</span><strong className="non-acceptable-value">₹{draftNonAcceptable.toLocaleString("en-IN")}</strong></div>
              </div>
              <div className="drawer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDrawer(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Submitting…" : "Submit allowance"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
      {specialClaim && (
        <div className="drawer-layer">
          <button className="drawer-backdrop" onClick={() => setSpecialClaim(null)} />
          <aside className="form-drawer allowance-drawer">
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Special approval</p>
                <h2>Request excess allowance approval</h2>
              </div>
              <button onClick={() => setSpecialClaim(null)}><X size={20} /></button>
            </div>
            <form onSubmit={submitSpecialApproval}>
              <div className="special-approval-amount">
                <span>Amount requiring approval</span>
                <strong>₹{(specialClaim.nonAcceptableAmount || 0).toLocaleString("en-IN")}</strong>
              </div>
              <label>
                Please explain why special approval is required *
                <textarea required minLength="10" maxLength="1000" rows="5" value={specialForm.explanation} onChange={(e) => setSpecialForm({ ...specialForm, explanation: e.target.value })} placeholder="Provide a clear business reason for exceeding the monthly limit" />
              </label>
              <label>
                Supporting proof *
                <div className="proof-upload">
                  <Upload size={18} />
                  <input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setSpecialForm({ ...specialForm, proof: e.target.files[0] })} />
                  <span>{specialForm.proof ? specialForm.proof.name : "Upload supporting image or PDF"}</span>
                </div>
              </label>
              <div className="drawer-actions">
                <button type="button" className="secondary-button" onClick={() => setSpecialClaim(null)}>Cancel</button>
                <button className="primary-button" disabled={busy}>{busy ? "Submitting…" : "Send for approval"}</button>
              </div>
            </form>
          </aside>
        </div>
      )}
      {proof && <ProofViewer proof={proof} close={() => setProof(null)} />}
    </>
  );
}
