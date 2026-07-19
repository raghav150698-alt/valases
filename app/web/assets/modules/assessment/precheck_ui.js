export function createAssessmentPrecheckUi({
  state,
  el,
  labels,
  createDefaultPrecheckChecklist,
}) {
  function renderPrecheckLine(text, tone = "pending") {
    if (!el.apPrecheckChecklist) return;
    el.apPrecheckChecklist.innerHTML = "";
    const node = document.createElement("div");
    node.className = `ap-precheck-line ${tone}`;
    node.textContent = String(text || "").trim();
    el.apPrecheckChecklist.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
  }

  function renderPrecheckChecklist(activeKey = "") {
    const checks = state.assessmentPreview.proctor.precheckChecks || createDefaultPrecheckChecklist();
    const ordered = Object.entries(labels);
    const precheckReady = Boolean(state.assessmentPreview.proctor.precheckReady);
    if (precheckReady) {
      renderPrecheckLine("Done: All mandatory checks completed.", "done");
      return;
    }
    const fallbackNext = ordered.find(([key]) => !checks[key])?.[0] || "";
    const currentKey = String(activeKey || fallbackNext || "");
    const label = labels[currentKey] || "Next check";
    const done = Boolean(checks[currentKey]);
    renderPrecheckLine(`${done ? "Done" : "Pending"}: ${label}`, done ? "done" : "pending");
  }

  function setPrecheckInstruction(text, activeKey = "", detailText = "", voiceScript = "") {
    if (el.apPrecheckInstruction) el.apPrecheckInstruction.textContent = text;
    if (el.apPrecheckInstructionDetail) {
      el.apPrecheckInstructionDetail.textContent = detailText || "Keep your face centered, eyes on question area, and stay silent unless prompted.";
    }
    if (el.apPrecheckVoiceScript) {
      if (voiceScript) {
        el.apPrecheckVoiceScript.textContent = `Read exactly: "${voiceScript}"`;
        el.apPrecheckVoiceScript.classList.remove("hidden");
      } else {
        el.apPrecheckVoiceScript.classList.add("hidden");
      }
    }
    renderPrecheckChecklist(activeKey);
  }

  function showPrecheckChecksPage() {
    el.apPrecheckChecksPage?.classList.remove("hidden");
    el.apPrecheckRulesPage?.classList.add("hidden");
  }

  function showPrecheckRulesPage() {
    el.apPrecheckChecksPage?.classList.add("hidden");
    el.apPrecheckRulesPage?.classList.remove("hidden");
  }

  async function runRulesReadAloudVerification(audioBaselineRms) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let audioContext = null;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const arr = new Uint8Array(analyser.fftSize);
      const start = Date.now();
      let activeFrames = 0;
      while (Date.now() - start < 4800) {
        analyser.getByteTimeDomainData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i += 1) {
          const d = (arr[i] - 128) / 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / arr.length);
        if (rms > Math.max(0.03, (audioBaselineRms || 0.03) * 1.35)) activeFrames += 1;
        await new Promise((r) => setTimeout(r, 110));
      }
      return activeFrames >= 9;
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      if (audioContext) audioContext.close().catch(() => {});
    }
  }

  function updateAssessmentStartEligibility() {
    const p = state.assessmentPreview.proctor;
    const precheckReady = Boolean(p.precheckReady) && !p.precheckInProgress;
    const precheckUnlocked = precheckReady && Date.now() >= Number(p.precheckUnlockAtMs || 0);
    const attested = Boolean(p.environmentAttested) || Boolean(p.precheckBypassed);
    if (el.apPrecheckNextBtn) {
      el.apPrecheckNextBtn.disabled = !precheckUnlocked;
    }
    if (el.apStartTestBtn) {
      el.apStartTestBtn.disabled = !(precheckUnlocked && attested);
    }
    if (el.apEnvironmentStatus) {
      if (p.precheckInProgress) {
        el.apEnvironmentStatus.textContent = "Pre-check in progress.";
      } else if (precheckReady && !precheckUnlocked) {
        el.apEnvironmentStatus.textContent = "Finalizing checks...";
      } else if (!precheckReady) {
        el.apEnvironmentStatus.textContent = "Complete mandatory checks to unlock Next.";
      } else if (!attested) {
        el.apEnvironmentStatus.textContent = "Assessment start remains blocked until you confirm the test machine is local-only.";
      } else {
        el.apEnvironmentStatus.textContent = "All checks completed. You can start the assessment.";
      }
    }
  }

  return {
    renderPrecheckChecklist,
    setPrecheckInstruction,
    showPrecheckChecksPage,
    showPrecheckRulesPage,
    runRulesReadAloudVerification,
    updateAssessmentStartEligibility,
  };
}
