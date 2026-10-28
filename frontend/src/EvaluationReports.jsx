import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
  Target,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { examApi } from "./services/api.js";
import "./evaluation.css";

const ROLE_LABELS = {
  super_admin: "Super Admin",
  admin: "Admin",
  hr_admin: "HR Admin",
  it_admin: "IT Admin",
  finance_admin: "Finance Admin",
  manager: "Manager",
  employee: "Employee",
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDuration = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!safe) return "—";
  return `${Math.floor(safe / 60)}m ${String(safe % 60).padStart(2, "0")}s`;
};

export default function EvaluationReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [sections, setSections] = useState([]);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await examApi.reports();
      setSummary(data?.summary || null);
      setAttempts(Array.isArray(data?.attempts) ? data.attempts : []);
      setSections(Array.isArray(data?.sections) ? data.sections : []);
    } catch (loadError) {
      setError(loadError?.message || "Could not load the evaluation reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return attempts.filter((attempt) => {
      if (resultFilter === "passed" && !attempt.passed) return false;
      if (resultFilter === "failed" && attempt.passed) return false;
      if (!needle) return true;
      return [attempt.name, attempt.email, attempt.department, attempt.employeeCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [attempts, query, resultFilter]);

  const sectionScoreFor = (attempt, sectionId) =>
    (attempt.sectionScores || []).find((item) => item.section === sectionId) || null;

  return (
    <div className="evaluation-page evaluation-reports-page">
      <div className="page-title-row">
        <div>
          <p className="breadcrumb">
            Home <span>›</span> Evaluation
          </p>
          <p className="eyebrow">Assessment</p>
          <h1>Evaluation Reports</h1>
          <p>Scores for every submitted assessment attempt.</p>
        </div>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "evaluation-spin" : undefined} /> Refresh
        </button>
      </div>

      {error && (
        <div className="evaluation-notice" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      <section className="evaluation-kpis">
        <div className="card evaluation-kpi">
          <span className="evaluation-kpi-icon indigo">
            <Users size={17} />
          </span>
          <p>Attempts submitted</p>
          <strong>{summary?.attempts ?? 0}</strong>
        </div>
        <div className="card evaluation-kpi">
          <span className="evaluation-kpi-icon emerald">
            <CheckCircle2 size={17} />
          </span>
          <p>Passed</p>
          <strong>{summary?.passed ?? 0}</strong>
        </div>
        <div className="card evaluation-kpi">
          <span className="evaluation-kpi-icon rose">
            <XCircle size={17} />
          </span>
          <p>Failed</p>
          <strong>{summary?.failed ?? 0}</strong>
        </div>
        <div className="card evaluation-kpi">
          <span className="evaluation-kpi-icon amber">
            <Target size={17} />
          </span>
          <p>Pass rate</p>
          <strong>{summary?.passRate ?? 0}%</strong>
        </div>
        <div className="card evaluation-kpi">
          <span className="evaluation-kpi-icon indigo">
            <ClipboardList size={17} />
          </span>
          <p>Average score</p>
          <strong>{summary?.averagePercent ?? 0}%</strong>
        </div>
        <div className="card evaluation-kpi">
          <span className="evaluation-kpi-icon emerald">
            <Trophy size={17} />
          </span>
          <p>Best score</p>
          <strong>{summary?.bestPercent ?? 0}%</strong>
        </div>
      </section>

      <section className="card evaluation-report-card">
        <div className="evaluation-report-toolbar">
          <div className="evaluation-search">
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, email, department or code"
              aria-label="Search reports"
            />
          </div>
          <div className="evaluation-filter-group" role="group" aria-label="Filter by result">
            {[
              ["all", "All"],
              ["passed", "Passed"],
              ["failed", "Failed"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`evaluation-filter ${resultFilter === value ? "active" : ""}`}
                onClick={() => setResultFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="evaluation-report-empty">
            <Loader2 size={20} className="evaluation-spin" />
            <p>Loading evaluation reports…</p>
          </div>
        ) : !attempts.length ? (
          <div className="evaluation-report-empty">
            <ClipboardList size={22} />
            <p>No assessment has been submitted yet.</p>
            <span>Scores appear here as soon as a user finishes the Evaluation test.</span>
          </div>
        ) : !filtered.length ? (
          <div className="evaluation-report-empty">
            <Search size={20} />
            <p>No attempts match your filters.</p>
          </div>
        ) : (
          <div className="evaluation-report-scroll">
            <table className="evaluation-report-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Submitted</th>
                  <th className="num">Score</th>
                  <th className="num">Percent</th>
                  <th>Result</th>
                  {sections.map((section) => (
                    <th key={section.id} className="num">
                      S{section.id}
                    </th>
                  ))}
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>
                      <div className="evaluation-report-person">
                        <strong>{attempt.name}</strong>
                        <span>{attempt.email || attempt.employeeCode || "—"}</span>
                        {attempt.department && <em>{attempt.department}</em>}
                      </div>
                    </td>
                    <td>{ROLE_LABELS[attempt.role] || attempt.role || "—"}</td>
                    <td>{formatDateTime(attempt.submittedAt)}</td>
                    <td className="num">
                      <strong>
                        {attempt.score} / {attempt.total}
                      </strong>
                    </td>
                    <td className="num">{attempt.percent}%</td>
                    <td>
                      <span className={`evaluation-badge ${attempt.passed ? "passed" : "failed"}`}>
                        {attempt.passed ? "Pass" : "Fail"}
                      </span>
                    </td>
                    {sections.map((section) => {
                      const score = sectionScoreFor(attempt, section.id);
                      return (
                        <td key={section.id} className="num">
                          {score ? `${score.correct} / ${score.total}` : "—"}
                        </td>
                      );
                    })}
                    <td className="num">{formatDuration(attempt.durationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <p className="evaluation-report-foot">
            Showing {filtered.length} of {attempts.length} submitted attempt{attempts.length === 1 ? "" : "s"}
            {summary?.passPercent ? ` · pass mark ${summary.passPercent}%` : ""}
          </p>
        )}
      </section>

      {sections.length > 0 && (
        <ul className="evaluation-section-list">
          {sections.map((section) => (
            <li key={section.id}>
              <span>Section {section.id}</span>
              {section.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
