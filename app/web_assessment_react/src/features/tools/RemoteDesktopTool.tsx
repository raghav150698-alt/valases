import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

type RemoteDesktopToolProps = {
  title?: string;
  description?: string;
  desktopPath?: string;
  assessmentMode?: boolean;
  candidateToken?: string;
  heartbeatSeconds?: number;
  onSessionChange?: (session: { sessionId: string; status: string; ready: boolean }) => void;
};

type DesktopSessionResponse = {
  session_id?: string;
  display_name?: string;
  status: string;
  status_detail?: string | null;
  launch_url?: string | null;
};

function desktopToolUrl(desktopPath: string) {
  const path = desktopPath.startsWith("/") ? desktopPath : `/${desktopPath}`;
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return isLocalHost ? `http://127.0.0.1:16080${path}` : "";
}

export function RemoteDesktopTool({
  title = "Desktop Tool Session",
  description = "Server-hosted desktop application streamed securely into the assessment workspace.",
  desktopPath = "/vnc.html?autoconnect=1&resize=remote&path=websockify",
  assessmentMode = false,
  candidateToken = "",
  heartbeatSeconds = 30,
  onSessionChange,
}: RemoteDesktopToolProps) {
  const [session, setSession] = useState<DesktopSessionResponse | null>(null);
  const [error, setError] = useState("");
  const startRequested = useRef(false);
  const localPreviewUrl = desktopToolUrl(desktopPath);
  const isCandidateSession = assessmentMode && Boolean(candidateToken);

  useEffect(() => {
    if (!isCandidateSession || startRequested.current) return;
    startRequested.current = true;
    let cancelled = false;
    const start = async () => {
      try {
        const response = await api.post<DesktopSessionResponse>(
          "/desktop-sessions/issued/start",
          {},
          { headers: { Authorization: `Bearer ${candidateToken}` } },
        );
        if (!cancelled) {
          setSession(response.data);
          setError("");
        }
      } catch (reason) {
        if (!cancelled) {
          const detail = (reason as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
          setError(typeof detail === "string" ? detail : "The desktop application could not be started.");
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [candidateToken, isCandidateSession]);

  useEffect(() => {
    const sessionId = session?.session_id || "";
    const ready = Boolean(sessionId && session?.status === "active" && session.launch_url);
    onSessionChange?.({ sessionId, status: session?.status || (error ? "failed" : "provisioning"), ready });
  }, [error, onSessionChange, session]);

  useEffect(() => {
    if (!isCandidateSession || !session?.session_id || !["active", "disconnected"].includes(session.status)) return;
    const interval = window.setInterval(async () => {
      try {
        const response = await api.post<DesktopSessionResponse>(
          "/desktop-sessions/issued/heartbeat",
          {},
          { headers: { Authorization: `Bearer ${candidateToken}` } },
        );
        setSession((current) => ({ ...current, ...response.data }));
      } catch {
        setSession((current) => current ? { ...current, status_detail: "Reconnecting to the application session..." } : current);
      }
    }, Math.max(10, Math.min(120, heartbeatSeconds)) * 1000);
    return () => window.clearInterval(interval);
  }, [candidateToken, heartbeatSeconds, isCandidateSession, session?.session_id, session?.status]);

  if (isCandidateSession) {
    if (error) {
      return (
        <section className="remote-tool-assessment remote-tool-unavailable" role="alert">
          <strong>Application unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </section>
      );
    }
    if (!session?.launch_url || session.status !== "active") {
      return (
        <section className="remote-tool-assessment remote-tool-provisioning" role="status">
          <span className="candidate-loading-spinner" aria-hidden="true" />
          <strong>Preparing {session?.display_name || title}</strong>
          <small>{session?.status_detail || "Creating your private application session and loading the assessment workspace..."}</small>
        </section>
      );
    }
    return (
      <section className="remote-tool-assessment remote-tool-live">
        <iframe
          className="remote-tool-frame"
          src={session.launch_url}
          title={session.display_name || title}
          allow="clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer"
        />
      </section>
    );
  }

  if (!localPreviewUrl) {
    return (
      <section className={`card remote-tool-shell${assessmentMode ? " remote-tool-assessment" : ""}`}>
        <div className="tool-header remote-tool-header"><div><h3>{title}</h3><p>{description}</p></div></div>
        <div className="remote-tool-notice">
          Desktop tool preview is limited to local test mode until a Windows session broker is configured.
        </div>
      </section>
    );
  }

  return (
    <section className={`card remote-tool-shell${assessmentMode ? " remote-tool-assessment" : ""}`}>
      <div className="tool-header remote-tool-header">
        <div><h3>{title}</h3><p>{description}</p></div>
        <div className="row"><a className="remote-tool-link" href={localPreviewUrl} target="_blank" rel="noreferrer">Open in new tab</a></div>
      </div>
      <div className="remote-tool-frame-wrap">
        <iframe className="remote-tool-frame" src={localPreviewUrl} title={title} allow="fullscreen" referrerPolicy="no-referrer" />
      </div>
    </section>
  );
}
