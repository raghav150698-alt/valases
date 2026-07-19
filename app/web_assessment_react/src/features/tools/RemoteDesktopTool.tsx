type RemoteDesktopToolProps = {
  title?: string;
  description?: string;
  desktopPath?: string;
  assessmentMode?: boolean;
};

function desktopToolUrl(desktopPath: string) {
  const path = desktopPath.startsWith("/") ? desktopPath : `/${desktopPath}`;
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalHost) {
    return `http://127.0.0.1:16080${path}`;
  }
  return "";
}

export function RemoteDesktopTool({
  title = "Desktop Tool Session",
  description = "Server-hosted desktop application streamed securely into the assessment workspace.",
  desktopPath = "/vnc.html?autoconnect=1&resize=remote&path=websockify",
  assessmentMode = false,
}: RemoteDesktopToolProps) {
  const src = desktopToolUrl(desktopPath);

  if (!src) {
    return (
      <section className={`card remote-tool-shell${assessmentMode ? " remote-tool-assessment" : ""}`}>
        <div className="tool-header remote-tool-header">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <div className="remote-tool-notice">
          Desktop tool preview is intentionally limited to local test mode for now. Start the local Docker desktop-tool
          service and open this assessment from the same machine to review it safely.
        </div>
      </section>
    );
  }

  return (
    <section className={`card remote-tool-shell${assessmentMode ? " remote-tool-assessment" : ""}`}>
      <div className="tool-header remote-tool-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="row">
          <a className="remote-tool-link" href={src} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
        </div>
      </div>
      <div className="remote-tool-frame-wrap">
        <iframe
          className="remote-tool-frame"
          src={src}
          title={title}
          allow="fullscreen"
          referrerPolicy="no-referrer"
        />
      </div>
    </section>
  );
}
