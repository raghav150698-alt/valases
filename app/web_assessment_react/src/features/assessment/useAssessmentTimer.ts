import { useEffect, useMemo, useRef, useState } from "react";

import { createInitialTimerState, ensureQuestionSeconds, formatClock } from "./assessmentRuntime";
import type { TimerState, TimingMode } from "./assessmentRuntime";

type Params = {
  timingMode: TimingMode;
  durationMinutes: number;
  timePerQuestionSeconds: number;
  questionIndex: number;
  enabled: boolean;
  onAssessmentTimeUp: () => void;
  onQuestionTimeUp: () => void;
};

export function useAssessmentTimer(params: Params) {
  const { timingMode, durationMinutes, timePerQuestionSeconds, questionIndex, enabled, onAssessmentTimeUp, onQuestionTimeUp } = params;
  const [state, setState] = useState<TimerState>(() => createInitialTimerState(durationMinutes));
  const questionFiredRef = useRef<Record<number, boolean>>({});

  useEffect(() => {
    setState(createInitialTimerState(durationMinutes));
    questionFiredRef.current = {};
  }, [durationMinutes, timingMode]);

  useEffect(() => {
    if (!enabled) return;
    const intervalId = window.setInterval(() => {
      setState((previous) => {
        const next: TimerState = {
          remainingAssessmentSec: previous.remainingAssessmentSec,
          questionRemainingByIndex: { ...previous.questionRemainingByIndex },
          questionTimedOutByIndex: { ...previous.questionTimedOutByIndex },
        };
        if (timingMode === "question") {
          const remaining = ensureQuestionSeconds(next, questionIndex, timePerQuestionSeconds) - 1;
          next.questionRemainingByIndex[questionIndex] = Math.max(0, remaining);
          if (remaining <= 0 && !questionFiredRef.current[questionIndex]) {
            questionFiredRef.current[questionIndex] = true;
            next.questionTimedOutByIndex[questionIndex] = true;
            queueMicrotask(onQuestionTimeUp);
          }
          return next;
        }
        next.remainingAssessmentSec = Math.max(0, next.remainingAssessmentSec - 1);
        if (next.remainingAssessmentSec <= 0) queueMicrotask(onAssessmentTimeUp);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [enabled, onAssessmentTimeUp, onQuestionTimeUp, questionIndex, timePerQuestionSeconds, timingMode]);

  const display = useMemo(() => {
    if (timingMode === "question") {
      return formatClock(state.questionRemainingByIndex[questionIndex] ?? timePerQuestionSeconds);
    }
    return formatClock(state.remainingAssessmentSec);
  }, [questionIndex, state.questionRemainingByIndex, state.remainingAssessmentSec, timePerQuestionSeconds, timingMode]);

  return { timerState: state, timerDisplay: display };
}
