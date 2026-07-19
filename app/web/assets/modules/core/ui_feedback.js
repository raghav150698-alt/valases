export function createUiFeedback({ state, el }) {
  function toast(message, type = "ok") {
    if (!el.toastStack) return;
    const node = document.createElement("div");
    node.className = `toast ${type === "error" ? "error" : ""}`;
    node.textContent = message;
    el.toastStack.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function showAuthProgress(title = "Signing you in", detail = "Please wait while we load your workspace.") {
    if (el.authProgressTitle) el.authProgressTitle.textContent = title;
    if (el.authProgressDetail) el.authProgressDetail.textContent = detail;
    if (state.authProgressTimer) {
      clearTimeout(state.authProgressTimer);
      state.authProgressTimer = null;
    }
    state.authProgressVisible = true;
    el.authProgressOverlay?.classList.remove("hidden");
  }

  function hideAuthProgress() {
    if (state.authProgressTimer) {
      clearTimeout(state.authProgressTimer);
      state.authProgressTimer = null;
    }
    state.authProgressVisible = false;
    el.authProgressOverlay?.classList.add("hidden");
  }

  return {
    toast,
    showAuthProgress,
    hideAuthProgress,
  };
}
