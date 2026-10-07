import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EnglishAssessmentRunner, type EnglishSection, type EnglishRecording, type EnglishProgress } from "../issued/EnglishAssessmentRunner";
import "./EnglishAssessmentTrial.css";
import { BrandLogo } from "../../components/BrandLogo";
import { createListeningTrial } from "./englishListeningBank";
import { EnglishContentSummary } from "./EnglishContentSummary";

export type EnglishTrialAssessment = {
  title: string;
  task?: { instructions?: string; description?: string; metadata?: Record<string, unknown>; expected_output?: Record<string, unknown> } | null;
};

export function EnglishAssessmentTrial({ assessment, onClose }: { assessment: EnglishTrialAssessment; onClose: () => void }) {
  const [selectedTask, setSelectedTask] = useState(() => assessment.task ? createListeningTrial(assessment.task) : null);
  const sections = useMemo(() => ((selectedTask?.metadata?.sections || []) as EnglishSection[]).map(section => ({ ...section, items: section.items.map(item => ({ ...item, audio_url: item.audio_url?.startsWith("/assessment-audio/") ? `${import.meta.env.BASE_URL}${item.audio_url.slice(1)}` : item.audio_url })) })), [selectedTask]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, string>>({});
  const [recordings, setRecordings] = useState<Record<string, EnglishRecording>>({});
  const [played, setPlayed] = useState<Record<string, boolean>>({});
  const [start, setStart] = useState({ section: 0, item: 0, version: 0 });
  const [review, setReview] = useState(false);
  const [mode, setMode] = useState<"candidate" | "inspect">("candidate");
  const [stage, setStage] = useState<"welcome" | "exam" | "submitted">("welcome");
  const [restartRequested, setRestartRequested] = useState(false);
  const runId = useRef(0);
  const currentRun = runId.current;
  const urls = useRef<string[]>([]);
  const trialRoot = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const lastProgress = useRef<EnglishProgress>();
  useEffect(() => { if (trialRoot.current) trialRoot.current.scrollTop = 0; }, [stage, review, start.version]);
  const trackProgress = useCallback((progress: EnglishProgress) => {
    lastProgress.current = progress;
    setStart(current => current.section === progress.section_index && current.item === progress.item_index ? current : { ...current, section: progress.section_index, item: progress.item_index });
  }, []);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      active.current = false;
      document.body.style.overflow = previousOverflow;
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
  const key = (selectedTask?.expected_output?.objective_answers || {}) as Record<string, string>;
  const objectiveItems = sections.flatMap(section => section.items).filter(item => item.type === "choice" || item.type === "reading_choice");
  const correct = objectiveItems.filter(item => key[item.id] && answers[item.id] === key[item.id]).length;
  const graded = objectiveItems.filter(item => key[item.id]).length;
  const resetTrial = (nextMode: "candidate" | "inspect") => {
    const previous = (selectedTask?.metadata?.listening_selection as { conversation_ids?: string[] } | undefined)?.conversation_ids || [];
    setSelectedTask(assessment.task ? createListeningTrial(assessment.task, previous) : null);
    runId.current += 1;
    urls.current.forEach(URL.revokeObjectURL); urls.current = [];
    lastProgress.current = undefined;
    setAnswers({}); setWriting({}); setRecordings({}); setPlayed({}); setReview(false);
    setStart(current => ({ section: 0, item: 0, version: current.version + 1 }));
    setMode(nextMode); setStage(nextMode === "candidate" ? "welcome" : "exam"); setRestartRequested(false);
  };
  return <div ref={trialRoot} className="english-trial" role="dialog" aria-modal="true" aria-label={`Try ${assessment.title}`} onKeyDown={event => {
    if (event.key === "Escape") onClose();
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, input, audio[controls], [tabindex="0"]')).filter(element => element.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="english-trial-toolbar">
      <div><strong>{mode === "candidate" ? "Candidate experience · test session" : "Content inspection"}</strong><small>No invitation needed. Restart selects fresh listening conversations. Sign-in, fullscreen enforcement, and camera proctoring are excluded.</small></div>
      {(mode === "inspect" || stage === "submitted") && <button type="button" onClick={() => setReview(true)}>Review answers</button>}
      <button type="button" onClick={() => setRestartRequested(true)}>Restart test</button>
      <button type="button" onClick={onClose} autoFocus>Close trial</button>
    </header>
    {restartRequested && <section className="english-trial-restart" role="alertdialog" aria-label="Restart candidate test"><p>Restart from the welcome screen? Your current practice answers and recordings will be discarded.</p><button type="button" onClick={() => resetTrial(mode)}>Restart from beginning</button><button type="button" onClick={() => setRestartRequested(false)}>Keep testing</button></section>}
    {!sections.length ? <p role="alert">This assessment has no English tasks configured.</p> : <>
      {stage === "welcome" && <section className="candidate-welcome-panel english-trial-welcome" aria-labelledby="trial-welcome-title">
        <BrandLogo className="assessment-brand-logo" />
        <span className="launch-section-label">Your assessment is ready</span>
        <h1 id="trial-welcome-title">{assessment.title}</h1>
        <p>{assessment.task?.description || "Complete the English language assessment in four timed sections."}</p>
        <EnglishContentSummary metadata={selectedTask?.metadata} />
        <div className="candidate-assessment-summary"><div><small>Format</small><strong>English language</strong></div><div><small>Time available</small><strong>{sections.reduce((sum, section) => sum + section.minutes, 0)} minutes</strong></div><div><small>Sections</small><strong>{sections.length}</strong></div></div>
        <div className="candidate-written-note"><h2>Before you begin</h2><p>{assessment.task?.instructions}</p><ul><li>Complete listening, reading, writing, and speaking in order.</li><li>Each section starts with instructions. Its timer starts when you begin that section.</li><li>Questions move forward only. Audio plays once and speaking responses allow one recording.</li><li>Use headphones and a microphone for listening and speaking.</li></ul></div>
        {typeof selectedTask?.metadata?.listening_content_note === "string" && <p className="english-trial-hint">{selectedTask.metadata.listening_content_note}</p>}
        <p className="english-trial-hint">This test uses the same exam screens and task rules as a candidate. Answers are available only after submission. Camera proctoring and invitation sign-in require a live candidate session.</p>
        <div className="candidate-welcome-footer"><button type="button" className="assessment-primary-btn" onClick={() => setStage("exam")} autoFocus>Start candidate test</button><button type="button" onClick={() => resetTrial("inspect")}>Inspect content instead</button></div>
      </section>}
      {stage === "submitted" && !review && <section className="assessment-thank-you" role="status"><BrandLogo className="assessment-brand-logo" /><span className="launch-section-label">Assessment complete</span><h1>Assessment submitted</h1><p>You have reached the end of the candidate experience. This test submission stays in your practice session.</p><strong>Thank you for your time.</strong><div><button type="button" onClick={() => setReview(true)}>Review test responses</button><button type="button" onClick={() => resetTrial("candidate")}>Test again as candidate</button></div></section>}
      {mode === "inspect" && <nav className="english-trial-navigation" aria-label="Trial navigation">
        <label>Explore section<select value={start.section} onChange={event => { lastProgress.current = undefined; setReview(false); setStart(current => ({ section: Number(event.target.value), item: 0, version: current.version + 1 })); }}>{sections.map((section, index) => <option key={section.id} value={index}>{section.label} · {section.minutes} min</option>)}</select></label>
        <label>Explore task<select value={start.item} onChange={event => { lastProgress.current = undefined; setReview(false); setStart(current => ({ ...current, item: Number(event.target.value), version: current.version + 1 })); }}>{sections[start.section].items.map((item, index) => <option key={item.id} value={index}>{item.label}{item.difficulty ? ` · ${item.difficulty}` : ""}</option>)}</select></label>
        <span>Candidate mode uses timed sections, one-way tasks, one audio play and one speaking attempt. Trial navigation lets you inspect any task.</span>
        <button type="button" onClick={() => resetTrial("candidate")}>Test as candidate</button>
      </nav>}
      {review ? <section className="english-trial-review"><h1>Practice review</h1><p>{graded ? `${correct} / ${graded} objective answers correct (${Object.keys(answers).length} answered).` : "An objective answer key is not configured."} Writing and speaking require human rubric review; this is not a final exam score or CEFR rating.</p>
        {sections.map(section => <article key={section.id}><h2>{section.label} · {section.minutes} minutes</h2><p>{section.description}</p>{section.items.map(item => <div className="english-trial-review-item" key={item.id}><strong>{item.label}{item.difficulty ? ` · ${item.difficulty}` : ""}</strong><p>{item.prompt}</p>{item.passage && <blockquote>{item.passage}</blockquote>}{item.options && <><p>Your answer: {answers[item.id] || "Unanswered"}</p><p>Correct answer: {key[item.id] || "Not configured"}</p></>}{item.type === "writing" && <><p>{item.minimum_words}–{item.maximum_words} words</p><blockquote>{writing[item.id] || "No practice response"}</blockquote></>}{item.type === "speaking" && <><p>{item.minimum_seconds}–{item.maximum_seconds} seconds</p>{recordings[item.id] ? <audio controls src={recordings[item.id].playback_url} /> : <p>No practice recording</p>}</>}{item.type === "audio" && <audio controls src={item.audio_url} />}</div>)}</article>)}
        <h2>Writing and speaking criteria</h2>{["writing", "speaking"].map(skill => {
          const rubric = (assessment.task?.metadata?.rubric || assessment.task?.expected_output?.rubric || {}) as Record<string, unknown>;
          const criteria = rubric[skill];
          return <div key={skill}><h3>{skill === "writing" ? "Writing" : "Speaking"}</h3><ul>{Array.isArray(criteria) && criteria.map(criterion => <li key={String(criterion)}>{String(criterion)}</li>)}</ul></div>;
        })}
        <button type="button" onClick={() => setReview(false)}>Return to trial</button>
      </section> : stage === "exam" ? <EnglishAssessmentRunner key={start.version} title={assessment.title} sections={sections} objectiveAnswers={answers} writingResponses={writing} speakingRecordings={recordings} audioPlayed={played}
        initialProgress={lastProgress.current || { section_index: start.section, item_index: start.item, phase: start.item ? "task" : "intro" }} submitting={false} paused={false} saveState="practice"
        onObjectiveAnswer={(id, value) => setAnswers(current => ({ ...current, [id]: value }))}
        onWritingResponse={(id, value) => setWriting(current => ({ ...current, [id]: value }))}
        onSpeakingRecording={async (id, blob, duration) => {
          if (!active.current || currentRun !== runId.current) throw new Error("Trial closed or restarted");
          const url = URL.createObjectURL(blob); urls.current.push(url);
          const recording = { storage_ref: "local-trial", playback_url: url, duration_seconds: duration };
          setRecordings(current => ({ ...current, [id]: recording })); return recording;
        }}
        onAudioPlayed={id => setPlayed(current => ({ ...current, [id]: true }))} onProgress={trackProgress} onSubmit={() => mode === "candidate" ? setStage("submitted") : setReview(true)} onExit={onClose} /> : null}
    </>}
  </div>;
}
