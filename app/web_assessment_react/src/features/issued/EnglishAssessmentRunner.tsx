import { useEffect, useMemo, useRef, useState } from "react";

export type EnglishItem = {
  id: string;
  type: "audio" | "choice" | "reading_choice" | "writing" | "speaking";
  label: string;
  prompt: string;
  passage?: string;
  options?: string[];
  audio_url?: string;
  duration_seconds?: number;
  source?: string;
  minimum_words?: number;
  maximum_words?: number;
  minimum_seconds?: number;
  maximum_seconds?: number;
  suggested_minutes?: number;
};

export type EnglishSection = {
  id: string;
  label: string;
  minutes: number;
  description: string;
  intro?: string;
  rules?: string[];
  items: EnglishItem[];
  attribution?: string;
};

export type EnglishProgress = {
  section_index: number;
  item_index: number;
  phase: "intro" | "task" | "complete";
  section_remaining_seconds: number;
  completed_sections: string[];
};

export type EnglishRecording = { storage_ref: string; playback_url: string; duration_seconds: number };

type Props = {
  title: string;
  sections: EnglishSection[];
  objectiveAnswers: Record<string, string>;
  writingResponses: Record<string, string>;
  speakingRecordings: Record<string, EnglishRecording>;
  audioPlayed: Record<string, boolean>;
  initialProgress?: Partial<EnglishProgress>;
  submitting: boolean;
  paused: boolean;
  onObjectiveAnswer: (id: string, value: string) => void;
  onWritingResponse: (id: string, value: string) => void;
  onSpeakingRecording: (id: string, blob: Blob, durationSeconds: number) => Promise<EnglishRecording>;
  onAudioPlayed: (id: string) => void;
  onProgress: (progress: EnglishProgress) => void;
  onSubmit: () => void;
  onExit: () => void;
};

const formatClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

const wordCount = (value: string) => value.trim() ? value.trim().split(/\s+/).length : 0;

