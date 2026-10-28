import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Lock,
  RefreshCw,
  Target,
  Timer,
  Trophy,
  XCircle,
} from "lucide-react";
import { setNavigationBlockedHandler, setNavigationLock } from "./router.jsx";
import "./evaluation.css";

const SECONDS_PER_QUESTION = 30;

const EVALUATION_QUESTIONS = [
  {
    id: 1,
    question: "What is the main difference between managing plastic waste and merely disposing of it?",
    options: [
      "Management means storing waste, while disposal means collecting it.",
      "Management covers segregation, collection, recycling, recovery and safe disposal, while disposal is only one part of the process.",
      "Management means burning waste, while disposal means sorting it.",
      "Management and disposal mean exactly the same thing.",
    ],
    correctIndex: 1,
  },
  {
    id: 2,
    question: "What is the purpose of maintaining plastic waste records?",
    options: [
      "To replace the need for registration.",
      "To avoid submitting any required reports.",
      "To track waste quantities, movement and processing, and demonstrate compliance.",
      "To record only the colour of discarded plastics.",
    ],
    correctIndex: 2,
  },
  {
    id: 3,
    question: "What is the purpose of marking and labelling plastic packaging?",
    options: [
      "To provide required identification, material and compliance information.",
      "To guarantee that every plastic package is biodegradable.",
      "To exempt the packaging from EPR obligations.",
      "To make all plastic packaging suitable for food contact.",
    ],
    correctIndex: 0,
  },
  {
    id: 4,
    question: "Why is open burning of plastic waste an environmental concern?",
    options: [
      "It converts all plastic waste into useful compost.",
      "It removes pollutants from the surrounding air.",
      "It safely recycles plastic without processing equipment.",
      "It can release harmful pollutants, affecting air quality, human health and the environment.",
    ],
    correctIndex: 3,
  },
  {
    id: 5,
    question: "What is meant by environmentally sound plastic waste management?",
    options: [
      "Dumping plastic waste in an unused open area.",
      "Handling and processing plastic waste in ways that protect human health and the environment.",
      "Mixing plastic waste with food waste before disposal.",
      "Burning plastic waste outdoors to reduce its volume.",
    ],
    correctIndex: 1,
  },
];

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

const formatClock = (totalSeconds) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

