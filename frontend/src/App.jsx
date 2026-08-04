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
} from "./services/api.js";
import { useLocation, useNavigate } from "./router.jsx";
import {
  AttendancePage,
  AllowancesPage,
  EmployeeOnboardingPage,
  EmployeeBiometricPage,
  HolidaysPage,
  LeavePage,
  MySpacePage,
  PeoplePage,
  ReportsPage,
  RequestsPage,
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
  ["Reports", FileText, "/reports"],
  ["Holidays", CalendarDays, "/holidays"],
];
const employeeAllowedPaths = new Set(["/", "/attendance", "/allowances"]);
const recruitmentNavigation = {
  hr_admin: [
    ["Recruitment Dashboard", "/recruitment/dashboard"],
    ["Interview Details", "/recruitment/interviews"],
    ["Candidates", "/recruitment/candidates"],
    ["Interview Calendar", "/recruitment/calendar"],
    ["Selected Candidates", "/recruitment/selected"],
    ["Offer Letters", "/recruitment/offers"],
    ["Approval Requests", "/recruitment/approvals"],
  ],
  super_admin: [
    ["Recruitment Dashboard", "/recruitment/dashboard"],
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
              {recruitmentNavigation[user.role].map(([label, route]) => (
                <button
                  key={route}
                  onClick={() => {
                    navigate(route);
                    close();
                  }}
                  className={`nav-item recruitment-nav-item ${path.startsWith(route) ? "active" : ""}`}
                >
                  <BriefcaseBusiness size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </>
          )}
          {user.role === "super_admin" && (
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

function HomePage({ user, dashboard }) {
  const navigate = useNavigate();
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
        <button className="quick-action" onClick={() => navigate("/leave")}>
          <span>+</span> Quick action <ChevronDown size={15} />
        </button>
      </div>
      <div className="dashboard-grid">
        <div className="main-column">
          <AttendanceCard initial={dashboard?.today} />
          <WeekCard />
        </div>
        <aside className="right-column">
          <HolidaysCard />
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
    "/leave": <LeavePage />,
    "/requests": <RequestsPage user={user} />,
    "/people": <PeoplePage user={user} />,
    "/people/new": <EmployeeOnboardingPage user={user} />,
    "/reports": <ReportsPage />,
    "/holidays": <HolidaysPage user={user} />,
    "/allowances": <AllowancesPage user={user} />,
  };
  const biometricEmployeeMatch = location.pathname.match(/^\/people\/([^/]+)\/biometrics$/);
  const activePage =
    biometricEmployeeMatch ? (
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
