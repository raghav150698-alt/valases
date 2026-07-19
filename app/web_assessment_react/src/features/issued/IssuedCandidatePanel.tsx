import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = String(params.get("issued_key") || "").trim();
    if (key) setAccessKey(key);
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
    setStatus("");
  };

  const login = async () => {
    const auth = accessKey
      ? await api.post(`/exams/issued/key/${encodeURIComponent(accessKey)}/login`, { password })
      : await api.post("/exams/issued/login", { email, password });
    await loadMe(String(auth.data.token || ""));
  };

  const acceptConsent = async () => {
    try {
      await issuedApi("POST", "/exams/issued/consent", {
        policy_version: "privacy-2026-07-19",
        consent_version: "candidate-consent-1.0",
        camera: false,
        microphone: false,
        recording: false,
      });
      setConsentAccepted(true);
    } catch {
      setStatus("We could not record your consent. Check your connection and try again.");
    }
  };

  const current = useMemo(() => (paper ? paper.questions[index] : null), [paper, index]);
  const isMcqAssessment = paper?.assessment_type === "mcq";

  const submit = async (endedByExit = false) => {
    if (!paper) return;
    const submittedData = paper.assessment_type === "spreadsheet"
      ? (excelSubmission || { final_sheet_json: {}, formulas_json: {}, calculated_values_json: {}, activity_log: [] })
      : paper.assessment_type === "coding"
        ? { code: taskResponse, attachment_url: taskFileLink }
        : paper.assessment_type === "tax_simulator"
          ? { entered_form_values: taxValues, identified_red_flags: identifiedFlags.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean), notes: taskResponse, attachment_url: taskFileLink }
          : { response_text: taskResponse, attachment_url: taskFileLink };
    const response = await issuedApi<{ passed: boolean; score_pct: number; status: string }>("POST", "/exams/issued/submit", {
      answers: Object.fromEntries(Object.entries(answers).map(([qid, selected]) => [qid, selected])),
      submitted_data: submittedData,
      proctoring_events: proctorEvents,
      time_taken_seconds: 0,
    });
    setPaper(null);
    setStatus(
      endedByExit
        ? `Assessment ended. Score ${Number(response.score_pct || 0).toFixed(2)}% | ${response.status}`
        : `${response.passed ? "PASS" : "FAIL"} | score ${Number(response.score_pct || 0).toFixed(2)}% | ${response.status}`,
    );
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

  const { confirmExit, fullscreenRequired, requestFullscreen, warningCount } = useAssessmentSession({
    active: Boolean(paper && consentAccepted),
    exitWarning: "Exiting now will end this assessment. Do you want to continue?",
    onExitConfirmed: () => {
      if (isMcqAssessment) {
        void submit(true);
        return;
      }
      window.location.replace("about:blank");
    },
    onPolicyWarning: (reason, count) => {
      setPolicyWarning({ reason, count });
      void recordProctorEvent(reason);
    },
    onPolicyTerminated: async (reason) => {
      setPolicyWarning({ reason: `Assessment closed: ${reason}`, count: 5 });
      await recordProctorEvent(reason, "critical");
      await submit(true);
    },
  });

  const { timerDisplay } = useAssessmentTimer({
    timingMode: paper?.timing_mode || "assessment",
    durationMinutes: Number(paper?.duration_minutes || 30),
    timePerQuestionSeconds: Number(paper?.time_per_question_seconds || 30),
    questionIndex: index,
    enabled: Boolean(paper && consentAccepted),
    onAssessmentTimeUp: () => { void submit(); },
    onQuestionTimeUp: () => {
      if (!paper) return;
      if (index < paper.questions.length - 1) setIndex((x) => x + 1);
      else void submit();
    },
  });

  return (
    <section className="card issued-access-card">
      <div className="workspace-section-head">
        <div>
          <span className="launch-section-label">Issued assessment access</span>
          <h2>Candidate sign in</h2>
          <p>Use the recruiter-issued credentials to open the assessment. This screen stays separate from the recruiter workspace.</p>
        </div>
      </div>
      {!paper ? (
        <div className="issued-login-panel">
          {!accessKey && (
            <label className="field-stack">
              <span>Issued email</span>
              <input placeholder="candidate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          <label className="field-stack">
            <span>Issued password</span>
            <input placeholder="Enter issued password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="auth-actions">
            <button onClick={login}>Login</button>
          </div>
          {status && <small>{status}</small>}
        </div>
      ) : (
        <>
          {!consentAccepted ? (
            <section className="candidate-consent-panel" aria-labelledby="candidate-consent-title">
              <span className="launch-section-label">Before you begin</span>
              <h3 id="candidate-consent-title">Assessment privacy and integrity notice</h3>
              <p>Your answers, submitted work, timestamps, and assessment activity are collected to administer, score, secure, and review this assessment.</p>
              <p>This session uses browser security checks. Leaving fullscreen closes the assessment. Repeated security warnings can close the attempt and send it for human review. Automated signals are not a final employment decision.</p>
              <div className="candidate-policy-links">
                <a href="/legal/privacy-policy.html" target="_blank" rel="noreferrer">Privacy policy</a>
                <a href="/legal/data-retention-and-deletion.html" target="_blank" rel="noreferrer">Retention and deletion</a>
                <a href="/legal/candidate-consent.html" target="_blank" rel="noreferrer">Full consent notice</a>
              </div>
              <label className="candidate-consent-check">
                <input type="checkbox" checked={consentAccepted} onChange={(event) => { if (event.target.checked) void acceptConsent(); }} />
                <span>I have read and agree to this assessment data and integrity notice.</span>
              </label>
              <small>Need an accommodation or have a privacy question? Contact the organization that issued this assessment.</small>
            </section>
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
            <div className={`assessment-policy-banner${warningCount >= 5 ? " critical" : ""}`} role="alert">
              <div>
                <strong>{warningCount >= 5 ? "Assessment closed" : "Security warning"}</strong>
                <span>{policyWarning.reason}. Warning {policyWarning.count} of 5.</span>
              </div>
              {warningCount < 5 && <button type="button" onClick={() => setPolicyWarning(null)}>Dismiss</button>}
            </div>
          )}
          <div className="assessment-runtime-header">
            <div>
              <span className="launch-section-label">Assessment session</span>
              <h3>{paper.assessment_title}</h3>
            </div>
            <div className="assessment-runtime-meta">
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
                setStatus(`${response.passed ? "PASS" : "FAIL"} | score ${Number(response.score_pct || 0).toFixed(2)}% | ${response.status}`);
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
              {paper.assessment_type === "tax_simulator" && Array.isArray(paper.task.metadata?.form_fields) && (
                <div className="task-response-panel">
                  <strong>Form values</strong>
                  <div className="workspace-form-grid compact">
                    {(paper.task.metadata.form_fields as string[]).map((field) => <label key={field} className="field-stack"><span>{field}</span><input value={taxValues[field] || ""} onChange={(event) => setTaxValues((previous) => ({ ...previous, [field]: event.target.value }))} /></label>)}
                  </div>
                  <label className="field-stack"><span>Red flags identified</span><textarea rows={3} value={identifiedFlags} onChange={(event) => setIdentifiedFlags(event.target.value)} placeholder="One item per line" /></label>
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