export default function EvaluationPage() {
  const total = EVALUATION_QUESTIONS.length;
  const [phase, setPhase] = useState("idle");
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_QUESTION);
  const [results, setResults] = useState(() => Array(total).fill(null));
  const [notice, setNotice] = useState("");
  const [tabSwitches, setTabSwitches] = useState(0);
  const [screenshotAttempts, setScreenshotAttempts] = useState(0);

  const question = EVALUATION_QUESTIONS[index];
  const result = results[index];
  const locked = Boolean(result);

  useEffect(() => {
    if (phase !== "active" || locked) return undefined;
    if (secondsLeft <= 0) {
      setResults((previous) =>
        previous.map((entry, position) =>
          position === index ? { selectedIndex: null, isCorrect: false, timedOut: true } : entry
        )
      );
      return undefined;
    }
    const timeout = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [phase, locked, secondsLeft, index]);

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
    const timeout = setTimeout(() => setNotice(""), 3600);
    return () => clearTimeout(timeout);
  }, [notice]);

  const startExam = () => {
    setResults(Array(total).fill(null));
    setIndex(0);
    setSecondsLeft(SECONDS_PER_QUESTION);
    setNotice("");
    setTabSwitches(0);
    setScreenshotAttempts(0);
    setPhase("active");
  };

  const chooseOption = (optionIndex) => {
    if (locked) return;
    setResults((previous) =>
      previous.map((entry, position) =>
        position === index
          ? { selectedIndex: optionIndex, isCorrect: optionIndex === question.correctIndex, timedOut: false }
          : entry
      )
    );
  };

  const goNext = () => {
    if (index < total - 1) {
      setIndex((value) => value + 1);
      setSecondsLeft(SECONDS_PER_QUESTION);
      return;
    }
    setPhase("finished");
  };

  const score = useMemo(() => results.filter((entry) => entry?.isCorrect).length, [results]);
  const answeredCount = useMemo(() => results.filter(Boolean).length, [results]);

  if (phase === "idle") {
    return (
      <div className="evaluation-page">
        <div className="page-title-row">
          <div>
            <p className="breadcrumb">
              Home <span>›</span> Evaluation
            </p>
            <p className="eyebrow">Assessment</p>
            <h1>Evaluation</h1>
            <p>Test your understanding with a timed multiple-choice assessment.</p>
          </div>
        </div>
        <section className="card evaluation-intro">
          <span className="evaluation-intro-icon">
            <ClipboardList size={26} />
          </span>
          <h2>Ready to begin?</h2>
          <p>
            The exam has <strong>{total} multiple-choice questions</strong>. You get{" "}
            <strong>{SECONDS_PER_QUESTION} seconds per question</strong> and the timer starts as soon as you press
            Start Exam. Answers lock once you select an option, and the correct answer is revealed immediately.
          </p>
          <p>
            Once the exam starts, <strong>navigation is locked</strong> — you cannot open another screen, use the back
            button, or switch tabs until all questions are finished. Copying, right-click and Print Screen are also
            monitored.
          </p>
          <div className="evaluation-meta">
            <div className="evaluation-meta-item">
              <ClipboardList size={17} />
              <span>Questions</span>
              <strong>{total}</strong>
            </div>
            <div className="evaluation-meta-item">
              <Timer size={17} />
              <span>Time per question</span>
              <strong>{SECONDS_PER_QUESTION} sec</strong>
            </div>
            <div className="evaluation-meta-item">
              <Target size={17} />
              <span>Feedback</span>
              <strong>Instant</strong>
            </div>
          </div>
          <button type="button" className="primary-button evaluation-start" onClick={startExam}>
            Start Exam <ChevronRight size={16} />
          </button>
        </section>
      </div>
    );
  }

  if (phase === "finished") {
    const percent = Math.round((score / total) * 100);
    const passed = percent >= 60;
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
              {score} <span>/ {total}</span>
            </h2>
            <p>
              {percent}% correct · {answeredCount} of {total} questions attempted
            </p>
          </div>
          <div className="evaluation-score-ring" style={{ "--evaluation-score": `${percent}%` }}>
            <strong>{percent}%</strong>
          </div>
        </section>

        <section className="evaluation-review">
          {EVALUATION_QUESTIONS.map((item, position) => {
            const entry = results[position];
            const answered = entry && entry.selectedIndex !== null && entry.selectedIndex !== undefined;
            return (
              <div
                key={item.id}
                className={`card evaluation-review-item ${entry?.isCorrect ? "correct" : "wrong"}`}
              >
                <div className="evaluation-review-head">
                  <span className="evaluation-review-index">Q{position + 1}</span>
                  <p>{item.question}</p>
                  {entry?.isCorrect ? (
                    <CheckCircle2 className="evaluation-review-status" size={19} />
                  ) : (
                    <XCircle className="evaluation-review-status" size={19} />
                  )}
                </div>
                <div className="evaluation-review-body">
                  <p className={`evaluation-review-line ${entry?.isCorrect ? "correct" : "wrong"}`}>
                    <span>Your answer</span>
                    {answered
                      ? `${OPTION_LABELS[entry.selectedIndex]}. ${item.options[entry.selectedIndex]}`
                      : "Not answered (time expired)"}
                  </p>
                  {!entry?.isCorrect && (
                    <p className="evaluation-review-line correct">
                      <span>Correct answer</span>
                      {`${OPTION_LABELS[item.correctIndex]}. ${item.options[item.correctIndex]}`}
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

        <h2 className="evaluation-question">{question.question}</h2>

        <div className="evaluation-options">
          {question.options.map((option, optionIndex) => {
            const isCorrectOption = optionIndex === question.correctIndex;
            const isChosen = result?.selectedIndex === optionIndex;
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
                onClick={() => chooseOption(optionIndex)}
                disabled={locked}
              >
                <span className="evaluation-option-key">{OPTION_LABELS[optionIndex]}</span>
                <span className="evaluation-option-text">{option}</span>
                {locked && isCorrectOption && <CheckCircle2 className="evaluation-option-icon" size={19} />}
                {locked && isChosen && !isCorrectOption && <XCircle className="evaluation-option-icon" size={19} />}
              </button>
            );
          })}
        </div>

        {locked && (
          <div className={`evaluation-feedback ${result.isCorrect ? "correct" : "wrong"}`}>
            {result.isCorrect ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
            <div>
              <strong>
                {result.isCorrect ? "Correct answer!" : result.timedOut ? "Time's up!" : "Wrong answer"}
              </strong>
              <span>
                Correct answer: {OPTION_LABELS[question.correctIndex]}. {question.options[question.correctIndex]}
              </span>
            </div>
          </div>
        )}

        <div className="evaluation-quiz-bottom">
          <span className="evaluation-hint">{locked ? "" : "Select an option to continue"}</span>
          <button type="button" className="primary-button" disabled={!locked} onClick={goNext}>
            {index < total - 1 ? "Next Question" : "See Results"} <ChevronRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
