import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Cake,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  HelpCircle,
  Home,
  Inbox,
  IndianRupee,
  LayoutGrid,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  Plane,
  Search,
  Settings,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Login from "./Login.jsx";
import {
  attendanceApi,
  dashboardApi,
  recruitmentApi,
  session,
  workArrangementApi,
} from "./services/api.js";
import { useLocation, useNavigate } from "./router.jsx";
import {
  AttendancePage,
  AllowancesPage,
  EmployeeOnboardingPage,
  EmployeeEditPage,
  EmployeeBiometricPage,
  HolidaysPage,
  LeavePage,
  MySpacePage,
  PeoplePage,
  ReportsPage,
  RequestsPage,
  OrganizationChartPage,
} from "./Pages.jsx";
import AttendanceVerificationDrawer from "./AttendanceVerificationDrawer.jsx";
import RecruitmentPage, {
  CompanyHomeSection,
  PublicOfferPage,
  RecruitmentHomeWidgets,
} from "./Recruitment.jsx";
import "./notification-menu.css";

const navigation = [
  ["Home", Home, "/"],
  ["My Space", LayoutGrid, "/my-space"],
  ["Attendance", Clock3, "/attendance"],
  ["Leave", Plane, "/leave"],
  ["Requests", Inbox, "/requests"],
  ["Allowances", IndianRupee, "/allowances"],
];
const teamNavigation = [
  ["People", UsersRound, "/people"],
  ["Organization Chart", UsersRound, "/organization-chart"],
  ["Reports", FileText, "/reports"],
  ["Holidays", CalendarDays, "/holidays"],
];
const employeeAllowedPaths = new Set(["/", "/attendance", "/leave", "/allowances"]);
const recruitmentNavigation = {
  hr_admin: [
    ["Recruitment Dashboard", "/recruitment/dashboard"],
    ["Interview Details", "/recruitment/interviews"],
    ["Candidates", "/recruitment/candidates"],
    ["Interview Calendar", "/recruitment/calendar"],
    ["Selected Candidates", "/recruitment/selected"],
    ["Offer Letters", "/recruitment/offers"],
  ],
  super_admin: [
    ["Recruitment Dashboard", "/recruitment/dashboard"],
    ["Interview Details", "/recruitment/interviews"],
    ["Candidates", "/recruitment/candidates"],
    ["Selected Candidates", "/recruitment/selected"],
    ["Offer Letters", "/recruitment/offers"],
    ["Offer Letter Approvals", "/recruitment/approvals"],
    ["Recruitment Reports", "/recruitment/reports"],
    ["Recruitment Settings", "/recruitment/settings"],
  ],
  admin: [
    ["Recruitment Dashboard", "/recruitment/dashboard"],
    ["Interview Details", "/recruitment/interviews"],
    ["Candidates", "/recruitment/candidates"],
    ["Selected Candidates", "/recruitment/selected"],
    ["Offer Letters", "/recruitment/offers"],
    ["Offer Letter Approvals", "/recruitment/approvals"],
    ["Recruitment Reports", "/recruitment/reports"],
    ["Recruitment Settings", "/recruitment/settings"],
  ],
  manager: [
    ["My Interviews", "/recruitment/my-interviews"],
    ["Candidate Feedback", "/recruitment/feedback"],
  ],
};
const initials = (user) =>
  `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}`;

function Avatar({ children, tone = "teal" }) {
  return <span className={`avatar avatar-${tone} avatar-md`}>{children}</span>;
}

