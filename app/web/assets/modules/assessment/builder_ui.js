export function createAssessmentBuilderUi({
  state,
  el,
  $, 
  toast,
  api,
  renderList,
  getSelectedAssessmentCourseId,
  isAssessmentDraftSourceSelected,
  getAssessmentSourceValue,
  persistAssessmentBuilderCache,
  resetAssessmentBuilder,
  tryRestoreAssessmentBuilderCache,
  assessmentOnlyMode = false,
}) {
  const STEP2_REQUIRED_TEXT_FIELDS = [
    "abTitle",
    "abAssessmentType",
    "abPassScore",
    "abInstructions",
    "abAbout",
    "abTools",
    "abTopics",
    "abMaxAttempts",
    "abQuestionsPerAttempt",
    "abTimingMode",
    "abDurationMinutes",
    "abTimePerQuestionSeconds",
    "abDefaultNegativeMarks",
  ];
  const STEP2_REQUIRED_CHECKBOX_ROWS = [
    "abNegativeMarking",
  ];

  function markFieldInvalid(fieldId, invalid = true) {
    const node = $(fieldId);
    if (!node) return;
    node.classList.toggle("ab-field-invalid", Boolean(invalid));
  }

  function markCheckboxRowInvalid(checkboxId, invalid = true) {
    const node = $(checkboxId);
    const row = node?.closest?.(".checkbox-row");
    if (!row) return;
    row.classList.toggle("ab-field-invalid", Boolean(invalid));
  }

  function clearStep2InvalidStyles() {
    STEP2_REQUIRED_TEXT_FIELDS.forEach((id) => markFieldInvalid(id, false));
    STEP2_REQUIRED_CHECKBOX_ROWS.forEach((id) => markCheckboxRowInvalid(id, false));
  }

  function showStep2Error(message) {
    const node = $("abStep2Error");
    if (!node) return;
    if (!message) {
      node.textContent = "";
      node.classList.add("hidden");
      return;
    }
    node.textContent = message;
    node.classList.remove("hidden");
  }

  function setAssessmentBuilderStep(step, options = {}) {
    const normalized = Math.max(1, Math.min(3, Number(step || 1)));
    state.assessmentBuilderStep = normalized;
    const track = $("abStepTrack");
    if (track) {
      if (options.noAnimate) track.style.transition = "none";
      track.style.transform = `translateX(-${(normalized - 1) * (100 / 3)}%)`;
      if (options.noAnimate) {
        requestAnimationFrame(() => {
          track.style.transition = "";
        });
      }
    }
    document.querySelectorAll("[data-ab-step-indicator]").forEach((node) => {
      node.classList.toggle("active", Number(node.getAttribute("data-ab-step-indicator") || 0) === normalized);
    });
  }

  function goToAssessmentStep(step) {
    setAssessmentBuilderStep(step);
  }

  function validateAssessmentStep(step) {
    const s = Number(step || 1);
    if (s === 1) {
      if (assessmentOnlyMode) {
        const selectNode = $("abCourseSelect");
        if (selectNode) selectNode.value = "standalone";
        return true;
      }
      const source = getAssessmentSourceValue();
      if (source === "standalone") return true;
      const courseId = getSelectedAssessmentCourseId();
      if (!courseId || isAssessmentDraftSourceSelected()) {
        toast("Select an active/inactive course (draft is not allowed for assessment).", "error");
        return false;
      }
      return true;
    }
    if (s === 2) {
      showStep2Error("");
      clearStep2InvalidStyles();
      const title = $("abTitle")?.value?.trim() || "";
      const assessmentType = $("abAssessmentType")?.value || "mcq";
      if (!title) {
        markFieldInvalid("abTitle", true);
        showStep2Error("Assessment title is required.");
        return false;
      }
      if (!["mcq", "coding", "spreadsheet", "tax_simulator", "case_study"].includes(assessmentType)) {
        markFieldInvalid("abAssessmentType", true);
        showStep2Error("Assessment type is required.");
        return false;
      }
      const passScore = Number($("abPassScore")?.value || 0);
      if (!Number.isFinite(passScore) || passScore < 70 || passScore > 100) {
        markFieldInvalid("abPassScore", true);
        showStep2Error("Passing score must be between 70 and 100.");
        return false;
      }
      const instructions = $("abInstructions")?.value?.trim() || "";
      const about = $("abAbout")?.value?.trim() || "";
      const tools = $("abTools")?.value?.trim() || "";
      const topics = $("abTopics")?.value?.trim() || "";
      if (!instructions) {
        markFieldInvalid("abInstructions", true);
        showStep2Error("Instructions are required.");
        return false;
      }
      if (!about) {
        markFieldInvalid("abAbout", true);
        showStep2Error("About assessment is required.");
        return false;
      }
      if (!tools) {
        markFieldInvalid("abTools", true);
        showStep2Error("Tools used is required.");
        return false;
      }
      if (!topics) {
        markFieldInvalid("abTopics", true);
        showStep2Error("Topics included is required.");
        return false;
      }
      const maxAttempts = Number($("abMaxAttempts")?.value);
      const questionsPerAttempt = Number($("abQuestionsPerAttempt")?.value);
      if (!Number.isFinite(maxAttempts) || maxAttempts <= 0 || maxAttempts > 3) {
        markFieldInvalid("abMaxAttempts", true);
        showStep2Error("Max attempts must be between 1 and 3.");
        return false;
      }
      if (assessmentType === "mcq" && ![25, 30, 35, 40].includes(questionsPerAttempt)) {
        markFieldInvalid("abQuestionsPerAttempt", true);
        showStep2Error("Questions shown to student must be one of 25, 30, 35, or 40.");
        return false;
      }
      const timingMode = assessmentType === "mcq" ? ($("abTimingMode")?.value || "question") : "assessment";
      if (timingMode === "assessment") {
        const mins = Number($("abDurationMinutes")?.value || 0);
        if (![25, 30, 35, 40, 45].includes(mins)) {
          markFieldInvalid("abDurationMinutes", true);
          showStep2Error("Assessment duration must be 25, 30, 35, 40, or 45 minutes.");
          return false;
        }
      } else if (assessmentType === "mcq") {
        const perQ = Number($("abTimePerQuestionSeconds")?.value);
        if (![25, 30, 35, 40, 45].includes(perQ)) {
          markFieldInvalid("abTimePerQuestionSeconds", true);
          showStep2Error("Time per question is required and must be 25, 30, 35, 40, or 45 seconds.");
          return false;
        }
      }
      if (Boolean($("abNegativeMarking")?.checked)) {
        const raw = String($("abDefaultNegativeMarks")?.value || "").trim();
        if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
          markFieldInvalid("abDefaultNegativeMarks", true);
          showStep2Error("Default negative marks must be 0 or a positive number.");
          return false;
        }
      }
      showStep2Error("");
      return true;
    }
    return true;
  }

  function openAssessmentBuilder(allowRestore = true) {
    resetAssessmentBuilder();
    showStep2Error("");
    clearStep2InvalidStyles();
    el.assessmentBuilderScreen?.classList.remove("hidden");
    if (allowRestore) tryRestoreAssessmentBuilderCache();
    setAssessmentBuilderStep(1, { noAnimate: true });
  }

  function closeAssessmentBuilder() {
    el.assessmentBuilderScreen?.classList.add("hidden");
    resetAssessmentBuilder();
  }

  function updateAssessmentSourceMeta() {
    const meta = $("abCourseMeta");
    const saveBtn = $("abSaveDraftBtn");
    const publishBtn = $("abPublishBtn");
    if (!meta) return;
    const raw = getAssessmentSourceValue();
    if (assessmentOnlyMode) {
      const selectNode = $("abCourseSelect");
      if (selectNode) selectNode.value = "standalone";
      meta.textContent = "Standalone assessment selected. Candidates access it only through issued credentials.";
      if (saveBtn) saveBtn.disabled = false;
      if (publishBtn) publishBtn.disabled = false;
      return;
    }
    if (!raw) {
      meta.textContent = "No course selected.";
      if (saveBtn) saveBtn.disabled = true;
      if (publishBtn) publishBtn.disabled = true;
      return;
    }
    if (raw.startsWith("draft:")) {
      const draftId = Number(raw.split(":")[1] || 0);
      const d = (state.providerDrafts || []).find((x) => Number(x.draft_id) === draftId);
      meta.textContent = `Draft selected: ${d?.title || `Draft #${draftId}`}. Publish the course first to create an assessment.`;
      if (saveBtn) saveBtn.disabled = true;
      if (publishBtn) publishBtn.disabled = true;
      return;
    }
    if (raw === "standalone") {
      meta.textContent = "Standalone assessment selected. Students can enroll directly to this assessment.";
      if (saveBtn) saveBtn.disabled = false;
      if (publishBtn) publishBtn.disabled = false;
      return;
    }
    const courseId = Number(raw.split(":")[1] || 0);
    const c = (state.providerCourses || []).find((x) => Number(x.id) === courseId);
    meta.textContent = c
      ? `Course selected: ${c.title} (${c.is_published ? "Active" : "Inactive"}).`
      : "Invalid selection.";
    if (saveBtn) saveBtn.disabled = false;
    if (publishBtn) publishBtn.disabled = false;
  }

  function renderAssessmentCourseOptions() {
    const selectNode = $("abCourseSelect");
    if (!selectNode) return;
    if (assessmentOnlyMode) {
      selectNode.innerHTML = `<option value="standalone">Standalone Assessment</option>`;
      selectNode.value = "standalone";
      selectNode.disabled = true;
      const filterNode = $("abCourseFilter");
      if (filterNode) filterNode.disabled = true;
      updateAssessmentSourceMeta();
      return;
    }
    const filter = $("abCourseFilter")?.value || "all";
    const options = [];

    if (filter !== "draft") {
      options.push({
        value: "standalone",
        label: "Standalone Assessment (Direct student enrollment)",
      });
      (state.providerCourses || []).forEach((c) => {
        if (filter === "active" && !c.is_published) return;
        if (filter === "inactive" && c.is_published) return;
        options.push({
          value: `course:${c.id}`,
          label: `${c.title} (${c.is_published ? "Active" : "Inactive"})`,
        });
      });
    }
    if (filter === "draft" || filter === "all") {
      (state.providerDrafts || []).forEach((d) => {
        options.push({
          value: `draft:${d.draft_id}`,
          label: `${d.title || `Draft #${d.draft_id}`} (Draft video)`,
        });
      });
    }

    const previous = selectNode.value;
    const html = [`<option value="">Select course or draft video</option>`]
      .concat(options.map((o) => `<option value="${o.value}">${o.label}</option>`))
      .join("");
    selectNode.innerHTML = html;
    if (options.some((o) => o.value === previous)) {
      selectNode.value = previous;
    }
    updateAssessmentSourceMeta();
  }

  function renderAssessmentPool() {
    const list = state.assessmentDraftQuestions || [];
    const perAttempt = Number($("abQuestionsPerAttempt")?.value || 0);
    const recommendedPool = perAttempt > 0 ? perAttempt * 2 : 0;
    if (el.abPoolMeta) {
      const recommendation = recommendedPool > 0 ? ` Recommended pool: ${recommendedPool}+` : "";
      el.abPoolMeta.textContent = `${list.length} questions.${recommendation}`;
    }
    renderList(
      el.abQuestionPoolList,
      list,
      (q, idx) => `
        <div><strong>Q${idx + 1}</strong> (${q.question_type === "mcq_multiple_correct" ? "Multi" : "Single"})</div>
        <div style="margin-top:4px;">${q.question_text}</div>
        <div class="meta">Marks: ${q.marks} | Negative: ${q.negative_marks}</div>
        <div class="meta">Options: ${q.options.length} | Correct: ${q.options.filter((o) => o.is_correct).length}</div>
        <div class="actions"><button class="btn small danger" data-ab-remove-q="${idx}">Remove</button></div>
      `,
      "No questions added yet.",
    );
    document.querySelectorAll("[data-ab-remove-q]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.abRemoveQ || -1);
        if (idx < 0 || idx >= state.assessmentDraftQuestions.length) return;
        const q = state.assessmentDraftQuestions[idx];
        if (state.assessmentEditingExamId && q.question_id) {
          try {
            await api("DELETE", `/exams/${state.assessmentEditingExamId}/questions/${q.question_id}`);
          } catch (err) {
            toast(err?.message || "Failed to remove question", "error");
            return;
          }
        }
        state.assessmentDraftQuestions = state.assessmentDraftQuestions.filter((_, i) => i !== idx);
        if (!state.assessmentDraftQuestions.length) {
          state.assessmentQuestionDefaultMarks = null;
          state.assessmentQuestionDefaultNegativeMarks = null;
          $("abQuestionMarks").value = "";
          $("abQuestionNegativeMarks").value = "";
        }
        persistAssessmentBuilderCache();
        renderAssessmentPool();
      });
    });
  }

  return {
    setAssessmentBuilderStep,
    goToAssessmentStep,
    validateAssessmentStep,
    openAssessmentBuilder,
    closeAssessmentBuilder,
    renderAssessmentCourseOptions,
    updateAssessmentSourceMeta,
    renderAssessmentPool,
  };
}
