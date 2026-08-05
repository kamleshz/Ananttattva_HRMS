import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Star,
  UserCheck,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import {
  apiUrl,
  employeeApi,
  organizationApi,
  publicOfferApi,
  recruitmentApi,
} from "./services/api.js";
import { useLocation, useNavigate } from "./router.jsx";

const stages = [
  "New Candidate",
  "Screening",
  "Shortlisted",
  "Interview Scheduled",
  "Interview In Progress",
  "Interview Completed",
  "Selected",
  "Offer Draft",
  "Pending Super Admin Approval",
  "Approved",
  "Offer Sent",
  "Offer Viewed",
  "Offer Accepted",
  "Onboarding Pending",
  "Joined",
  "Rejected",
];
const sources = [
  "Job Portal",
  "LinkedIn",
  "Referral",
  "Consultancy",
  "Company Website",
  "Walk-In",
  "Email",
  "Campus",
  "Other",
];
const rounds = [
  "HR Screening",
  "Technical Round 1",
  "Technical Round 2",
  "Managerial Round",
  "Assignment",
  "Final Discussion",
  "Salary Discussion",
  "Other",
];
const money = (value) =>
  value
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
const niceDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
const initials = (person) =>
  `${person?.firstName?.[0] || ""}${person?.lastName?.[0] || ""}`;