export function EnglishAssessmentRunner({
  title,
  sections,
  objectiveAnswers,
  writingResponses,
  speakingRecordings,
  audioPlayed,
  initialProgress,
  submitting,
  paused,
  onObjectiveAnswer,
  onWritingResponse,
  onSpeakingRecording,
  onAudioPlayed,
  onProgress,
  onSubmit,
  onExit,
}: Props) {
  const safeInitialSection = Math.min(Math.max(Number(initialProgress?.section_index || 0), 0), Math.max(sections.length - 1, 0));
  const [sectionIndex, setSectionIndex] = useState(safeInitialSection);
  const [itemIndex, setItemIndex] = useState(Math.max(0, Number(initialProgress?.item_index || 0)));
  const [phase, setPhase] = useState<EnglishProgress["phase"]>(initialProgress?.phase || "intro");
  const [remainingSeconds, setRemainingSeconds] = useState(Math.max(0, Number(initialProgress?.section_remaining_seconds || sections[safeInitialSection]?.minutes * 60 || 900)));
  const [completedSections, setCompletedSections] = useState<string[]>(initialProgress?.completed_sections || []);
  const [recordingItemId, setRecordingItemId] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingItemId, setUploadingItemId] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const [audioActiveId, setAudioActiveId] = useState("");
  const [audioProgress, setAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const section = sections[sectionIndex];
  const items = section?.items || [];
  const item = items[Math.min(itemIndex, Math.max(items.length - 1, 0))];
  const progress = useMemo<EnglishProgress>(() => ({
    section_index: sectionIndex,
    item_index: itemIndex,
    phase,
    section_remaining_seconds: remainingSeconds,
    completed_sections: completedSections,
  }), [completedSections, itemIndex, phase, remainingSeconds, sectionIndex]);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    if (phase !== "task" || paused) return;
    const timer = window.setInterval(() => setRemainingSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [paused, phase, sectionIndex]);

  useEffect(() => {
    if (phase !== "task" || remainingSeconds > 0) return;
    if (recorderRef.current) recorderRef.current.stop();
    const nextCompleted = Array.from(new Set([...completedSections, section.id]));
    setCompletedSections(nextCompleted);
    if (sectionIndex < sections.length - 1) {
      const nextIndex = sectionIndex + 1;
      setSectionIndex(nextIndex);
      setItemIndex(0);
      setRemainingSeconds(Number(sections[nextIndex]?.minutes || 15) * 60);
      setPhase("intro");
    } else {
      setPhase("complete");
    }
  }, [completedSections, phase, remainingSeconds, section?.id, sectionIndex, sections]);

  useEffect(() => {
    onProgress(progress);
  }, [itemIndex, phase, sectionIndex]); // Progress is persisted on meaningful navigation; autosave also captures answer changes.

  useEffect(() => {
    if (phase !== "task") return;
    const checkpoint = window.setInterval(() => onProgress(progressRef.current), 10_000);
    return () => window.clearInterval(checkpoint);
  }, [phase, onProgress]);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!recordingItemId) return;
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recordingItemId]);

  useEffect(() => {
    if (recordingItemId && item?.id === recordingItemId && recordingSeconds >= Number(item.maximum_seconds || 180)) stopRecording();
  }, [item?.id, item?.maximum_seconds, recordingItemId, recordingSeconds]);

  if (!section) return null;

  const startSection = () => {
    setItemIndex(0);
    setRemainingSeconds(Number(section.minutes || 15) * 60);
    setPhase("task");
  };

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioActiveId("");
  };

  const playAudio = (currentItem: EnglishItem) => {
    if (!currentItem.audio_url || audioPlayed[currentItem.id] || audioActiveId) return;
    const audio = new Audio(currentItem.audio_url);
    audioRef.current = audio;
    setAudioActiveId(currentItem.id);
    setAudioProgress(0);
    audio.ontimeupdate = () => setAudioProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    audio.onended = () => {
      setAudioProgress(1);
      setAudioActiveId("");
      audioRef.current = null;
      onAudioPlayed(currentItem.id);
    };
    audio.onerror = () => {
      setAudioActiveId("");
      audioRef.current = null;
      setRecordingError("The audio could not be loaded. Check the connection and try once more.");
    };
    void audio.play();
  };

  const startRecording = async (currentItem: EnglishItem) => {
    setRecordingError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError("This browser cannot record audio. Use the latest Chrome, Edge, or Firefox and allow microphone access.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(stream);
      recorderChunksRef.current = [];
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setRecordingItemId(currentItem.id);
      recorder.ondataavailable = (event) => { if (event.data.size) recorderChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const duration = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000));
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        recorderStreamRef.current = null;
        setRecordingItemId("");
        setUploadingItemId(currentItem.id);
        try {
          await onSpeakingRecording(currentItem.id, blob, duration);
        } catch {
          setRecordingError("The recording could not be saved. Please record this response again.");
        } finally {
          setUploadingItemId("");
        }
      };
      recorder.start(1000);
    } catch {
      setRecordingError("Microphone access was not granted. Allow access in the browser and try again.");
    }
  };

  const responseReady = (() => {
    if (!item) return false;
    if (item.type === "audio") return Boolean(audioPlayed[item.id]);
    if (item.type === "choice" || item.type === "reading_choice") return Boolean(objectiveAnswers[item.id]);
    if (item.type === "writing") return wordCount(writingResponses[item.id] || "") >= Number(item.minimum_words || 1);
    if (item.type === "speaking") return Number(speakingRecordings[item.id]?.duration_seconds || 0) >= Number(item.minimum_seconds || 1);
    return false;
  })();

  const nextTask = () => {
    stopAudio();
    setRecordingError("");
    if (itemIndex < items.length - 1) {
      setItemIndex((current) => current + 1);
      return;
    }
    const nextCompleted = Array.from(new Set([...completedSections, section.id]));
    setCompletedSections(nextCompleted);
    if (sectionIndex < sections.length - 1) {
      const nextSectionIndex = sectionIndex + 1;
      setSectionIndex(nextSectionIndex);
      setItemIndex(0);
      setRemainingSeconds(Number(sections[nextSectionIndex]?.minutes || 15) * 60);
      setPhase("intro");
    } else {
      setPhase("complete");
    }
  };

  return (
    <main className="english-exam-shell" aria-label={title}>
      <header className="english-exam-header">
        <div>
          <span>English assessment</span>
          <strong>{title}</strong>
        </div>
        <div className="english-exam-clock" aria-live="polite">
          <small>{phase === "task" ? `${section.label} time remaining` : phase === "complete" ? "Ready to submit" : "Timer starts with section"}</small>
          <b>{phase === "task" ? formatClock(remainingSeconds) : phase === "complete" ? "Complete" : `${section.minutes}:00`}</b>
        </div>
        <button className="english-exit-button" type="button" onClick={onExit}>Exit</button>
      </header>

      <nav className="english-section-track" aria-label="Assessment sections">
        {sections.map((entry, entryIndex) => {
          const state = completedSections.includes(entry.id) ? "complete" : entryIndex === sectionIndex ? "current" : "upcoming";
          return <div className={state} key={entry.id}><span>{completedSections.includes(entry.id) ? "✓" : entryIndex + 1}</span><div><strong>{entry.label}</strong><small>15 min</small></div></div>;
        })}
      </nav>

      {phase === "intro" && (
        <section className="english-section-intro">
          <span>Section {sectionIndex + 1} of {sections.length}</span>
          <h1>{section.label}</h1>
          <p>{section.intro || section.description}</p>
          <div className="english-section-facts"><div><small>Time</small><strong>{section.minutes} minutes</strong></div><div><small>Tasks</small><strong>{section.items.length}</strong></div><div><small>Navigation</small><strong>One-way</strong></div></div>
          <div className="english-section-rules"><strong>Before you begin</strong><ul>{(section.rules || []).map((rule) => <li key={rule}>{rule}</li>)}</ul></div>
          <button className="assessment-primary-btn" type="button" onClick={startSection}>Begin {section.label}</button>
        </section>
      )}

      {phase === "task" && item && (
        <section className="english-task-stage">
          <div className="english-task-meta">
            <div><span>{section.label}</span><strong>Task {itemIndex + 1} of {items.length}</strong></div>
            <div className="english-task-progress"><i style={{ width: `${((itemIndex + 1) / items.length) * 100}%` }} /></div>
          </div>
          <article className="english-task-card">
            <span className="english-task-label">{item.label}</span>
            <h1>{item.prompt}</h1>

            {item.type === "audio" && (
              <div className="english-listening-player">
                <div className={`english-audio-symbol ${audioActiveId === item.id ? "playing" : ""}`} aria-hidden="true"><i /><i /><i /><i /><i /></div>
                <div><strong>{audioPlayed[item.id] ? "Recording completed" : audioActiveId === item.id ? "Recording in progress" : "Ready to listen"}</strong><small>{audioPlayed[item.id] ? "Continue to the questions." : "The recording can be played once."}</small></div>
                <button className="assessment-primary-btn" type="button" disabled={Boolean(audioActiveId) || Boolean(audioPlayed[item.id])} onClick={() => playAudio(item)}>{audioPlayed[item.id] ? "Played" : audioActiveId === item.id ? "Playing…" : "Play recording"}</button>
                <div className="english-audio-progress"><i style={{ width: `${audioProgress * 100}%` }} /></div>
                <small className="english-audio-credit">Human-performed learning audio · {item.source}</small>
              </div>
            )}

            {item.passage && <div className="english-reading-passage"><small>{item.type === "writing" ? "Source text" : item.type === "speaking" ? "Text to read" : "Passage"}</small><p>{item.passage}</p></div>}

            {(item.type === "choice" || item.type === "reading_choice") && (
              <fieldset className="english-choice-list"><legend>Select one answer</legend>{(item.options || []).map((option, optionIndex) => <label className={objectiveAnswers[item.id] === option ? "selected" : ""} key={option}><input type="radio" name={item.id} checked={objectiveAnswers[item.id] === option} onChange={() => onObjectiveAnswer(item.id, option)} /><span>{String.fromCharCode(65 + optionIndex)}</span><strong>{option}</strong></label>)}</fieldset>
            )}

            {item.type === "writing" && (
              <div className="english-writing-response"><textarea autoFocus rows={11} value={writingResponses[item.id] || ""} onChange={(event) => onWritingResponse(item.id, event.target.value)} placeholder="Write your response here…" /><div className={wordCount(writingResponses[item.id] || "") > Number(item.maximum_words || Infinity) ? "over" : ""}><span>{wordCount(writingResponses[item.id] || "")} words</span><small>Target {item.minimum_words}–{item.maximum_words} words · Suggested {item.suggested_minutes} min</small></div></div>
            )}

            {item.type === "speaking" && (
              <div className="english-speaking-response">
                <div className="english-recording-status"><span className={recordingItemId === item.id ? "live" : speakingRecordings[item.id] ? "saved" : ""} /><div><strong>{recordingItemId === item.id ? `Recording · ${formatClock(recordingSeconds)}` : uploadingItemId === item.id ? "Saving recording…" : speakingRecordings[item.id] ? "Response saved" : "Microphone ready"}</strong><small>Target {item.minimum_seconds}–{item.maximum_seconds} seconds</small></div></div>
                {recordingItemId === item.id ? <button className="english-stop-recording" type="button" onClick={stopRecording}>Stop recording</button> : <button className="assessment-primary-btn" type="button" disabled={Boolean(uploadingItemId) || Boolean(recordingItemId)} onClick={() => void startRecording(item)}>{speakingRecordings[item.id] ? "Record again" : "Start recording"}</button>}
                {speakingRecordings[item.id] && recordingItemId !== item.id && <audio controls preload="metadata" src={speakingRecordings[item.id].playback_url} />}
              </div>
            )}

            {recordingError && <p className="english-task-error" role="alert">{recordingError}</p>}
          </article>
          <footer className="english-task-footer"><span>{responseReady ? "Response saved" : item.type === "audio" ? "Finish the recording to continue" : item.type === "speaking" && speakingRecordings[item.id] ? `Record at least ${item.minimum_seconds} seconds to continue` : "Complete this task to continue"}</span><button className="assessment-primary-btn" type="button" disabled={!responseReady || Boolean(recordingItemId) || Boolean(uploadingItemId)} onClick={nextTask}>{itemIndex === items.length - 1 ? `Complete ${section.label}` : "Next task"}</button></footer>
        </section>
      )}

      {phase === "complete" && (
        <section className="english-complete-card">
          <span>All sections complete</span><h1>Review checkpoint</h1><p>Your responses have been saved. Submitting will close the assessment and send your work for recruiter review.</p>
          <div>{sections.map((entry) => <article key={entry.id}><span>✓</span><div><strong>{entry.label}</strong><small>Section completed</small></div></article>)}</div>
          <button className="assessment-primary-btn" type="button" disabled={submitting} onClick={onSubmit}>{submitting ? "Submitting…" : "Submit assessment"}</button>
        </section>
      )}
    </main>
  );
}
