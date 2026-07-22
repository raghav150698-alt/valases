import { useCallback, useEffect, useState } from "react";
import { useRef } from "react";

type AssessmentSessionOptions = {
  active: boolean;
  exitWarning: string;
  onExitConfirmed: () => void;
  onFullscreenExited?: () => void;
  onPolicyWarning?: (reason: string, warningCount: number, signal?: ProctorViolation) => void;
  onPolicyTerminated?: (reason: string, warningCount: number, signal?: ProctorViolation) => void;
};

export type ProctorViolation = {
  eventType: string;
  severity?: "info" | "warning" | "critical";
  details?: Record<string, unknown>;
};

const MAX_WARNINGS = 5;

export function useAssessmentSession({ active, exitWarning, onExitConfirmed, onFullscreenExited, onPolicyWarning, onPolicyTerminated }: AssessmentSessionOptions) {
  const [fullscreenRequired, setFullscreenRequired] = useState(false);
  const [escapeWarningVisible, setEscapeWarningVisible] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const warningCountRef = useRef(0);
  const terminatedRef = useRef(false);
  const recentReasonsRef = useRef<Record<string, number>>({});
  const warningCallbackRef = useRef(onPolicyWarning);
  const terminatedCallbackRef = useRef(onPolicyTerminated);
  const fullscreenExitedCallbackRef = useRef(onFullscreenExited);
  const exitConfirmedCallbackRef = useRef(onExitConfirmed);
  warningCallbackRef.current = onPolicyWarning;
  terminatedCallbackRef.current = onPolicyTerminated;
  fullscreenExitedCallbackRef.current = onFullscreenExited;
  exitConfirmedCallbackRef.current = onExitConfirmed;

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

  const keepAssessmentOpen = useCallback(() => {
    setEscapeWarningVisible(false);
    void requestFullscreen();
  }, [requestFullscreen]);

  const endAssessmentFromEscape = useCallback(() => {
    terminatedRef.current = true;
    setEscapeWarningVisible(false);
    exitConfirmedCallbackRef.current();
  }, []);

  useEffect(() => {
    if (!active) {
      setFullscreenRequired(false);
      setWarningCount(0);
      setLastWarning(null);
      setEscapeWarningVisible(false);
      warningCountRef.current = 0;
      terminatedRef.current = false;
      return;
    }
    void requestFullscreen();

    const recordViolation = (reason: string, immediate = false, signal?: ProctorViolation) => {
      if (terminatedRef.current) return;
      const now = Date.now();
      if (now - Number(recentReasonsRef.current[reason] || 0) < 2500) return;
      recentReasonsRef.current[reason] = now;
      const nextCount = warningCountRef.current + 1;
      warningCountRef.current = nextCount;
      setWarningCount(nextCount);
      setLastWarning(reason);
      warningCallbackRef.current?.(reason, nextCount, signal);
      if (immediate || nextCount >= MAX_WARNINGS) {
        terminatedRef.current = true;
        terminatedCallbackRef.current?.(reason, nextCount, signal);
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
      if (missing && !terminatedRef.current) {
        setEscapeWarningVisible(false);
        if (fullscreenExitedCallbackRef.current) {
          terminatedRef.current = true;
          fullscreenExitedCallbackRef.current();
        } else {
          recordViolation("Fullscreen was exited", true);
        }
      }
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
      if (event.key === "Escape" && document.fullscreenElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (fullscreenExitedCallbackRef.current) setEscapeWarningVisible(true);
        else confirmExit();
        return;
      }
      const blocked = event.key === "F12" ||
        (event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(event.key.toUpperCase())) ||
        (event.ctrlKey && ["U", "P"].includes(event.key.toUpperCase()));
      if (blocked) {
        event.preventDefault();
        recordViolation("A restricted browser shortcut was used");
      }
    };

    const handleProctorSignal = (event: Event) => {
      const detail = (event as CustomEvent<{ event_type?: string; duration_ms?: number; confidence?: number; object_label?: string }>).detail || {};
      const eventType = String(detail.event_type || "").toLowerCase();
      const durationMs = Number(detail.duration_ms || 0);
      const isSustainedGazeAway = ["look_away_over_2s", "gaze_away_over_3s", "gaze_pattern_review_flag"].includes(eventType);
      if (isSustainedGazeAway && durationMs >= 2000) {
        recordViolation("Sustained gaze away was detected", false, { eventType: "look_away_over_2s", details: { duration_ms: durationMs } });
      } else if (eventType === "mobile_phone_detected") {
        recordViolation("A mobile phone was detected. Put it away before continuing", false, {
          eventType: "mobile_phone_detected",
          severity: "critical",
          details: { confidence: Number(detail.confidence || 0), object_label: String(detail.object_label || "cell phone") },
        });
      }
    };
    const handleProctorMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const detail = event.data?.type === "valases:proctor-signal" ? event.data.detail : null;
      if (detail) handleProctorSignal(new CustomEvent("valases:proctor-signal", { detail }));
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
    window.addEventListener("valases:proctor-signal", handleProctorSignal);
    window.addEventListener("message", handleProctorMessage);

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
      window.removeEventListener("valases:proctor-signal", handleProctorSignal);
      window.removeEventListener("message", handleProctorMessage);
    };
  }, [active, confirmExit, exitWarning, requestFullscreen]);

  return {
    confirmExit,
    fullscreenRequired,
    requestFullscreen,
    escapeWarningVisible,
    keepAssessmentOpen,
    endAssessmentFromEscape,
    warningCount,
    lastWarning,
  };
}
