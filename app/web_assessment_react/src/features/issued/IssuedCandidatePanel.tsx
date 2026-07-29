import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useCandidateGazeProctor } from "../assessment/useCandidateGazeProctor";
import { useAssessmentSession } from "../assessment/useAssessmentSession";
import { useAssessmentTimer } from "../assessment/useAssessmentTimer";
import type { TimerState } from "../assessment/assessmentRuntime";
import type { ExcelAssessmentSubmission } from "../tools/ExcelSimulator";
import type { AccountingAssessmentSubmission, AccountingCase } from "../tools/AccountingTool";
import type { TaxAssessmentSubmission, TaxCase } from "../tools/TaxTool";
import type { CorporateTaxAssessmentSubmission, CorporateTaxCase } from "../tools/CorporateTaxTool";
import { BrandLogo } from "../../components/BrandLogo";

const ExcelSimulator = lazy(() => import("../tools/ExcelSimulator").then((module) => ({ default: module.ExcelSimulator })));
const AccountingTool = lazy(() => import("../tools/AccountingTool").then((module) => ({ default: module.AccountingTool })));
const TaxTool = lazy(() => import("../tools/TaxTool").then((module) => ({ default: module.TaxTool })));
const CorporateTaxTool = lazy(() => import("../tools/CorporateTaxTool").then((module) => ({ default: module.CorporateTaxTool })));
const RemoteDesktopTool = lazy(() => import("../tools/RemoteDesktopTool").then((module) => ({ default: module.RemoteDesktopTool })));

type IssuedOption = { id: number; text: string };
type IssuedQuestion = { question_id: number; question_text: string; question_type: string; options: IssuedOption[] };
type IssuedExam = {
  issued_id: number;
  assessment_title: string;
  assessment_type: string;
  desktop_app?: {
    app_key: string;
    display_name: string;
    heartbeat_seconds: number;
  } | null;
  instructions?: string;
  duration_minutes: number;
  timing_mode: "question" | "assessment";
  time_per_question_seconds: number | null;
  task?: {
    id: number;
    type: string;
    title: string;
    description: string;
    instructions: string;
    metadata: Record<string, unknown>;
  } | null;
  questions: IssuedQuestion[];
  status: string;
  score_pct?: number;
  passed?: boolean;
  draft?: {
    submission_id?: string;
    revision: number;
    saved_at?: string;
    answers: Record<string, number[]>;
    submitted_data: Record<string, unknown>;
    current_question_index: number;
    time_taken_seconds?: number;
    timer_state: Partial<TimerState>;
  } | null;
};

