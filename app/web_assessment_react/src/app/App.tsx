import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { AuthPanel } from "../features/auth/AuthPanel";
import { AdminConsole } from "../features/admin/AdminConsole";
import { useAssessmentSession } from "../features/assessment/useAssessmentSession";
import { HiringWorkspace } from "../features/hiring/HiringWorkspace";
import { ExcelSimulator } from "../features/tools/ExcelSimulator";
import { AccountingTool } from "../features/tools/AccountingTool";
import { TaxTool } from "../features/tools/TaxTool";
import { api } from "../lib/api";
import { useSessionStore } from "../lib/sessionStore";

const CodingEnv = lazy(() => import("../features/tools/CodingEnv"));

type View = "provider";

function CandidatePortalRedirect({ accessKey }: { accessKey: string }) {
  const candidateBaseUrl = String(import.meta.env.VITE_CANDIDATE_APP_URL || "").trim().replace(/\/$/, "");
  const candidateUrl = candidateBaseUrl ? `${candidateBaseUrl}/?issued_key=${encodeURIComponent(accessKey)}` : "";

  useEffect(() => {
    if (candidateUrl) window.location.replace(candidateUrl);
  }, [candidateUrl]);

  return (
    <main className="assessment-thank-you" role="status">
      <BrandLogo className="assessment-brand-logo" />
      <span className="launch-section-label">Candidate assessment</span>
      <h1>{candidateUrl ? "Opening secure assessment" : "Candidate portal required"}</h1>
      <p>{candidateUrl ? "You are being redirected to the isolated candidate environment." : "Ask the recruiter for a newly issued candidate link."}</p>
      {candidateUrl && <a className="assessment-primary-btn" href={candidateUrl}>Continue</a>}
    </main>
  );
}

function AssessmentThankYou({ reason = "submitted" }: { reason?: "submitted" | "fullscreen" | "policy" }) {
  const ended = reason !== "submitted";
  const message = reason === "fullscreen"
    ? "The session ended because fullscreen was exited. Your work and integrity events were sent for review."
    : reason === "policy"
      ? "The session ended after the assessment integrity warning limit was reached. Your work was sent for review."
      : "Your work was submitted successfully.";
  return (
    <main className="assessment-thank-you" role="status">
      <BrandLogo className="assessment-brand-logo" />
      <span className="launch-section-label">Valases Assessments</span>
      <h1>{ended ? "Assessment ended" : "Assessment submitted"}</h1>
      <p>{message}</p>
      <strong>Thank you for your time.</strong>
      <small>You may now close this browser tab.</small>
    </main>
  );
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
  const [ended, setEnded] = useState<{ reason: "submitted" | "fullscreen" | "policy" } | null>(null);
  useEffect(() => {
    const handleCompleted = () => setEnded({ reason: "submitted" });
    window.addEventListener("valases:assessment-completed", handleCompleted);
    return () => window.removeEventListener("valases:assessment-completed", handleCompleted);
  }, []);
  const { fullscreenRequired, requestFullscreen, escapeWarningVisible, keepAssessmentOpen, endAssessmentFromEscape } = useAssessmentSession({
    active: sessionActive,
    exitWarning: "Leaving this assessment will end the session. Do you want to continue?",
    onExitConfirmed: () => setEnded({ reason: "fullscreen" }),
    onFullscreenExited: () => setEnded({ reason: "fullscreen" }),
    onPolicyWarning: (reason, count) => setPolicyWarning({ message: reason, count }),
    onPolicyTerminated: (reason, count) => {
      setPolicyWarning({ message: `Assessment closed: ${reason}`, count });
      window.setTimeout(() => {
        setEnded({ reason: "policy" });
      }, 900);
    },
  });

  if (ended) return <AssessmentThankYou reason={ended.reason} />;

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
        <div className="assessment-blocking-backdrop" role="alertdialog" aria-modal="true">
          <div className={`assessment-warning-dialog${policyWarning.count >= 5 ? " critical" : ""}`}>
            <h2>{policyWarning.count >= 5 ? "Assessment closed" : "Please return your attention to the assessment"}</h2>
            <p>{policyWarning.message}. Warning {policyWarning.count} of 5.</p>
            {policyWarning.count < 5 && <button type="button" onClick={() => setPolicyWarning(null)}>Continue Assessment</button>}
          </div>
        </div>
      )}
      {escapeWarningVisible && (
        <div className="assessment-blocking-backdrop" role="alertdialog" aria-modal="true">
          <div className="assessment-warning-dialog critical">
            <h2>Leaving fullscreen will end this assessment</h2>
            <p>Your current work will be submitted and the session will close.</p>
            <div className="assessment-dialog-actions">
              <button type="button" className="secondary-btn" onClick={keepAssessmentOpen}>Keep Assessment Open</button>
              <button type="button" className="assessment-exit-btn" onClick={endAssessmentFromEscape}>End Assessment</button>
            </div>
          </div>
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
  const token = useSessionStore((s) => s.token);
  const role = useSessionStore((s) => s.role);
  const setSession = useSessionStore((s) => s.setSession);
  const [sessionResolved, setSessionResolved] = useState(!token);
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embedded") === "1";
  const tool = String(params.get("tool") || "").trim().toLowerCase();
  const issuedAccessKey = String(params.get("issued_key") || "").trim();
  const recruiterAuthenticated = role === "provider";
  const handleToolSubmit = useCallback(() => {
    if (!window.confirm("Submit this assessment? You will not be able to continue after submission.")) return;
    window.dispatchEvent(new CustomEvent("valases:assessment-completed"));
  }, []);
  const recruiterWorkspaceBody = useMemo(() => {
    if (recruiterAuthenticated) {
      return <HiringWorkspace />;
    }
    return null;
  }, [recruiterAuthenticated]);

  useEffect(() => {
    if (!token) {
      setSessionResolved(true);
      return;
    }

    let active = true;
    setSessionResolved(false);
    void api.get("/auth/me/context", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => {
      if (!active) return;
      const resolvedRole = String(response.data?.role || "").trim().toLowerCase();
      if (resolvedRole === "admin" || resolvedRole === "provider" || resolvedRole === "student") {
        setSession(token, resolvedRole);
      }
    }).catch(() => {
      // The API interceptor clears expired sessions. For transient failures,
      // retain the last known session so a reload can retry role resolution.
    }).finally(() => {
      if (active) setSessionResolved(true);
    });

    return () => {
      active = false;
    };
  }, [setSession, token]);

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
        <Suspense fallback={<div className="tool-loading-state" role="status">Loading coding workspace...</div>}>
          <CodingEnv assessmentMode />
        </Suspense>
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
    return <CandidatePortalRedirect accessKey={issuedAccessKey} />;
  }

  if (token && !sessionResolved) {
    return (
      <main className="assessment-thank-you" role="status">
        <BrandLogo className="assessment-brand-logo" />
        <h1>Opening your workspace</h1>
        <p>Confirming your account access...</p>
      </main>
    );
  }

  if (role === "admin") {
    return <AdminConsole />;
  }

  if (!recruiterAuthenticated) {
    return (
      <div className="auth-page-shell">
        <header className="auth-page-topbar">
          <div className="auth-page-brand">
            <BrandLogo className="auth-brand-logo" />
            <div>
              <strong>Valases</strong>
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
