import { IssuedCandidatePanel } from "../features/issued/IssuedCandidatePanel";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const issuedAccessKey = String(params.get("issued_key") || "").trim();

  if (!issuedAccessKey) {
    return (
      <main className="assessment-thank-you candidate-portal-empty" role="main">
        <div className="assessment-thank-you-mark" aria-hidden="true">C</div>
        <span className="launch-section-label">Certora Assessments</span>
        <h1>Use your issued assessment link</h1>
        <p>This secure environment opens only from the unique link sent by your recruiter.</p>
        <small>Return to the invitation email and open the assessment link provided there.</small>
      </main>
    );
  }

  return (
    <div className="launch-shell candidate-only-shell">
      <main className="shell launch-content candidate-content">
        <IssuedCandidatePanel />
      </main>
    </div>
  );
}
