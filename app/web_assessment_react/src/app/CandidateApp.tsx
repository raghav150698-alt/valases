import { IssuedCandidatePanel } from "../features/issued/IssuedCandidatePanel";
import type { ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const issuedAccessKey = String(params.get("issued_key") || "").trim();

  if (!issuedAccessKey) {
    return (
      <CandidatePortalFrame>
        <main className="assessment-thank-you candidate-portal-empty" role="main">
          <BrandLogo className="assessment-brand-logo" />
          <h1>Open your invitation link</h1>
          <p>Your assessment link is included in the invitation email.</p>
          <small>Contact the organization that invited you if the link has expired.</small>
        </main>
      </CandidatePortalFrame>
    );
  }

  return (
    <CandidatePortalFrame>
      <main className="candidate-content">
        <IssuedCandidatePanel />
      </main>
    </CandidatePortalFrame>
  );
}

function CandidatePortalFrame({ children }: { children: ReactNode }) {
  const legalBase = `${import.meta.env.BASE_URL}legal`;
  return (
    <div className="candidate-portal-shell">
      <header className="candidate-portal-header">
        <a className="candidate-portal-brand" href="/" aria-label="Valases Assessments home"><BrandLogo className="candidate-header-logo" /><strong>Valases</strong></a>
        <span>Candidate assessments</span>
      </header>
      {children}
      <footer className="candidate-portal-footer">
        <span>Valases Assessments</span>
        <nav aria-label="Legal information">
          <a href={`${legalBase}/privacy-policy.html`}>Privacy</a>
          <a href={`${legalBase}/candidate-consent.html`}>Consent</a>
          <a href={`${legalBase}/data-retention-and-deletion.html`}>Data retention</a>
        </nav>
      </footer>
    </div>
  );
}
