import { useCallback, useEffect, useState } from "react";
import { useRef } from "react";

type AssessmentSessionOptions = {
  active: boolean;
  exitWarning: string;
  onExitConfirmed: () => void;
  onPolicyWarning?: (reason: string, warningCount: number) => void;
  onPolicyTerminated?: (reason: string, warningCount: number) => void;
};

const MAX_WARNINGS = 5;

export function useAssessmentSession({ active, exitWarning, onExitConfirmed, onPolicyWarning, onPolicyTerminated }: AssessmentSessionOptions) {
  const [fullscreenRequired, setFullscreenRequired] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const warningCountRef = useRef(0);
  const terminatedRef = useRef(false);
  const recentReasonsRef = useRef<Record<string, number>>({});
  const warningCallbackRef = useRef(onPolicyWarning);
  const terminatedCallbackRef = useRef(onPolicyTerminated);
  warningCallbackRef.current = onPolicyWarning;
  terminatedCallbackRef.current = onPolicyTerminated;

  const requestFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (document.fullscreenElement === root) {
      setFullscreenRequired(false);
      return;
    }
    try {
      await root.requestFullscreen();
      setFullscreenRequired(false);
    } catch {
      setFullscreenRequired(true);
    }
  }, []);

  const confirmExit = useCallback(() => {
    if (!window.confirm(exitWarning)) return;
    onExitConfirmed();
  }, [exitWarning, onExitConfirmed]);

  useEffect(() => {
    if (!active) {
      setFullscreenRequired(false);
      setWarningCount(0);
      setLastWarning(null);
      warningCountRef.current = 0;
      terminatedRef.current = false;
      return;
    }
    void requestFullscreen();

    const recordViolation = (reason: string, immediate = false) => {
      if (terminatedRef.current) return;
      const now = Date.now();
      if (now - Number(recentReasonsRef.current[reason] || 0) < 2500) return;
      recentReasonsRef.current[reason] = now;
      const nextCount = warningCountRef.current + 1;
      warningCountRef.current = nextCount;
      setWarningCount(nextCount);
      setLastWarning(reason);
      warningCallbackRef.current?.(reason, nextCount);
      if (immediate || nextCount >= MAX_WARNINGS) {
        terminatedRef.current = true;
        terminatedCallbackRef.current?.(reason, nextCount);
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = exitWarning;
      return exitWarning;
    };

    const handleFullscreenChange = () => {
      const missing = !document.fullscreenElement;
      setFullscreenRequired(missing);
      if (missing) recordViolation("Fullscreen was exited", true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") recordViolation("The assessment tab was hidden");
    };
    const handleBlur = () => recordViolation("The assessment window lost focus");
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      recordViolation("The context menu was opened");
    };
    const handleClipboard = (event: ClipboardEvent) => {
      event.preventDefault();
      recordViolation(`Clipboard ${event.type} was blocked`);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const blocked = event.key === "F12" ||
        (event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(event.key.toUpperCase())) ||
        (event.ctrlKey && ["U", "P"].includes(event.key.toUpperCase()));
      if (blocked) {
        event.preventDefault();
        recordViolation("A restricted browser shortcut was used");
      }
    };

    const handlePopState = () => {
      if (!active) return;
      window.history.pushState({ assessmentGuard: true }, "", window.location.href);
      confirmExit();
    };

    window.history.pushState({ assessmentGuard: true }, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("copy", handleClipboard);
    document.addEventListener("cut", handleClipboard);
    document.addEventListener("paste", handleClipboard);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("copy", handleClipboard);
      document.removeEventListener("cut", handleClipboard);
      document.removeEventListener("paste", handleClipboard);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [active, confirmExit, exitWarning, requestFullscreen]);

  return {
    confirmExit,
    fullscreenRequired,
    requestFullscreen,
    warningCount,
    lastWarning,
  };
}
