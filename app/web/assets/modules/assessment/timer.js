export function createAssessmentTimer({
  state,
  el,
  formatSecondsToClock,
  onAssessmentTimeUp,
  onQuestionTimeUp,
}) {
  function clearAssessmentPreviewTimer() {
    if (state.assessmentPreview.timerId) {
      clearInterval(state.assessmentPreview.timerId);
      state.assessmentPreview.timerId = null;
    }
  }

  function questionModeBaseSeconds(preview) {
    return Math.max(1, Number(preview?.exam?.time_per_question_seconds || 0));
  }

  function ensureQuestionTimerState(preview) {
    if (!preview.questionRemainingByIndex || typeof preview.questionRemainingByIndex !== "object") {
      preview.questionRemainingByIndex = {};
    }
    if (!preview.questionTimedOutByIndex || typeof preview.questionTimedOutByIndex !== "object") {
      preview.questionTimedOutByIndex = {};
    }
  }

  function renderAssessmentTimerText() {
    const preview = state.assessmentPreview;
    const exam = preview.exam;
    if (!exam || !el.apTimerText) return;
    if (exam.timing_mode === "question") {
      ensureQuestionTimerState(preview);
      const idx = Math.max(0, Number(preview.index || 0));
      const base = questionModeBaseSeconds(preview);
      if (!Number.isFinite(Number(preview.questionRemainingByIndex[idx]))) {
        preview.questionRemainingByIndex[idx] = base;
      }
      const left = Math.max(0, Number(preview.questionRemainingByIndex[idx] || 0));
      el.apTimerText.textContent = `Q ${idx + 1}/${preview.questions.length}: ${formatSecondsToClock(Math.floor(left))}`;
      return;
    }
    el.apTimerText.textContent = formatSecondsToClock(Math.max(0, Math.floor(Number(preview.remainingSec || 0))));
  }

  function tickAssessmentTimer() {
    const preview = state.assessmentPreview;
    const exam = preview.exam;
    if (!exam || preview.timerPaused) return;

    if (exam.timing_mode === "question") {
      ensureQuestionTimerState(preview);
      const idx = Math.max(0, Number(preview.index || 0));
      const base = questionModeBaseSeconds(preview);
      if (!Number.isFinite(Number(preview.questionRemainingByIndex[idx]))) {
        preview.questionRemainingByIndex[idx] = base;
      }
      const next = Math.max(0, Number(preview.questionRemainingByIndex[idx] || 0) - 1);
      preview.questionRemainingByIndex[idx] = next;
      renderAssessmentTimerText();
      if (next <= 0 && !preview.questionTimedOutByIndex[idx]) {
        preview.questionTimedOutByIndex[idx] = true;
        onQuestionTimeUp?.(idx);
      }
      return;
    }

    preview.remainingSec = Math.max(0, Number(preview.remainingSec || 0) - 1);
    renderAssessmentTimerText();
    if (preview.remainingSec <= 0) {
      clearAssessmentPreviewTimer();
      onAssessmentTimeUp?.();
    }
  }

  function startAssessmentPreviewTimer() {
    clearAssessmentPreviewTimer();
    const preview = state.assessmentPreview;
    const exam = preview.exam;
    if (!exam) return;

    if (exam.timing_mode === "question") {
      ensureQuestionTimerState(preview);
      renderAssessmentTimerText();
      preview.timerId = setInterval(() => {
        tickAssessmentTimer();
      }, 1000);
      return;
    }

    const total = Math.max(1, Number(exam.duration_minutes || 0) * 60);
    preview.remainingSec = Math.max(1, Number(preview.remainingSec || 0) || total);
    renderAssessmentTimerText();
    preview.timerId = setInterval(() => {
      tickAssessmentTimer();
    }, 1000);
  }

  function syncQuestionTimerOnRender() {
    const preview = state.assessmentPreview;
    const exam = preview.exam;
    if (!exam || exam.timing_mode !== "question") return;
    ensureQuestionTimerState(preview);
    const idx = Math.max(0, Number(preview.index || 0));
    const base = questionModeBaseSeconds(preview);
    if (!Number.isFinite(Number(preview.questionRemainingByIndex[idx]))) {
      preview.questionRemainingByIndex[idx] = base;
    }
    renderAssessmentTimerText();
  }

  return {
    clearAssessmentPreviewTimer,
    startAssessmentPreviewTimer,
    syncQuestionTimerOnRender,
  };
}
