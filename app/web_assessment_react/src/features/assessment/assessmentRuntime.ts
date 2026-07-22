export type TimingMode = "question" | "assessment";

export type TimerState = {
  remainingAssessmentSec: number;
  questionRemainingByIndex: Record<number, number>;
  questionTimedOutByIndex: Record<number, boolean>;
};

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function createInitialTimerState(durationMinutes: number): TimerState {
  return {
    remainingAssessmentSec: Math.max(1, Math.floor(durationMinutes * 60)),
    questionRemainingByIndex: {},
    questionTimedOutByIndex: {},
  };
}

export function ensureQuestionSeconds(state: TimerState, index: number, perQuestionSeconds: number): number {
  if (!Number.isFinite(state.questionRemainingByIndex[index])) {
    state.questionRemainingByIndex[index] = Math.max(1, Math.floor(perQuestionSeconds));
  }
  return state.questionRemainingByIndex[index];
}
