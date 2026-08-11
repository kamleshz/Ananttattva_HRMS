const API_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, "");
const TOKEN_KEY = "peoplepulse_access_token";
export const SERVER_FACE_ENABLED = import.meta.env.VITE_FACE_ENGINE === 'uniface';
const BIOMETRIC_API_URL = (import.meta.env.VITE_BIOMETRIC_API_URL || API_URL).replace(/\/+$/, '');

export function apiUrl(path = "") {
  if (!path) return API_URL;
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const session = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl(path), { ...options, headers });
  const payload = await response
    .json()
    .catch(() => ({ message: "Invalid server response" }));
  if (!response.ok) {
    if (response.status === 401) session.clear();
    const issue = Array.isArray(payload.details) ? payload.details[0] : null;
    const field = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new Error(
      issue?.message ? `${field}${issue.message}` : payload.message || "Request failed",
    );
  }
  return payload.data;
}

async function biometricRequest(path, options = {}) {
  const headers={"Content-Type":"application/json",...options.headers};
  const token=session.getToken();if(token)headers.Authorization=`Bearer ${token}`;
  let response;
  try { response=await fetch(`${BIOMETRIC_API_URL}${path}`,{...options,headers}); }
  catch (cause) { const error=new Error('The biometric service could not be reached.');error.code='NETWORK_FAILED';error.cause=cause;throw error; }
  const payload=await response.json().catch(()=>({message:'Invalid biometric service response'}));
  if(!response.ok){const error=new Error(payload.message||'Biometric request failed');error.code=payload.details?.[0]?.code;throw error}
  return payload.data;
}

export async function uploadApi(path, formData) {
  const headers = {};
  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers,
    body: formData,
  });
  const payload = await response
    .json()
    .catch(() => ({ message: "Invalid server response" }));
  if (!response.ok) throw new Error(payload.message || "Upload failed");
  return payload.data;
}

