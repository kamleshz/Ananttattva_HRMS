import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
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

const PDF_MARGIN = 36;
const PDF_EMERALD = [5, 150, 105];

// jsPDF and the table plugin are heavy, so they are pulled in only when someone
// actually downloads a report.
const loadPdfLibs = async () => {
  const [jspdf, autotable] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF: jspdf.jsPDF, autoTable: autotable.autoTable };
};

const pdfStamp = () =>
  new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const pdfHeader = (doc, title, subtitle) => {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_EMERALD);
  doc.rect(0, 0, width, 52, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("AT Connect", PDF_MARGIN, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(title, PDF_MARGIN, 38);
  doc.setFontSize(9);
  doc.text(`Generated ${pdfStamp()}`, width - PDF_MARGIN, 38, { align: "right" });
  if (subtitle) {
    doc.setTextColor(71, 85, 105);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(subtitle, PDF_MARGIN, 68);
  }
};

const pdfFooter = (doc) => {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text("AT Connect HRMS - Evaluation Report", PDF_MARGIN, height - 16);
    doc.text(`Page ${page} of ${pages}`, width - PDF_MARGIN, height - 16, { align: "right" });
  }
};

const safeFileName = (value) =>
  String(value || "report")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "report";

const TABLE_STYLE = {
  theme: "grid",
  styles: { fontSize: 8.5, cellPadding: 4, textColor: [51, 65, 85], lineColor: [226, 232, 240] },
  headStyles: { fillColor: PDF_EMERALD, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
  alternateRowStyles: { fillColor: [248, 250, 252] },
  margin: { left: PDF_MARGIN, right: PDF_MARGIN, bottom: 32 },
};

// One PDF covering every attempt currently shown on the page.
const buildSummaryPdf = async ({ attempts, sections, summary }) => {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  pdfHeader(doc, "Evaluation Report", `Pass mark ${summary?.passPercent ?? 60}% - ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`);

  const stats = [
    ["Attempts", summary?.attempts ?? 0],
    ["Passed", summary?.passed ?? 0],
    ["Failed", summary?.failed ?? 0],
    ["Pass rate", `${summary?.passRate ?? 0}%`],
    ["Average", `${summary?.averagePercent ?? 0}%`],
    ["Best", `${summary?.bestPercent ?? 0}%`],
  ];
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: 82,
    body: [stats.map(([, value]) => String(value))],
    head: [stats.map(([label]) => label)],
    styles: { ...TABLE_STYLE.styles, halign: "center", fontStyle: "bold" },
    headStyles: { ...TABLE_STYLE.headStyles, halign: "center" },
    bodyStyles: { fontSize: 12 },
  });

  autoTable(doc, {
    ...TABLE_STYLE,
    startY: doc.lastAutoTable.finalY + 16,
    head: [[
      "Employee",
      "Email / Code",
      "Department",
      "Role",
      "Submitted",
      "Score",
      "%",
      "Result",
      ...sections.map((section) => `S${section.id}`),
      "Time",
    ]],
    body: attempts.map((attempt) => [
      attempt.name,
      attempt.email || attempt.employeeCode || "-",
      attempt.department || "-",
      ROLE_LABELS[attempt.role] || attempt.role || "-",
      formatDateTime(attempt.submittedAt),
      `${attempt.score} / ${attempt.total}`,
      `${attempt.percent}%`,
      attempt.passed ? "Pass" : "Fail",
      ...sections.map((section) => {
        const score = (attempt.sectionScores || []).find((item) => item.section === section.id);
        return score ? `${score.correct} / ${score.total}` : "-";
      }),
      formatDuration(attempt.durationSeconds),
    ]),
    columnStyles: Object.fromEntries(
      [5, 6, 7, 8 + sections.length, ...sections.map((_, position) => 8 + position)]
        .map((column) => [column, { halign: "center" }])
    ),
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 7) {
        data.cell.styles.textColor = data.cell.raw === "Pass" ? [4, 120, 87] : [153, 27, 27];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  pdfFooter(doc);
  doc.save(`evaluation-report-${safeFileName(pdfStamp())}.pdf`);
};

// A single candidate's report card, including the per-section breakdown.
const buildAttemptPdf = async (attempt, sections) => {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  pdfHeader(doc, "Evaluation Report - Individual Result", attempt.name);

  autoTable(doc, {
    ...TABLE_STYLE,
    startY: 84,
    head: [["Field", "Detail"]],
    body: [
      ["Employee", attempt.name],
      ["Email", attempt.email || "-"],
      ["Employee code", attempt.employeeCode || "-"],
      ["Department", attempt.department || "-"],
      ["Role", ROLE_LABELS[attempt.role] || attempt.role || "-"],
      ["Submitted", formatDateTime(attempt.submittedAt)],
      ["Duration", formatDuration(attempt.durationSeconds)],
      ["Result", attempt.passed ? "Pass" : "Fail"],
      ["Score", `${attempt.score} / ${attempt.total} (${attempt.percent}%)`],
      ["Tab switches", String(attempt.tabSwitches ?? 0)],
      ["Screenshot attempts", String(attempt.screenshotAttempts ?? 0)],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 130 } },
  });

  const rows = (attempt.sectionScores || []).length
    ? attempt.sectionScores
    : sections.map((section) => ({ section: section.id, title: section.title, correct: 0, total: 0 }));
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: doc.lastAutoTable.finalY + 18,
    head: [["Section", "Title", "Correct", "Total", "Score"]],
    body: rows.map((row) => [
      `Section ${row.section}`,
      row.title || "-",
      String(row.correct),
      String(row.total),
      row.total ? `${Math.round((row.correct / row.total) * 100)}%` : "-",
    ]),
    columnStyles: { 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" } },
  });

  pdfFooter(doc);
  doc.save(`evaluation-report-${safeFileName(attempt.name)}.pdf`);
};

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
  const [pdfBusy, setPdfBusy] = useState("");

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

  const downloadPdf = async (key, build) => {
    if (pdfBusy) return;
    setPdfBusy(key);
    setError("");
    try {
      await build();
    } catch (pdfError) {
      setError(pdfError?.message || "Could not generate the PDF. Please try again.");
    } finally {
      setPdfBusy("");
    }
  };

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
        <div className="evaluation-page-actions">
          <button type="button" className="secondary-button" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? "evaluation-spin" : undefined} /> Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={loading || !filtered.length || Boolean(pdfBusy)}
            onClick={() =>
              downloadPdf("all", () => buildSummaryPdf({ attempts: filtered, sections, summary }))
            }
          >
            {pdfBusy === "all" ? (
              <>
                <Loader2 size={15} className="evaluation-spin" /> Preparing PDF…
              </>
            ) : (
              <>
                <Download size={15} /> Download PDF
              </>
            )}
          </button>
        </div>
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
                  <th className="evaluation-report-action-head">Report</th>
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
                    <td>
                      <button
                        type="button"
                        className="evaluation-report-download"
                        title={`Download ${attempt.name}'s report as PDF`}
                        aria-label={`Download ${attempt.name}'s report as PDF`}
                        disabled={Boolean(pdfBusy)}
                        onClick={() => downloadPdf(attempt.id, () => buildAttemptPdf(attempt, sections))}
                      >
                        {pdfBusy === attempt.id ? (
                          <Loader2 size={15} className="evaluation-spin" />
                        ) : (
                          <Download size={15} />
                        )}
                      </button>
                    </td>
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
