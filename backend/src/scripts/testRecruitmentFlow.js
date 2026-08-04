import { env } from "../config/env.js";
import http from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import {
  Candidate,
  CandidateActivity,
  CandidateCommunication,
  CandidateDocument,
  Interview,
  InterviewFeedback,
  Notification,
  OfferApproval,
  OfferLetter,
} from "../models/Recruitment.js";

async function api(path, { method = "GET", body, token } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: env.port,
        path: `/api${path}`,
        method,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString());
          } catch {}
          if (response.statusCode < 200 || response.statusCode >= 300)
            return reject(
              new Error(
                `${method} ${path}: ${parsed.message || response.statusCode}`,
              ),
            );
          resolve(parsed.data);
        });
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

await connectDatabase();
const admin = await User.findOne({ email: env.seedEmail });
if (!admin) throw new Error("Seed administrator is not available");
const token = jwt.sign({ role: admin.role }, env.jwtSecret, {
  subject: admin.id,
  expiresIn: "10m",
});
const suffix = Date.now().toString().slice(-9);
const interviewer = admin.id;
const candidate = await api("/recruitment/candidates", {
  method: "POST",
  token,
  body: {
    firstName: "Workflow",
    lastName: "Candidate",
    email: `workflow.${suffix}@peoplepulse.local`,
    mobile: `9${suffix}`,
    position: "Senior Engineer",
    department: "Technology",
    employmentType: "Permanent",
    source: "LinkedIn",
    totalExperience: 5,
    relevantExperience: 4,
    currentCTC: 700000,
    expectedCTC: 850000,
    skills: ["React", "Node.js", "MongoDB"],
    employmentStatus: "Employed",
  },
});
const interview = await api("/recruitment/interviews", {
  method: "POST",
  token,
  body: {
    candidate: candidate._id,
    round: "Technical Round 1",
    interviewType: "Video Call",
    date: new Date(Date.now() + 86400000),
    startTime: "10:00",
    endTime: "10:45",
    interviewers: [interviewer],
    meetingMode: "Microsoft Teams",
    meetingLink: "https://teams.microsoft.com/test",
    instructions: "Technical discussion",
  },
});
await api(`/recruitment/interviews/${interview._id}/status`, {
  method: "PATCH",
  token,
  body: { status: "Completed" },
});
const feedback = await api(
  `/recruitment/interviews/${interview._id}/feedback`,
  {
    method: "POST",
    token,
    body: {
      technicalSkills: 5,
      communication: 4,
      problemSolving: 5,
      roleKnowledge: 4,
      cultureFit: 4,
      experienceRelevance: 5,
      strengths: "Strong full stack fundamentals",
      concerns: "None",
      detailedFeedback: "Recommended after technical evaluation.",
      recommendation: "Strong Hire",
    },
  },
);
const selected = await api(`/recruitment/candidates/${candidate._id}/select`, {
  method: "POST",
  token,
  body: {
    finalDesignation: "Senior Engineer",
    department: "Technology",
    workLocation: "Mumbai",
    employmentType: "Permanent",
    proposedCTC: 850000,
    joiningDate: new Date(Date.now() + 30 * 86400000),
    probationPeriod: "6 months",
  },
});
const offer = await api("/recruitment/offers", {
  method: "POST",
  token,
  body: {
    candidate: candidate._id,
    designation: "Senior Engineer",
    department: "Technology",
    workLocation: "Mumbai",
    employmentType: "Permanent",
    joiningDate: new Date(Date.now() + 30 * 86400000),
    probationPeriod: "6 months",
    noticePeriod: "30 days",
    compensation: {
      annualCTC: 850000,
      monthlyGross: 70833,
      basicSalary: 35000,
      hra: 17500,
      specialAllowance: 18333,
    },
    terms: {
      offerValidUntil: new Date(Date.now() + 10 * 86400000),
      additionalConditions: "Subject to background verification.",
    },
  },
});
const generated = await api(`/recruitment/offers/${offer._id}/generate`, {
  method: "POST",
  token,
});
await api(`/recruitment/offers/${offer._id}/submit-for-approval`, {
  method: "POST",
  token,
});
let unapprovedSendBlocked = false;
try {
  await api(`/recruitment/offers/${offer._id}/send`, { method: "POST", token });
} catch (error) {
  unapprovedSendBlocked = error.message.includes(
    "Only an approved offer can be sent",
  );
}
if (!unapprovedSendBlocked)
  throw new Error(
    "Security check failed: unapproved offer send was not blocked",
  );
const approvals = await api("/recruitment/offer-approvals", { token });
const approval = approvals.find((item) => item.offer?._id === offer._id);
const approvalResult = await api(
  `/recruitment/offer-approvals/${approval._id}/approve`,
  { method: "POST", token, body: { remarks: "Approved after review" } },
);
const sent = await api(`/recruitment/offers/${offer._id}/send`, {
  method: "POST",
  token,
});
const publicToken = sent.developmentAcceptanceUrl.split("/").pop();
await api(`/public/offers/${publicToken}/view`, { method: "POST", body: {} });
const accepted = await api(`/public/offers/${publicToken}/accept`, {
  method: "POST",
  body: {
    expectedJoiningDate: new Date(Date.now() + 30 * 86400000),
    comment: "Happy to accept",
  },
});
const onboarding = await api(
  `/recruitment/candidates/${candidate._id}/start-onboarding`,
  { method: "POST", token, body: {} },
);
console.log(
  JSON.stringify(
    {
      candidate: candidate.candidateCode,
      interview: "Completed",
      feedback: feedback.recommendation,
      selection: selected.currentStage,
      pdf: generated.fileName,
      unapprovedSendBlocked,
      approval: approvalResult.offer.status,
      email: sent.offer.status,
      acceptance: accepted.status,
      onboardingEmployee: onboarding.employeeCode,
    },
    null,
    2,
  ),
);
const smokeCandidates = await Candidate.find({
  email: /^workflow\.\d+@peoplepulse\.local$/,
}).select("_id email");
const smokeCandidateIds = smokeCandidates.map((item) => item._id);
const smokeEmails = smokeCandidates.map((item) => item.email);
const smokeOffers = await OfferLetter.find({
  candidate: { $in: smokeCandidateIds },
}).select("_id");
const smokeOfferIds = smokeOffers.map((item) => item._id);
await Promise.all([
  Interview.deleteMany({ candidate: { $in: smokeCandidateIds } }),
  InterviewFeedback.deleteMany({ candidate: { $in: smokeCandidateIds } }),
  CandidateDocument.deleteMany({ candidate: { $in: smokeCandidateIds } }),
  CandidateActivity.deleteMany({ candidate: { $in: smokeCandidateIds } }),
  CandidateCommunication.deleteMany({ candidate: { $in: smokeCandidateIds } }),
  Notification.deleteMany({ candidate: { $in: smokeCandidateIds } }),
  OfferApproval.deleteMany({ offer: { $in: smokeOfferIds } }),
  OfferLetter.deleteMany({ _id: { $in: smokeOfferIds } }),
  Employee.deleteMany({ officialEmail: { $in: smokeEmails } }),
  Candidate.deleteMany({ _id: { $in: smokeCandidateIds } }),
]);
console.log(
  `Cleaned ${smokeCandidateIds.length} recruitment smoke-test candidate records.`,
);
await mongoose.disconnect();
