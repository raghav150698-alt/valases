export function createAssessmentPreviewProctorUi({
  state,
  el,
  $, 
  renderList,
  beginGazeQuestionGrace,
  persistCurrentStudentAttemptAnswer,
  finalizeGazeQuestionForNavigation,
  showAssessmentPreviewResult,
  assessmentTimer,
  api,
  toast,
}) {
  function readCurrentPreviewAnswer() {
    const current = state.assessmentPreview.questions[state.assessmentPreview.index];
    if (!current) return;
    const checked = Array.from(document.querySelectorAll("[data-ap-opt]:checked")).map((x) => Number(x.value));
    state.assessmentPreview.answers[current.question_id] = checked;
  }

  async function onAssessmentQuestionTimerElapsed() {
    const preview = state.assessmentPreview;
    if (preview.questionTimeTransitionInFlight) return;
    preview.questionTimeTransitionInFlight = true;
    try {
      readCurrentPreviewAnswer();
      if (preview.mode === "student_attempt") await persistCurrentStudentAttemptAnswer();
      const isLast = preview.index >= preview.questions.length - 1;
      finalizeGazeQuestionForNavigation(preview, true);
      if (isLast) {
        showAssessmentPreviewResult("question_timer_expired");
        return;
      }
      preview.index = Math.min(preview.questions.length - 1, preview.index + 1);
      renderAssessmentPreviewQuestion();
      assessmentTimer.syncQuestionTimerOnRender();
    } catch {
      showAssessmentPreviewResult("question_timer_error");
    } finally {
      preview.questionTimeTransitionInFlight = false;
    }
  }

  function renderAssessmentPreviewQuestion() {
    const preview = state.assessmentPreview;
    const q = preview.questions[preview.index];
    if (!q) return;
    el.apQuestionPanel?.classList.remove("question-enter");
    requestAnimationFrame(() => el.apQuestionPanel?.classList.add("question-enter"));
    if (el.apProgressText) el.apProgressText.textContent = `Question ${preview.index + 1}/${preview.questions.length}`;
    if (el.apQuestionText) el.apQuestionText.textContent = q.question_text;
    const existing = preview.answers[q.question_id] || [];
    const inputType = q.question_type === "mcq_multiple_correct" ? "checkbox" : "radio";
    const name = `ap-q-${q.question_id}`;
    renderList(
      el.apOptionsList,
      q.options || [],
      (o) => `
        <label class="preview-option">
          <input data-ap-opt type="${inputType}" name="${name}" value="${o.option_id}" ${existing.includes(o.option_id) ? "checked" : ""} />
          <span>${o.option_text}</span>
        </label>
      `,
      "No options.",
    );
    if (preview.mode === "student_attempt") {
      document.querySelectorAll("[data-ap-opt]").forEach((node) => {
        node.addEventListener("change", async () => {
          readCurrentPreviewAnswer();
          try {
            await persistCurrentStudentAttemptAnswer();
          } catch {}
        });
      });
    }
    const prevBtn = $("apPrevBtn");
    const nextBtn = $("apNextBtn");
    const submitBtn = $("apSubmitBtn");
    if (prevBtn) prevBtn.disabled = preview.index <= 0;
    const isLast = preview.index >= preview.questions.length - 1;
    if (nextBtn) nextBtn.classList.toggle("hidden", isLast);
    if (submitBtn) submitBtn.classList.toggle("hidden", !isLast);
    assessmentTimer.syncQuestionTimerOnRender();
    requestAnimationFrame(() => beginGazeQuestionGrace(preview.proctor));
  }

  function setTrainingFeedbackChoice(choice) {
    state.assessmentPreview.trainingFeedbackChoice = choice;
    el.apTrainingPassBtn?.classList.toggle("primary", choice === "correct");
    el.apTrainingFailBtn?.classList.toggle("primary", choice === "incorrect");
  }

  function trainingReviewEligible() {
    const preview = state.assessmentPreview;
    if (Boolean(preview.attemptId)) return true;
    return (
      preview.mode === "preview"
      && Boolean(preview.latestResult)
      && Boolean(preview.proctor?.sessionId)
    );
  }

  function renderTrainingFeedbackPanel(result = null) {
    if (!el.apTrainingFeedbackPanel) return;
    const activeResult = result || state.assessmentPreview.latestResult;
    const showReview = trainingReviewEligible();
    el.apTrainingFeedbackPanel.classList.toggle("hidden", !showReview);
    if (!showReview) return;
    const savedStatus = activeResult?.training_feedback_status || "";
    const savedComment = activeResult?.training_feedback_comment || "";
    const feedbackCount = Number(activeResult?.training_feedback_count || 0);
    if (!state.assessmentPreview.trainingFeedbackChoice && savedStatus) {
      state.assessmentPreview.trainingFeedbackChoice = savedStatus;
    }
    setTrainingFeedbackChoice(state.assessmentPreview.trainingFeedbackChoice || "");
    if (el.apTrainingComment) {
      el.apTrainingComment.value = savedComment;
    }
    if (el.apTrainingFeedbackStatus) {
      if (savedStatus) {
        const label = savedStatus === "correct" ? "Pass (model correct)" : "Fail (model wrong)";
        el.apTrainingFeedbackStatus.textContent = `Latest saved review: ${label}${feedbackCount > 1 ? ` | total saved: ${feedbackCount}` : ""}`;
      } else {
        el.apTrainingFeedbackStatus.textContent =
          "No training review saved yet. Use the score and proctor lines above, then choose Pass or Fail.";
      }
    }
  }

  async function saveTrainingFeedback() {
    const preview = state.assessmentPreview;
    const attemptId = preview.attemptId;
    const sessionId = preview.proctor?.sessionId;
    if (!attemptId && !sessionId) {
      toast("Cannot save: proctor session was lost. Close and re-run the assessment once.", "error");
      return;
    }
    const choice = preview.trainingFeedbackChoice;
    if (!choice) {
      toast("Choose Pass or Fail for the model review first.", "error");
      return;
    }
    const comment = el.apTrainingComment?.value?.trim() || "";
    let out;
    if (attemptId) {
      out = await api("POST", `/student/attempts/${attemptId}/proctor-training-feedback`, {
        training_result: choice,
        comment,
      });
    } else {
      out = await api("POST", `/proctoring/sessions/${sessionId}/training-feedback`, {
        training_result: choice,
        comment,
      });
    }
    state.assessmentPreview.latestResult = {
      ...(state.assessmentPreview.latestResult || {}),
      training_feedback_status: out.training_feedback_status,
      training_feedback_comment: out.training_feedback_comment,
      training_feedback_count: out.training_feedback_count,
    };
    renderTrainingFeedbackPanel(state.assessmentPreview.latestResult);
    toast("Training review saved");
  }

  return {
    readCurrentPreviewAnswer,
    onAssessmentQuestionTimerElapsed,
    renderAssessmentPreviewQuestion,
    setTrainingFeedbackChoice,
    trainingReviewEligible,
    renderTrainingFeedbackPanel,
    saveTrainingFeedback,
  };
}
