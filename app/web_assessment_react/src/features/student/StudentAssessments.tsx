import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAssessmentSession } from "../assessment/useAssessmentSession";
import { PrecheckGate } from "./PrecheckGate";
import { useAssessmentTimer } from "./useAssessmentTimer";
import { TrainingFeedbackPanel } from "./TrainingFeedbackPanel";

type CatalogRow = { exam_id: number; title: string; provider_name: string; status: string };
type Paper = {
  attempt_id: number;
  exam_id: number;
  title: string;
  timing_mode: "question" | "assessment";
  duration_minutes: number;
  time_per_question_seconds: number;
  questions: { question_id: number; question_text: string; question_type: string; options: { option_id: number; option_text: string }[] }[];
};
type AttemptResult = {
  percentage: number;
  passed: boolean;
  training_feedback_status?: string;
  training_feedback_comment?: string;
  training_feedback_count?: number;
};

export function StudentAssessments() {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [precheckDone, setPrecheckDone] = useState(false);
  const [status, setStatus] = useState("");

  const catalog = useQuery({
    queryKey: ["student-catalog"],
    queryFn: async () => (await api.get<CatalogRow[]>("/student/assessments/catalog")).data,
  });

  const start = useMutation({
    mutationFn: async (examId: number) => (await api.post(`/student/exams/${examId}/attempts/start`)).data,
    onSuccess: async (data) => {
      const paperData = (await api.get<Paper>(`/student/attempts/${data.attempt_id}/paper`)).data;
      setPaper(paperData);
      setIndex(0);
      setAnswers({});
      setResult(null);
      setPrecheckDone(false);
    },
  });

  const saveAnswer = useMutation({
    mutationFn: async (payload: { attemptId: number; questionId: number; selected: number[] }) =>
      api.post(`/student/attempts/${payload.attemptId}/answers`, { question_id: payload.questionId, selected_option_ids: payload.selected }),
  });

  const submit = useMutation({
    mutationFn: async (attemptId: number) => (await api.post(`/student/attempts/${attemptId}/submit`)).data,
    onSuccess: (data) =>
      setResult({
        percentage: Number(data.percentage || 0),
        passed: Boolean(data.passed),
        training_feedback_status: data.training_feedback_status,
        training_feedback_comment: data.training_feedback_comment,
        training_feedback_count: data.training_feedback_count,
      }),
  });

  const current = useMemo(() => (paper ? paper.questions[index] : null), [paper, index]);
  const finishAndExit = () => {
    if (!paper || submit.isPending || result) return;
    setStatus("Assessment ended.");
    submit.mutate(paper.attempt_id);
  };

  const { confirmExit, fullscreenRequired, requestFullscreen } = useAssessmentSession({
    active: Boolean(paper && precheckDone && !result),
    exitWarning: "Exiting now will end this assessment. Do you want to continue?",
    onExitConfirmed: finishAndExit,
  });

  const { timerDisplay } = useAssessmentTimer({
    timingMode: paper?.timing_mode || "assessment",
    durationMinutes: Number(paper?.duration_minutes || 30),
    timePerQuestionSeconds: Number(paper?.time_per_question_seconds || 30),
    questionIndex: index,
    enabled: Boolean(paper && precheckDone && !result),
    onAssessmentTimeUp: () => {
      if (paper && !submit.isPending && !result) submit.mutate(paper.attempt_id);
    },
    onQuestionTimeUp: () => {
      if (!paper) return;
      if (index < paper.questions.length - 1) setIndex((x) => x + 1);
      else if (!submit.isPending && !result) submit.mutate(paper.attempt_id);
    },
  });

  const logEvent = useMutation({
    mutationFn: async (payload: { attemptId: number; eventType: string; payload: Record<string, unknown> }) =>
      api.post(`/student/attempts/${payload.attemptId}/events`, {
        event_type: payload.eventType,
        payload: payload.payload,
      }),
  });

  if (paper && !precheckDone) {
    return (
      <PrecheckGate
        onComplete={() => {
          setPrecheckDone(true);
          logEvent.mutate({
            attemptId: paper.attempt_id,
            eventType: "precheck_completed",
            payload: { exam_id: paper.exam_id, timing_mode: paper.timing_mode },
          });
        }}
      />
    );
  }

  if (paper && current) {
    const selected = answers[current.question_id] || [];
    return (
      <section className="card assessment-runtime-card">
        {fullscreenRequired && (
          <div className="assessment-fullscreen-overlay inline">
            <strong>Assessment must stay in fullscreen</strong>
            <span>Return to fullscreen to continue.</span>
            <button type="button" onClick={() => void requestFullscreen()}>Resume Fullscreen</button>
          </div>
        )}
        <div className="assessment-runtime-header">
          <div>
            <span className="launch-section-label">Candidate assessment</span>
            <h2>{paper.title}</h2>
          </div>
          <div className="assessment-runtime-meta">
            <span>Question {index + 1}/{paper.questions.length}</span>
            <span>Timer: {timerDisplay}</span>
          </div>
        </div>
        <div className="question-runtime-surface">
          <h3>{current.question_text}</h3>
          <div className="question-option-list">
            {current.options.map((o) => (
              <label key={o.option_id} className="question-option-card">
                <input
                  type={current.question_type === "mcq_multiple_correct" ? "checkbox" : "radio"}
                  name={`q-${current.question_id}`}
                  checked={selected.includes(o.option_id)}
                  onChange={async (e) => {
                    const next = current.question_type === "mcq_multiple_correct"
                      ? (e.target.checked ? [...selected, o.option_id] : selected.filter((x) => x !== o.option_id))
                      : [o.option_id];
                    setAnswers((prev) => ({ ...prev, [current.question_id]: next }));
                    await saveAnswer.mutateAsync({ attemptId: paper.attempt_id, questionId: current.question_id, selected: next });
                    logEvent.mutate({
                      attemptId: paper.attempt_id,
                      eventType: "answer_saved",
                      payload: { question_id: current.question_id, selected_option_ids: next },
                    });
                  }}
                />
                <span>{o.option_text}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="row assessment-question-actions">
          <button className="assessment-exit-btn" type="button" onClick={confirmExit}>Exit Assessment</button>
          <button disabled={index === 0} onClick={() => setIndex((x) => x - 1)}>Prev</button>
          {index < paper.questions.length - 1 ? (
            <button
              onClick={() => {
                logEvent.mutate({
                  attemptId: paper.attempt_id,
                  eventType: "question_navigate_next",
                  payload: { from_index: index, to_index: index + 1 },
                });
                setIndex((x) => x + 1);
              }}
            >
              Next
            </button>
          ) : (
            <button className="assessment-primary-btn" onClick={() => submit.mutate(paper.attempt_id)}>Submit Assessment</button>
          )}
        </div>
        {status && <small>{status}</small>}
        {result && (
          <>
            <strong>{result.passed ? "PASS" : "FAIL"} | {result.percentage.toFixed(2)}%</strong>
            <TrainingFeedbackPanel attemptId={paper.attempt_id} latest={result} />
          </>
        )}
      </section>
    );
  }

  return (
    <section className="card candidate-catalog-card">
      <div className="workspace-section-head">
        <div>
          <span className="launch-section-label">Student preview</span>
          <h2>Assessment catalog</h2>
          <p>Use this view to preview how available assessments will look before the issued flow takes over.</p>
        </div>
      </div>
      <div className="candidate-catalog-grid">
        {catalog.data?.map((row) => (
          <article className="candidate-catalog-item" key={row.exam_id}>
            <div>
              <strong>{row.title}</strong>
              <small>{row.provider_name}</small>
            </div>
            <div className="candidate-catalog-actions">
              <span>{row.status}</span>
              {row.status === "available" && <button onClick={() => start.mutate(row.exam_id)}>Start</button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
