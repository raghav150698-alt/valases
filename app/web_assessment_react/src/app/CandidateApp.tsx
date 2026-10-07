import { IssuedCandidatePanel } from "../features/issued/IssuedCandidatePanel";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { CandidateOfferPanel } from "../features/offers/CandidateOfferPanel";
import { api } from "../lib/api";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const fragmentParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const issuedAccessKey = String(fragmentParams.get("issued_key") || params.get("issued_key") || "").trim();
  const offerKey = String(params.get("offer_key") || "").trim();
  const applicationOrganization = String(params.get("apply_org") || "").trim();
  const applicationJob = String(params.get("apply_job") || "").trim();

  if (offerKey) {
    return (
      <CandidatePortalFrame>
        <main className="candidate-content">
          <CandidateOfferPanel offerKey={offerKey} />
        </main>
      </CandidatePortalFrame>
    );
  }

  if (applicationOrganization && applicationJob) {
    return <CandidatePortalFrame><main className="candidate-content"><PublicApplicationForm organizationSlug={applicationOrganization} jobCode={applicationJob} /></main></CandidatePortalFrame>;
  }

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

type PublicJob = { organization: { name: string; logo_url?: string }; job: { job_code: string; title: string; department: string; location: string; employment_type: string; work_arrangement: string; description: string; responsibilities: string[]; requirements: string[]; skills: string[] } };

function PublicApplicationForm({ organizationSlug, jobCode }: { organizationSlug: string; jobCode: string }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone_number: "", location: "", headline: "", resume_text: "", consent_obtained: false });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState("");
  useEffect(() => {
    let active = true;
    api.get<PublicJob>(`/hiring/public/jobs/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(jobCode)}`)
      .then((response) => { if (active) setJob(response.data); })
      .catch((reason) => { if (active) setError((reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "This role is no longer available."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [jobCode, organizationSlug]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!job || submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await api.post<{ message: string }>(`/hiring/public/jobs/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(jobCode)}/applications`, form);
      setSubmitted(response.data.message);
    } catch (reason) {
      setError((reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "We could not submit your application. Please check the form and try again.");
    } finally { setSubmitting(false); }
  };
  if (loading) return <section className="public-application-card" role="status"><BrandLogo className="assessment-brand-logo" /><p>Loading role details...</p></section>;
  if (error && !job) return <section className="public-application-card" role="alert"><BrandLogo className="assessment-brand-logo" /><span className="launch-section-label">Application unavailable</span><h1>{error}</h1><p>Ask the organization for an updated application link.</p></section>;
  if (!job) return null;
  if (submitted) return <section className="public-application-card public-application-success" role="status"><div className="public-company-mark">{job.organization.logo_url ? <img src={job.organization.logo_url} alt="" /> : <span>{job.organization.name.slice(0, 1)}</span>}</div><span className="launch-section-label">Application received</span><h1>Thank you for applying</h1><p>{submitted}</p><small>Keep an eye on your inbox for any next steps from {job.organization.name}.</small></section>;
  return <div className="public-application-layout"><article className="public-job-card"><div className="public-company-mark">{job.organization.logo_url ? <img src={job.organization.logo_url} alt="" /> : <span>{job.organization.name.slice(0, 1)}</span>}</div><span className="launch-section-label">{job.organization.name}</span><h1>{job.job.title}</h1><p className="public-job-meta">{job.job.department} · {job.job.location} · {job.job.employment_type.replaceAll("_", " ")} · {job.job.work_arrangement}</p><p className="public-job-description">{job.job.description || "We are looking for a thoughtful, capable person to join our team."}</p>{job.job.responsibilities.length > 0 && <><h2>What you’ll do</h2><ul>{job.job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></>}{job.job.requirements.length > 0 && <><h2>What we’re looking for</h2><ul>{job.job.requirements.map((item) => <li key={item}>{item}</li>)}</ul></>}{job.job.skills.length > 0 && <div className="public-skill-list">{job.job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}</article><form className="public-application-form" onSubmit={submit}><div><span className="launch-section-label">Apply for this role</span><h2>Your application</h2><p>Share the information our hiring team needs to review your application.</p></div><div className="public-form-grid"><label>First name<input required value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label><label>Last name<input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label><label>Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Phone <span>(optional)</span><input type="tel" value={form.phone_number} onChange={(event) => setForm({ ...form, phone_number: event.target.value })} /></label></div><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="City, country or remote" /></label><label>Professional headline<input value={form.headline} onChange={(event) => setForm({ ...form, headline: event.target.value })} placeholder="Product designer, 6 years experience" /></label><label>Resume or relevant experience<textarea required rows={8} value={form.resume_text} onChange={(event) => setForm({ ...form, resume_text: event.target.value })} placeholder="Paste your resume or summarize the experience relevant to this role." /></label><label className="candidate-consent-check public-consent"><input type="checkbox" required checked={form.consent_obtained} onChange={(event) => setForm({ ...form, consent_obtained: event.target.checked })} /><span>I consent to {job.organization.name} processing this application for recruitment and contacting me about this role.</span></label>{error && <p className="candidate-login-status" role="alert">{error}</p>}<button className="assessment-primary-btn" type="submit" disabled={submitting}>{submitting ? "Submitting application..." : "Submit application"}</button><small>Read the privacy and data-retention links in the footer before submitting.</small></form></div>;
}

function CandidatePortalFrame({ children }: { children: ReactNode }) {
  const legalBase = `${import.meta.env.BASE_URL}legal`;
  return (
    <div className="candidate-portal-shell">
      <header className="candidate-portal-header">
        <a className="candidate-portal-brand" href="/" aria-label="Valases Assessments home"><BrandLogo className="candidate-header-logo" /></a>
        <span>Candidate portal</span>
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
