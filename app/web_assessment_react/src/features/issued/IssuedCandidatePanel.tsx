import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useCandidateGazeProctor } from "../assessment/useCandidateGazeProctor";
import { useAssessmentSession } from "../assessment/useAssessmentSession";
import { useAssessmentTimer } from "../student/useAssessmentTimer";
import { ExcelAssessmentSubmission, ExcelSimulator } from "../tools/ExcelSimulator";

type IssuedOption = { id: number; text: string };
type IssuedQuestion = { question_id: number; question_text: string; question_type: string; options: IssuedOption[] };
type IssuedExam = {
  issued_id: number;
  assessment_title: string;
  assessment_type: string;
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
    marks: number;
    metadata: Record<string, unknown>;
    grading_config: Record<string, unknown>;
  } | null;
  questions: IssuedQuestion[];
  status: string;
  score_pct?: number;
  passed?: boolean;
};

export function IssuedCandidatePanel() {
  const [token, setToken] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paper, setPaper] = useState<IssuedExam | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [status, setStatus] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [excelSubmission, setExcelSubmission] = useState<ExcelAssessmentSubmission | null>(null);
  const [taskResponse, setTaskResponse] = useState("");
  const [taskFileLink, setTaskFileLink] = useState("");
  const [taxValues, setTaxValues] = useState<Record<string, string>>({});
  const [identifiedFlags, setIdentifiedFlags] = useState("");
  const [proctorEvents, setProctorEvents] = useState<Array<Record<string, unknown>>>([]);
  const [policyWarning, setPolicyWarning] = useState<{ reason: string; count: number } | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [completion, setCompletion] = useState<{ title: string; message: string } | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isAcceptingConsent, setIsAcceptingConsent] = useState(false);
  const [welcomeCompleted, setWelcomeCompleted] = useState(false);
  const [briefingState, setBriefingState] = useState<"idle" | "playing" | "completed" | "error">("idle");
  const [briefingError, setBriefingError] = useState("");
  const welcomeSpeechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const welcomeSpeechRunRef = useRef(0);
  const { status: gazeStatus, error: gazeError, stream: gazeStream, start: startGazeProctor, stop: stopGazeProctor } = useCandidateGazeProctor(Boolean(paper));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = String(params.get("issued_key") || "").trim();
    if (key) setAccessKey(key);
  }, []);

  useEffect(() => () => {
    welcomeSpeechRunRef.current += 1;
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
    if (me.status === "completed") {
      setPaper(null);
      setStatus(`Already completed. Score ${Number(me.score_pct || 0).toFixed(2)}%`);
      return;
    }
    setPaper(me);
    setIndex(0);
    setAnswers({});
    setExcelSubmission(null);
    setTaskResponse(String(me.task?.metadata?.starter_code || ""));
    setTaskFileLink("");
    setTaxValues({});
    setIdentifiedFlags("");
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
    return `Welcome to your Certora assessment. You are about to begin ${paper.assessment_title}, a ${assessmentType} assessment with ${paper.duration_minutes} minutes available. Before continuing, move to a quiet place, keep a stable internet connection, and have your camera ready. The assessment must remain in fullscreen. Camera-based gaze detection runs during the session. If sustained attention away from the screen is detected, the timer pauses and an integrity warning appears. Exiting fullscreen ends the assessment. Listen to this briefing completely, then select Next to review privacy and camera consent.`;
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
    const selectedVoice = voices.find((voice) => voice.lang.toLowerCase() === "en-in")
      || voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
      || null;
    const segments = welcomeBriefing.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((segment) => segment.trim()).filter(Boolean) || [welcomeBriefing];
    const speakSegment = (position: number) => {
      if (runId !== welcomeSpeechRunRef.current) return;
      if (position >= segments.length) {
        welcomeSpeechRef.current = null;
        setBriefingState("completed");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(segments[position]);
      utterance.voice = selectedVoice;
      utterance.rate = 0.94;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => speakSegment(position + 1);
      utterance.onerror = (event) => {
        welcomeSpeechRef.current = null;
        if (event.error === "canceled" || event.error === "interrupted" || runId !== welcomeSpeechRunRef.current) return;
        setBriefingState("error");
        setBriefingError("The audio briefing stopped unexpectedly. Select Play audio briefing to try again.");
      };
      welcomeSpeechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };
    setBriefingState("playing");
    speakSegment(0);
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
    try {
      await startGazeProctor();
      await issuedApi("POST", "/exams/issued/consent", {
        policy_version: "privacy-2026-07-19",
        consent_version: "candidate-consent-1.0",
        camera: true,
        microphone: false,
        recording: false,
      });
      setConsentAccepted(true);
    } catch {
      stopGazeProctor();
      setStatus("We could not start camera proctoring. Check camera permission and your connection, then try again.");
      if (document.fullscreenElement) void document.exitFullscreen();
    } finally {
      setIsAcceptingConsent(false);
    }
  };

  const current = useMemo(() => (paper ? paper.questions[index] : null), [paper, index]);
  const isMcqAssessment = paper?.assessment_type === "mcq";

  const submit = async (endReason: "fullscreen" | "policy" | "manual" | null = null) => {
    if (!paper) return;
    const submittedData = paper.assessment_type === "spreadsheet"
      ? (excelSubmission || { final_sheet_json: {}, formulas_json: {}, calculated_values_json: {}, activity_log: [] })
      : paper.assessment_type === "coding"
        ? { code: taskResponse, attachment_url: taskFileLink }
        : paper.assessment_type === "tax_simulator" || paper.assessment_type === "accounting"
          ? { entered_form_values: taxValues, identified_red_flags: identifiedFlags.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean), notes: taskResponse, attachment_url: taskFileLink }
          : { response_text: taskResponse, attachment_url: taskFileLink };
    try {
      const response = await issuedApi<{ status: string; message: string }>("POST", "/exams/issued/submit", {
        answers: Object.fromEntries(Object.entries(answers).map(([qid, selected]) => [qid, selected])),
        submitted_data: submittedData,
        proctoring_events: proctorEvents,
        time_taken_seconds: 0,
      });
      setPaper(null);
      setCompletion({
        title: endReason ? "Assessment ended" : "Assessment submitted",
        message: endReason === "fullscreen"
          ? "Your session ended because fullscreen was exited. Your work and integrity events were sent for review."
          : endReason === "policy"
            ? "Your session ended after the assessment integrity warning limit was reached. Your work was sent for review."
            : endReason === "manual"
              ? "You ended this assessment. Your completed work was submitted for review."
          : response.message || "Thank you. Your assessment was submitted successfully for recruiter review.",
      });
    } catch {
      if (endReason) {
        setPaper(null);
        setCompletion({
          title: "Assessment ended",
          message: endReason === "fullscreen"
            ? "Fullscreen was exited and this session is now closed. The recorded activity will be reviewed."
            : "This session is now closed. Your recorded work and integrity activity will be reviewed.",
        });
      } else {
        setStatus("Submission failed. Check your connection and try again.");
      }
    }
  };

  const recordProctorEvent = async (reason: string, severity = "warning") => {
    const event = { event_type: reason, severity, details: { source: "candidate_browser" }, recorded_at: new Date().toISOString() };
    setProctorEvents((currentEvents) => [...currentEvents.slice(-99), event]);
    if (!token) return;
    try {
      const response = await issuedApi<{ warning_count: number; should_terminate: boolean }>("POST", "/exams/issued/proctor-event", {
        event_type: reason,
        severity,
        details: { source: "candidate_browser" },
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
      void submit("manual");
    },
    onFullscreenExited: () => {
      setPolicyWarning({ reason: "Fullscreen was exited. The assessment is ending", count: 5 });
      void recordProctorEvent("Fullscreen was exited", "critical").finally(() => submit("fullscreen"));
    },
    onPolicyWarning: (reason, count) => {
      setPolicyWarning({ reason, count });
      void recordProctorEvent(reason);
    },
    onPolicyTerminated: async (reason) => {
      setPolicyWarning({ reason: `Assessment closed: ${reason}`, count: 5 });
      await recordProctorEvent(reason, "critical");
      await submit("policy");
    },
  });

  const { timerDisplay } = useAssessmentTimer({
    timingMode: paper?.timing_mode || "assessment",
    durationMinutes: Number(paper?.duration_minutes || 30),
    timePerQuestionSeconds: Number(paper?.time_per_question_seconds || 30),
    questionIndex: index,
    enabled: Boolean(paper && consentAccepted && !policyWarning && !escapeWarningVisible),
    onAssessmentTimeUp: () => { void submit(); },
    onQuestionTimeUp: () => {
      if (!paper) return;
      if (index < paper.questions.length - 1) setIndex((x) => x + 1);
      else void submit();
    },
  });

  if (completion) {
    return (
      <section className="assessment-thank-you" role="status">
        <div className="assessment-thank-you-mark" aria-hidden="true">C</div>
        <span className="launch-section-label">Certora Assessments</span>
        <h1>{completion.title}</h1>
        <p>{completion.message}</p>
        <strong>Thank you for your time.</strong>
        <small>You may now close this browser tab.</small>
      </section>
    );
  }

  return (
    <section className={paper && consentAccepted ? "issued-assessment-runtime" : "card issued-access-card"}>
      {!paper && <div className="workspace-section-head">
        <div>
          <span className="launch-section-label">Issued assessment access</span>
          <h2>Candidate sign in</h2>
          <p>Use the recruiter-issued credentials to open the assessment. This screen stays separate from the recruiter workspace.</p>
        </div>
      </div>}
      {!paper ? (
        <form className="issued-login-panel" aria-busy={isSigningIn} onSubmit={(event) => { event.preventDefault(); void login(); }}>
          {!accessKey && (
            <label className="field-stack">
              <span>Issued email</span>
              <input placeholder="candidate@company.com" value={email} disabled={isSigningIn} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          <label className="field-stack">
            <span>Issued password</span>
            <input placeholder="Enter issued password" type="password" value={password} disabled={isSigningIn} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="auth-actions">
            <button type="submit" disabled={isSigningIn || !password || (!accessKey && !email)}>
              {isSigningIn ? "Opening assessment..." : "Login"}
            </button>
          </div>
          {isSigningIn && <div className="candidate-login-progress" role="status" aria-live="polite"><span className="candidate-loading-spinner" aria-hidden="true" /><span><strong>Signing you in</strong><small>Loading your secured assessment workspace...</small></span></div>}
          {status && <small className="candidate-login-status" role="alert">{status}</small>}
        </form>
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
                <h2 id="candidate-welcome-title">Welcome to Certora Assessments</h2>
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
                  <p>Choose a quiet place with a stable connection and keep your camera available. The assessment runs in fullscreen and uses local gaze detection for integrity checks.</p>
                  <ul>
                    <li>Read each task carefully and submit only when your work is complete.</li>
                    <li>Sustained gaze away pauses the timer and displays a warning.</li>
                    <li>Leaving fullscreen ends the assessment and submits the recorded attempt for review.</li>
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
                  <small>The Next button appears only after the audio finishes.</small>
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
              <p>This session uses browser security checks and local camera-based gaze detection. Camera frames are processed for integrity signals and are not recorded by this flow. Leaving fullscreen closes the assessment. Automated signals are not a final employment decision.</p>
              <div className="candidate-policy-links">
                <a href="/legal/privacy-policy.html" target="_blank" rel="noreferrer">Privacy policy</a>
                <a href="/legal/data-retention-and-deletion.html" target="_blank" rel="noreferrer">Retention and deletion</a>
                <a href="/legal/candidate-consent.html" target="_blank" rel="noreferrer">Full consent notice</a>
              </div>
              <label className="candidate-consent-check">
                <input type="checkbox" checked={consentAccepted} disabled={isAcceptingConsent} onChange={(event) => { if (event.target.checked) { void requestFullscreen(); void acceptConsent(); } }} />
                <span>I have read and agree to this assessment data and integrity notice.</span>
              </label>
              {isAcceptingConsent && <div className="candidate-login-progress compact" role="status"><span className="candidate-loading-spinner" aria-hidden="true" /><span><strong>Preparing fullscreen assessment</strong><small>Starting the camera model and calibrating your on-screen gaze...</small></span></div>}
              {gazeError && <small className="candidate-login-status" role="alert">{gazeError}</small>}
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
              <div className={`assessment-warning-dialog${warningCount >= 5 ? " critical" : ""}`}>
                <span className="launch-section-label">Integrity check</span>
                <h2 id="policy-warning-title">{warningCount >= 5 ? "Assessment closed" : "Please return your attention to the assessment"}</h2>
                <p>{policyWarning.reason}. Warning {policyWarning.count} of 5.</p>
                {warningCount < 5 && <button type="button" onClick={() => setPolicyWarning(null)}>Continue Assessment</button>}
              </div>
            </div>
          )}
          {escapeWarningVisible && (
            <div className="assessment-blocking-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="escape-warning-title">
              <div className="assessment-warning-dialog critical">
                <span className="launch-section-label">Fullscreen protection</span>
                <h2 id="escape-warning-title">Leaving fullscreen will end this assessment</h2>
                <p>Your current work will be submitted and the session will close if fullscreen is exited.</p>
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
              <span className={`candidate-proctor-state ${gazeStatus}`}><i aria-hidden="true" />Camera proctor {gazeStatus === "active" ? "active" : gazeStatus}</span>
              {gazeStream && <video className="candidate-proctor-preview" aria-label="Camera proctor preview" autoPlay muted playsInline ref={(node) => { if (node && node.srcObject !== gazeStream) node.srcObject = gazeStream; }} />}
              <span>{paper.assessment_type === "mcq" ? `Question ${index + 1}/${paper.questions.length}` : "Task workspace"}</span>
              <span>Timer: {timerDisplay}</span>
            </div>
          </div>
          {paper.assessment_type === "spreadsheet" && paper.task && (
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
                setExcelSubmission(submission);
                const response = await issuedApi<{ passed: boolean; score_pct: number; status: string }>("POST", "/exams/issued/submit", {
                  answers: {},
                  submitted_data: submission,
                  proctoring_events: [...proctorEvents, ...submission.activity_log],
                  time_taken_seconds: 0,
                });
                setPaper(null);
                setCompletion({
                  title: "Assessment submitted",
                  message: `Thank you. Your assessment was submitted successfully with status: ${response.status}.`,
                });
              }}
            />
          )}
          {paper.assessment_type !== "spreadsheet" && current && (
            <div className="question-runtime-surface">
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
          )}
          {!isMcqAssessment && paper.assessment_type !== "spreadsheet" && paper.task && (
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
              {["tax_simulator", "accounting"].includes(paper.assessment_type) && Array.isArray(paper.task.metadata?.form_fields) && (
                <div className="task-response-panel">
                  <strong>{paper.assessment_type === "accounting" ? "Close outputs" : "Return values"}</strong>
                  <div className="workspace-form-grid compact">
                    {(paper.task.metadata.form_fields as string[]).map((field) => <label key={field} className="field-stack"><span>{field}</span><input value={taxValues[field] || ""} onChange={(event) => setTaxValues((previous) => ({ ...previous, [field]: event.target.value }))} /></label>)}
                  </div>
                  {Array.isArray(paper.task.metadata?.red_flag_options) ? <fieldset className="task-flag-options"><legend>Exceptions identified</legend>{(paper.task.metadata.red_flag_options as string[]).map((flag) => {
                    const selected = identifiedFlags.split(/\r?\n/).includes(flag);
                    return <label key={flag}><input type="checkbox" checked={selected} onChange={(event) => {
                      const currentFlags = identifiedFlags.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
                      setIdentifiedFlags((event.target.checked ? [...currentFlags, flag] : currentFlags.filter((value) => value !== flag)).join("\n"));
                    }} /><span>{flag}</span></label>;
                  })}</fieldset> : <label className="field-stack"><span>Red flags identified</span><textarea rows={3} value={identifiedFlags} onChange={(event) => setIdentifiedFlags(event.target.value)} placeholder="One item per line" /></label>}
                </div>
              )}
              <div className="task-response-panel">
                <label className="field-stack">
                  <span>{paper.assessment_type === "coding" ? "Solution code" : "Candidate response"}</span>
                  <textarea className={paper.assessment_type === "coding" ? "code-input" : ""} rows={paper.assessment_type === "coding" ? 16 : 10} value={taskResponse} onChange={(event) => setTaskResponse(event.target.value)} placeholder={paper.assessment_type === "coding" ? String(paper.task.metadata?.starter_code || "Write your solution here") : "Enter your response, assumptions, and conclusion."} />
                </label>
                {paper.task.metadata?.answer_format === "file_or_text" && <label className="field-stack"><span>Submission file link</span><input type="url" value={taskFileLink} onChange={(event) => setTaskFileLink(event.target.value)} placeholder="https://..." /></label>}
              </div>
              <div className="assessment-action-bar inline"><button className="assessment-primary-btn" type="button" disabled={!taskResponse.trim() && Object.keys(taxValues).length === 0} onClick={() => void submit()}>Submit Assessment</button></div>
            </section>
          )}
          {isMcqAssessment && <div className="row assessment-question-actions">
            <button className="assessment-exit-btn" type="button" onClick={confirmExit}>Exit Assessment</button>
            <button disabled={index === 0} onClick={() => setIndex((x) => x - 1)}>Prev</button>
            {paper && index < paper.questions.length - 1 ? (
              <button onClick={() => setIndex((x) => x + 1)}>Next</button>
            ) : (
              <button className="assessment-primary-btn" onClick={() => void submit()}>Submit Assessment</button>
            )}
          </div>}
          {status && <div>{status}</div>}
            </>
          )}
        </>
      )}
    </section>
  );
}