function PageHeader({ title, description, children }) {
  return (
    <div className="recruitment-header">
      <div>
        <p>
          <BriefcaseBusiness size={14} /> Recruitment <ChevronRight size={12} />{" "}
          {title}
        </p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {children && <div className="recruitment-header-actions">{children}</div>}
    </div>
  );
}
function Empty({ icon: Icon = UsersRound, title = "Nothing here yet", text }) {
  return (
    <div className="recruitment-empty">
      <span>
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Status({ children }) {
  return (
    <span
      className={`recruitment-status status-${String(children).toLowerCase().replaceAll(" ", "-")}`}
    >
      {children}
    </span>
  );
}
function Drawer({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="recruitment-drawer-layer">
      <button className="drawer-backdrop" onClick={onClose} />
      <aside className={`recruitment-drawer ${wide ? "wide" : ""}`}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}
function Field({ label, children, className = "" }) {
  return (
    <label className={className}>
      {label}
      {children}
    </label>
  );
}

function CandidateForm({ onClose, onCreated }) {
  const [form, setForm] = useState({
      firstName: "",
      middleName: "",
      lastName: "",
      email: "",
      mobile: "",
      alternateMobile: "",
      currentCity: "",
      address: "",
      preferredLocation: "",
      pan: "",
      position: "",
      department: "",
      designation: "",
      employmentType: "Permanent",
      workLocation: "",
      source: "LinkedIn",
      totalExperience: 0,
      relevantExperience: 0,
      currentCompany: "",
      currentDesignation: "",
      currentCTC: 0,
      expectedCTC: 0,
      noticePeriod: "",
      skills: "",
      qualification: "",
      employmentStatus: "Employed",
      notes: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = (key, value) => setForm({ ...form, [key]: value });
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await recruitmentApi.createCandidate({
        ...form,
        totalExperience: Number(form.totalExperience),
        relevantExperience: Number(form.relevantExperience),
        currentCTC: Number(form.currentCTC),
        expectedCTC: Number(form.expectedCTC),
        skills: form.skills
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      });
      onCreated(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add candidate"
      subtitle="Create a complete candidate profile"
      onClose={onClose}
      wide
    >
      <form className="recruitment-form" onSubmit={submit}>
        <FormSection title="Personal details">
          <div className="form-grid three">
            <Field label="First name *">
              <input
                value={form.firstName}
                onChange={(e) => update("firstName", e.target.value)}
                required
              />
            </Field>
            <Field label="Middle name">
              <input
                value={form.middleName}
                onChange={(e) => update("middleName", e.target.value)}
              />
            </Field>
            <Field label="Last name *">
              <input
                value={form.lastName}
                onChange={(e) => update("lastName", e.target.value)}
                required
              />
            </Field>
            <Field label="Personal email *">
              <input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                required
              />
            </Field>
            <Field label="Mobile number *">
              <input
                value={form.mobile}
                onChange={(e) => update("mobile", e.target.value)}
                required
              />
            </Field>
            <Field label="Alternate mobile">
              <input
                value={form.alternateMobile}
                onChange={(e) => update("alternateMobile", e.target.value)}
              />
            </Field>
            <Field label="Current city">
              <input
                value={form.currentCity}
                onChange={(e) => update("currentCity", e.target.value)}
              />
            </Field>
            <Field label="Preferred location">
              <input
                value={form.preferredLocation}
                onChange={(e) => update("preferredLocation", e.target.value)}
              />
            </Field>
            <Field label="PAN">
              <input
                value={form.pan}
                onChange={(e) => update("pan", e.target.value)}
              />
            </Field>
            <Field label="Current address" className="span-three">
              <textarea
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
              />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Position details">
          <div className="form-grid three">
            <Field label="Position applied for *">
              <input
                value={form.position}
                onChange={(e) => update("position", e.target.value)}
                required
              />
            </Field>
            <Field label="Department *">
              <input
                value={form.department}
                onChange={(e) => update("department", e.target.value)}
                required
              />
            </Field>
            <Field label="Designation">
              <input
                value={form.designation}
                onChange={(e) => update("designation", e.target.value)}
              />
            </Field>
            <Field label="Employment type">
              <select
                value={form.employmentType}
                onChange={(e) => update("employmentType", e.target.value)}
              >
                {[
                  "Permanent",
                  "Probation",
                  "Contract",
                  "Internship",
                  "Consultant",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Work location">
              <input
                value={form.workLocation}
                onChange={(e) => update("workLocation", e.target.value)}
              />
            </Field>
            <Field label="Source">
              <select
                value={form.source}
                onChange={(e) => update("source", e.target.value)}
              >
                {sources.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
        </FormSection>
        <FormSection title="Experience & compensation">
          <div className="form-grid three">
            <Field label="Total experience (years)">
              <input
                type="number"
                min="0"
                step=".5"
                value={form.totalExperience}
                onChange={(e) => update("totalExperience", e.target.value)}
              />
            </Field>
            <Field label="Relevant experience">
              <input
                type="number"
                min="0"
                step=".5"
                value={form.relevantExperience}
                onChange={(e) => update("relevantExperience", e.target.value)}
              />
            </Field>
            <Field label="Current company">
              <input
                value={form.currentCompany}
                onChange={(e) => update("currentCompany", e.target.value)}
              />
            </Field>
            <Field label="Current designation">
              <input
                value={form.currentDesignation}
                onChange={(e) => update("currentDesignation", e.target.value)}
              />
            </Field>
            <Field label="Current CTC">
              <input
                type="number"
                min="0"
                value={form.currentCTC}
                onChange={(e) => update("currentCTC", e.target.value)}
              />
            </Field>
            <Field label="Expected CTC">
              <input
                type="number"
                min="0"
                value={form.expectedCTC}
                onChange={(e) => update("expectedCTC", e.target.value)}
              />
            </Field>
            <Field label="Notice period">
              <input
                value={form.noticePeriod}
                onChange={(e) => update("noticePeriod", e.target.value)}
              />
            </Field>
            <Field label="Qualification">
              <input
                value={form.qualification}
                onChange={(e) => update("qualification", e.target.value)}
              />
            </Field>
            <Field label="Employment status">
              <select
                value={form.employmentStatus}
                onChange={(e) => update("employmentStatus", e.target.value)}
              >
                {[
                  "Employed",
                  "Serving Notice Period",
                  "Unemployed",
                  "Fresher",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Skills (comma separated)" className="span-three">
              <input
                value={form.skills}
                onChange={(e) => update("skills", e.target.value)}
                placeholder="React, Node.js, MongoDB"
              />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Additional notes">
          <Field label="Internal notes">
            <textarea
              rows="4"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </Field>
        </FormSection>
        {error && <p className="form-error">{error}</p>}
        <div className="drawer-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Creating…" : "Add candidate"} <ArrowRightIcon />
          </button>
        </div>
      </form>
    </Drawer>
  );
}
function ArrowRightIcon() {
  return <ChevronRight size={15} />;
}
function FormSection({ title, children }) {
  return (
    <section className="recruitment-form-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function CandidateTable({ items, onView, onSchedule, onSelect, onOffer }) {
  return items.length ? (
    <div className="recruitment-table-wrap">
      <table className="recruitment-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Position</th>
            <th>Experience</th>
            <th>Compensation</th>
            <th>Stage</th>
            <th>Source</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item._id}>
              <td>
                <button className="candidate-cell" onClick={() => onView(item)}>
                  <span>{initials(item)}</span>
                  <div>
                    <strong>
                      {item.firstName} {item.lastName}
                    </strong>
                    <small>
                      {item.candidateCode} · {item.email}
                    </small>
                  </div>
                </button>
              </td>
              <td>
                <strong>{item.position}</strong>
                <small>{item.department}</small>
              </td>
              <td>
                {item.totalExperience || 0} yrs
                <small>{item.currentCompany || "—"}</small>
              </td>
              <td>
                {money(item.expectedCTC)}
                <small>Expected</small>
              </td>
              <td>
                <Status>{item.currentStage}</Status>
              </td>
              <td>{item.source}</td>
              <td>
                <div className="row-actions">
                  <button
                    title="Schedule interview"
                    onClick={() => onSchedule(item)}
                  >
                    <CalendarDays size={15} />
                  </button>
                  {item.currentStage === "Interview Completed" && (
                    <button
                      title="Select candidate"
                      onClick={() => onSelect(item)}
                    >
                      <UserCheck size={15} />
                    </button>
                  )}
                  {["Selected", "Offer Draft"].includes(item.currentStage) && (
                    <button title="Create offer" onClick={() => onOffer(item)}>
                      <FileText size={15} />
                    </button>
                  )}
                  <button onClick={() => onView(item)}>
                    <ChevronRight size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No candidates found"
      text="Add your first candidate to begin the recruitment workflow."
    />
  );
}

function ScheduleForm({ candidate, onClose, onDone }) {
  const [employees, setEmployees] = useState([]),
    [form, setForm] = useState({
      candidate: candidate?._id || "",
      round: "HR Screening",
      interviewType: "Video Call",
      date: "",
      startTime: "10:00",
      endTime: "10:45",
      interviewers: [],
      meetingMode: "Microsoft Teams",
      meetingLink: "",
      location: "",
      instructions: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    employeeApi
      .list()
      .then(setEmployees)
      .catch(() => {});
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await recruitmentApi.createInterview({
        ...form,
        date: new Date(`${form.date}T${form.startTime}`).toISOString(),
      });
      onDone();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Schedule interview"
      subtitle={
        candidate
          ? `${candidate.firstName} ${candidate.lastName} · ${candidate.position}`
          : "Create an interview"
      }
      onClose={onClose}
    >
      <form className="recruitment-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Interview round">
            <select
              value={form.round}
              onChange={(e) => setForm({ ...form, round: e.target.value })}
            >
              {rounds.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Interview type">
            <select
              value={form.interviewType}
              onChange={(e) =>
                setForm({ ...form, interviewType: e.target.value })
              }
            >
              {[
                "In Person",
                "Video Call",
                "Phone Call",
                "Online Assessment",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
          <Field label="Start time">
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              required
            />
          </Field>
          <Field label="End time">
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              required
            />
          </Field>
          <Field label="Meeting mode">
            <select
              value={form.meetingMode}
              onChange={(e) =>
                setForm({ ...form, meetingMode: e.target.value })
              }
            >
              {[
                "Microsoft Teams",
                "Google Meet",
                "Zoom",
                "Office",
                "Phone",
                "Other",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Interviewer" className="span-two">
            <select
              value={form.interviewers[0] || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  interviewers: e.target.value ? [e.target.value] : [],
                })
              }
              required
            >
              <option value="">Select interviewer</option>
              {employees
                .filter((x) => x.user)
                .map((x) => (
                  <option key={x.user} value={x.user}>
                    {x.firstName} {x.lastName} · {x.designation}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Meeting link" className="span-two">
            <input
              value={form.meetingLink}
              onChange={(e) =>
                setForm({ ...form, meetingLink: e.target.value })
              }
            />
          </Field>
          <Field label="Instructions" className="span-two">
            <textarea
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
            />
          </Field>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="drawer-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Scheduling…" : "Schedule interview"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function SelectionForm({ candidate, onClose, onDone }) {
  const [form, setForm] = useState({
      finalDesignation: candidate.position,
      department: candidate.department,
      reportingManager: "",
      branch: "Head Office",
      workLocation: candidate.workLocation || "Main Office",
      employmentType: candidate.employmentType,
      proposedCTC: candidate.expectedCTC || "",
      joiningDate: "",
      probationPeriod: "6 months",
      shift: "General Shift",
      attendancePolicy: "Standard",
      remarks: "",
    }),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    try {
      await recruitmentApi.select(candidate._id, {
        ...form,
        proposedCTC: Number(form.proposedCTC),
      });
      onDone();
    } catch (x) {
      setError(x.message);
    }
  }
  return (
    <Drawer
      title="Select candidate"
      subtitle={`${candidate.firstName} ${candidate.lastName} · ${candidate.position}`}
      onClose={onClose}
    >
      <form className="recruitment-form" onSubmit={submit}>
        <div className="selection-summary">
          <span>
            Expected CTC<strong>{money(candidate.expectedCTC)}</strong>
          </span>
          <span>
            Experience<strong>{candidate.totalExperience || 0} years</strong>
          </span>
        </div>
        <div className="form-grid">
          <Field label="Final designation">
            <input
              value={form.finalDesignation}
              onChange={(e) =>
                setForm({ ...form, finalDesignation: e.target.value })
              }
              required
            />
          </Field>
          <Field label="Department">
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              required
            />
          </Field>
          <Field label="Proposed CTC">
            <input
              type="number"
              value={form.proposedCTC}
              onChange={(e) =>
                setForm({ ...form, proposedCTC: e.target.value })
              }
              required
            />
          </Field>
          <Field label="Joining date">
            <input
              type="date"
              value={form.joiningDate}
              onChange={(e) =>
                setForm({ ...form, joiningDate: e.target.value })
              }
              required
            />
          </Field>
          <Field label="Work location">
            <input
              value={form.workLocation}
              onChange={(e) =>
                setForm({ ...form, workLocation: e.target.value })
              }
            />
          </Field>
          <Field label="Probation">
            <input
              value={form.probationPeriod}
              onChange={(e) =>
                setForm({ ...form, probationPeriod: e.target.value })
              }
            />
          </Field>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="drawer-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button">Confirm selection</button>
        </div>
      </form>
    </Drawer>
  );
}

function OfferForm({ candidate, onClose, onDone }) {
  const selected = candidate.selectedDetails || {};
  const [form, setForm] = useState({
      candidate: candidate._id,
      designation: selected.finalDesignation || candidate.position,
      department: selected.department || candidate.department,
      workLocation: selected.workLocation || candidate.workLocation || "",
      employmentType: selected.employmentType || candidate.employmentType,
      joiningDate: selected.joiningDate?.slice?.(0, 10) || "",
      probationPeriod: selected.probationPeriod || "6 months",
      workTimings: "9:30 AM – 6:30 PM",
      weeklyOff: "Saturday and Sunday",
      noticePeriod: "30 days",
      annualCTC: selected.proposedCTC || candidate.expectedCTC || 0,
      monthlyGross: 0,
      basicSalary: 0,
      hra: 0,
      specialAllowance: 0,
      offerValidUntil: "",
      additionalConditions: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const offer = await recruitmentApi.createOffer({
        ...form,
        compensation: {
          annualCTC: Number(form.annualCTC),
          monthlyGross: Number(form.monthlyGross),
          basicSalary: Number(form.basicSalary),
          hra: Number(form.hra),
          specialAllowance: Number(form.specialAllowance),
        },
        terms: {
          offerValidUntil: form.offerValidUntil,
          additionalConditions: form.additionalConditions,
        },
      });
      await recruitmentApi.generateOffer(offer._id);
      onDone();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Create offer letter"
      subtitle={`${candidate.firstName} ${candidate.lastName} · ${candidate.email}`}
      onClose={onClose}
      wide
    >
      <form className="recruitment-form" onSubmit={submit}>
        <FormSection title="Employment details">
          <div className="form-grid three">
            <Field label="Designation">
              <input
                value={form.designation}
                onChange={(e) =>
                  setForm({ ...form, designation: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Department">
              <input
                value={form.department}
                onChange={(e) =>
                  setForm({ ...form, department: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Work location">
              <input
                value={form.workLocation}
                onChange={(e) =>
                  setForm({ ...form, workLocation: e.target.value })
                }
              />
            </Field>
            <Field label="Joining date">
              <input
                type="date"
                value={form.joiningDate}
                onChange={(e) =>
                  setForm({ ...form, joiningDate: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Probation period">
              <input
                value={form.probationPeriod}
                onChange={(e) =>
                  setForm({ ...form, probationPeriod: e.target.value })
                }
              />
            </Field>
            <Field label="Notice period">
              <input
                value={form.noticePeriod}
                onChange={(e) =>
                  setForm({ ...form, noticePeriod: e.target.value })
                }
              />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Compensation">
          <div className="form-grid three">
            {[
              ["annualCTC", "Annual CTC"],
              ["monthlyGross", "Monthly gross"],
              ["basicSalary", "Basic salary"],
              ["hra", "HRA"],
              ["specialAllowance", "Special allowance"],
            ].map(([key, label]) => (
              <Field label={label} key={key}>
                <input
                  type="number"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        </FormSection>
        <FormSection title="Terms">
          <div className="form-grid">
            <Field label="Offer valid until">
              <input
                type="date"
                value={form.offerValidUntil}
                onChange={(e) =>
                  setForm({ ...form, offerValidUntil: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Work timings">
              <input
                value={form.workTimings}
                onChange={(e) =>
                  setForm({ ...form, workTimings: e.target.value })
                }
              />
            </Field>
            <Field label="Additional conditions" className="span-two">
              <textarea
                rows="4"
                value={form.additionalConditions}
                onChange={(e) =>
                  setForm({ ...form, additionalConditions: e.target.value })
                }
              />
            </Field>
          </div>
        </FormSection>
        {error && <p className="form-error">{error}</p>}
        <div className="drawer-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Generating draft…" : "Create offer & generate PDF"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function RecruitmentDashboard({ onAdd }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    recruitmentApi
      .dashboard()
      .then(setData)
      .catch(() => {});
  }, []);
  const metrics = [
    [
      "Total Candidates",
      Object.values(data?.stageCounts || {}).reduce((a, b) => a + b, 0),
      UsersRound,
    ],
    [
      "Interviews Scheduled",
      data?.interviewCounts?.Scheduled || 0,
      CalendarDays,
    ],
    ["Selected Candidates", data?.stageCounts?.Selected || 0, UserCheck],
    [
      "Offers Pending",
      data?.offerCounts?.["Pending Super Admin Approval"] || 0,
      Clock3,
    ],
    ["Offers Approved", data?.offerCounts?.Approved || 0, FileCheck2],
    ["Candidates Joined", data?.stageCounts?.Joined || 0, CheckCircle2],
  ];
  return (
    <>
      <PageHeader
        title="Recruitment Dashboard"
        description="A live view of hiring activity, interviews and offers."
      >
        <button className="primary-button" onClick={onAdd}>
          <Plus size={15} /> Add candidate
        </button>
      </PageHeader>
      <div className="recruitment-metrics">
        {metrics.map(([label, value, Icon]) => (
          <article key={label}>
            <span>
              <Icon size={18} />
            </span>
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          </article>
        ))}
      </div>
      <section className="recruitment-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Hiring flow</p>
            <h2>Recruitment pipeline</h2>
          </div>
        </div>
        <div className="pipeline-board">
          {stages.slice(0, 13).map((stage) => (
            <div key={stage}>
              <span>{stage}</span>
              <strong>{data?.stageCounts?.[stage] || 0}</strong>
              <i />
            </div>
          ))}
        </div>
      </section>
      <div className="recruitment-dashboard-grid">
        <section className="recruitment-card">
          <div className="section-heading">
            <h2>Recent candidates</h2>
          </div>
          {data?.recentCandidates?.length ? (
            data.recentCandidates.map((x) => (
              <div className="compact-candidate" key={x._id}>
                <span>{initials(x)}</span>
                <div>
                  <strong>
                    {x.firstName} {x.lastName}
                  </strong>
                  <small>
                    {x.position} · {x.department}
                  </small>
                </div>
                <Status>{x.currentStage}</Status>
              </div>
            ))
          ) : (
            <Empty />
          )}
        </section>
        <section className="recruitment-card">
          <div className="section-heading">
            <h2>Upcoming interviews</h2>
          </div>
          {data?.interviews?.length ? (
            data.interviews.map((x) => (
              <div className="interview-row" key={x._id}>
                <span>
                  <strong>
                    {new Date(x.date).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                  <small>{niceDate(x.date)}</small>
                </span>
                <div>
                  <strong>
                    {x.candidate?.firstName} {x.candidate?.lastName}
                  </strong>
                  <small>
                    {x.round} · {x.meetingMode}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <Empty
              icon={CalendarDays}
              text="Scheduled interviews will appear here."
            />
          )}
        </section>
      </div>
    </>
  );
}

function CandidatesView({ selectedOnly = false, onAdd }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]),
    [search, setSearch] = useState(""),
    [schedule, setSchedule] = useState(null),
    [selecting, setSelecting] = useState(null),
    [offer, setOffer] = useState(null);
  const load = () => recruitmentApi.candidates(search).then(setItems);
  useEffect(() => {
    recruitmentApi.candidates().then(setItems);
  }, []);
  const shown = selectedOnly
    ? items.filter((x) =>
        [
          "Selected",
          "Offer Draft",
          "Pending Super Admin Approval",
          "Approved",
          "Offer Sent",
          "Offer Viewed",
          "Offer Accepted",
          "Onboarding Pending",
          "Joined",
        ].includes(x.currentStage),
      )
    : items;
  return (
    <>
      <PageHeader
        title={selectedOnly ? "Selected Candidates" : "Candidates"}
        description={
          selectedOnly
            ? "Manage selected candidates and move them into offer processing."
            : "Search, review and progress every candidate from one place."
        }
      >
        {!selectedOnly && (
          <button className="primary-button" onClick={onAdd}>
            <Plus size={15} /> Add candidate
          </button>
        )}
      </PageHeader>
      <section className="recruitment-card">
        <div className="candidate-toolbar">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
          >
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, mobile or candidate ID"
            />
          </form>
          <select>
            <option>All departments</option>
          </select>
          <select>
            <option>All stages</option>
            {stages.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <CandidateTable
          items={shown}
          onView={(item) => navigate(`/recruitment/candidates/${item._id}`)}
          onSchedule={setSchedule}
          onSelect={setSelecting}
          onOffer={setOffer}
        />
      </section>
      {schedule && (
        <ScheduleForm
          candidate={schedule}
          onClose={() => setSchedule(null)}
          onDone={() => {
            setSchedule(null);
            load();
          }}
        />
      )}
      {selecting && (
        <SelectionForm
          candidate={selecting}
          onClose={() => setSelecting(null)}
          onDone={() => {
            setSelecting(null);
            load();
          }}
        />
      )}
      {offer && (
        <OfferForm
          candidate={offer}
          onClose={() => setOffer(null)}
          onDone={() => {
            setOffer(null);
            navigate("/recruitment/offers");
          }}
        />
      )}
    </>
  );
}

function InterviewCalendarView({ items, mode }) {
  const today = new Date();
  if (mode === "Agenda")
    return (
      <div className="calendar-agenda">
        {items.map((item) => (
          <article key={item._id}>
            <time>
              {niceDate(item.date)}
              <strong>{item.startTime}</strong>
            </time>
            <div>
              <strong>
                {item.candidate?.firstName} {item.candidate?.lastName}
              </strong>
              <span>
                {item.round} · {item.candidate?.position}
              </span>
            </div>
            <Status>{item.status}</Status>
          </article>
        ))}
      </div>
    );
  const start =
    mode === "Month"
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : mode === "Week"
        ? new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() - today.getDay(),
          )
        : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const count =
    mode === "Month"
      ? new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
      : mode === "Week"
        ? 7
        : 1;
  const days = Array.from(
    { length: count },
    (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
  );
  return (
    <div className={`interview-calendar-grid ${mode.toLowerCase()}`}>
      {days.map((day) => {
        const events = items.filter(
          (item) => new Date(item.date).toDateString() === day.toDateString(),
        );
        return (
          <article
            className={
              day.toDateString() === today.toDateString() ? "today" : ""
            }
            key={day.toISOString()}
          >
            <header>
              <span>
                {day.toLocaleDateString("en-IN", { weekday: "short" })}
              </span>
              <strong>{day.getDate()}</strong>
            </header>
            {events.map((event) => (
              <div className="calendar-event" key={event._id}>
                <b>{event.startTime}</b>
                <strong>
                  {event.candidate?.firstName} {event.candidate?.lastName}
                </strong>
                <small>
                  {event.round} · {event.meetingMode}
                </small>
              </div>
            ))}
          </article>
        );
      })}
    </div>
  );
}

function InterviewsView({ user, calendar = false }) {
  const [items, setItems] = useState([]),
    [feedback, setFeedback] = useState(null),
    [error, setError] = useState(""),
    [calendarMode, setCalendarMode] = useState("Month");
  const load = () =>
    recruitmentApi
      .interviews()
      .then(setItems)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function complete(item) {
    try {
      await recruitmentApi.interviewStatus(item._id, "Completed");
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHeader
        title={
          calendar
            ? "Interview Calendar"
            : user.role === "manager"
              ? "My Interviews"
              : "Interview Details"
        }
        description="Manage schedules, interviewer assignments and feedback."
      />
      <section className="recruitment-card">
        {calendar && (
          <div className="calendar-view-switch">
            {["Month", "Week", "Day", "Agenda"].map((mode) => (
              <button
                className={calendarMode === mode ? "active" : ""}
                onClick={() => setCalendarMode(mode)}
                key={mode}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        {items.length ? (
          calendar ? (
            <InterviewCalendarView items={items} mode={calendarMode} />
          ) : (
            <div className="interview-list">
              {items.map((item) => (
                <article key={item._id}>
                  <div className="interview-date">
                    <strong>{new Date(item.date).getDate()}</strong>
                    <span>
                      {new Date(item.date).toLocaleDateString("en-IN", {
                        month: "short",
                      })}
                    </span>
                  </div>
                  <div>
                    <h3>
                      {item.candidate?.firstName} {item.candidate?.lastName}
                    </h3>
                    <p>
                      {item.candidate?.position} · {item.round}
                    </p>
                    <span>
                      <Clock3 size={13} /> {item.startTime} – {item.endTime}{" "}
                      <i /> {item.meetingMode}
                    </span>
                  </div>
                  <div className="interview-people">
                    <small>Interviewers</small>
                    <strong>
                      {item.interviewers?.map((x) => x.firstName).join(", ")}
                    </strong>
                  </div>
                  <Status>{item.status}</Status>
                  <div className="row-actions">
                    {["Scheduled", "Rescheduled"].includes(item.status) &&
                      user.role !== "manager" && (
                        <button
                          className="complete-interview-button"
                          onClick={() => complete(item)}
                          title="Mark completed"
                        >
                          <Check size={15} />
                          <span>Mark completed</span>
                        </button>
                      )}
                    {item.status === "Completed" && !item.feedbackSubmitted && (
                      <button
                        onClick={() => setFeedback(item)}
                        title="Add feedback"
                      >
                        <Star size={15} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )
        ) : (
          <Empty
            icon={CalendarDays}
            title="No interviews scheduled"
            text="Interview assignments will appear here."
          />
        )}
      </section>
      {feedback && (
        <FeedbackForm
          interview={feedback}
          onClose={() => setFeedback(null)}
          onDone={() => {
            setFeedback(null);
            load();
          }}
        />
      )}
    </>
  );
}

function FeedbackForm({ interview, onClose, onDone }) {
  const [form, setForm] = useState({
      technicalSkills: 4,
      communication: 4,
      problemSolving: 4,
      roleKnowledge: 4,
      cultureFit: 4,
      experienceRelevance: 4,
      strengths: "",
      concerns: "",
      detailedFeedback: "",
      recommendation: "Hire",
    }),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    try {
      await recruitmentApi.feedback(interview._id, form);
      onDone();
    } catch (x) {
      setError(x.message);
    }
  }
  return (
    <Drawer
      title="Candidate feedback"
      subtitle={`${interview.candidate?.firstName} ${interview.candidate?.lastName} · ${interview.round}`}
      onClose={onClose}
    >
      <form className="recruitment-form" onSubmit={submit}>
        <div className="rating-grid">
          {[
            ["technicalSkills", "Technical skills"],
            ["communication", "Communication"],
            ["problemSolving", "Problem solving"],
            ["roleKnowledge", "Role knowledge"],
            ["cultureFit", "Culture fit"],
            ["experienceRelevance", "Experience relevance"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <select
                value={form[key]}
                onChange={(e) =>
                  setForm({ ...form, [key]: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 4, 5].map((x) => (
                  <option key={x} value={x}>
                    {x} –{" "}
                    {
                      [
                        "",
                        "Poor",
                        "Below Average",
                        "Average",
                        "Good",
                        "Excellent",
                      ][x]
                    }
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <Field label="Strengths">
          <textarea
            value={form.strengths}
            onChange={(e) => setForm({ ...form, strengths: e.target.value })}
          />
        </Field>
        <Field label="Concerns">
          <textarea
            value={form.concerns}
            onChange={(e) => setForm({ ...form, concerns: e.target.value })}
          />
        </Field>
        <Field label="Detailed feedback">
          <textarea
            rows="4"
            value={form.detailedFeedback}
            onChange={(e) =>
              setForm({ ...form, detailedFeedback: e.target.value })
            }
            required
          />
        </Field>
        <Field label="Recommendation">
          <select
            value={form.recommendation}
            onChange={(e) =>
              setForm({ ...form, recommendation: e.target.value })
            }
          >
            {["Strong Hire", "Hire", "Hold", "Reject", "Strong Reject"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </Field>
        {error && <p className="form-error">{error}</p>}
        <div className="drawer-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button">Submit & lock feedback</button>
        </div>
      </form>
    </Drawer>
  );
}

function OffersView({ approvals = false, user }) {
  const [items, setItems] = useState([]),
    [message, setMessage] = useState("");
  const load = () =>
    approvals
      ? recruitmentApi.approvals().then(setItems)
      : recruitmentApi.offers().then(setItems);
  useEffect(() => {
    if (approvals) recruitmentApi.approvals().then(setItems);
    else recruitmentApi.offers().then(setItems);
  }, [approvals]);
  async function act(id, action) {
    const remarks =
      action === "approve"
        ? window.prompt("Optional approval remarks", "") || ""
        : window.prompt("Remarks are required", "");
    if (action !== "approve" && !remarks) return;
    try {
      await recruitmentApi.approvalAction(id, action, remarks);
      setMessage(`Offer ${action.replace("-", " ")} completed.`);
      load();
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function offerAction(id, action) {
    try {
      const result =
        action === "submit"
          ? await recruitmentApi.submitOffer(id)
          : action === "generate"
            ? await recruitmentApi.generateOffer(id)
            : await recruitmentApi.sendOffer(id);
      setMessage(
        result.developmentAcceptanceUrl
          ? `Offer sent. Development link: ${result.developmentAcceptanceUrl}`
          : `Offer ${action} completed.`,
      );
      load();
    } catch (e) {
      setMessage(e.message);
    }
  }
  const visibleItems = items.filter((raw) => {
    const offer = approvals ? raw.offer : raw;
    return Boolean(offer?.candidate);
  });
  return (
    <>
      <PageHeader
        title={approvals ? "Offer Letter Approvals" : "Offer Letters"}
        description={
          approvals
            ? "Review compensation, terms and approve or return offers."
            : "Create, track, approve and send professional offer letters."
        }
      />
      {message && <p className="recruitment-notice">{message}</p>}
      <section className="recruitment-card">
        {visibleItems.length ? (
          <div className="offer-list">
            {visibleItems.map((raw) => {
              const offer = approvals ? raw.offer : raw;
              const candidate = offer?.candidate || {};
              return (
                <article key={raw._id}>
                  <span className="offer-file">
                    <FileText size={21} />
                  </span>
                  <div>
                    <h3>
                      {candidate.firstName} {candidate.lastName}
                    </h3>
                    <p>
                      {offer.designation || candidate.position} ·{" "}
                      {offer.offerCode}
                    </p>
                    <small>
                      Joining {niceDate(offer.joiningDate)}{" "}
                      {user.role === "super_admin" &&
                      offer.compensation?.annualCTC
                        ? ` · ${money(offer.compensation.annualCTC)}`
                        : ""}
                    </small>
                  </div>
                  <Status>{approvals ? raw.status : offer.status}</Status>
                  <div className="offer-actions">
                    {approvals && raw.status === "Pending" ? (
                      <>
                        <button
                          className="approve"
                          onClick={() => act(raw._id, "approve")}
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button onClick={() => act(raw._id, "request-changes")}>
                          Request changes
                        </button>
                        <button
                          className="reject"
                          onClick={() => act(raw._id, "reject")}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <>
                        {["Draft", "Changes Requested"].includes(
                          offer.status,
                        ) && (
                          <>
                            <button
                              onClick={() => offerAction(offer._id, "generate")}
                            >
                              <Download size={14} /> Generate
                            </button>
                            <button
                              className="approve"
                              onClick={() => offerAction(offer._id, "submit")}
                            >
                              <Send size={14} /> Submit
                            </button>
                          </>
                        )}
                        {offer.status === "Approved" && (
                          <button
                            className="approve"
                            onClick={() => offerAction(offer._id, "send")}
                          >
                            <Mail size={14} /> Send offer
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={FileText}
            title="No offers yet"
            text="Offers created for selected candidates will appear here."
          />
        )}
      </section>
    </>
  );
}

function CandidateDocuments({ candidateId, documents, onDone }) {
  const [type, setType] = useState("Resume");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await recruitmentApi.uploadDocument(candidateId, file, type);
      onDone();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }
  return (
    <section className="recruitment-card">
      <div className="section-heading">
        <h2>Private documents</h2>
        <label className="document-upload">
          <Plus size={14} />
          {busy ? "Uploading…" : "Upload document"}
          <input
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={upload}
          />
        </label>
      </div>
      <select
        className="document-type"
        value={type}
        onChange={(event) => setType(event.target.value)}
      >
        {[
          "Resume",
          "Cover Letter",
          "Aadhaar",
          "PAN",
          "Salary Slip",
          "Previous Offer Letter",
          "Experience Letter",
          "Relieving Letter",
          "Education Certificate",
          "Other Supporting Document",
        ].map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
      {error && <p className="form-error">{error}</p>}
      <div className="document-list">
        {documents.map((document) => (
          <div key={document._id}>
            <FileText size={16} />
            <span>
              <strong>{document.fileName}</strong>
              <small>
                {document.documentType} · {document.verificationStatus}
              </small>
            </span>
            <ShieldCheck size={14} />
          </div>
        ))}
      </div>
      {!documents.length && (
        <p className="documents-empty">
          No documents uploaded. Files remain private and require
          authentication.
        </p>
      )}
    </section>
  );
}

function CandidateProfile({ user }) {
  const navigate = useNavigate(),
    id = useLocation().pathname.split("/").pop();
  const [data, setData] = useState(null),
    [schedule, setSchedule] = useState(false),
    [selecting, setSelecting] = useState(false),
    [offer, setOffer] = useState(false),
    [message, setMessage] = useState("");
  const load = () => recruitmentApi.candidate(id).then(setData);
  useEffect(() => {
    recruitmentApi.candidate(id).then(setData);
  }, [id]);
  if (!data)
    return <div className="state-message">Loading candidate profile…</div>;
  const c = data.candidate;
  async function reject() {
    const reason = window.prompt("Rejection reason");
    if (!reason) return;
    try {
      await recruitmentApi.reject(c._id, {
        reason,
        remarks: "",
        sendEmail: false,
      });
      load();
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function onboard() {
    try {
      await recruitmentApi.startOnboarding(c._id);
      setMessage("Employee onboarding draft created.");
      load();
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function completeInterview(interviewId) {
    setMessage("");
    try {
      await recruitmentApi.interviewStatus(interviewId, "Completed");
      setMessage(
        "Interview marked as completed. Feedback can now be submitted.",
      );
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }
  return (
    <>
      <button
        className="back-link"
        onClick={() => navigate("/recruitment/candidates")}
      >
        <ArrowLeft size={14} /> Back to candidates
      </button>
      <section className="candidate-profile-hero">
        <span className="profile-candidate-avatar">{initials(c)}</span>
        <div>
          <p>{c.candidateCode}</p>
          <h1>
            {c.firstName} {c.middleName} {c.lastName}
          </h1>
          <span>
            {c.position} · {c.department}
          </span>
          <div>
            <a href={`mailto:${c.email}`}>
              <Mail size={13} />
              {c.email}
            </a>
            <a href={`tel:${c.mobile}`}>
              <Phone size={13} />
              {c.mobile}
            </a>
          </div>
        </div>
        <Status>{c.currentStage}</Status>
        <div className="profile-actions">
          {["New Candidate", "Screening", "Shortlisted"].includes(
            c.currentStage,
          ) && (
            <button
              className="primary-button"
              onClick={() => setSchedule(true)}
            >
              <CalendarDays size={15} /> Schedule interview
            </button>
          )}
          {c.currentStage === "Interview Completed" && (
            <button
              className="primary-button"
              onClick={() => setSelecting(true)}
            >
              <UserCheck size={15} /> Select candidate
            </button>
          )}
          {["Selected", "Offer Draft"].includes(c.currentStage) && (
            <button className="primary-button" onClick={() => setOffer(true)}>
              <FileText size={15} /> Create offer
            </button>
          )}
          {c.currentStage === "Offer Accepted" && (
            <button className="primary-button" onClick={onboard}>
              Start onboarding
            </button>
          )}
          <button className="secondary-button danger" onClick={reject}>
            <XCircle size={15} /> Reject
          </button>
        </div>
      </section>
      {message && <p className="recruitment-notice">{message}</p>}
      <div className="candidate-profile-grid">
        <div>
          <section className="recruitment-card">
            <h2>Candidate overview</h2>
            <dl className="candidate-details">
              <div>
                <dt>Current company</dt>
                <dd>{c.currentCompany || "—"}</dd>
              </div>
              <div>
                <dt>Total experience</dt>
                <dd>{c.totalExperience || 0} years</dd>
              </div>
              <div>
                <dt>Current CTC</dt>
                <dd>{money(c.currentCTC)}</dd>
              </div>
              <div>
                <dt>Expected CTC</dt>
                <dd>{money(c.expectedCTC)}</dd>
              </div>
              <div>
                <dt>Notice period</dt>
                <dd>{c.noticePeriod || "—"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{c.currentCity || "—"}</dd>
              </div>
            </dl>
            <div className="skill-tags">
              {c.skills?.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
          </section>
          <CandidateDocuments
            candidateId={c._id}
            documents={data.documents}
            onDone={load}
          />
          <section className="recruitment-card">
            <h2>Interviews & feedback</h2>
            {data.interviews.length ? (
              data.interviews.map((x) => (
                <div className="profile-interview" key={x._id}>
                  <span>
                    <CalendarDays size={17} />
                  </span>
                  <div>
                    <strong>{x.round}</strong>
                    <small>
                      {niceDate(x.date)} · {x.startTime} · {x.meetingMode}
                    </small>
                  </div>
                  <Status>{x.status}</Status>
                  {["Scheduled", "Rescheduled"].includes(x.status) &&
                    user.role !== "manager" && (
                      <button
                        className="complete-interview-button"
                        onClick={() => completeInterview(x._id)}
                      >
                        <Check size={14} /> Mark completed
                      </button>
                    )}
                </div>
              ))
            ) : (
              <Empty icon={CalendarDays} />
            )}
          </section>
        </div>
        <aside>
          <section className="recruitment-card">
            <h2>Activity timeline</h2>
            <div className="activity-timeline">
              {data.activity.map((x) => (
                <div key={x._id}>
                  <i />
                  <strong>{x.message || x.action}</strong>
                  <span>
                    {niceDate(x.createdAt)} ·{" "}
                    {new Date(x.createdAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
      {schedule && (
        <ScheduleForm
          candidate={c}
          onClose={() => setSchedule(false)}
          onDone={() => {
            setSchedule(false);
            load();
          }}
        />
      )}
      {selecting && (
        <SelectionForm
          candidate={c}
          onClose={() => setSelecting(false)}
          onDone={() => {
            setSelecting(false);
            load();
          }}
        />
      )}
      {offer && (
        <OfferForm
          candidate={c}
          onClose={() => setOffer(false)}
          onDone={() => {
            setOffer(false);
            navigate("/recruitment/offers");
          }}
        />
      )}
    </>
  );
}

function ReportsView() {
  const [data, setData] = useState(null);
  useEffect(() => {
    recruitmentApi
      .report()
      .then(setData)
      .catch(() => {});
  }, []);
  return (
    <>
      <PageHeader
        title="Recruitment Reports"
        description="Source, department and stage-level hiring insights."
      />
      <div className="report-columns">
        {[
          ["Candidates by source", data?.sources],
          ["Candidates by department", data?.departments],
          ["Pipeline distribution", data?.stages],
        ].map(([title, rows]) => (
          <section className="recruitment-card" key={title}>
            <h2>{title}</h2>
            <div className="simple-bars">
              {rows?.map((x) => (
                <div key={x._id || "Unknown"}>
                  <span>{x._id || "Unknown"}</span>
                  <i>
                    <b style={{ width: `${Math.min(100, x.count * 12)}%` }} />
                  </i>
                  <strong>{x.count}</strong>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function RecruitmentSettings() {
  const [templates, setTemplates] = useState([]);
  const [message, setMessage] = useState("");
  const load = () => recruitmentApi.templates().then(setTemplates);
  useEffect(() => {
    load();
  }, []);
  async function createTemplate() {
    const name = window.prompt("Template name", "Standard Employment Offer");
    if (!name) return;
    try {
      await recruitmentApi.createTemplate({
        name,
        company: "AnanTTattva Private Limited",
        employmentType: "Permanent",
        authorizedSignatory: "Human Resources",
        terms:
          "Subject to background verification, confidentiality, data protection and company policies.",
        emailSubject: "Employment Offer – {{designation}} at {{company_name}}",
        emailBody:
          "Dear {{candidate_name}}, we are pleased to offer you the position of {{designation}}.",
      });
      setMessage("Offer template created.");
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }
  return (
    <>
      <PageHeader
        title="Recruitment Settings"
        description="Configure offer templates and controlled recruitment defaults."
      >
        <button className="primary-button" onClick={createTemplate}>
          <Plus size={15} /> New offer template
        </button>
      </PageHeader>
      {message && <p className="recruitment-notice">{message}</p>}
      <section className="recruitment-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Documents</p>
            <h2>Offer letter templates</h2>
          </div>
        </div>
        <div className="template-grid">
          {templates.map((template) => (
            <article key={template._id}>
              <span>
                <FileText size={20} />
              </span>
              <div>
                <strong>{template.name}</strong>
                <small>
                  {template.company || "All companies"} ·{" "}
                  {template.employmentType || "All employment types"}
                </small>
                <p>
                  {template.authorizedSignatory || "No signatory configured"}
                </p>
              </div>
              <Status>{template.isActive ? "Active" : "Inactive"}</Status>
            </article>
          ))}
        </div>
        {!templates.length && (
          <Empty
            icon={FileText}
            title="No offer templates"
            text="Create a reusable template with company terms and email content."
          />
        )}
      </section>
    </>
  );
}

export function RecruitmentHomeWidgets({ user }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (["super_admin", "hr_admin"].includes(user.role))
      recruitmentApi
        .dashboard()
        .then(setData)
        .catch(() => {});
  }, [user.role]);
  if (!data) return null;
  const today = new Date().toDateString();
  const todaysInterviews = data.interviews.filter(
    (interview) => new Date(interview.date).toDateString() === today,
  );
  const pending = data.offerCounts?.["Pending Super Admin Approval"] || 0;
  return (
    <div className="home-recruitment-grid">
      <section className="recruitment-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recruitment</p>
            <h2>Today&apos;s Interviews</h2>
          </div>
          <a href="/recruitment/interviews">View all</a>
        </div>
        {todaysInterviews.length ? (
          todaysInterviews.map((interview) => (
            <div className="interview-row" key={interview._id}>
              <span>
                <strong>{interview.startTime}</strong>
                <small>{interview.meetingMode}</small>
              </span>
              <div>
                <strong>
                  {interview.candidate?.firstName}{" "}
                  {interview.candidate?.lastName}
                </strong>
                <small>
                  {interview.round} · {interview.candidate?.position}
                </small>
              </div>
            </div>
          ))
        ) : (
          <Empty icon={CalendarDays} title="No interviews today" />
        )}
      </section>
      <section
        className={`recruitment-card home-offer-widget ${user.role === "super_admin" && pending ? "attention" : ""}`}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Offer workflow</p>
            <h2>
              {user.role === "super_admin"
                ? "Offer Letter Approvals"
                : "Offer Letters"}
            </h2>
          </div>
          <a href="/recruitment/approvals">Review</a>
        </div>
        <strong className="home-offer-count">{pending}</strong>
        <p>
          {pending === 1 ? "offer requires" : "offers require"} Super Admin
          approval
        </p>
        <div className="home-offer-stats">
          <span>
            Drafts <b>{data.offerCounts?.Draft || 0}</b>
          </span>
          <span>
            Approved <b>{data.offerCounts?.Approved || 0}</b>
          </span>
          <span>
            Sent <b>{data.offerCounts?.Sent || 0}</b>
          </span>
        </div>
      </section>
    </div>
  );
}

function OfficeLocationsSettings() {
  const empty={name:'',address:'',latitude:'',longitude:'',allowedRadiusMeters:150,maximumAccuracyMeters:100,isPrimary:false,isActive:true};
  const [locations,setLocations]=useState([]),[form,setForm]=useState(empty),[editingId,setEditingId]=useState(null),[locating,setLocating]=useState(false),[message,setMessage]=useState('');
  const load=()=>organizationApi.officeLocations(true).then(setLocations).catch(error=>setMessage(error.message));
  useEffect(()=>{load()},[]);
  function reset(){setForm(empty);setEditingId(null)}
  function edit(location){setEditingId(location._id);setForm({name:location.name||'',address:location.address||'',latitude:location.latitude,longitude:location.longitude,allowedRadiusMeters:location.allowedRadiusMeters||150,maximumAccuracyMeters:location.maximumAccuracyMeters||100,isPrimary:Boolean(location.isPrimary),isActive:Boolean(location.isActive)});window.scrollTo({top:0,behavior:'smooth'})}
  function useCurrentLocation(){setMessage('');if(!navigator.geolocation){setMessage('Location is not supported by this browser.');return}setLocating(true);navigator.geolocation.getCurrentPosition(({coords})=>{setForm(current=>({...current,latitude:Number(coords.latitude.toFixed(7)),longitude:Number(coords.longitude.toFixed(7))}));setMessage(`Office pin captured with ${Math.round(coords.accuracy)} metre GPS accuracy. Review and save the location.`);setLocating(false)},error=>{setMessage(error.code===1?'Allow location access in the browser and try again.':'Unable to capture the current location. Move near a window and try again.');setLocating(false)},{enableHighAccuracy:true,maximumAge:0,timeout:20000})}
  async function submit(event){event.preventDefault();setMessage('');try{const payload={...form,latitude:Number(form.latitude),longitude:Number(form.longitude),allowedRadiusMeters:Number(form.allowedRadiusMeters),maximumAccuracyMeters:Number(form.maximumAccuracyMeters)};if(editingId)await organizationApi.updateOfficeLocation(editingId,payload);else await organizationApi.createOfficeLocation(payload);reset();setMessage(editingId?'Office location updated.':'Office location saved.');load()}catch(error){setMessage(error.message)}}
  return <><PageHeader title="Office Locations" description="Configure the office boundaries used for secure attendance verification."/>{message&&<p className="recruitment-notice">{message}</p>}<div className="organization-settings-grid"><form className="recruitment-card organization-form" onSubmit={submit}><div className="settings-form-heading"><div><h2>{editingId?'Edit office boundary':'Add office boundary'}</h2><p>Capture the pin while physically inside the office for the most accurate geofence.</p></div><button type="button" className="secondary-button" onClick={useCurrentLocation} disabled={locating}><MapPin size={14}/>{locating?'Capturing location…':'Use my current location'}</button></div><div className="form-grid"><Field label="Office name"><input required value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></Field><Field label="Office address"><input value={form.address} onChange={event=>setForm({...form,address:event.target.value})}/></Field><Field label="Latitude"><input required type="number" step="any" value={form.latitude} onChange={event=>setForm({...form,latitude:event.target.value})}/></Field><Field label="Longitude"><input required type="number" step="any" value={form.longitude} onChange={event=>setForm({...form,longitude:event.target.value})}/></Field><Field label="Allowed radius (metres)"><input required type="number" min="10" max="10000" value={form.allowedRadiusMeters} onChange={event=>setForm({...form,allowedRadiusMeters:event.target.value})}/></Field><Field label="Maximum GPS error (metres)"><input required type="number" min="5" max="1000" value={form.maximumAccuracyMeters} onChange={event=>setForm({...form,maximumAccuracyMeters:event.target.value})}/></Field></div><div className="contact-visibility-options"><label><input type="checkbox" checked={form.isPrimary} onChange={event=>setForm({...form,isPrimary:event.target.checked})}/>Primary office</label><label><input type="checkbox" checked={form.isActive} onChange={event=>setForm({...form,isActive:event.target.checked})}/>Active</label></div><div className="drawer-actions office-form-actions">{editingId&&<button type="button" className="secondary-button" onClick={reset}>Cancel editing</button>}<button className="primary-button">{editingId?'Update office location':'Save office location'}</button></div></form><section className="recruitment-card"><h2>Configured boundaries</h2>{locations.map(location=><div className="settings-contact" key={location._id}><span><MapPin size={16}/></span><div><strong>{location.name}</strong><small>{location.address||'Address not configured'}</small><p>{location.latitude}, {location.longitude} · Radius {location.allowedRadiusMeters}m · Accuracy ≤ {location.maximumAccuracyMeters}m</p></div><div className="office-location-actions"><Status>{location.isActive?'Active':'Inactive'}</Status><button type="button" className="secondary-button" onClick={()=>edit(location)}>Edit</button></div></div>)}{!locations.length&&<Empty title="No office locations configured" text="Attendance remains blocked until an authorized office boundary is added."/>}</section></div></>;
}

export function OrganizationSettings() {
  const [data, setData] = useState(null),
    [contacts, setContacts] = useState([]),
    [employees,setEmployees]=useState([]),
    [contactOpen,setContactOpen]=useState(false),
    [contactForm,setContactForm]=useState({category:'Human Resources',employee:'',displayName:'',designation:'',officialPhone:'',officialEmail:'',availability:'',visibilityRoles:[],displayOnHome:true,displayOnLoginPage:false,contactPriority:'primary',displayOrder:0,isActive:true}),
    [message, setMessage] = useState("");
  useEffect(() => {
    Promise.all([organizationApi.get(), organizationApi.contacts(),employeeApi.list()]).then(
      ([org, list,employeeList]) => {
        setData(org.profile);
        setContacts(list);
        setEmployees(employeeList);
      },
    );
  }, []);
  if (!data)
    return <div className="state-message">Loading organization settings…</div>;
  async function save(e) {
    e.preventDefault();
    try {
      setData(await organizationApi.update(data));
      setMessage("Organization profile saved.");
    } catch (x) {
      setMessage(x.message);
    }
  }
  function selectContactEmployee(employeeId){const employee=employees.find(item=>item._id===employeeId);setContactForm(current=>({...current,employee:employeeId,displayName:employee?`${employee.firstName||''} ${employee.lastName||''}`.trim():current.displayName,designation:employee?.designation||current.designation,officialEmail:employee?.officialEmail||current.officialEmail,officialPhone:employee?.mobile||current.officialPhone}))}
  function toggleContactRole(role){setContactForm(current=>({...current,visibilityRoles:current.visibilityRoles.includes(role)?current.visibilityRoles.filter(item=>item!==role):[...current.visibilityRoles,role]}))}
  async function addContact(event) {
    event.preventDefault();setMessage('');
    try{const item=await organizationApi.createContact({...contactForm,displayOrder:contacts.length+1});setContacts([...contacts,item]);setContactOpen(false);setContactForm({category:'Human Resources',employee:'',displayName:'',designation:'',officialPhone:'',officialEmail:'',availability:'',visibilityRoles:[],displayOnHome:true,displayOnLoginPage:false,contactPriority:'primary',displayOrder:0,isActive:true});setMessage('Point of contact added.')}catch(error){setMessage(error.message)}
  }
  return (
    <>
      <PageHeader
        title="Organization Profile"
        description="Manage company information, website, branding and points of contact."
      >
        <button className="primary-button" onClick={() => setContactOpen(true)}>
          <Plus size={15} /> Add contact
        </button>
      </PageHeader>
      {message && <p className="recruitment-notice">{message}</p>}
      {contactOpen&&<div className="drawer-layer"><button className="drawer-backdrop" onClick={()=>setContactOpen(false)}/><aside className="form-drawer"><div className="drawer-heading"><div><p className="eyebrow">Organization settings</p><h2>Add point of contact</h2><p>Only official contact details selected for organizational display are shown.</p></div><button type="button" onClick={()=>setContactOpen(false)}><X size={20}/></button></div><form onSubmit={addContact}><div className="form-grid"><Field label="Category"><select value={contactForm.category} onChange={event=>setContactForm({...contactForm,category:event.target.value})}><option>Human Resources</option><option>Accounts</option><option>Information Technology</option><option>Director</option></select></Field><Field label="Contact priority"><select value={contactForm.contactPriority} onChange={event=>setContactForm({...contactForm,contactPriority:event.target.value})}><option value="primary">Primary contact</option><option value="backup">Backup contact</option></select></Field><Field label="Select employee" className="span-two"><select value={contactForm.employee} onChange={event=>selectContactEmployee(event.target.value)}><option value="">Enter details manually</option>{employees.map(employee=><option value={employee._id} key={employee._id}>{employee.firstName} {employee.lastName} · {employee.employeeCode}</option>)}</select></Field><Field label="Display name"><input required value={contactForm.displayName} onChange={event=>setContactForm({...contactForm,displayName:event.target.value})}/></Field><Field label="Designation"><input value={contactForm.designation} onChange={event=>setContactForm({...contactForm,designation:event.target.value})}/></Field><Field label="Official email"><input type="email" value={contactForm.officialEmail} onChange={event=>setContactForm({...contactForm,officialEmail:event.target.value})}/></Field><Field label="Official phone"><input value={contactForm.officialPhone} onChange={event=>setContactForm({...contactForm,officialPhone:event.target.value})}/></Field><Field label="Availability" className="span-two"><input value={contactForm.availability} onChange={event=>setContactForm({...contactForm,availability:event.target.value})} placeholder="e.g. Monday to Friday, 9:30 AM – 6:30 PM"/></Field></div><div className="contact-visibility-options"><label><input type="checkbox" checked={contactForm.displayOnHome} onChange={event=>setContactForm({...contactForm,displayOnHome:event.target.checked})}/>Display on Home</label><label><input type="checkbox" checked={contactForm.displayOnLoginPage} onChange={event=>setContactForm({...contactForm,displayOnLoginPage:event.target.checked})}/>Display on Login Page</label></div><p className="contact-role-label">Visible roles (leave all clear for everyone)</p><div className="contact-visibility-options">{[['employee','Employee'],['hr_admin','HR'],['it_admin','Admin'],['super_admin','Super Admin']].map(([role,label])=><label key={role}><input type="checkbox" checked={contactForm.visibilityRoles.includes(role)} onChange={()=>toggleContactRole(role)}/>{label}</label>)}</div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>setContactOpen(false)}>Cancel</button><button className="primary-button">Save contact</button></div></form></aside></div>}
      <div className="organization-settings-grid">
        <form className="recruitment-card organization-form" onSubmit={save}>
          <h2>Company information</h2>
          <div className="form-grid">
            <Field label="Company name">
              <input
                value={data.companyName || ""}
                onChange={(e) =>
                  setData({ ...data, companyName: e.target.value })
                }
              />
            </Field>
            <Field label="Industry">
              <input
                value={data.industry || ""}
                onChange={(e) => setData({ ...data, industry: e.target.value })}
              />
            </Field>
            <Field label="Company email">
              <input
                value={data.email || ""}
                onChange={(e) => setData({ ...data, email: e.target.value })}
              />
            </Field>
            <Field label="Company phone">
              <input
                value={data.phone || ""}
                onChange={(e) => setData({ ...data, phone: e.target.value })}
              />
            </Field>
            <Field label="Website" className="span-two">
              <input
                value={data.website || ""}
                onChange={(e) => setData({ ...data, website: e.target.value })}
              />
            </Field>
            <Field label="Description" className="span-two">
              <textarea
                value={data.description || ""}
                onChange={(e) =>
                  setData({ ...data, description: e.target.value })
                }
              />
            </Field>
            <Field label="Head office">
              <input
                value={data.headOfficeAddress || ""}
                onChange={(e) =>
                  setData({ ...data, headOfficeAddress: e.target.value })
                }
              />
            </Field>
            <Field label="City">
              <input
                value={data.city || ""}
                onChange={(e) => setData({ ...data, city: e.target.value })}
              />
            </Field>
            <Field label="Working days">
              <input
                value={data.workingDays || ""}
                onChange={(e) =>
                  setData({ ...data, workingDays: e.target.value })
                }
              />
            </Field>
            <Field label="Working hours">
              <input
                value={data.workingHours || ""}
                onChange={(e) =>
                  setData({ ...data, workingHours: e.target.value })
                }
              />
            </Field>
          </div>
          <button className="primary-button">Save organization profile</button>
        </form>
        <section className="recruitment-card">
          <h2>Points of contact</h2>
          {contacts.map((x) => (
            <div className="settings-contact" key={x._id}>
              <span>{x.displayName.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{x.displayName}</strong>
                <small>
                  {x.category} · {x.designation || "Official contact"}
                </small>
                <p>
                  {x.officialEmail || "No email"} ·{" "}
                  {x.officialPhone || "No phone"}
                </p>
              </div>
              <Status>{x.isActive ? "Active" : "Inactive"}</Status>
            </div>
          ))}
          {!contacts.length && <Empty title="No contacts configured" />}
        </section>
      </div>
    </>
  );
}

export function CompanyHomeSection() {
  const [org, setOrg] = useState(null);
  useEffect(() => {
    organizationApi
      .get()
      .then(setOrg)
      .catch(() => {});
  }, []);
  if (!org) return null;
  const p = org.profile;
  return (
    <>
      <section className="company-home-card">
        <div className="company-home-logo">
          {p.logo ? <img src={p.logo} alt="" /> : <Building2 size={27} />}
        </div>
        <div>
          <p className="eyebrow">Company profile</p>
          <h2>{p.companyName}</h2>
          <span>{p.description}</span>
          <dl>
            <div>
              <dt>Head office</dt>
              <dd>{[p.city, p.state].filter(Boolean).join(", ")}</dd>
            </div>
            <div>
              <dt>Working hours</dt>
              <dd>
                {p.workingDays}
                <br />
                {p.workingHours}
              </dd>
            </div>
          </dl>
        </div>
        {p.website && (
          <a
            href={
              p.website.startsWith("http") ? p.website : `https://${p.website}`
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Visit website <ExternalLink size={14} />
          </a>
        )}
      </section>
      {org.contacts.length > 0 && (
        <section className="home-contacts">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Here to help</p>
              <h2>Points of Contact</h2>
            </div>
          </div>
          <div>
            {org.contacts.map((x) => (
              <article key={x._id}>
                <span>{x.displayName.slice(0, 2).toUpperCase()}</span>
                <div>
                  <small>{x.category}</small>
                  <strong>{x.displayName}</strong>
                  <p>{x.designation}</p>
                </div>
                <footer>
                  {x.officialPhone && (
                    <a href={`tel:${x.officialPhone}`}>
                      <Phone size={14} /> Call
                    </a>
                  )}
                  {x.officialEmail && (
                    <a href={`mailto:${x.officialEmail}`}>
                      <Mail size={14} /> Email
                    </a>
                  )}
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function PublicOfferPage() {
  const token = useLocation().pathname.split("/").pop();
  const [offer, setOffer] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    publicOfferApi
      .get(token)
      .then((data) => {
        setOffer(data);
        publicOfferApi.view(token).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [token]);
  async function accept() {
    const date = window.prompt(
      "Confirm your expected joining date (YYYY-MM-DD)",
      offer?.joiningDate?.slice(0, 10) || "",
    );
    if (!date) return;
    try {
      const result = await publicOfferApi.accept(token, {
        expectedJoiningDate: date,
        comment: "",
      });
      setOffer({ ...offer, status: result.status });
      setMessage(
        "Offer accepted successfully. Human Resources will contact you with onboarding details.",
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function decline() {
    const reason = window.prompt("Please tell us why you are declining");
    if (!reason) return;
    try {
      const result = await publicOfferApi.decline(token, {
        reason,
        comments: "",
      });
      setOffer({ ...offer, status: result.status });
      setMessage("Your response has been recorded.");
    } catch (e) {
      setMessage(e.message);
    }
  }
  if (error)
    return (
      <main className="public-offer-page">
        <div className="public-offer-error">
          <XCircle size={32} />
          <h1>Offer unavailable</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  if (!offer)
    return (
      <main className="public-offer-page">
        <div className="state-message">Opening your secure offer…</div>
      </main>
    );
  return (
    <main className="public-offer-page">
      <header>
        <span>
          <BriefcaseBusiness size={20} />
        </span>{" "}
        AT Connect <small>Secure offer portal</small>
      </header>
      <section className="public-offer-card">
        <div className="offer-welcome">
          <span>
            <FileCheck2 size={28} />
          </span>
          <p>Employment offer</p>
          <h1>Congratulations, {offer.candidate.firstName}!</h1>
          <p>
            We are delighted to offer you the position of{" "}
            <strong>{offer.designation}</strong>.
          </p>
          <Status>{offer.status}</Status>
        </div>
        <div className="public-offer-summary">
          <div>
            <small>Position</small>
            <strong>{offer.designation}</strong>
          </div>
          <div>
            <small>Department</small>
            <strong>{offer.department}</strong>
          </div>
          <div>
            <small>Work location</small>
            <strong>{offer.workLocation}</strong>
          </div>
          <div>
            <small>Joining date</small>
            <strong>{niceDate(offer.joiningDate)}</strong>
          </div>
          <div>
            <small>Annual CTC</small>
            <strong>{money(offer.compensation?.annualCTC)}</strong>
          </div>
          <div>
            <small>Offer valid until</small>
            <strong>{niceDate(offer.terms?.offerValidUntil)}</strong>
          </div>
        </div>
        <a
          className="offer-download"
          href={apiUrl(`/public/offers/${token}/download`)}
        >
          <Download size={16} /> Download offer letter
        </a>
        {message && <p className="public-offer-message">{message}</p>}
        {["Sent", "Viewed"].includes(offer.status) && (
          <div className="public-offer-actions">
            <button className="decline" onClick={decline}>
              Decline offer
            </button>
            <button className="accept" onClick={accept}>
              <CheckCircle2 size={17} /> Accept offer
            </button>
          </div>
        )}
        <p className="public-security">
          <ShieldCheck size={14} /> This secure link is unique to you and
          expires automatically.
        </p>
      </section>
    </main>
  );
}

export default function RecruitmentPage({ user }) {
  const path = useLocation().pathname;
  const [add, setAdd] = useState(false);
  if (path.startsWith("/recruitment/candidates/"))
    return <CandidateProfile user={user} />;
  let content;
  if (path === "/recruitment" || path === "/recruitment/dashboard")
    content = <RecruitmentDashboard onAdd={() => setAdd(true)} />;
  else if (path === "/recruitment/candidates")
    content = <CandidatesView onAdd={() => setAdd(true)} />;
  else if (path === "/recruitment/selected")
    content = <CandidatesView selectedOnly />;
  else if (
    path === "/recruitment/interviews" ||
    path === "/recruitment/my-interviews" ||
    path === "/recruitment/feedback"
  )
    content = <InterviewsView user={user} />;
  else if (path === "/recruitment/calendar")
    content = <InterviewsView user={user} calendar />;
  else if (path === "/recruitment/offers") content = <OffersView user={user} />;
  else if (path === "/recruitment/approvals")
    content = (
      <OffersView user={user} approvals={user.role === "super_admin"} />
    );
  else if (path === "/recruitment/reports") content = <ReportsView />;
  else if (path === "/recruitment/settings") content = <RecruitmentSettings />;
  else if (path === "/settings/office-locations" || path === "/settings/attendance")
    content = <OfficeLocationsSettings />;
  else if (path === "/settings/organization" || path === "/settings/contacts")
    content = <OrganizationSettings />;
  else content = <RecruitmentDashboard onAdd={() => setAdd(true)} />;
  return (
    <>
      {content}
      {add && (
        <CandidateForm
          onClose={() => setAdd(false)}
          onCreated={() => {
            setAdd(false);
            window.location.assign("/recruitment/candidates");
          }}
        />
      )}
    </>
  );
}
