import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Loader2,
  Lock,
  RefreshCw,
  Target,
  Timer,
  Trophy,
  XCircle,
} from "lucide-react";
import { examApi } from "./services/api.js";
import { setNavigationBlockedHandler, setNavigationLock } from "./router.jsx";
import "./evaluation.css";

const SECONDS_PER_QUESTION = 30;
const QUESTIONS_PER_SECTION = 10;
// Fallback until /exam/meta answers; mirrors the backend's active section count.
const DEFAULT_SECTION_COUNT = 2;
const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

const formatClock = (totalSeconds) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

const formatOption = (options, text) => {
  if (!text) return null;
  const position = options.indexOf(text);
  return position >= 0 ? `${OPTION_LABELS[position]}. ${text}` : text;
};

export default function EvaluationPage() {
  const [phase, setPhase] = useState("idle");
  const [meta, setMeta] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_QUESTION);
  const [results, setResults] = useState([]);
  const [notice, setNotice] = useState("");
  const [tabSwitches, setTabSwitches] = useState(0);
  const [screenshotAttempts, setScreenshotAttempts] = useState(0);
  // Guards against grading the same question twice (timer expiry + a click).
  const submittedRef = useRef(false);

  const total = questions.length;
  const question = questions[index];
  const result = results[index];
  const locked = Boolean(result);

  useEffect(() => {
    let active = true;
    examApi
      .meta()
      .then((data) => {
        if (active && data) setMeta(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const submitAnswer = async (selected, timedOut) => {
    try {
      const data = await examApi.answer(attemptId, question.id, selected);
      setResults((previous) =>
        previous.map((entry, position) => (position === index ? { ...data, timedOut } : entry))
      );
    } catch (error) {
      // Let the candidate try again rather than losing the question to a hiccup.
      submittedRef.current = false;
      setNotice(error?.message || "Could not submit your answer. Please try again.");
      if (timedOut) setSecondsLeft(10);
    }
  };

  useEffect(() => {
    if (phase !== "active" || locked || !question) return undefined;
    if (secondsLeft <= 0) {
      if (!submittedRef.current) {
        submittedRef.current = true;
        submitAnswer("", true);
      }
      return undefined;
    }
    const timeout = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [phase, locked, secondsLeft, index, question]);

  // Anti-cheat lock: while the exam is running the user cannot navigate to another
  // screen, go back, refresh/close the tab, copy the question or switch tabs.
  useEffect(() => {
    if (phase !== "active") {
      setNavigationLock(false);
      return undefined;
    }
    setNavigationLock(true, window.location.pathname);
    setNavigationBlockedHandler(() =>
      setNotice("The exam is locked. Answer all questions to leave this screen.")
    );
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    const blockClipboard = (event) => {
      event.preventDefault();
      setNotice("Copying is disabled during the exam.");
    };
    const handleVisibility = () => {
      if (document.hidden) setTabSwitches((count) => count + 1);
    };
    // Screenshot deterrent: there is no browser screenshot API, but on Windows/Chrome
    // the PrtScn key is delivered to the page. Flag it and wipe the captured image
    // out of the clipboard so it cannot be pasted elsewhere.
    const handleScreenshot = (event) => {
      if (event.key !== "PrintScreen" && event.code !== "PrintScreen") return;
      setScreenshotAttempts((count) => count + 1);
      setNotice("Screenshots are not allowed during the exam.");
      try {
        navigator.clipboard?.writeText?.("").catch(() => {});
      } catch {
        /* clipboard not available */
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("copy", blockClipboard);
    document.addEventListener("cut", blockClipboard);
    document.addEventListener("contextmenu", blockClipboard);
    document.addEventListener("visibilitychange", handleVisibility);
    // PrtScn is delivered as a keyup on Windows browsers; listening on keydown too
    // would double-count a single press.
    window.addEventListener("keyup", handleScreenshot);
    return () => {
      setNavigationLock(false);
      setNavigationBlockedHandler(null);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("copy", blockClipboard);
      document.removeEventListener("cut", blockClipboard);
      document.removeEventListener("contextmenu", blockClipboard);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("keyup", handleScreenshot);
    };
  }, [phase]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const startExam = async () => {
    setPhase("loading");
    setNotice("");
    submittedRef.current = false;
    setResults([]);
    setIndex(0);
    setSecondsLeft(SECONDS_PER_QUESTION);
    setTabSwitches(0);
    setScreenshotAttempts(0);
    try {
      const data = await examApi.questions(QUESTIONS_PER_SECTION);
      const paper = Array.isArray(data?.questions) ? data.questions : [];
      if (!paper.length) throw new Error("No questions are available right now.");
      setAttemptId(data.attemptId || null);
      setSummary(null);
      setQuestions(paper);
      setResults(Array(paper.length).fill(null));
      setPhase("active");
    } catch (error) {
      setNotice(error?.message || "Could not load the exam. Please try again.");
      setPhase("idle");
    }
  };

  const chooseOption = (optionText) => {
    if (locked || submittedRef.current) return;
    submittedRef.current = true;
    submitAnswer(optionText, false);
  };

  // The score is computed and stored server-side on submit, so the report cannot
  // be faked from the browser.
  const finishExam = async () => {
    setSubmitting(true);
    try {
      const data = await examApi.submit(attemptId, { tabSwitches, screenshotAttempts });
      if (data) setSummary(data);
    } catch (error) {
      setNotice(error?.message || "Your score could not be saved to the report.");
    } finally {
      setSubmitting(false);
      setPhase("finished");
    }
  };

  const goNext = () => {
    if (index < total - 1) {
      submittedRef.current = false;
      setIndex((value) => value + 1);
      setSecondsLeft(SECONDS_PER_QUESTION);
      return;
    }
    finishExam();
  };

  const score = useMemo(() => results.filter((entry) => entry?.correct).length, [results]);
  const answeredCount = useMemo(() => results.filter((entry) => entry?.answered).length, [results]);

  if (phase === "idle" || phase === "loading") {
    const perSection = meta?.perSection || QUESTIONS_PER_SECTION;
    const sectionCount = meta?.sectionCount || 0;
    const totalQuestions = meta?.questionsPerExam || perSection * (sectionCount || DEFAULT_SECTION_COUNT);
    return (
      <div className="evaluation-page">
        {notice && (
          <div className="evaluation-notice" role="alert">
            <AlertTriangle size={17} />
            <span>{notice}</span>
          </div>
        )}
        <div className="page-title-row">
          <div>
            <p className="breadcrumb">
              Home <span>›</span> Evaluation
            </p>
            <p className="eyebrow">Assessment</p>
            <h1>Evaluation</h1>
            <p>Plastic Waste Management compliance assessment.</p>
          </div>
        </div>
        <section className="card evaluation-intro">
          <span className="evaluation-intro-icon">
            <ClipboardList size={26} />
          </span>
          <h2>Ready to begin?</h2>
          <p>
            Each attempt draws{" "}
            <strong>
              {perSection} random questions from each of the {sectionCount || DEFAULT_SECTION_COUNT} sections
            </strong>{" "}
            — <strong>{totalQuestions} questions</strong> in total — picked at random from a bank of{" "}
            <strong>{meta?.bankSize || 500}</strong>. You get <strong>{SECONDS_PER_QUESTION} seconds per question</strong>{" "}
            and the timer starts as soon as you press Start Exam. Answers lock once you select an option, and the correct
            answer is revealed immediately.
          </p>
          <p>
            Both the questions and the answer options are shuffled for every attempt, so no two papers are the same.
            Once the exam starts, <strong>navigation is locked</strong> — you cannot open another screen, use the back
            button, or switch tabs until all questions are finished. Copying, right-click and Print Screen are also
            monitored.
          </p>
          <div className="evaluation-meta">
            <div className="evaluation-meta-item">
              <ClipboardList size={17} />
              <span>Per section</span>
              <strong>{perSection}</strong>
            </div>
            <div className="evaluation-meta-item">
              <ClipboardList size={17} />
              <span>Sections</span>
              <strong>{sectionCount || DEFAULT_SECTION_COUNT}</strong>
            </div>
            <div className="evaluation-meta-item">
              <Target size={17} />
              <span>Total questions</span>
              <strong>{totalQuestions}</strong>
            </div>
            <div className="evaluation-meta-item">
              <Timer size={17} />
              <span>Time per question</span>
              <strong>{SECONDS_PER_QUESTION} sec</strong>
            </div>
          </div>
          {Array.isArray(meta?.sections) && meta.sections.length > 0 && (
            <ul className="evaluation-section-list">
              {meta.sections.map((section) => (
                <li key={section.id}>
                  <span>Section {section.id}</span>
                  {section.title}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="primary-button evaluation-start"
            onClick={startExam}
            disabled={phase === "loading"}
          >
            {phase === "loading" ? (
              <>
                <Loader2 size={16} className="evaluation-spin" /> Preparing your paper…
              </>
            ) : (
              <>
                Start Exam <ChevronRight size={16} />
              </>
            )}
          </button>
        </section>
      </div>
    );
  }

  if (phase === "finished") {
    const finalScore = summary?.score ?? score;
    const finalTotal = summary?.total ?? total;
    const percent = summary?.percent ?? (finalTotal ? Math.round((finalScore / finalTotal) * 100) : 0);
    const passed = summary?.passed ?? percent >= 60;
    return (
      <div className="evaluation-page">
        <div className="page-title-row">
          <div>
            <p className="breadcrumb">
              Home <span>›</span> Evaluation
            </p>
            <p className="eyebrow">Assessment</p>
            <h1>Evaluation Result</h1>
            <p>Review your answers below and retake the exam any time.</p>
          </div>
        </div>

        <section className={`card evaluation-score ${passed ? "passed" : "failed"}`}>
          <span className="evaluation-score-icon">
            <Trophy size={26} />
          </span>
          <div className="evaluation-score-copy">
            <p className="eyebrow">Your score</p>
            <h2>
              {finalScore} <span>/ {finalTotal}</span>
            </h2>
            <p>
              {percent}% correct · {answeredCount} of {finalTotal} questions attempted
              {summary?.durationSeconds ? ` · finished in ${formatClock(summary.durationSeconds)}` : ""}
            </p>
          </div>
          <div className="evaluation-score-ring" style={{ "--evaluation-score": `${percent}%` }}>
            <strong>{percent}%</strong>
          </div>
        </section>

        {Array.isArray(summary?.sectionScores) && summary.sectionScores.length > 0 && (
          <section className="evaluation-breakdown">
            {summary.sectionScores.map((item) => (
              <div key={item.section} className="card evaluation-breakdown-item">
                <p className="eyebrow">Section {item.section}</p>
                <h3>{item.title}</h3>
                <div className="evaluation-breakdown-score">
                  <strong>{item.correct}</strong>
                  <span>/ {item.total}</span>
                </div>
                <div className="evaluation-progress-track">
                  <span style={{ width: `${item.total ? (item.correct / item.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </section>
        )}

        {(tabSwitches > 0 || screenshotAttempts > 0) && (
          <section className="evaluation-tab-warning" role="alert">
            <AlertTriangle size={16} />
            <span>
              This attempt recorded {tabSwitches} tab switch{tabSwitches === 1 ? "" : "es"} and{" "}
              {screenshotAttempts} screenshot attempt{screenshotAttempts === 1 ? "" : "s"}.
            </span>
          </section>
        )}

        <section className="evaluation-review">
          {questions.map((item, position) => {
            const entry = results[position];
            const yourAnswer = formatOption(item.options, entry?.selected);
            return (
              <div key={item.id} className={`card evaluation-review-item ${entry?.correct ? "correct" : "wrong"}`}>
                <div className="evaluation-review-head">
                  <span className="evaluation-review-index">Q{position + 1}</span>
                  <p>{item.question}</p>
                  {entry?.correct ? (
                    <CheckCircle2 className="evaluation-review-status" size={19} />
                  ) : (
                    <XCircle className="evaluation-review-status" size={19} />
                  )}
                </div>
                <div className="evaluation-review-body">
                  {item.sectionTitle && <p className="evaluation-review-section">{item.sectionTitle}</p>}
                  <p className={`evaluation-review-line ${entry?.correct ? "correct" : "wrong"}`}>
                    <span>Your answer</span>
                    {yourAnswer || (entry?.timedOut ? "Not answered (time expired)" : "Not answered")}
                  </p>
                  {!entry?.correct && entry?.correctOption && (
                    <p className="evaluation-review-line correct">
                      <span>Correct answer</span>
                      {formatOption(item.options, entry.correctOption) || entry.correctOption}
                    </p>
                  )}
                  {entry?.explanation && (
                    <p className="evaluation-review-explanation">
                      <span>Why</span>
                      {entry.explanation}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <div className="evaluation-actions">
          <button type="button" className="secondary-button" onClick={() => setPhase("idle")}>
            Back
          </button>
          <button type="button" className="primary-button" onClick={startExam}>
            <RefreshCw size={15} /> Retake Exam
          </button>
        </div>
      </div>
    );
  }

  const questionProgress = ((index + 1) / total) * 100;
  const timerPercent = (secondsLeft / SECONDS_PER_QUESTION) * 100;
  const timerTone = secondsLeft <= 10 ? "danger" : secondsLeft <= 20 ? "warn" : "safe";

  return (
    <div className="evaluation-page">
      {notice && (
        <div className="evaluation-notice" role="alert">
          <AlertTriangle size={17} />
          <span>{notice}</span>
        </div>
      )}
      <div className="page-title-row">
        <div>
          <p className="breadcrumb">
            Home <span>›</span> Evaluation
          </p>
          <p className="eyebrow">Assessment</p>
          <h1>Evaluation</h1>
          <p>Answer before the timer runs out. The correct answer is revealed instantly.</p>
        </div>
      </div>

      <section className="card evaluation-quiz evaluation-quiz-locked">
        <div className="evaluation-locked-bar">
          <Lock size={15} />
          <span>Exam in progress — navigation is locked until you finish all {total} questions.</span>
        </div>
        {tabSwitches > 0 && (
          <div className="evaluation-tab-warning" role="alert">
            <AlertTriangle size={16} />
            <span>
              {tabSwitches} tab switch{tabSwitches > 1 ? "es" : ""} detected. Please stay on this screen — leaving the
              exam is not allowed.
            </span>
          </div>
        )}
        {screenshotAttempts > 0 && (
          <div className="evaluation-tab-warning" role="alert">
            <AlertTriangle size={16} />
            <span>
              Screenshot attempt detected{screenshotAttempts > 1 ? ` (${screenshotAttempts})` : ""}. Screenshots are not
              allowed during the exam.
            </span>
          </div>
        )}
        <div className="evaluation-quiz-top">
          <div className="evaluation-progress">
            <div className="evaluation-progress-head">
              <span>
                Question <strong>{index + 1}</strong> of {total}
              </span>
              <span>{Math.round(questionProgress)}% complete</span>
            </div>
            <div className="evaluation-progress-track">
              <span style={{ width: `${questionProgress}%` }} />
            </div>
          </div>
          <div className={`evaluation-timer ${timerTone}`}>
            <Timer size={17} />
            <strong>{formatClock(secondsLeft)}</strong>
            <div className="evaluation-timer-track">
              <span style={{ width: `${timerPercent}%` }} />
            </div>
          </div>
        </div>

        {question.sectionTitle && <p className="evaluation-question-section">{question.sectionTitle}</p>}
        <h2 className="evaluation-question">{question.question}</h2>

        <div className="evaluation-options">
          {question.options.map((option, optionIndex) => {
            const isCorrectOption = locked && option === result?.correctOption;
            const isChosen = locked && option === result?.selected;
            let stateClass = "";
            if (locked) {
              if (isCorrectOption) stateClass = "is-correct";
              else if (isChosen) stateClass = "is-wrong";
              else stateClass = "is-muted";
            }
            return (
              <button
                key={option}
                type="button"
                className={`evaluation-option ${stateClass}`}
                onClick={() => chooseOption(option)}
                disabled={locked}
              >
                <span className="evaluation-option-key">{OPTION_LABELS[optionIndex]}</span>
                <span className="evaluation-option-text">{option}</span>
                {isCorrectOption && <CheckCircle2 className="evaluation-option-icon" size={19} />}
                {isChosen && !isCorrectOption && <XCircle className="evaluation-option-icon" size={19} />}
              </button>
            );
          })}
        </div>

        {locked && (
          <div className={`evaluation-feedback ${result.correct ? "correct" : "wrong"}`}>
            {result.correct ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
            <div>
              <strong>{result.correct ? "Correct answer!" : result.timedOut ? "Time's up!" : "Wrong answer"}</strong>
              <span>
                Correct answer: {formatOption(question.options, result.correctOption) || result.correctOption}
              </span>
              {result.explanation && <em className="evaluation-feedback-why">{result.explanation}</em>}
            </div>
          </div>
        )}

        <div className="evaluation-quiz-bottom">
          <span className="evaluation-hint">{locked ? "" : "Select an option to continue"}</span>
          <button type="button" className="primary-button" disabled={!locked || submitting} onClick={goNext}>
            {index < total - 1 ? "Next Question" : submitting ? "Saving…" : "See Results"} <ChevronRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