function Sidebar({ open, close, user, employee, path, navigate }) {
  const [recruitmentOpen,setRecruitmentOpen]=useState(path.startsWith('/recruitment'));
  const recruitmentExpanded=recruitmentOpen||path.startsWith('/recruitment');
  const primaryNavigation = user.role === "employee"
    ? navigation.filter(([, , route]) => employeeAllowedPaths.has(route))
    : navigation;
  return (
    <>
      <button
        className={open ? "backdrop" : "backdrop hidden"}
        aria-label="Close menu"
        onClick={close}
      />
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          <span>AT Connect</span>
          <button className="mobile-close" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <nav className="nav">
          {primaryNavigation.map(([label, Icon, route]) => (
            <button
              key={label}
              onClick={() => {
                navigate(route);
                close();
              }}
              className={`nav-item ${path === route || (route !== "/" && path.startsWith(`${route}/`)) ? "active" : ""}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Requests" && <span className="nav-badge">2</span>}
            </button>
          ))}
          {user.role !== "employee" && <p className="nav-label">Team</p>}
          {user.role !== "employee" && teamNavigation.map(([label, Icon, route]) => (
            <button
              key={label}
              onClick={() => {
                navigate(route);
                close();
              }}
              className={`nav-item ${path === route || (route !== "/" && path.startsWith(`${route}/`)) ? "active" : ""}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
          {recruitmentNavigation[user.role] && (
            <>
              <p className="nav-label">Recruitment</p>
              <button type="button" onClick={()=>setRecruitmentOpen(value=>!value)} className={`nav-item recruitment-parent ${path.startsWith('/recruitment')?'active':''}`} aria-expanded={recruitmentExpanded}>
                <BriefcaseBusiness size={18}/><span>Candidate Recruitment</span><ChevronDown className={recruitmentExpanded?'':'rotated'} size={16}/>
              </button>
              {recruitmentExpanded&&<div className="subnav recruitment-subnav">{recruitmentNavigation[user.role].map(([label, route]) => (
                <button key={route} onClick={()=>{navigate(route);close()}} className={`nav-item recruitment-nav-item ${path.startsWith(route)?"active":""}`}>
                  <span>{label}</span>
                </button>
              ))}</div>}
            </>
          )}
          {["super_admin", "admin"].includes(user.role) && (
            <>
              <p className="nav-label">Settings</p>
              <button
                onClick={() => {
                  navigate("/settings/organization");
                  close();
                }}
                className={`nav-item ${path.startsWith("/settings") ? "active" : ""}`}
              >
                <Settings size={17} />
                <span>Organization Profile</span>
              </button>
              <button onClick={()=>{navigate('/settings/contacts');close()}} className={`nav-item ${path==='/settings/contacts'?'active':''}`}><UsersRound size={17}/><span>Points of Contact</span></button>
              <button onClick={()=>{navigate('/settings/office-locations');close()}} className={`nav-item ${path==='/settings/office-locations'?'active':''}`}><MapPin size={17}/><span>Office Locations</span></button>
              <button onClick={()=>{navigate('/settings/attendance');close()}} className={`nav-item ${path==='/settings/attendance'?'active':''}`}><Clock3 size={17}/><span>Attendance Settings</span></button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          {user.role !== "employee" && <button className="nav-item">
            <HelpCircle size={18} />
            <span>Help & support</span>
          </button>}
          <div className="sidebar-user">
            <Avatar>{initials(user)}</Avatar>
            <div>
              <strong>
                {user.firstName} {user.lastName}
              </strong>
              <span>{employee?.department || user.role.replace("_", " ")}</span>
            </div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
    </>
  );
}

function Header({ openMenu, user, logout, navigate }) {
  const [profile, setProfile] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  useEffect(() => {
    recruitmentApi
      .notifications()
      .then(setNotifications)
      .catch(() => {});
  }, []);
  return (
    <header className="topbar">
      <button className="menu-button" onClick={openMenu}>
        <Menu size={21} />
      </button>
      <div className="search-box">
        <Search size={17} />
        <input
          placeholder="Search people, pages or actions..."
          onKeyDown={(event) => event.key === "Enter" && navigate(`/people`)}
        />
        <span>⌘ K</span>
      </div>
      <div className="top-actions">
        <button className="inbox-button" onClick={() => navigate("/requests")}>
          <Inbox size={18} />
          <span>Inbox</span>
          <b>2</b>
        </button>
        <div className="notification-wrap">
          <button className="icon-button notification" aria-label={`${notifications.filter((item) => !item.readAt).length} unread notifications`} onClick={() => setNotificationOpen(!notificationOpen)}>
            <Bell size={19} />
            {notifications.some((item) => !item.readAt) && <i />}
          </button>
          {notificationOpen && <div className="notification-menu">
            <div className="notification-menu-heading"><div><span>Notifications</span><small>{notifications.filter((item) => !item.readAt).length} unread</small></div><button onClick={() => setNotificationOpen(false)}><X size={16}/></button></div>
            <div className="notification-menu-list">{notifications.length ? notifications.map((item) => <article key={item._id} className={item.readAt ? "" : "unread"}><span><Bell size={14}/></span><div><strong>{item.title || item.type}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString("en-IN")}</small></div></article>) : <p className="notification-empty">No notifications yet.</p>}</div>
          </div>}
        </div>
        <div className="profile-wrap">
          <button
            className="profile-button"
            onClick={() => setProfile(!profile)}
          >
            <Avatar>{initials(user)}</Avatar>
            <span>
              <strong>{user.firstName}</strong>
              <small>{user.role.replace("_", " ")}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {profile && (
            <div className="profile-menu">
              <button onClick={() => navigate("/my-space")}>
                <UserRound size={16} /> My profile
              </button>
              <button>
                <Settings size={16} /> Settings
              </button>
              <hr />
              <button className="danger" onClick={logout}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function LegacyAttendanceVerificationDrawer({ mode, close, recorded }) {
  const videoRef = useRef(null),
    canvasRef = useRef(null),
    [stream, setStream] = useState(null),
    [photo, setPhoto] = useState(""),
    [coordinates, setCoordinates] = useState(null),
    [locationError, setLocationError] = useState(
      navigator.geolocation ? "" : "Location is not supported by this browser.",
    ),
    [cameraError, setCameraError] = useState(
      navigator.mediaDevices?.getUserMedia
        ? ""
        : "Camera is not supported by this browser.",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let activeStream;
    if (navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          setCoordinates({
            latitude: coords.latitude,
            longitude: coords.longitude,
          }),
        (positionError) =>
          setLocationError(
            positionError.code === 1
              ? "Location permission was denied. Please allow it and try again."
              : "Unable to determine your current location.",
          ),
        { timeout: 12000, enableHighAccuracy: true, maximumAge: 0 },
      );
    if (navigator.mediaDevices?.getUserMedia)
      navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        })
        .then((mediaStream) => {
          activeStream = mediaStream;
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch(() =>
          setCameraError("Camera permission is required to record attendance."),
        );
    return () => activeStream?.getTracks().forEach((track) => track.stop());
  }, []);
  function capture() {
    const video = videoRef.current,
      canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext("2d").drawImage(video, 0, 0, 640, 480);
    setPhoto(canvas.toDataURL("image/jpeg", 0.72));
    stream?.getTracks().forEach((track) => track.stop());
  }
  async function submit() {
    if (!photo || !coordinates) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        photo,
        attendanceMode: "office",
        locationVerified: true,
        location: coordinates,
      };
      const result =
        mode === "check-out"
          ? await attendanceApi.checkOut(payload)
          : await attendanceApi.checkIn(payload);
      recorded(result);
      close();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  function retake() {
    setPhoto("");
    setCameraError("");
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      })
      .then((mediaStream) => {
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => setCameraError("Unable to reopen camera."));
  }
  const ready = Boolean(photo && coordinates);
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={close} />
      <aside className="attendance-drawer">
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">Attendance verification</p>
            <h2>{mode === "check-out" ? "Web check out" : "Web check in"}</h2>
            <p>Verify your location and capture a live photo.</p>
          </div>
          <button onClick={close}>
            <X size={20} />
          </button>
        </div>
        <div className="verification-section">
          <p className="verification-label">1 · Current location</p>
          {coordinates ? (
            <div className="verification-success">
              <CheckCircle2 size={18} />
              <div>
                <strong>Location captured</strong>
                <span>
                  {coordinates.latitude.toFixed(6)},{" "}
                  {coordinates.longitude.toFixed(6)}
                </span>
              </div>
            </div>
          ) : locationError ? (
            <div className="verification-error">{locationError}</div>
          ) : (
            <div className="verification-loading">
              <span /> Getting your precise location…
            </div>
          )}
        </div>
        <div className="verification-section">
          <p className="verification-label">2 · Live photo</p>
          <div className="camera-frame">
            {photo ? (
              <img src={photo} alt="Attendance capture" />
            ) : (
              <video ref={videoRef} muted playsInline />
            )}
            {!photo && !stream && !cameraError && (
              <div className="camera-placeholder">
                <UserRound size={30} />
                <span>Opening camera…</span>
              </div>
            )}
            {cameraError && (
              <div className="camera-placeholder error">
                <UserRound size={30} />
                <span>{cameraError}</span>
              </div>
            )}
            <div className="face-guide" />
          </div>
          <canvas ref={canvasRef} hidden />
          {photo ? (
            <button className="secondary-button camera-action" onClick={retake}>
              Retake photo
            </button>
          ) : (
            <button
              className="secondary-button camera-action"
              disabled={!stream}
              onClick={capture}
            >
              Capture photo
            </button>
          )}
        </div>
        {error && <p className="attendance-error drawer-error">{error}</p>}
        <div className="attendance-drawer-footer">
          <div>
            <Clock3 size={16} />
            <span>Time will be generated securely by the server.</span>
          </div>
          <button
            className="primary-button"
            disabled={!ready || busy}
            onClick={submit}
          >
            {busy
              ? "Recording attendance…"
              : mode === "check-out"
                ? "Confirm check out"
                : "Confirm check in"}{" "}
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
    </div>
  );
}

function AttendanceCard({ initial }) {
  const [record, setRecord] = useState(initial);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const checkedIn = Boolean(record?.checkIn?.time && !record?.checkOut?.time);
  const completed = Boolean(record?.checkOut?.time);
  const start = record?.checkIn?.time ? new Date(record.checkIn.time) : null;
  const end = completed ? new Date(record.checkOut.time) : now;
  const worked = start ? Math.max(0, Math.floor((end - start) / 60000)) : 0;
  const workedText = `${String(Math.floor(worked / 60)).padStart(2, "0")}h ${String(worked % 60).padStart(2, "0")}m`;
  return (
    <>
      <section className="card attendance-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Today</p>
            <h2>My attendance</h2>
          </div>
          <span className={`status ${record ? "present" : "neutral"}`}>
            <i />
            {completed
              ? "Completed"
              : checkedIn
                ? "Checked in"
                : "Not checked in"}
          </span>
        </div>
        <div className="shift-row">
          <div className="shift-icon">
            <CalendarDays size={19} />
          </div>
          <div>
            <span>General shift</span>
            <strong>10:00 AM – 6:30 PM</strong>
            <small>15 min grace · On time through 10:15 AM</small>
          </div>
          <button>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="clock-block">
          {start ? (
            <>
              <p className="clock-label">
                {completed
                  ? "Total hours"
                  : `Working since ${start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
              </p>
              <div className="live-time">{workedText}</div>
              <div className="progress">
                <span
                  style={{ width: `${Math.min(100, (worked / 510) * 100)}%` }}
                />
              </div>
              <div className="progress-label">
                <span>Shift progress</span>
                <b>{Math.round(Math.min(100, (worked / 510) * 100))}%</b>
              </div>
            </>
          ) : (
            <>
              <p className="clock-label">Current time</p>
              <div className="live-time">
                {now.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <p className="clock-note">You haven’t checked in yet</p>
            </>
          )}
        </div>
        {record?.checkIn?.photo && (
          <div className="today-proof">
            <img src={record.checkIn.photo} alt="Today's check-in" />
            <div>
              <span>Attendance photo</span>
              <strong>
                {completed
                  ? "Check-in proof saved"
                  : "Identity captured successfully"}
              </strong>
            </div>
            <CheckCircle2 size={18} />
          </div>
        )}
        <button
          className={`attendance-button ${checkedIn ? "checkout" : ""}`}
          disabled={completed}
          onClick={() => setCaptureOpen(true)}
        >
          {completed
            ? "Attendance completed"
            : checkedIn
              ? "Web check out"
              : "Web check in"}{" "}
          <ChevronRight size={17} />
        </button>
        <div className="requirements">
          <span>
            <CheckCircle2 size={14} /> Live location required
          </span>
          <span>
            <CheckCircle2 size={14} /> Photo required
          </span>
        </div>
      </section>
      {captureOpen && (
        <AttendanceVerificationDrawer
          mode={checkedIn ? "check-out" : "check-in"}
          close={() => setCaptureOpen(false)}
          recorded={setRecord}
        />
      )}
    </>
  );
}

function WeekCard() {
  const navigate = useNavigate();
  const days = [
    ["M", "27", "done"],
    ["T", "28", "done"],
    ["W", "29", "done"],
    ["T", "30", "late"],
    ["F", "31", "today"],
  ];
  return (
    <section className="card week-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">This week</p>
          <h2>My week</h2>
        </div>
        <button className="link-button" onClick={() => navigate("/attendance")}>
          View attendance <ChevronRight size={15} />
        </button>
      </div>
      <div className="week-days">
        {days.map(([day, date, state], i) => (
          <div key={i} className={`week-day ${state}`}>
            <span>{day}</span>
            <b>{date}</b>
            <i>
              {state === "done" ? (
                <Check size={13} />
              ) : state === "late" ? (
                "Late"
              ) : (
                "Today"
              )}
            </i>
          </div>
        ))}
      </div>
      <div className="week-summary">
        <div>
          <span>Effective hours</span>
          <strong>31h 42m</strong>
        </div>
        <div>
          <span>Avg. hours</span>
          <strong>7h 55m</strong>
        </div>
        <div>
          <span>On time</span>
          <strong>3 of 4 days</strong>
        </div>
      </div>
    </section>
  );
}

function HolidaysCard() {
  const navigate = useNavigate();
  return (
    <section className="card side-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>Upcoming holidays</h2>
        </div>
        <MoreHorizontal size={18} />
      </div>
      {[
        ["15", "Aug", "Independence Day", "Friday · In 15 days"],
        ["27", "Aug", "Raksha Bandhan", "Thursday · In 27 days"],
      ].map(([day, month, name, meta], i) => (
        <div className="holiday" key={name}>
          <div className={`date-tile ${i ? "amber" : ""}`}>
            <b>{day}</b>
            <span>{month}</span>
          </div>
          <div>
            <strong>{name}</strong>
            <span>{meta}</span>
          </div>
        </div>
      ))}
      <button className="full-link" onClick={() => navigate("/holidays")}>
        View holiday calendar <ChevronRight size={15} />
      </button>
    </section>
  );
}
function CelebrationCard({ birthdays = [] }) {
  const birthday = birthdays[0];
  const name = birthday ? `${birthday.firstName} ${birthday.lastName}` : "";
  const birthdayDate = birthday ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long" }).format(new Date(birthday.date)) : "";
  const timing = birthday?.daysUntil === 0 ? "today" : birthday?.daysUntil === 1 ? "tomorrow" : `on ${birthdayDate}`;
  return (
    <section className="card side-card celebration">
      <div className="celebration-icon">
        <Cake size={20} />
      </div>
      <div>
        <p className="eyebrow">Celebrations</p>
        <h2>{birthday ? `${name}'s birthday is ${timing}` : "No birthdays in the next 30 days"}</h2>
        <span>{birthday ? birthday.daysUntil === 0 ? "Send your teammate some good wishes." : `${birthday.daysUntil} days to go.` : "Birthdays will appear after HR adds employee dates of birth."}</span>
        {birthdays.length > 1 && <small>+{birthdays.length-1} more upcoming birthday{birthdays.length>2?'s':''}</small>}
      </div>
    </section>
  );
}
function MobileNav({ user }) {
  const navigate = useNavigate(),
    location = useLocation();
  const mobileItems = user.role === "employee"
    ? [[Home, "Home", "/"], [Clock3, "Attendance", "/attendance"], [IndianRupee, "Allowances", "/allowances"]]
    : [[Home, "Home", "/"], [Clock3, "Attendance", "/attendance"], [Inbox, "Requests", "/requests"], [UserRound, "Profile", "/my-space"]];
  return (
    <nav className="mobile-nav">
      {mobileItems.map(([Icon, label, path]) => (
        <button
          key={label}
          onClick={() => navigate(path)}
          className={location.pathname === path ? "active" : ""}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

const durationClock = (totalSeconds = 0) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 3600)).padStart(2, "0")}:${String(Math.floor((safe % 3600) / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

function ModernAttendanceCard() {
  const navigate=useNavigate();
  const [attendance, setAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [availableModes, setAvailableModes] = useState(["office"]);
  const [selectedMode, setSelectedMode] = useState("office");
  const [now, setNow] = useState(new Date());
  const refresh = async () => {
    setError("");
    try {
      const [today, arrangements] = await Promise.all([attendanceApi.today(), workArrangementApi.today()]);
      setAttendance(today);
      setAvailableModes(arrangements.modes || ["office"]);
      if (today.attendanceMode) setSelectedMode(today.attendanceMode);
    }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    Promise.all([attendanceApi.today(),workArrangementApi.today()]).then(([today,arrangements])=>{setAttendance(today);setAvailableModes(arrangements.modes||["office"]);if(today.attendanceMode)setSelectedMode(today.attendanceMode)}).catch(requestError=>setError(requestError.message)).finally(()=>setLoading(false));
  }, []);
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  if (loading) return <section className="card attendance-card attendance-skeleton" aria-label="Loading today's attendance"><div className="skeleton-line wide"/><div className="skeleton-block"/><div className="skeleton-line"/></section>;
  const state = attendance?.state || "NOT_CHECKED_IN";
  const checkedIn = state === "CHECKED_IN";
  const completed = state === "CHECKED_OUT";
  const pendingApproval = Boolean(attendance?.manualCheckInRequest);
  const checkInTime = attendance?.checkIn?.time ? new Date(attendance.checkIn.time) : null;
  const checkOutTime = attendance?.checkOut?.time ? new Date(attendance.checkOut.time) : null;
  const durationSeconds = checkInTime ? Math.max(0, Math.floor(((checkOutTime || now) - checkInTime) / 1000)) : 0;
  const shift = attendance?.shift || { name:"General Shift", startTime:"10:00", endTime:"18:30" };
  const [startHour,startMinute] = shift.startTime.split(":").map(Number);
  const [endHour,endMinute] = shift.endTime.split(":").map(Number);
  const shiftSeconds = Math.max(60, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) * 60);
  const progress = Math.min(100, Math.round(durationSeconds / shiftSeconds * 100));
  const office = attendance?.checkIn?.officeName || (selectedMode === "office" ? "Configured office" : selectedMode.replaceAll("_", " "));
  return <>
    <section className={`card attendance-card attendance-state-${state.toLowerCase()}`}>
      <div className="card-heading"><div><p className="eyebrow">Today&apos;s attendance</p><h2>{shift.name}</h2></div><span className={`status ${state === "NOT_CHECKED_IN" ? "neutral" : "present"}`}><i/>{completed ? "Day completed" : checkedIn ? "Checked in" : pendingApproval ? "Approval pending" : "Not checked in"}</span></div>
      <div className="shift-row"><div className="shift-icon"><CalendarDays size={19}/></div><div><span>Shift timing</span><strong>{shift.startTime} – {shift.endTime}</strong><small>{office}</small></div></div>
      {error ? <div className="attendance-error" role="alert">{error}</div> : state === "NOT_CHECKED_IN" ? <div className="clock-block"><p className="clock-label">Current time</p><div className="live-time">{now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div><p className="clock-note">You haven&apos;t checked in yet.</p></div> : <div className="attendance-live-layout"><div className="duration-ring" style={{"--progress":`${progress * 3.6}deg`}}><div><strong>{durationClock(durationSeconds)}</strong><span>{completed ? "Total working" : "Working duration"}</span></div></div><dl className="attendance-facts"><div><dt>Check-In</dt><dd>{checkInTime?.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) || "Unavailable"}</dd></div><div><dt>Check-Out</dt><dd>{checkOutTime?.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) || "In progress"}</dd></div><div><dt>Office</dt><dd>{office}</dd></div><div><dt>Location</dt><dd>{attendance?.checkIn?.distanceMeters != null ? `Verified · ${attendance.checkIn.distanceMeters}m` : "Verified"}</dd></div><div><dt>Face</dt><dd>{attendance?.checkIn?.source === "manual_approval" ? "HR approved" : "Verified"}</dd></div><div><dt>Shift progress</dt><dd>{progress}%</dd></div></dl></div>}
      {attendance?.checkoutType === "AUTO_CHECKOUT" && <div className="auto-checkout-banner"><strong>Your previous attendance session was automatically closed.</strong><span>Request an attendance correction if the recorded effective hours are inaccurate.</span></div>}
      {pendingApproval && <div className="late-policy-banner"><strong>Manual check-in awaiting approval</strong><span>HR or Admin will review the captured selfie and original attempt time. You will be notified after a decision.</span></div>}
      {attendance?.late?.isLate && <div className="late-policy-banner"><strong>{attendance.late.halfDayPenaltyApplied ? "Half-Day Penalty Applied" : "Late Arrival"}</strong><span>{attendance.late.lateMinutes} minutes late · Monthly count: {attendance.late.monthlyLateCount}</span></div>}
      {!pendingApproval && !checkedIn && !completed && availableModes.length > 1 && <div className="attendance-mode-picker" aria-label="Attendance mode">{availableModes.map(item=><button key={item} className={selectedMode===item?'active':''} onClick={()=>setSelectedMode(item)}>{item==='office'?'Office':item==='wfh'?'Work from home':item==='client_location'?'Client location':'Field visit'}</button>)}</div>}
      {!pendingApproval && !completed && !error && <button className={`attendance-button ${checkedIn ? "checkout" : ""}`} onClick={() => setDrawerOpen(true)}>{checkedIn ? "Check Out" : `Check In · ${selectedMode==='office'?'Office':selectedMode.replaceAll('_',' ')}`}<ChevronRight size={17}/></button>}
      {completed && <button className="full-link" onClick={() => navigate("/attendance")}>View attendance details <ChevronRight size={15}/></button>}
      <div className="requirements"><span><CheckCircle2 size={14}/>Location required</span><span><CheckCircle2 size={14}/>Face verification required</span></div>
    </section>
    {drawerOpen && <AttendanceVerificationDrawer mode={checkedIn ? "check-out" : "check-in"} attendanceMode={checkedIn ? attendance.attendanceMode : selectedMode} close={() => setDrawerOpen(false)} recorded={refresh}/>}
  </>;
}

function RealWeekCard({ days = [], summary = {} }) {
  const navigate=useNavigate();
  const hours=minutes=>`${Math.floor((minutes||0)/60)}h ${String((minutes||0)%60).padStart(2,"0")}m`;
  return <section className="card week-card"><div className="card-heading"><div><p className="eyebrow">This week</p><h2>My week</h2></div><button className="link-button" onClick={()=>navigate("/attendance")}>View attendance <ChevronRight size={15}/></button></div><div className="week-days">{days.map((item,index)=>{const date=new Date(item.date);const state=item.lateMinutes?"late":item.status==="today"?"today":item.status==="upcoming"?"upcoming":item.status==="not_recorded"?"neutral":"done";return <div key={index} className={`week-day ${state}`}><span>{date.toLocaleDateString("en-IN",{weekday:"short"}).toUpperCase()}</span><b>{date.getDate()}</b><i>{item.workingMinutes?hours(item.workingMinutes):state==="today"?"Today":state==="upcoming"?"Upcoming":state==="late"?"Late":"—"}</i></div>})}</div><div className="week-summary"><div><span>Effective hours</span><strong>{hours(summary.effectiveMinutes)}</strong></div><div><span>Avg. hours</span><strong>{hours(summary.averageMinutes)}</strong></div><div><span>On time</span><strong>{summary.onTimeDays||0} of {summary.completedDays||0} days</strong></div><div><span>Late count</span><strong>{summary.monthlyLateCount||0} this month</strong></div></div></section>;
}

function RealHolidaysCard({ holidays = [] }) {
  const navigate=useNavigate();
  return <section className="card side-card"><div className="card-heading"><div><p className="eyebrow">Calendar</p><h2>Upcoming holidays</h2></div><CalendarDays size={18}/></div>{holidays.map((holiday,index)=>{const date=new Date(holiday.date);const daysUntil=Math.max(0,Math.ceil((date-new Date())/86400000));return <div className="holiday" key={holiday._id||holiday.name}><div className={`date-tile ${index?"amber":""}`}><b>{date.getDate()}</b><span>{date.toLocaleDateString("en-IN",{month:"short"})}</span></div><div><strong>{holiday.name}</strong><span>{date.toLocaleDateString("en-IN",{weekday:"long"})} · {daysUntil===0?"Today":`In ${daysUntil} days`}</span></div></div>})}{!holidays.length&&<p className="compact-empty">No upcoming holidays configured.</p>}<button className="full-link" onClick={()=>navigate("/holidays")}>View holiday calendar <ChevronRight size={15}/></button></section>;
}

function WorkforceDemographicsCard({ demographics }) {
  if(!demographics)return null;
  const total=demographics.male+demographics.female+demographics.nonBinary+demographics.preferNotToSay+demographics.notSpecified;
  return <section className="card side-card workforce-demographics-card"><div className="card-heading"><div><p className="eyebrow">Workforce</p><h2>Employee demographics</h2></div><UsersRound size={18}/></div><div className="demographic-grid"><div><span>Male employees</span><strong>{demographics.male}</strong></div><div><span>Female employees</span><strong>{demographics.female}</strong></div><div><span>Other / private</span><strong>{demographics.nonBinary+demographics.preferNotToSay}</strong></div><div><span>Not specified</span><strong>{demographics.notSpecified}</strong></div></div><small className="demographic-total">{total} active employees · Counts use employee records only</small></section>;
}

function HomePage({ user, dashboard }) {
  const navigate = useNavigate();
  const quickAction=['super_admin','admin'].includes(user.role)?{label:'Review offer approvals',route:'/recruitment/approvals'}:user.role==='hr_admin'?{label:'Add candidate',route:'/recruitment/candidates'}:{label:dashboard?.today?.checkIn?.time?'View attendance':'Check in',route:'/attendance'};
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12
      ? "Good morning"
      : hour < 17
        ? "Good afternoon"
        : "Good evening";
  }, []);
  const date = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <>
      <div className="welcome">
        <div>
          <p className="breadcrumb">
            Home <ChevronRight size={13} /> My dashboard
          </p>
          <h1>
            {greeting}, {user.firstName} <span>👋</span>
          </h1>
          <p>
            {date} <i /> Here’s what’s happening today.
          </p>
        </div>
        <button className="quick-action" onClick={() => navigate(quickAction.route)}>
          <span>+</span> {quickAction.label} <ChevronRight size={15} />
        </button>
      </div>
      <div className="dashboard-grid">
        <div className="main-column">
          <ModernAttendanceCard />
          <RealWeekCard days={dashboard?.week} summary={dashboard?.weekSummary}/>
        </div>
        <aside className="right-column">
          <WorkforceDemographicsCard demographics={dashboard?.demographics}/>
          <RealHolidaysCard holidays={dashboard?.holidays}/>
          <CelebrationCard birthdays={dashboard?.birthdays} />
        </aside>
      </div>
      <RecruitmentHomeWidgets user={user} />
      <CompanyHomeSection />
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null),
    [dashboard, setDashboard] = useState(null),
    [loading, setLoading] = useState(Boolean(session.getToken())),
    [menu, setMenu] = useState(false);
  const navigate = useNavigate(),
    location = useLocation();
  useEffect(() => {
    if (!session.getToken()) return;
    dashboardApi
      .employee()
      .then((data) => {
        setDashboard(data);
        setUser(data.user);
      })
      .catch(() => session.clear())
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user?.role === "employee" && !employeeAllowedPaths.has(location.pathname) && !location.pathname.startsWith("/public/offers/")) navigate("/");
  }, [user, location.pathname, navigate]);
  if (location.pathname.startsWith("/public/offers/"))
    return <PublicOfferPage />;
  async function authenticated(authUser) {
    setUser(authUser);
    setLoading(true);
    try {
      setDashboard(await dashboardApi.employee());
    } finally {
      setLoading(false);
    }
  }
  function logout() {
    session.clear();
    setUser(null);
    setDashboard(null);
  }
  if (loading)
    return (
      <div className="app-loader">
        <span className="brand-mark">
          <Sparkles size={18} />
        </span>
        <p>Loading your workspace…</p>
      </div>
    );
  if (!user) return <Login onAuthenticated={authenticated} />;
  const pages = {
    "/": <HomePage user={user} dashboard={dashboard} />,
    "/my-space": <MySpacePage />,
    "/attendance": <AttendancePage user={user} />,
    "/leave": <LeavePage user={user} />,
    "/requests": <RequestsPage user={user} />,
    "/people": <PeoplePage user={user} />,
    "/organization-chart": <OrganizationChartPage />,
    "/people/new": <EmployeeOnboardingPage user={user} />,
    "/reports": <ReportsPage />,
    "/holidays": <HolidaysPage user={user} />,
    "/allowances": <AllowancesPage user={user} />,
  };
  const biometricEmployeeMatch = location.pathname.match(/^\/people\/([^/]+)\/biometrics$/);
  const editEmployeeMatch = location.pathname.match(/^\/people\/([^/]+)\/edit$/);
  const activePage =
    editEmployeeMatch ? (
      <EmployeeEditPage employeeId={editEmployeeMatch[1]} user={user} />
    ) : biometricEmployeeMatch ? (
      <EmployeeBiometricPage employeeId={biometricEmployeeMatch[1]} />
    ) : location.pathname.startsWith("/recruitment") ||
    location.pathname.startsWith("/settings/") ? (
      <RecruitmentPage user={user} />
    ) : (
      pages[location.pathname] || pages["/"]
    );
  return (
    <div className="app-shell">
      <Sidebar
        open={menu}
        close={() => setMenu(false)}
        user={user}
        employee={dashboard?.employee}
        path={location.pathname}
        navigate={navigate}
      />
      <div className="app-main">
        <Header
          openMenu={() => setMenu(true)}
          user={user}
          logout={logout}
          navigate={navigate}
        />
        <main className={location.pathname === "/" ? "" : "page-content"}>
          {activePage}
        </main>
      </div>
      <MobileNav user={user} />
    </div>
  );
}