export function IssuedCandidatePanel() {
  const legalBase = `${import.meta.env.BASE_URL}legal`;
  const [token, setToken] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paper, setPaper] = useState<IssuedExam | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [status, setStatus] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [excelSubmission, setExcelSubmission] = useState<ExcelAssessmentSubmission | null>(null);
  const [accountingSubmission, setAccountingSubmission] = useState<AccountingAssessmentSubmission | null>(null);
  const [taxSubmission, setTaxSubmission] = useState<TaxAssessmentSubmission | null>(null);
  const [corporateTaxSubmission, setCorporateTaxSubmission] = useState<CorporateTaxAssessmentSubmission | null>(null);
  const [taskResponse, setTaskResponse] = useState("");
  const [taskFileLink, setTaskFileLink] = useState("");
  const [desktopSession, setDesktopSession] = useState({ sessionId: "", status: "not_started", ready: false });
  const [proctorEvents, setProctorEvents] = useState<Array<Record<string, unknown>>>([]);
  const [policyWarning, setPolicyWarning] = useState<{ reason: string; count: number } | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [completion, setCompletion] = useState<{ title: string; message: string } | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isAcceptingConsent, setIsAcceptingConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [welcomeCompleted, setWelcomeCompleted] = useState(false);
  const [briefingState, setBriefingState] = useState<"idle" | "playing" | "completed" | "error">("idle");
  const [briefingError, setBriefingError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [autosaveTick, setAutosaveTick] = useState(0);
  const [restoredTimerState, setRestoredTimerState] = useState<TimerState | null>(null);
  const welcomeSpeechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const welcomeSpeechWatchdogRef = useRef<number | null>(null);
  const welcomeSpeechRunRef = useRef(0);
  const submittingRef = useRef(false);
  const submissionIdRef = useRef<string>(globalThis.crypto?.randomUUID?.() || `submission-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const autosaveRevisionRef = useRef(0);
  const timerStateRef = useRef<TimerState | null>(null);
  const { status: gazeStatus, error: gazeError, stream: gazeStream, start: startGazeProctor, stop: stopGazeProctor } = useCandidateGazeProctor(Boolean(paper));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = String(params.get("issued_key") || "").trim();
    if (key) setAccessKey(key);
  }, []);

  useEffect(() => () => {
    welcomeSpeechRunRef.current += 1;
    if (welcomeSpeechWatchdogRef.current) window.clearTimeout(welcomeSpeechWatchdogRef.current);
    window.speechSynthesis?.cancel();
    welcomeSpeechRef.current = null;
  }, []);

  const issuedApi = async <T,>(method: "GET" | "POST", path: string, body?: unknown) => {
    const response = await api.request<T>({
      method,
      url: path,
      data: body,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.data;
  };

  const loadMe = async (newToken: string) => {
    setToken(newToken);
    const response = await api.request<IssuedExam>({
      method: "GET",
      url: "/exams/issued/me",
      headers: { Authorization: `Bearer ${newToken}` },
    });
    const me = response.data;
    if (["submitted", "completed", "review_pending", "reviewed", "terminated"].includes(me.status)) {
      setPaper(null);
      setStatus("This assessment has already been submitted. Results are shared only by the recruiting organization.");
      return;
    }
    setPaper(me);
    const draft = me.draft;
    const draftData = draft?.submitted_data || {};
    if (draft?.submission_id) submissionIdRef.current = draft.submission_id;
    autosaveRevisionRef.current = Number(draft?.revision || 0);
    setIndex(Math.min(Math.max(Number(draft?.current_question_index || 0), 0), Math.max(me.questions.length - 1, 0)));
    setAnswers(Object.fromEntries(Object.entries(draft?.answers || {}).map(([key, value]) => [Number(key), value])));
    setExcelSubmission((draftData.final_sheet_json ? draftData : null) as ExcelAssessmentSubmission | null);
    setAccountingSubmission((draftData.accounting_workspace ? draftData : null) as AccountingAssessmentSubmission | null);
    setTaxSubmission((draftData.tax_workspace ? draftData : null) as TaxAssessmentSubmission | null);
    setCorporateTaxSubmission((draftData.corporate_tax_workspace ? draftData : null) as CorporateTaxAssessmentSubmission | null);
    setTaskResponse(String(draftData.code || draftData.response_text || draftData.notes || me.task?.metadata?.starter_code || ""));
    setTaskFileLink(String(draftData.attachment_url || ""));
    const timerState = draft?.timer_state;
    setRestoredTimerState(
      timerState && Number.isFinite(timerState.remainingAssessmentSec)
        ? {
          remainingAssessmentSec: Number(timerState.remainingAssessmentSec),
          questionRemainingByIndex: timerState.questionRemainingByIndex || {},
          questionTimedOutByIndex: timerState.questionTimedOutByIndex || {},
        }
        : null,
    );
    setSaveState(draft ? "saved" : "idle");
    setProctorEvents([]);
    setPolicyWarning(null);
    setConsentAccepted(false);
    setWelcomeCompleted(false);
    setBriefingState("idle");
    setBriefingError("");
    setCompletion(null);
    setStatus("");
  };

  const welcomeBriefing = useMemo(() => {
    if (!paper) return "";
    const assessmentType = paper.assessment_type.replaceAll("_", " ");
    return `Please listen carefully to this complete briefing before you continue. Welcome to your Valases assessment. You are about to begin ${paper.assessment_title}, a ${assessmentType} assessment with ${paper.duration_minutes} minutes available. Find a quiet place, make sure your internet connection is stable, put away mobile phones, and keep your camera ready. Your assessment will remain in fullscreen. During the session, camera-based attention and object checks help protect assessment integrity. If sustained attention away from the screen, a mobile phone, or repeated browser policy issues are detected, the timer pauses and a warning appears. Return to fullscreen promptly if it exits. When you are ready, select Next to review the privacy and camera notice.`;
  }, [paper]);

  const playWelcomeBriefing = () => {
    if (!welcomeBriefing || briefingState === "playing") return;
    setBriefingError("");
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setBriefingState("error");
      setBriefingError("Audio briefing is not supported in this browser. Open the link in current Chrome, Edge, or Safari and try again.");
      return;
    }
    welcomeSpeechRunRef.current += 1;
    const runId = welcomeSpeechRunRef.current;
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("en") && /natural|neural/i.test(voice.name))
      || voices.find((voice) => voice.lang.toLowerCase() === "en-in" && voice.localService)
      || voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
      || null;
    const utterance = new SpeechSynthesisUtterance(welcomeBriefing);
    utterance.voice = selectedVoice;
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => {
      if (runId !== welcomeSpeechRunRef.current) return;
      if (welcomeSpeechWatchdogRef.current) window.clearTimeout(welcomeSpeechWatchdogRef.current);
      welcomeSpeechWatchdogRef.current = null;
      welcomeSpeechRef.current = null;
      setBriefingState("completed");
    };
    utterance.onerror = (event) => {
      if (welcomeSpeechWatchdogRef.current) window.clearTimeout(welcomeSpeechWatchdogRef.current);
      welcomeSpeechWatchdogRef.current = null;
      welcomeSpeechRef.current = null;
      if (event.error === "canceled" || event.error === "interrupted" || runId !== welcomeSpeechRunRef.current) return;
      setBriefingState("error");
      setBriefingError("The audio briefing stopped unexpectedly. Select Play audio briefing to try again.");
    };
    welcomeSpeechRef.current = utterance;
    setBriefingState("playing");
    window.speechSynthesis.speak(utterance);
    const estimatedDurationMs = Math.max(25_000, Math.ceil(welcomeBriefing.split(/\s+/).length / 2.1) * 1000);
    welcomeSpeechWatchdogRef.current = window.setTimeout(() => {
      if (runId !== welcomeSpeechRunRef.current || welcomeSpeechRef.current !== utterance) return;
      window.speechSynthesis.cancel();
      welcomeSpeechRef.current = null;
      welcomeSpeechWatchdogRef.current = null;
      setBriefingState("error");
      setBriefingError("The audio service did not finish the briefing. Select Play audio briefing to try again.");
    }, estimatedDurationMs + 12_000);
  };

  const login = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setStatus("");
    try {
      const auth = accessKey
        ? await api.post(`/exams/issued/key/${encodeURIComponent(accessKey)}/login`, { password })
        : await api.post("/exams/issued/login", { email, password });
      await loadMe(String(auth.data.token || ""));
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setStatus(detail || "We could not sign you in. Check the issued credentials and try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const acceptConsent = async () => {
    if (isAcceptingConsent) return;
    setIsAcceptingConsent(true);
    setStatus("");
    const consentDetails = {
      policy_version: "privacy-2026-07-19",
      consent_version: "candidate-consent-1.0",
      camera: true,
      microphone: false,
      recording: false,
      accepted_at: new Date().toISOString(),
    };
    setProctorEvents((currentEvents) => [
      ...currentEvents.filter((event) => event.event_type !== "candidate_consent_accepted").slice(-99),
      { event_type: "candidate_consent_accepted", severity: "info", details: consentDetails, recorded_at: consentDetails.accepted_at },
    ]);
    try {
      await issuedApi("POST", "/exams/issued/consent", {
        policy_version: consentDetails.policy_version,
        consent_version: consentDetails.consent_version,
        camera: consentDetails.camera,
        microphone: consentDetails.microphone,
        recording: consentDetails.recording,
      });
    } catch (error) {
      const responseStatus = Number((error as { response?: { status?: number } })?.response?.status || 0);
      if (!responseStatus || responseStatus < 500) {
        setStatus("We could not confirm your consent with the assessment service. Check your connection and try again.");
        if (document.fullscreenElement) void document.exitFullscreen();
        setIsAcceptingConsent(false);
        return;
      }
      // The explicit consent event is retained locally and submitted with the
      // attempt, so a transient server write failure does not block the session.
    }
    try {
      await startGazeProctor();
      setConsentAccepted(true);
    } catch {
      stopGazeProctor();
      setStatus("We could not start integrity monitoring. Check camera permission and try again.");
      if (document.fullscreenElement) void document.exitFullscreen();
    } finally {
      setIsAcceptingConsent(false);
    }
  };

  const current = useMemo(() => (paper ? paper.questions[index] : null), [paper, index]);
  const isMcqAssessment = paper?.assessment_type === "mcq";

  const finishCandidateSession = useCallback((title: string, message: string) => {
    submittingRef.current = true;
    setIsSubmitting(false);
    setPolicyWarning(null);
    stopGazeProctor();
    setCompletion({ title, message });
    setPaper(null);
    if (document.fullscreenElement) void document.exitFullscreen();
  }, [stopGazeProctor]);

  const beginSubmission = () => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setStatus("");
    setIsSubmitting(true);
    return true;
  };

  const failSubmission = () => {
    submittingRef.current = false;
    setIsSubmitting(false);
    setStatus("Submission failed. Check your connection and try again.");
  };

  const buildSubmittedData = useCallback((): Record<string, unknown> => {
    if (!paper) return {};
    if (paper.desktop_app) return { desktop_session_id: desktopSession.sessionId };
    if (paper.assessment_type === "spreadsheet") {
      return excelSubmission || { final_sheet_json: {}, formulas_json: {}, calculated_values_json: {}, activity_log: [] };
    }
    if (paper.assessment_type === "coding") return { code: taskResponse, attachment_url: taskFileLink };
    if (paper.assessment_type === "accounting") {
      return accountingSubmission || {
        entered_form_values: {},
        identified_red_flags: [],
        notes: "",
        accounting_workspace: {
          bank_treatments: {},
          book_treatments: {},
          ar_adjustment: 0,
          duplicate_invoice_voided: false,
          transactions: [],
          posted_journal_entries: [],
          activity_log: [],
          completed_workflows: [],
        },
      };
    }
    if (paper.assessment_type === "tax_simulator") {
      return taxSubmission || {
        entered_form_values: {},
        identified_red_flags: [],
        notes: "",
        tax_workspace: {
          inputs: {},
          activity_log: [],
          completed_sections: [],
        },
      };
    }
    if (paper.assessment_type === "tax_1120") {
      return corporateTaxSubmission || {
        entered_form_values: {},
        identified_red_flags: [],
        notes: "",
        corporate_tax_workspace: {
          inputs: {},
          activity_log: [],
          completed_sections: [],
        },
      };
    }
    return { response_text: taskResponse, attachment_url: taskFileLink };
  }, [accountingSubmission, corporateTaxSubmission, desktopSession.sessionId, excelSubmission, paper, taskFileLink, taskResponse, taxSubmission]);

  const submit = async (endReason: "fullscreen" | "policy" | "manual" | null = null) => {
    if (!paper || !beginSubmission()) return;
    const submittedData = buildSubmittedData();
    try {
      const response = await issuedApi<{ status: string; message: string }>("POST", "/exams/issued/submit", {
        submission_id: submissionIdRef.current,
        answers: Object.fromEntries(Object.entries(answers).map(([qid, selected]) => [qid, selected])),
        submitted_data: submittedData,
        proctoring_events: proctorEvents,
        time_taken_seconds: Math.max(
          0,
          Number(paper.duration_minutes || 0) * 60 - Number(timerStateRef.current?.remainingAssessmentSec ?? Number(paper.duration_minutes || 0) * 60),
        ),
      });
      finishCandidateSession(
        endReason ? "Assessment ended" : "Assessment submitted",
        endReason === "fullscreen"
          ? "Your session ended because fullscreen was exited. Your work and integrity events were sent for review."
          : endReason === "policy"
            ? "Your session ended after the assessment integrity warning limit was reached. Your work was sent for review."
            : endReason === "manual"
              ? "You ended this assessment. Your completed work was submitted for review."
          : response.message || "Thank you. Your assessment was submitted successfully for recruiter review.",
      );
    } catch {
      if (endReason) {
        finishCandidateSession(
          "Assessment ended",
          endReason === "fullscreen"
            ? "Fullscreen was exited and this session is now closed. The recorded activity will be reviewed."
            : "This session is now closed. Your recorded work and integrity activity will be reviewed.",
        );
      } else {
        failSubmission();
      }
    }
  };

  const recordProctorEvent = async (eventType: string, severity = "warning", details: Record<string, unknown> = {}) => {
    const eventDetails = { source: "candidate_browser", ...details };
    const event = { event_type: eventType, severity, details: eventDetails, recorded_at: new Date().toISOString() };
    setProctorEvents((currentEvents) => [...currentEvents.slice(-99), event]);
    if (!token) return;
    try {
      const response = await issuedApi<{ warning_count: number; should_terminate: boolean }>("POST", "/exams/issued/proctor-event", {
        event_type: eventType,
        severity,
        details: eventDetails,
      });
      if (response.should_terminate) {
        setStatus("Assessment closed because the warning limit was reached. Your attempt has been sent for review.");
      }
    } catch {
      // The final submission still carries the local event log if the network is briefly unavailable.
    }
  };

  const { confirmExit, fullscreenRequired, requestFullscreen, warningCount, escapeWarningVisible, keepAssessmentOpen, endAssessmentFromEscape } = useAssessmentSession({
    active: Boolean(paper && consentAccepted),
    exitWarning: "Exiting now will end this assessment. Do you want to continue?",
    onExitConfirmed: () => {
      if (submittingRef.current) return;
      void submit("manual");
    },
    onPolicyWarning: (reason, count, signal) => {
      if (submittingRef.current) return;
      setPolicyWarning({ reason, count });
      void recordProctorEvent(signal?.eventType || "browser_policy_warning", signal?.severity || "warning", { reason, ...(signal?.details || {}) });
    },
    onPolicyTerminated: async (reason, _count, signal) => {
      if (submittingRef.current) return;
      setPolicyWarning({ reason: `Assessment closed: ${reason}`, count: 8 });
      await recordProctorEvent(signal?.eventType || "browser_policy_terminated", "critical", { reason, ...(signal?.details || {}) });
      await submit("policy");
    },
  });

  const { timerState, timerDisplay } = useAssessmentTimer({
    timingMode: paper?.timing_mode || "assessment",
    durationMinutes: Number(paper?.duration_minutes || 30),
    timePerQuestionSeconds: Number(paper?.time_per_question_seconds || 30),
    questionIndex: index,
    enabled: Boolean(paper && consentAccepted && !policyWarning && !escapeWarningVisible && !fullscreenRequired),
    initialState: restoredTimerState,
    onAssessmentTimeUp: () => { void submit(); },
    onQuestionTimeUp: () => {
      if (!paper) return;
      if (index < paper.questions.length - 1) setIndex((x) => x + 1);
      else void submit();
    },
  });
  timerStateRef.current = timerState;

  useEffect(() => {
    if (!paper || !consentAccepted || submittingRef.current) return;
    const intervalId = window.setInterval(() => setAutosaveTick((value) => value + 1), 15_000);
    return () => window.clearInterval(intervalId);
  }, [consentAccepted, paper]);

  useEffect(() => {
    if (!paper || !consentAccepted || submittingRef.current) return;
    setSaveState("saving");
    const revision = autosaveRevisionRef.current + 1;
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await api.post<{ revision: number }>("/exams/issued/autosave", {
          submission_id: submissionIdRef.current,
          revision,
          answers: Object.fromEntries(Object.entries(answers).map(([qid, selected]) => [qid, selected])),
          submitted_data: buildSubmittedData(),
          current_question_index: index,
          time_taken_seconds: Math.max(0, Number(paper.duration_minutes || 0) * 60 - Number(timerStateRef.current?.remainingAssessmentSec ?? Number(paper.duration_minutes || 0) * 60)),
          timer_state: timerStateRef.current || {},
        }, { headers: { Authorization: `Bearer ${token}` } });
        autosaveRevisionRef.current = Math.max(autosaveRevisionRef.current, Number(response.data.revision || revision));
        setSaveState("saved");
      } catch {
        setSaveState("offline");
      }
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [answers, autosaveTick, buildSubmittedData, consentAccepted, index, paper, token]);

  if (completion) {
    return (
      <section className="assessment-thank-you" role="status">
        <BrandLogo className="assessment-brand-logo" />
        <span className="launch-section-label">Valases Assessments</span>
        <h1>{completion.title}</h1>
        <p>{completion.message}</p>
        <strong>Thank you for your time.</strong>
        <small>You may now close this browser tab.</small>
      </section>
    );
  }

  return (
    <section
      className={paper && consentAccepted ? "issued-assessment-runtime" : paper ? "candidate-entry-container" : "candidate-login-surface"}
      aria-busy={isSubmitting}
    >
      {isSubmitting && (
        <div className="assessment-submit-overlay" role="status" aria-live="assertive">
          <span className="assessment-submit-spinner" aria-hidden="true" />
          <strong>Submitting assessment</strong>
          <span>Saving your work. Please keep this window open.</span>
        </div>
      )}
      {!paper ? (
        <div className="candidate-login-layout">
          <div className="candidate-login-intro">
            <BrandLogo className="candidate-login-logo" />
            <h1>Welcome</h1>
            <p>Sign in with the details from your assessment invitation.</p>
          </div>
        <form className="issued-login-panel" aria-busy={isSigningIn} onSubmit={(event) => { event.preventDefault(); void login(); }}>
          {!accessKey && (
            <label className="field-stack">
              <span>Email address</span>
              <input autoComplete="email" placeholder="name@company.com" value={email} disabled={isSigningIn} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          <label className="field-stack">
            <span>Assessment password</span>
            <input autoComplete="current-password" placeholder="Enter your password" type="password" value={password} disabled={isSigningIn} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="auth-actions">
            <button type="submit" disabled={isSigningIn || !password || (!accessKey && !email)}>
              {isSigningIn ? "Signing in..." : "Continue"}
            </button>
          </div>
          {isSigningIn && <div className="candidate-login-progress" role="status" aria-live="polite"><span className="candidate-loading-spinner" aria-hidden="true" /><span><strong>Signing you in</strong><small>Preparing your assessment...</small></span></div>}
          {status && <small className="candidate-login-status" role="alert">{status}</small>}
        </form>
        </div>
      ) : (
        <>
          {!consentAccepted ? (
            !welcomeCompleted ? (
            <section className="candidate-welcome-panel" aria-labelledby="candidate-welcome-title">
              <nav className="candidate-entry-steps" aria-label="Assessment preparation progress">
                <span className="active"><b>1</b>Welcome</span>
                <span><b>2</b>Privacy and camera</span>
                <span><b>3</b>Assessment</span>
              </nav>
              <div className="candidate-welcome-heading">
                <span className="launch-section-label">Your assessment is ready</span>
                <h2 id="candidate-welcome-title">Welcome to Valases Assessments</h2>
                <p>Review the written note and listen to the complete audio briefing before continuing.</p>
              </div>
              <div className="candidate-assessment-summary">
                <div><small>Assessment</small><strong>{paper.assessment_title}</strong></div>
                <div><small>Format</small><strong>{paper.assessment_type.replaceAll("_", " ")}</strong></div>
                <div><small>Time available</small><strong>{paper.duration_minutes} minutes</strong></div>
              </div>
              <div className="candidate-welcome-content">
                <div className="candidate-written-note">
                  <span className="launch-section-label">Written note</span>
                  <h3>Before you begin</h3>
                  <p>Choose a quiet place with a stable connection, put away mobile phones, and keep your camera available. The assessment runs in fullscreen and uses local attention and object checks.</p>
                  <ul>
                    <li>Read each task carefully and submit only when your work is complete.</li>
                    <li>Sustained gaze away pauses the timer and displays a warning.</li>
                    <li>If fullscreen exits, return promptly to continue. Repeated integrity warnings may send the attempt for review.</li>
                  </ul>
                </div>
                <div className={`candidate-audio-note ${briefingState}`}>
                  <div className="candidate-audio-note-head">
                    <div><span className="launch-section-label">Required audio note</span><h3>{briefingState === "completed" ? "Briefing completed" : "Listen before continuing"}</h3></div>
                    <span className="candidate-audio-status">{briefingState === "playing" ? "Playing" : briefingState === "completed" ? "Completed" : "Not played"}</span>
                  </div>
                  <div className="candidate-audio-visual" aria-hidden="true">{Array.from({ length: 18 }, (_, position) => <i key={position} />)}</div>
                  <button type="button" className="candidate-audio-button" disabled={briefingState === "playing"} onClick={playWelcomeBriefing}>
                    {briefingState === "playing" ? "Audio briefing playing..." : briefingState === "completed" ? "Replay audio briefing" : "Play audio briefing"}
                  </button>
                  {briefingError && <small className="candidate-login-status" role="alert">{briefingError}</small>}
                </div>
              </div>
              <div className="candidate-welcome-footer">
                <span aria-live="polite">{briefingState === "completed" ? "Audio complete. You may continue." : "Complete the audio briefing to unlock the next step."}</span>
                <div className="candidate-welcome-next-slot">
                  {briefingState === "completed" ? <button type="button" className="assessment-primary-btn" onClick={() => setWelcomeCompleted(true)}>Next</button> : <div className="candidate-next-locked" aria-hidden="true">Next</div>}
                </div>
              </div>
            </section>
            ) : (
            <section className="candidate-consent-panel" aria-labelledby="candidate-consent-title">
              <nav className="candidate-entry-steps" aria-label="Assessment preparation progress">
                <span className="done"><b>1</b>Welcome</span>
                <span className="active"><b>2</b>Privacy and camera</span>
                <span><b>3</b>Assessment</span>
              </nav>
              <span className="launch-section-label">Before you begin</span>
              <h3 id="candidate-consent-title">Assessment privacy and integrity notice</h3>
              <p>Your answers, submitted work, timestamps, and assessment activity are collected to administer, score, secure, and review this assessment.</p>
              <p>This session uses browser security checks and on-device camera analysis for attention and prohibited-object signals, including mobile phones. Camera frames are processed in the browser and are not recorded by this flow. If fullscreen exits, return promptly to continue. Automated signals require recruiter review and are not a final employment decision.</p>
              <div className="candidate-policy-links">
                <a href={`${legalBase}/privacy-policy.html`} target="_blank" rel="noreferrer">Privacy policy</a>
                <a href={`${legalBase}/data-retention-and-deletion.html`} target="_blank" rel="noreferrer">Retention and deletion</a>
                <a href={`${legalBase}/candidate-consent.html`} target="_blank" rel="noreferrer">Full consent notice</a>
              </div>
              <label className="candidate-consent-check">
                <input type="checkbox" checked={consentAccepted} disabled={isAcceptingConsent} onChange={(event) => { if (event.target.checked) { void requestFullscreen(); void acceptConsent(); } }} />
                <span>I have read and agree to this assessment data and integrity notice.</span>
              </label>
              {isAcceptingConsent && <div className="candidate-login-progress compact" role="status"><span className="candidate-loading-spinner" aria-hidden="true" /><span><strong>Preparing fullscreen assessment</strong><small>Starting integrity checks and calibrating the camera...</small></span></div>}
              {gazeError && (
                <div className="candidate-camera-retry" role="alert">
                  <small className="candidate-login-status">{gazeError}</small>
                  <button type="button" className="secondary-btn" disabled={isAcceptingConsent} onClick={() => { void requestFullscreen(); void acceptConsent(); }}>
                    Retry camera check
                  </button>
                </div>
              )}
              <small>Need an accommodation or have a privacy question? Contact the organization that issued this assessment.</small>
            </section>
            )
          ) : (
            <>
          {fullscreenRequired && (
            <div className="assessment-fullscreen-overlay inline">
              <strong>Assessment must stay in fullscreen</strong>
              <span>Return to fullscreen to continue.</span>
              <button type="button" onClick={() => void requestFullscreen()}>Resume Fullscreen</button>
            </div>
          )}
          {policyWarning && (
            <div className="assessment-blocking-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="policy-warning-title">
                <div className={`assessment-warning-dialog${warningCount >= 8 ? " critical" : ""}`}>
                <span className="launch-section-label">Integrity check</span>
                <h2 id="policy-warning-title">{warningCount >= 8 ? "Assessment closed" : "Please return your attention to the assessment"}</h2>
                <p>{policyWarning.reason}. Warning {policyWarning.count} of 8.</p>
                {warningCount < 8 && <button type="button" onClick={() => setPolicyWarning(null)}>Continue Assessment</button>}
              </div>
            </div>
          )}
          {escapeWarningVisible && (
            <div className="assessment-blocking-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="escape-warning-title">
              <div className="assessment-warning-dialog critical">
                <span className="launch-section-label">Fullscreen protection</span>
                <h2 id="escape-warning-title">Keep the assessment in fullscreen</h2>
                <p>Return to fullscreen to continue. You can still end and submit manually if you are finished.</p>
                <div className="assessment-dialog-actions">
                  <button type="button" className="secondary-btn" onClick={keepAssessmentOpen}>Keep Assessment Open</button>
                  <button type="button" className="assessment-exit-btn" onClick={endAssessmentFromEscape}>End Assessment</button>
                </div>
              </div>
            </div>
          )}
          <div className="assessment-runtime-header">
            <div>
              <span className="launch-section-label">Assessment session</span>
              <h3>{paper.assessment_title}</h3>
            </div>
            <div className="assessment-runtime-meta">
              <span className={`candidate-save-state ${saveState}`} aria-live="polite">
                {saveState === "saving" ? "Saving..." : saveState === "offline" ? "Save pending" : saveState === "saved" ? "Saved" : "Ready"}
              </span>
              <span className={`candidate-proctor-state ${gazeStatus}`}><i aria-hidden="true" />Integrity monitoring {gazeStatus === "active" ? "active" : gazeStatus}</span>
              {gazeStream && <video className="candidate-proctor-preview" aria-label="Camera proctor preview" autoPlay muted playsInline ref={(node) => { if (node && node.srcObject !== gazeStream) node.srcObject = gazeStream; }} />}
              <span>{paper.assessment_type === "mcq" ? `Question ${index + 1}/${paper.questions.length}` : "Task workspace"}</span>
              <span>Timer: {timerDisplay}</span>
            </div>
          </div>
          {paper.desktop_app && (
            <section className="candidate-desktop-runtime">
              <Suspense fallback={<div className="tool-loading-state" role="status">Preparing application...</div>}>
                <RemoteDesktopTool
                  title={paper.desktop_app.display_name}
                  assessmentMode
                  candidateToken={token}
                  heartbeatSeconds={paper.desktop_app.heartbeat_seconds}
                  onSessionChange={setDesktopSession}
                />
              </Suspense>
              <div className="assessment-action-bar desktop-session-actions">
                <span>{desktopSession.ready ? "Your work is saved to this assessment session." : "The submit action will become available when your application session is ready."}</span>
                <button className="assessment-primary-btn" type="button" disabled={!desktopSession.ready} onClick={() => void submit()}>Submit assessment</button>
              </div>
            </section>
          )}
          {!paper.desktop_app && paper.assessment_type === "spreadsheet" && paper.task && (
            <Suspense fallback={<div className="tool-loading-state" role="status">Loading spreadsheet...</div>}>
              <ExcelSimulator
                title={paper.task.title || paper.assessment_title}
                description={paper.task.description}
                instructions={paper.task.instructions || paper.instructions || ""}
                initialSheet={(paper.task.metadata?.initial_spreadsheet_data || {}) as Record<string, string | number | boolean | null>}
                lockedCells={(paper.task.metadata?.locked_cells || []) as string[]}
                candidateMode
                showTopbarActions={false}
                onAutosave={(submission) => setExcelSubmission(submission)}
                onSubmit={async (submission) => {
                  if (!window.confirm("Submit this assessment? You will not be able to continue after submission.")) return;
                  if (!beginSubmission()) return;
                  setExcelSubmission(submission);
                  try {
                    await issuedApi<{ status: string }>("POST", "/exams/issued/submit", {
                      submission_id: submissionIdRef.current,
                      answers: {},
                      submitted_data: submission,
                      proctoring_events: [...proctorEvents, ...submission.activity_log],
                      time_taken_seconds: 0,
                    });
                    finishCandidateSession("Assessment submitted", "Thank you. Your assessment was submitted successfully for recruiter review.");
                  } catch {
                    failSubmission();
                  }
                }}
              />
            </Suspense>
          )}
          {!paper.desktop_app && paper.assessment_type === "accounting" && paper.task && (
            <section className="candidate-accounting-runtime">
              <Suspense fallback={<div className="tool-loading-state" role="status">Preparing accounting workbench...</div>}>
                <AccountingTool
                  title={paper.task.title || paper.assessment_title}
                  description={paper.task.description}
                  instructions={paper.task.instructions || paper.instructions || ""}
                  caseData={(paper.task.metadata?.accounting_case || {}) as Partial<AccountingCase>}
                  initialSubmission={accountingSubmission}
                  candidateMode
                  onAutosave={setAccountingSubmission}
                  onSubmit={async (submission) => {
                    if (!window.confirm("Submit this assessment? You will not be able to continue after submission.")) return;
                    if (!beginSubmission()) return;
                    setAccountingSubmission(submission);
                    try {
                      const response = await issuedApi<{ status: string; message?: string }>("POST", "/exams/issued/submit", {
                        submission_id: submissionIdRef.current,
                        answers: {},
                        submitted_data: submission,
                        proctoring_events: proctorEvents,
                        time_taken_seconds: Math.max(
                          0,
                          Number(paper.duration_minutes || 0) * 60 - Number(timerStateRef.current?.remainingAssessmentSec ?? Number(paper.duration_minutes || 0) * 60),
                        ),
                      });
                      finishCandidateSession("Assessment submitted", response.message || "Thank you. Your assessment was submitted successfully for recruiter review.");
                    } catch {
                      failSubmission();
                    }
                  }}
                />
              </Suspense>
            </section>
          )}
          {!paper.desktop_app && paper.assessment_type === "tax_simulator" && paper.task && (
            <section className="candidate-tax-runtime">
              <Suspense fallback={<div className="tool-loading-state" role="status">Preparing tax return...</div>}>
                <TaxTool
                  title={paper.task.title || paper.assessment_title}
                  description={paper.task.description}
                  instructions={paper.task.instructions || paper.instructions || ""}
                  caseData={(paper.task.metadata?.tax_case || {}) as Partial<TaxCase>}
                  initialSubmission={taxSubmission}
                  candidateMode
                  onAutosave={setTaxSubmission}
                  onSubmit={async (submission) => {
                    if (!window.confirm("Submit this assessment? You will not be able to continue after submission.")) return;
                    if (!beginSubmission()) return;
                    setTaxSubmission(submission);
                    try {
                      const response = await issuedApi<{ status: string; message?: string }>("POST", "/exams/issued/submit", {
                        submission_id: submissionIdRef.current,
                        answers: {},
                        submitted_data: submission,
                        proctoring_events: proctorEvents,
                        time_taken_seconds: Math.max(
                          0,
                          Number(paper.duration_minutes || 0) * 60 - Number(timerStateRef.current?.remainingAssessmentSec ?? Number(paper.duration_minutes || 0) * 60),
                        ),
                      });
                      finishCandidateSession("Assessment submitted", response.message || "Thank you. Your assessment was submitted successfully for recruiter review.");
                    } catch {
                      failSubmission();
                    }
                  }}
                />
              </Suspense>
            </section>
          )}
          {!paper.desktop_app && paper.assessment_type === "tax_1120" && paper.task && (
            <section className="candidate-tax-runtime">
              <Suspense fallback={<div className="tool-loading-state" role="status">Preparing corporate tax return...</div>}>
                <CorporateTaxTool
                  title={paper.task.title || paper.assessment_title}
                  description={paper.task.description}
                  instructions={paper.task.instructions || paper.instructions || ""}
                  caseData={(paper.task.metadata?.corporate_tax_case || {}) as Partial<CorporateTaxCase>}
                  initialSubmission={corporateTaxSubmission}
                  candidateMode
                  onAutosave={setCorporateTaxSubmission}
                  onSubmit={async (submission) => {
                    if (!window.confirm("Submit this assessment? You will not be able to continue after submission.")) return;
                    if (!beginSubmission()) return;
                    setCorporateTaxSubmission(submission);
                    try {
                      const response = await issuedApi<{ status: string; message?: string }>("POST", "/exams/issued/submit", {
                        submission_id: submissionIdRef.current,
                        answers: {},
                        submitted_data: submission,
                        proctoring_events: proctorEvents,
                        time_taken_seconds: Math.max(
                          0,
                          Number(paper.duration_minutes || 0) * 60 - Number(timerStateRef.current?.remainingAssessmentSec ?? Number(paper.duration_minutes || 0) * 60),
                        ),
                      });
                      finishCandidateSession("Assessment submitted", response.message || "Thank you. Your assessment was submitted successfully for recruiter review.");
                    } catch {
                      failSubmission();
                    }
                  }}
                />
              </Suspense>
            </section>
          )}
          {isMcqAssessment && current && (
            <main className="mcq-runtime">
            <div className="question-runtime-surface">
              <span className="mcq-question-number">Question {index + 1} of {paper.questions.length}</span>
              <strong>{current.question_text}</strong>
              <div className="question-option-list">
                {current.options.map((o) => (
                <label key={o.id} className="question-option-card">
                  <input
                    type={current.question_type === "mcq_multiple_correct" ? "checkbox" : "radio"}
                    name={`issued-${current.question_id}`}
                    checked={(answers[current.question_id] || []).includes(o.id)}
                    onChange={(e) => {
                      const prev = answers[current.question_id] || [];
                      const next = current.question_type === "mcq_multiple_correct"
                        ? (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id))
                        : [o.id];
                      setAnswers((state) => ({ ...state, [current.question_id]: next }));
                    }}
                  />
                  <span>{o.text}</span>
                </label>
              ))}
              </div>
            </div>
            <footer
              className="assessment-question-footer"
              onPointerEnter={() => window.dispatchEvent(new Event("valases:onscreen-navigation"))}
              onPointerMove={() => window.dispatchEvent(new Event("valases:onscreen-navigation"))}
            >
              <div className="assessment-question-context">
                <button className="assessment-exit-btn" type="button" onClick={confirmExit}>Exit assessment</button>
                <span>{(answers[current.question_id] || []).length ? "Answer selected" : "Select an answer to continue"}</span>
              </div>
              <div className="assessment-question-navigation">
                <button className="secondary-btn" disabled={index === 0} onClick={() => setIndex((x) => x - 1)}>Previous</button>
                {paper && index < paper.questions.length - 1 ? (
                  <button className="assessment-primary-btn" onClick={() => setIndex((x) => x + 1)}>Next question</button>
                ) : (
                  <button className="assessment-primary-btn" onClick={() => void submit()}>Submit assessment</button>
                )}
              </div>
            </footer>
            </main>
          )}
          {!paper.desktop_app && !isMcqAssessment && !["spreadsheet", "accounting", "tax_simulator", "tax_1120"].includes(paper.assessment_type) && paper.task && (
            <section className="task-candidate-workspace">
              <div className="task-candidate-brief">
                <span>Task brief</span>
                <h3>{paper.task.title}</h3>
                <p>{paper.task.description}</p>
                {paper.task.instructions && <div className="task-instructions">{paper.task.instructions}</div>}
                {Array.isArray(paper.task.metadata?.attachments) && paper.task.metadata.attachments.length > 0 && (
                  <div className="task-attachments">
                    <strong>Reference material</strong>
                    {(paper.task.metadata.attachments as Array<{ name?: string; url?: string }>).map((attachment, attachmentIndex) => (
                      <a key={`${attachment.url}-${attachmentIndex}`} href={attachment.url} target="_blank" rel="noreferrer">{attachment.name || `Attachment ${attachmentIndex + 1}`}</a>
                    ))}
                  </div>
                )}
              </div>
              <div className="task-response-panel">
                <label className="field-stack">
                  <span>{paper.assessment_type === "coding" ? "Solution code" : "Candidate response"}</span>
                  <textarea className={paper.assessment_type === "coding" ? "code-input" : ""} rows={paper.assessment_type === "coding" ? 16 : 10} value={taskResponse} onChange={(event) => setTaskResponse(event.target.value)} placeholder={paper.assessment_type === "coding" ? String(paper.task.metadata?.starter_code || "Write your solution here") : "Enter your response, assumptions, and conclusion."} />
                </label>
                {paper.task.metadata?.answer_format === "file_or_text" && <label className="field-stack"><span>Submission file link</span><input type="url" value={taskFileLink} onChange={(event) => setTaskFileLink(event.target.value)} placeholder="https://..." /></label>}
              </div>
              <div className="assessment-action-bar inline"><button className="assessment-primary-btn" type="button" disabled={!taskResponse.trim() && !taskFileLink.trim()} onClick={() => void submit()}>Submit Assessment</button></div>
            </section>
          )}
          {status && <div>{status}</div>}
            </>
          )}
        </>
      )}
    </section>
  );
}
