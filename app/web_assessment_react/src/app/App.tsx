import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AuthPanel } from "../features/auth/AuthPanel";
import { useAssessmentSession } from "../features/assessment/useAssessmentSession";
import { ProviderAssessments } from "../features/provider/ProviderAssessments";
import { IssuedCandidatePanel } from "../features/issued/IssuedCandidatePanel";
import { CodingEnv } from "../features/tools/CodingEnv";
import { ExcelSimulator } from "../features/tools/ExcelSimulator";
import { AccountingTool } from "../features/tools/AccountingTool";
import { TaxTool } from "../features/tools/TaxTool";
import { useSessionStore } from "../lib/sessionStore";

type View = "provider";

function exitServerTool() {
  try {
    window.close();
  } catch {
    // Browser may block closing a tab it did not open.
  }
  window.location.replace("about:blank");
}

function EmbeddedToolShell({
  children,
  onSubmitAssessment,
  sessionActive = true,
}: {
  children: ReactNode;
  onSubmitAssessment?: () => void;
  sessionActive?: boolean;
}) {
  const [policyWarning, setPolicyWarning] = useState<{ message: string; count: number } | null>(null);
  const { fullscreenRequired, requestFullscreen } = useAssessmentSession({
    active: sessionActive,
    exitWarning: "Leaving this assessment will end the session. Do you want to continue?",
    onExitConfirmed: exitServerTool,
    onPolicyWarning: (reason, count) => setPolicyWarning({ message: reason, count }),
    onPolicyTerminated: (reason, count) => {
      setPolicyWarning({ message: `Assessment closed: ${reason}`, count });
      window.setTimeout(() => {
        onSubmitAssessment?.();
        if (!onSubmitAssessment) exitServerTool();
      }, 900);
    },
  });

  return (
    <div className="embedded-shell assessment-kiosk-shell">
      {fullscreenRequired && (
        <div className="assessment-fullscreen-overlay">
          <strong>Assessment must stay in fullscreen</strong>
          <span>Return to fullscreen to continue the assessment.</span>
          <button type="button" onClick={() => void requestFullscreen()}>Resume Fullscreen</button>
        </div>
      )}
      {policyWarning && (
        <div className="assessment-policy-toast" role="alert">
          <strong>{policyWarning.count >= 5 ? "Assessment closed" : "Security warning"}</strong>
          <span>{policyWarning.message}. Warning {policyWarning.count} of 5.</span>
          <button type="button" onClick={() => setPolicyWarning(null)}>Dismiss</button>
        </div>
      )}
      {children}
      {onSubmitAssessment && (
        <div className="assessment-action-bar">
          <button className="assessment-primary-btn" type="button" onClick={onSubmitAssessment}>
            Submit Assessment
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [view] = useState<View>("provider");
  const role = useSessionStore((s) => s.role);
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embedded") === "1";
  const tool = String(params.get("tool") || "").trim().toLowerCase();
  const issuedAccessKey = String(params.get("issued_key") || "").trim();
  const recruiterAuthenticated = role === "provider" || role === "admin";
  const handleToolSubmit = useCallback(() => {
    if (!window.confirm("Submit this assessment? You will not be able to continue after submission.")) return;
    exitServerTool();
  }, []);
  const recruiterWorkspaceBody = useMemo(() => {
    if (recruiterAuthenticated) {
      return <ProviderAssessments />;
    }
    return null;
  }, [recruiterAuthenticated]);

  if (embedded && tool === "excel") {
    return (
      <EmbeddedToolShell onSubmitAssessment={handleToolSubmit}>
        <ExcelSimulator
          embedded
          title="Excel Assessment"
          description="Assessment workbook"
          instructions=""
          showTopbarActions={false}
          onSubmit={async () => {
            handleToolSubmit();
          }}
        />
      </EmbeddedToolShell>
    );
  }

  if (embedded && ["coding", "code", "vscode", "vs-code"].includes(tool)) {
    return (
      <EmbeddedToolShell onSubmitAssessment={handleToolSubmit}>
        <CodingEnv assessmentMode />
      </EmbeddedToolShell>
    );
  }

  if (embedded && ["gnucash", "accounting-desktop", "desktop-accounting"].includes(tool)) {
    return (
      <EmbeddedToolShell>
        <AccountingTool />
      </EmbeddedToolShell>
    );
  }

  if (embedded && ["tax", "tax-software", "tax-simulator", "drake"].includes(tool)) {
    return (
      <EmbeddedToolShell>
        <TaxTool />
      </EmbeddedToolShell>
    );
  }

  if (issuedAccessKey) {
    return (
      <div className="launch-shell">
        <div className="shell launch-content candidate-content">
          <IssuedCandidatePanel />
        </div>
      </div>
    );
  }

  if (!recruiterAuthenticated) {
    return (
      <div className="auth-page-shell">
        <header className="auth-page-topbar">
          <div className="auth-page-brand">
            <span className="auth-logo-mark" aria-hidden="true">C</span>
            <div>
              <strong>Certora</strong>
              <small>Assessment platform</small>
            </div>
          </div>
        </header>
        <main className="auth-page-main">
          <AuthPanel />
        </main>
      </div>
    );
  }

  return (
    <div className="workspace-page-shell">
      <div className="shell workspace-content">
        {view === "provider" && recruiterWorkspaceBody}
      </div>
    </div>
  );
}