export async function downloadApi(path) {
  const headers = {};
  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl(path), { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Download failed" }));
    if (response.status === 401) session.clear();
    throw new Error(payload.message || "Download failed");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "attendance.xlsx";
  return { blob: await response.blob(), fileName };
}

export const authApi = {
  login: (credentials) =>
    api("/auth/login", { method: "POST", body: JSON.stringify(credentials) }),
  verifyOtp: (verification) =>
    api("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify(verification),
    }),
  forgotPassword: (email) => api("/auth/forgot-password", { method:"POST", body:JSON.stringify({email}) }),
  resetPassword: (data) => api("/auth/reset-password", { method:"POST", body:JSON.stringify(data) }),
  me: () => api("/auth/me"),
};
export const dashboardApi = { employee: () => api("/dashboard/employee") };
export const attendanceApi = {
  today: () => api('/attendance/today'),
  history: (month, year) => api(`/attendance/me?month=${month}&year=${year}`),
  allHistory: (month, year) => api(`/attendance/all?month=${month}&year=${year}`),
  exportExcel: (month, year) => downloadApi(`/attendance/export?month=${month}&year=${year}`),
  corrections: (scope = "mine") => api(`/attendance/corrections${scope === "all" ? "?scope=all" : ""}`),
  requestCorrection: (id, data) => api(`/attendance/${id}/correction`, { method: "POST", body: JSON.stringify(data) }),
  reviewCorrection: (id, decision, reviewNote = "") => api(`/attendance/corrections/${id}/${decision}`, { method: "PATCH", body: JSON.stringify({ reviewNote }) }),
  faceMatchRequests: (scope = "mine") => api(`/attendance/face-match-requests${scope === "all" ? "?scope=all" : ""}`),
  requestFaceMatchApproval: (data) => api("/attendance/face-match-requests", { method:"POST", body:JSON.stringify(data) }),
  reviewFaceMatchRequest: (id, decision, reviewNote = "") => api(`/attendance/face-match-requests/${id}/${decision}`, { method:"PATCH", body:JSON.stringify({reviewNote}) }),
  manualRequests: (scope = "mine") => api(`/attendance/manual${scope === "all" ? "?scope=all" : ""}`),
  createManualRequest: (data) => api('/attendance/manual', { method:'POST', body:JSON.stringify(data) }),
  reviewManualRequest: (id, decision, reviewNote = "") => api(`/attendance/manual/${id}/${decision}`, { method:'PATCH', body:JSON.stringify({reviewNote}) }),
  manualMetrics: () => api('/attendance/manual/metrics'),
  checkIn: (data) =>
    api("/attendance/check-in", { method: "POST", body: JSON.stringify(data) }),
  checkOut: (data) =>
    api("/attendance/check-out", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
export const workArrangementApi = {
  list: (scope = "mine") => api(`/work-arrangements${scope === "mine" ? "" : `?scope=${scope}`}`),
  today: () => api("/work-arrangements/today"),
  create: (data) => api("/work-arrangements", { method: "POST", body: JSON.stringify(data) }),
  review: (id, decision, reviewNote = "") => api(`/work-arrangements/${id}/${decision}`, { method: "PATCH", body: JSON.stringify({ reviewNote }) }),
};
export const employeeApi = {
  demographics: (group) => api(`/employees/demographics/list?group=${encodeURIComponent(group)}`),
  organizationChart: () => api('/employees/organization-chart'),
  list: (search = "") =>
    api(
      `/employees?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  create: (data) =>
    api("/employees", { method: "POST", body: JSON.stringify(data) }),
  get: (id) => api(`/employees/${id}`),
  update: (id, data) => api(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  getBiometrics: (id) => api(`/employees/${id}/biometrics`),
  updateBiometrics: (id, data) =>
    api(`/employees/${id}/biometrics`, { method: "PUT", body: JSON.stringify(data) }),
  confirmProbation: (id, data) =>
    api(`/employees/${id}/confirm-probation`, { method: "PATCH", body: JSON.stringify(data) }),
};
export const leaveApi = {
  balance: () => api('/leaves/balance'),
  list: (scope = "mine") =>
    api(`/leaves${scope === "mine" ? "" : `?scope=${scope}`}`),
  create: (data) =>
    api("/leaves", { method: "POST", body: JSON.stringify(data) }),
  review: (id, decision, reviewNote = "") =>
    api(`/leaves/${id}/${decision}`, {
      method: "PATCH",
      body: JSON.stringify({ reviewNote }),
    }),
};
export const adminApi = { dashboard: () => api("/dashboard/admin") };
export const biometricApi = {
  challenge: (mode, attendanceMode = 'office', employeeId) =>
    (SERVER_FACE_ENABLED?biometricRequest:api)("/biometrics/challenge", {
      method: "POST",
      body: JSON.stringify(SERVER_FACE_ENABLED?{action:mode,attendanceMode,...(employeeId&&{employeeId})}:{mode}),
    }).then(data=>SERVER_FACE_ENABLED?{...data,challenge:data.steps?.[0]}:data),
  verify: (data) =>
    (SERVER_FACE_ENABLED?biometricRequest:api)("/biometrics/verify", { method: "POST", body: JSON.stringify(data) }),
  enroll: (data) => biometricRequest('/biometrics/enroll',{method:'POST',body:JSON.stringify(data)}),
  status: () => biometricRequest('/biometrics/me/status'),
  employeeStatus: (id) => biometricRequest(`/employees/${id}/biometrics/status`),
  reset: (id) => biometricRequest(`/employees/${id}/biometrics/reset`,{method:'POST',body:JSON.stringify({confirmation:'RESET BIOMETRICS'})}),
  migrate: (id) => biometricRequest(`/admin/biometrics/migrate/${id}`,{method:'POST'}),
  migrateBatch: (data) => biometricRequest('/admin/biometrics/migrate-batch',{method:'POST',body:JSON.stringify(data)}),
  healthReport: (days = 30) => biometricRequest(`/admin/biometrics/health-report?days=${days}`),
};
export const holidayApi = {
  list: (year = new Date().getFullYear()) => api(`/holidays?year=${year}`),
  create: (data) =>
    api("/holidays", { method: "POST", body: JSON.stringify(data) }),
  remove: (id) => api(`/holidays/${id}`, { method: "DELETE" }),
};
export const allowanceApi = {
  list: (scope = "mine") =>
    api(`/allowances${scope === "all" ? "?scope=all" : ""}`),
  create: (data) =>
    api("/allowances", { method: "POST", body: JSON.stringify(data) }),
  monthlyUsage: (date) =>
    api(`/allowances/monthly-usage?date=${encodeURIComponent(date)}`),
  proof: (id) => api(`/allowances/${id}/proof`),
  requestSpecialApproval: (id, data) =>
    api(`/allowances/${id}/special-approval`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  specialApprovalProof: (id) =>
    api(`/allowances/${id}/special-approval/proof`),
  reviewSpecialApproval: (id, decision, reviewNote = "") =>
    api(`/allowances/${id}/special-approval/${decision}`, {
      method: "PATCH",
      body: JSON.stringify({ reviewNote }),
    }),
  review: (id, decision, reviewNote = "") =>
    api(`/allowances/${id}/${decision}`, {
      method: "PATCH",
      body: JSON.stringify({ reviewNote }),
    }),
};
export const recruitmentApi = {
  dashboard: () => api("/recruitment/dashboard"),
  candidates: (search = "") =>
    api(
      `/recruitment/candidates${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    ),
  candidate: (id) => api(`/recruitment/candidates/${id}`),
  createCandidate: (data) =>
    api("/recruitment/candidates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCandidate: (id, data) =>
    api(`/recruitment/candidates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  changeStage: (id, stage) =>
    api(`/recruitment/candidates/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    }),
  uploadDocument: (id, file, documentType) => {
    const form = new FormData();
    form.append("file", file);
    form.append("documentType", documentType);
    return uploadApi(`/recruitment/candidates/${id}/documents`, form);
  },
  interviews: () => api("/recruitment/interviews"),
  createInterview: (data) =>
    api("/recruitment/interviews", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  interviewStatus: (id, status) =>
    api(`/recruitment/interviews/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  feedback: (id, data) =>
    api(`/recruitment/interviews/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  select: (id, data) =>
    api(`/recruitment/candidates/${id}/select`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  reject: (id, data) =>
    api(`/recruitment/candidates/${id}/reject`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  offers: () => api("/recruitment/offers"),
  offer: (id) => api(`/recruitment/offers/${id}`),
  createOffer: (data) =>
    api("/recruitment/offers", { method: "POST", body: JSON.stringify(data) }),
  updateOffer: (id, data) =>
    api(`/recruitment/offers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  generateOffer: (id) =>
    api(`/recruitment/offers/${id}/generate`, { method: "POST" }),
  submitOffer: (id) =>
    api(`/recruitment/offers/${id}/submit-for-approval`, { method: "POST" }),
  sendOffer: (id) => api(`/recruitment/offers/${id}/send`, { method: "POST" }),
  approvals: () => api("/recruitment/offer-approvals"),
  approvalAction: (id, action, remarks = "") =>
    api(`/recruitment/offer-approvals/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ remarks }),
    }),
  templates: () => api("/recruitment/offer-templates"),
  createTemplate: (data) =>
    api("/recruitment/offer-templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  report: () => api("/recruitment/reports/summary"),
  notifications: () => api("/recruitment/notifications"),
  startOnboarding: (id) =>
    api(`/recruitment/candidates/${id}/start-onboarding`, { method: "POST" }),
};
export const organizationApi = {
  publicProfile: () => api('/organization/public-profile'),
  publicContacts: () => api('/organization/public-contacts'),
  get: () => api("/organization"),
  update: (data) =>
    api("/organization", { method: "PUT", body: JSON.stringify(data) }),
  contacts: () => api("/organization/contacts/manage"),
  createContact: (data) =>
    api("/organization/contacts", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateContact: (id, data) =>
    api(`/organization/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  officeLocations: (manage = false) => api(`/organization/office-locations${manage ? '/manage' : ''}`),
  createOfficeLocation: (data) => api('/organization/office-locations', { method:'POST', body:JSON.stringify(data) }),
  updateOfficeLocation: (id, data) => api(`/organization/office-locations/${id}`, { method:'PUT', body:JSON.stringify(data) }),
};
export const publicOfferApi = {
  get: (token) => api(`/public/offers/${token}`),
  view: (token) => api(`/public/offers/${token}/view`, { method: "POST" }),
  accept: (token, data) =>
    api(`/public/offers/${token}/accept`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decline: (token, data) =>
    api(`/public/offers/${token}/decline`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
