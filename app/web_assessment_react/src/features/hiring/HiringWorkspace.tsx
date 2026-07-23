import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { BrandLogo } from "../../components/BrandLogo";
import "./HiringWorkspace.css";

const ProviderAssessments = lazy(() => import("../provider/ProviderAssessments").then((module) => ({ default: module.ProviderAssessments })));

type Workspace = {
  organization: { id: number; name: string; slug: string; plan_code: string };
  membership_role: string;
  pipeline_stages: string[];
  metrics: { open_jobs: number; applications: number; scheduled_interviews: number };
  pipeline: Record<string, number>;
  recent_jobs: Job[];
};

type Job = {
  id: number;
  job_code: string;
  title: string;
  department: string;
  location: string;
  employment_type: string;
  work_arrangement: string;
  status: string;
  headcount: number;
  skills: string[];
  description: string;
  created_at: string;
};

type Candidate = {
  id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  headline: string;
  location: string;
  source: string;
  skills: string[];
  experience_years: number | null;
  consent_status: string;
};

type Application = {
  id: number;
  job_id: number;
  job_title: string;
  candidate: Candidate;
  stage: string;
  status: string;
  ai_match_score: number | null;
  ai_confidence: number | null;
  ai_recommendation: string | null;
  ai_rationale: { matched_skills?: string[]; missing_skills?: string[]; limitations?: string };
};

type Interview = {
  id: number;
  application_id: number;
  candidate_name: string;
  job_title: string;
  interview_type: string;
  status: string;
  scheduled_at: string | null;
  duration_minutes: number;
  meeting_url: string | null;
};

type Tab = "overview" | "jobs" | "candidates" | "pipeline" | "interviews" | "assessments" | "integrations";

const stageLabel = (stage: string) => stage.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase());
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

function apiError(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="hiring-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="hiring-modal">
        <header><h2>{title}</h2><button className="hiring-icon-button" type="button" aria-label="Close" onClick={onClose}>x</button></header>
        {children}
      </section>
    </div>
  );
}

export function HiringWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<"job" | "candidate" | "application" | "interview" | "integration" | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<{ provider: string; status: string; config: { external_account_name?: string; sync_scope?: string[] } } | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["hiring"] });

  const workspaceQuery = useQuery({ queryKey: ["hiring", "workspace"], queryFn: async () => (await api.get<Workspace>("/hiring/workspace")).data });
  const jobsQuery = useQuery({ queryKey: ["hiring", "jobs"], queryFn: async () => (await api.get<Job[]>("/hiring/jobs")).data });
  const candidatesQuery = useQuery({ queryKey: ["hiring", "candidates"], queryFn: async () => (await api.get<Candidate[]>("/hiring/candidates")).data });
  const applicationsQuery = useQuery({ queryKey: ["hiring", "applications"], queryFn: async () => (await api.get<Application[]>("/hiring/applications")).data });
  const interviewsQuery = useQuery({ queryKey: ["hiring", "interviews"], queryFn: async () => (await api.get<Interview[]>("/hiring/interviews")).data });
  const integrationsQuery = useQuery({ queryKey: ["hiring", "integrations"], queryFn: async () => (await api.get<Array<{ provider: string; status: string; config: { external_account_name?: string; sync_scope?: string[] } }>>("/hiring/integrations")).data });

  const jobs = jobsQuery.data || [];
  const candidates = candidatesQuery.data || [];
  const applications = applicationsQuery.data || [];
  const interviews = interviewsQuery.data || [];
  const workspace = workspaceQuery.data;
  const pipelineStages = workspace?.pipeline_stages || ["applied", "screening", "assessment", "interview", "offer", "hired"];
  const activeJobs = jobs.filter((job) => job.status === "open");
  const busy = workspaceQuery.isLoading || jobsQuery.isLoading || candidatesQuery.isLoading || applicationsQuery.isLoading;

  const screenMutation = useMutation({
    mutationFn: async (applicationId: number) => (await api.post(`/hiring/applications/${applicationId}/screen`)).data,
    onSuccess: (data) => { setNotice(`Screening complete: ${data.match_score}% evidence match. Human review is still required.`); refresh(); },
    onError: (error) => setNotice(apiError(error, "Could not screen this application.")),
  });
  const stageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: string }) => api.patch(`/hiring/applications/${id}/stage`, { stage, reason: "Updated from the hiring workspace" }),
    onSuccess: () => { setNotice("Candidate stage updated."); refresh(); },
    onError: (error) => setNotice(apiError(error, "Could not update the stage.")),
  });
  const complianceMutation = useMutation({
    mutationFn: async (applicationId: number) => (await api.post(`/hiring/applications/${applicationId}/compliance/run`)).data,
    onSuccess: (data) => { setNotice(`${data.checks.length} compliance checks refreshed. Review any item that is not passed.`); refresh(); },
    onError: (error) => setNotice(apiError(error, "Could not run compliance checks.")),
  });

  const selectedDetails = useMemo(() => applications.find((item) => item.id === selectedApplication?.id) || selectedApplication, [applications, selectedApplication]);

  if (busy && !workspace) {
    return <main className="hiring-loading" role="status"><BrandLogo /><p>Opening hiring workspace...</p></main>;
  }

  return (
    <div className="hiring-shell">
      <aside className="hiring-sidebar">
        <div className="hiring-brand"><BrandLogo className="hiring-brand-logo" /><span>Valases</span></div>
        <div className="hiring-org-switch"><small>Organization</small><strong>{workspace?.organization.name || "Your organization"}</strong><span>{workspace?.membership_role.replace(/_/g, " ") || "Recruiter"}</span></div>
        <nav aria-label="Hiring navigation">
          {([
            ["overview", "Overview"], ["jobs", "Jobs"], ["candidates", "Candidates"], ["pipeline", "Pipeline"], ["interviews", "Interviews"], ["assessments", "Assessments"], ["integrations", "Integrations"],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button type="button" className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="hiring-sidebar-foot">Hiring operations<br /><span>Human review stays in control</span></div>
      </aside>

      <main className="hiring-main">
        <header className="hiring-topbar">
          <div><p>{tab === "overview" ? "Hiring command center" : stageLabel(tab)}</p><h1>{tab === "overview" ? "Build a stronger hiring signal" : stageLabel(tab)}</h1></div>
          <div className="hiring-topbar-actions">
            <button type="button" className="hiring-button secondary" onClick={() => setDialog("candidate")}>Add candidate</button>
            <button type="button" className="hiring-button primary" onClick={() => setDialog("job")}>New job</button>
          </div>
        </header>

        {notice && <div className="hiring-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}

        {tab === "overview" && <Overview workspace={workspace} jobs={jobs} applications={applications} interviews={interviews} onTab={setTab} onNewJob={() => setDialog("job")} onNewApplication={() => setDialog("application")} />}
        {tab === "jobs" && <JobsView jobs={jobs} applications={applications} onNewJob={() => setDialog("job")} onCreateApplication={() => setDialog("application")} />}
        {tab === "candidates" && <CandidatesView candidates={candidates} applications={applications} onNewCandidate={() => setDialog("candidate")} onCreateApplication={() => setDialog("application")} />}
        {tab === "pipeline" && <PipelineView stages={pipelineStages} applications={applications} onSelect={setSelectedApplication} onMove={(id, stage) => stageMutation.mutate({ id, stage })} />}
        {tab === "interviews" && <InterviewsView interviews={interviews} applications={applications} onSchedule={() => setDialog("interview")} />}
        {tab === "assessments" && <Suspense fallback={<div className="hiring-section-empty">Loading assessment workspace...</div>}><ProviderAssessments /></Suspense>}
        {tab === "integrations" && <IntegrationsView integrations={integrationsQuery.data || []} onConfigure={(integration) => { setSelectedIntegration(integration); setDialog("integration"); }} />}
      </main>

      {selectedDetails && <ApplicationDrawer application={selectedDetails} stages={pipelineStages} onClose={() => setSelectedApplication(null)} onScreen={() => screenMutation.mutate(selectedDetails.id)} onCompliance={() => complianceMutation.mutate(selectedDetails.id)} onMove={(stage) => stageMutation.mutate({ id: selectedDetails.id, stage })} />}
      {dialog === "job" && <JobForm onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Job requisition created as a draft."); refresh(); setTab("jobs"); }} />}
      {dialog === "candidate" && <CandidateForm onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Candidate added to your organization."); refresh(); setTab("candidates"); }} />}
      {dialog === "application" && <ApplicationForm jobs={activeJobs.length ? activeJobs : jobs} candidates={candidates} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Application added to the pipeline."); refresh(); setTab("pipeline"); }} />}
      {dialog === "interview" && <InterviewForm applications={applications} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Interview scheduled and the candidate moved to interview stage."); refresh(); setTab("interviews"); }} />}
      {dialog === "integration" && selectedIntegration && <IntegrationForm integration={selectedIntegration} onClose={() => { setDialog(null); setSelectedIntegration(null); }} onSaved={() => { setDialog(null); setSelectedIntegration(null); setNotice("Integration record updated. Connect credentials only through the approved OAuth or secret-management flow."); refresh(); }} />}
    </div>
  );
}

function Overview({ workspace, jobs, applications, interviews, onTab, onNewJob, onNewApplication }: { workspace?: Workspace; jobs: Job[]; applications: Application[]; interviews: Interview[]; onTab: (tab: Tab) => void; onNewJob: () => void; onNewApplication: () => void }) {
  const metrics = workspace?.metrics || { open_jobs: 0, applications: 0, scheduled_interviews: 0 };
  return <>
    <section className="hiring-metrics-grid">
      <Metric label="Open roles" value={metrics.open_jobs} note="Roles currently accepting candidates" action="View jobs" onClick={() => onTab("jobs")} />
      <Metric label="Active candidates" value={metrics.applications} note="Applications across your pipeline" action="Open pipeline" onClick={() => onTab("pipeline")} />
      <Metric label="Scheduled interviews" value={metrics.scheduled_interviews} note="Structured conversations ahead" action="View calendar" onClick={() => onTab("interviews")} />
      <Metric label="Review coverage" value={`${applications.filter((item) => item.ai_match_score !== null).length}/${applications.length || 0}`} note="Evidence-aided screens completed" action="Review signals" onClick={() => onTab("pipeline")} />
    </section>
    <section className="hiring-overview-grid">
      <div className="hiring-panel hiring-pipeline-snapshot"><div className="hiring-panel-header"><div><h2>Pipeline health</h2><p>Move candidates with evidence, not just momentum.</p></div><button type="button" onClick={() => onTab("pipeline")}>Open pipeline</button></div><div className="hiring-stage-summary">{(workspace?.pipeline_stages || []).slice(0, 6).map((stage) => <div key={stage}><span>{stageLabel(stage)}</span><strong>{workspace?.pipeline?.[stage] || 0}</strong></div>)}</div></div>
      <div className="hiring-panel hiring-upcoming"><div className="hiring-panel-header"><div><h2>Upcoming interviews</h2><p>Structured scorecards keep decisions comparable.</p></div><button type="button" onClick={() => onTab("interviews")}>View all</button></div>{interviews.slice(0, 3).map((interview) => <div className="hiring-upcoming-row" key={interview.id}><span>{interview.scheduled_at ? new Date(interview.scheduled_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Unscheduled"}</span><div><strong>{interview.candidate_name}</strong><small>{interview.job_title} · {stageLabel(interview.interview_type)}</small></div></div>)}{!interviews.length && <Empty text="No interviews scheduled yet." />}</div>
    </section>
    <section className="hiring-panel"><div className="hiring-panel-header"><div><h2>Active requisitions</h2><p>Start from a well-defined role, then attach assessments and interview plans.</p></div><button type="button" onClick={onNewJob}>New job</button></div>{jobs.length ? <div className="hiring-table"><div className="hiring-table-head"><span>Role</span><span>Department</span><span>Status</span><span>Candidates</span><span></span></div>{jobs.slice(0, 5).map((job) => <div className="hiring-table-row" key={job.id}><div><strong>{job.title}</strong><small>{job.job_code} · {job.location}</small></div><span>{job.department}</span><span><StatusPill status={job.status} /></span><span>{applications.filter((application) => application.job_id === job.id).length}</span><button type="button" onClick={onNewApplication}>Add candidate</button></div>)}</div> : <Empty text="Create your first role to start building a structured hiring process." action="Create job" onClick={onNewJob} />}</section>
  </>;
}

function Metric({ label, value, note, action, onClick }: { label: string; value: string | number; note: string; action: string; onClick: () => void }) { return <div className="hiring-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small><button type="button" onClick={onClick}>{action}</button></div>; }
function StatusPill({ status }: { status: string }) { return <span className={`hiring-status ${status}`}>{stageLabel(status)}</span>; }
function Empty({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) { return <div className="hiring-section-empty"><p>{text}</p>{action && <button type="button" className="hiring-button primary" onClick={onClick}>{action}</button>}</div>; }

function JobsView({ jobs, applications, onNewJob, onCreateApplication }: { jobs: Job[]; applications: Application[]; onNewJob: () => void; onCreateApplication: () => void }) { return <section className="hiring-panel hiring-full-panel"><div className="hiring-panel-header"><div><h2>Requisitions</h2><p>Every hiring workflow starts with an owned, structured job definition.</p></div><button type="button" className="hiring-button primary" onClick={onNewJob}>New job</button></div>{jobs.length ? <div className="hiring-table"><div className="hiring-table-head jobs"><span>Role</span><span>Work setup</span><span>Skills</span><span>Pipeline</span><span>Status</span><span></span></div>{jobs.map((job) => <div className="hiring-table-row jobs" key={job.id}><div><strong>{job.title}</strong><small>{job.job_code} · {job.department}</small></div><div><strong>{job.location}</strong><small>{stageLabel(job.work_arrangement)}</small></div><div className="hiring-skills">{job.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}{job.skills.length > 3 && <span>+{job.skills.length - 3}</span>}</div><span>{applications.filter((item) => item.job_id === job.id).length} candidates</span><StatusPill status={job.status} /><button type="button" onClick={onCreateApplication}>Add candidate</button></div>)}</div> : <Empty text="No jobs created yet." action="Create job" onClick={onNewJob} />}</section>; }

function CandidatesView({ candidates, applications, onNewCandidate, onCreateApplication }: { candidates: Candidate[]; applications: Application[]; onNewCandidate: () => void; onCreateApplication: () => void }) { return <section className="hiring-panel hiring-full-panel"><div className="hiring-panel-header"><div><h2>Candidate directory</h2><p>Keep candidate information, consent and skills visible to the hiring team.</p></div><button type="button" className="hiring-button primary" onClick={onNewCandidate}>Add candidate</button></div>{candidates.length ? <div className="hiring-table"><div className="hiring-table-head candidates"><span>Candidate</span><span>Skills</span><span>Experience</span><span>Consent</span><span>Applications</span><span></span></div>{candidates.map((candidate) => <div className="hiring-table-row candidates" key={candidate.id}><div><strong>{candidate.full_name}</strong><small>{candidate.headline || candidate.email}</small></div><div className="hiring-skills">{candidate.skills.length ? candidate.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>) : <small>No skills added</small>}</div><span>{candidate.experience_years ?? "-"}{candidate.experience_years !== null ? " yrs" : ""}</span><StatusPill status={candidate.consent_status} /><span>{applications.filter((application) => application.candidate.id === candidate.id).length}</span><button type="button" onClick={onCreateApplication}>Add to role</button></div>)}</div> : <Empty text="Add candidates manually or through an ATS connection." action="Add candidate" onClick={onNewCandidate} />}</section>; }

function PipelineView({ stages, applications, onSelect, onMove }: { stages: string[]; applications: Application[]; onSelect: (application: Application) => void; onMove: (id: number, stage: string) => void }) { return <section className="hiring-pipeline-board">{stages.slice(0, 6).map((stage) => <div className="hiring-pipeline-column" key={stage}><header><span>{stageLabel(stage)}</span><strong>{applications.filter((item) => item.stage === stage).length}</strong></header><div>{applications.filter((item) => item.stage === stage).map((application) => <article className="hiring-application-card" key={application.id} onClick={() => onSelect(application)}><strong>{application.candidate.full_name}</strong><span>{application.job_title}</span><div><em>{application.ai_match_score !== null ? `${application.ai_match_score}% match` : "Not screened"}</em>{stage !== "interview" && stage !== "offer" && <button type="button" onClick={(event) => { event.stopPropagation(); onMove(application.id, stage === "applied" ? "screening" : "interview"); }}>Move</button>}</div></article>)}</div></div>)}</section>; }

function InterviewsView({ interviews, applications, onSchedule }: { interviews: Interview[]; applications: Application[]; onSchedule: () => void }) { return <section className="hiring-panel hiring-full-panel"><div className="hiring-panel-header"><div><h2>Interview plan</h2><p>Schedule structured conversations and collect comparable evidence.</p></div><button type="button" className="hiring-button primary" disabled={!applications.length} onClick={onSchedule}>Schedule interview</button></div>{interviews.length ? <div className="hiring-table"><div className="hiring-table-head interviews"><span>When</span><span>Candidate</span><span>Role</span><span>Format</span><span>Status</span></div>{interviews.map((interview) => <div className="hiring-table-row interviews" key={interview.id}><span>{interview.scheduled_at ? new Date(interview.scheduled_at).toLocaleString() : "Needs scheduling"}</span><strong>{interview.candidate_name}</strong><span>{interview.job_title}</span><span>{stageLabel(interview.interview_type)} · {interview.duration_minutes} min</span><StatusPill status={interview.status} /></div>)}</div> : <Empty text="No interviews scheduled. Move a candidate into the pipeline, then schedule a structured interview." action={applications.length ? "Schedule interview" : undefined} onClick={onSchedule} />}</section>; }

function IntegrationsView({ integrations, onConfigure }: { integrations: Array<{ provider: string; status: string; config: { external_account_name?: string; sync_scope?: string[] } }>; onConfigure: (integration: { provider: string; status: string; config: { external_account_name?: string; sync_scope?: string[] } }) => void }) { return <section className="hiring-panel hiring-full-panel"><div className="hiring-panel-header"><div><h2>Integration center</h2><p>Record approved connection scope here. Credentials remain in the provider OAuth flow or your deployment secret manager.</p></div></div><div className="hiring-integration-grid">{integrations.map((integration) => <div className="hiring-integration-row" key={integration.provider}><div><strong>{stageLabel(integration.provider)}</strong><small>{integration.config.external_account_name || "Not configured"}</small></div><StatusPill status={integration.status} /><button type="button" onClick={() => onConfigure(integration)}>Configure</button></div>)}</div></section>; }

function ApplicationDrawer({ application, stages, onClose, onScreen, onCompliance, onMove }: { application: Application; stages: string[]; onClose: () => void; onScreen: () => void; onCompliance: () => void; onMove: (stage: string) => void }) { return <aside className="hiring-drawer"><header><div><small>{application.job_title}</small><h2>{application.candidate.full_name}</h2><span>{application.candidate.headline || application.candidate.email}</span></div><button type="button" className="hiring-icon-button" aria-label="Close candidate details" onClick={onClose}>x</button></header><section><h3>Screening signal</h3>{application.ai_match_score !== null ? <><strong className="hiring-score">{application.ai_match_score}%</strong><p>{application.ai_recommendation?.replace(/_/g, " ")}</p><div className="hiring-skill-detail"><span>Matched</span>{(application.ai_rationale.matched_skills || []).join(", ") || "No matched skills recorded"}</div><div className="hiring-skill-detail"><span>Still to verify</span>{(application.ai_rationale.missing_skills || []).join(", ") || "No gaps recorded"}</div></> : <p>No screening signal yet. Use it as a review aid, never a decision-maker.</p>}<button type="button" className="hiring-button secondary" onClick={onScreen}>Run evidence screen</button></section><section><h3>Pipeline stage</h3><select value={application.stage} onChange={(event) => onMove(event.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></section><section><h3>Compliance</h3><p>Consent, structured evidence and automated-decision guardrails are checked together.</p><button type="button" className="hiring-button secondary" onClick={onCompliance}>Run checks</button></section></aside>; }

function JobForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [form, setForm] = useState({ job_code: "", title: "", department: "", location: "Remote", skills: "", description: "" }); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const draft = async () => { if (!form.title) return; setLoading(true); try { const { data } = await api.post("/hiring/jobs/draft-description", { title: form.title, department: form.department || "General", location: form.location, skills: splitList(form.skills) }); setForm((current) => ({ ...current, description: data.description })); } catch (reason) { setError(apiError(reason, "Could not create the job draft.")); } finally { setLoading(false); } }; const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { await api.post("/hiring/jobs", { ...form, department: form.department || "General", skills: splitList(form.skills) }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not create the job.")); } finally { setLoading(false); } }; return <Modal title="New job requisition" onClose={onClose}><form className="hiring-form" onSubmit={submit}><div className="hiring-form-grid"><label>Job code<input required value={form.job_code} onChange={(event) => setForm({ ...form, job_code: event.target.value })} placeholder="FIN-104" /></label><label>Role title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Senior Accountant" /></label><label>Department<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="Finance" /></label><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label></div><label>Required skills<input value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} placeholder="GAAP, Excel, reconciliations" /></label><div className="hiring-description-label"><label>Job description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Write the role purpose, responsibilities and requirements." /></label><button type="button" className="hiring-button secondary" disabled={!form.title || loading} onClick={() => void draft()}>Draft description</button></div>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading}>{loading ? "Saving..." : "Create draft"}</button></footer></form></Modal>; }

function CandidateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [form, setForm] = useState({ first_name: "", last_name: "", email: "", headline: "", skills: "", experience_years: "", resume_text: "", consent_obtained: false }); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { await api.post("/hiring/candidates", { ...form, skills: splitList(form.skills), experience_years: form.experience_years ? Number(form.experience_years) : null }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not add the candidate.")); } finally { setLoading(false); } }; return <Modal title="Add candidate" onClose={onClose}><form className="hiring-form" onSubmit={submit}><div className="hiring-form-grid"><label>First name<input required value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label><label>Last name<input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Experience<input type="number" min="0" max="80" value={form.experience_years} onChange={(event) => setForm({ ...form, experience_years: event.target.value })} placeholder="Years" /></label></div><label>Headline<input value={form.headline} onChange={(event) => setForm({ ...form, headline: event.target.value })} placeholder="Accounting professional" /></label><label>Skills<input value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} placeholder="GAAP, Excel, forecasting" /></label><label>Resume text<textarea value={form.resume_text} onChange={(event) => setForm({ ...form, resume_text: event.target.value })} placeholder="Paste a resume or relevant work history for evidence-based screening." /></label><label className="hiring-checkbox"><input type="checkbox" checked={form.consent_obtained} onChange={(event) => setForm({ ...form, consent_obtained: event.target.checked })} />Candidate consent to process hiring data has been recorded</label>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading}>{loading ? "Saving..." : "Add candidate"}</button></footer></form></Modal>; }

function ApplicationForm({ jobs, candidates, onClose, onSaved }: { jobs: Job[]; candidates: Candidate[]; onClose: () => void; onSaved: () => void }) { const [jobId, setJobId] = useState(""); const [candidateId, setCandidateId] = useState(""); const [error, setError] = useState(""); const submit = async (event: React.FormEvent) => { event.preventDefault(); try { await api.post("/hiring/applications", { job_id: Number(jobId), candidate_id: Number(candidateId) }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not create the application.")); } }; return <Modal title="Add candidate to role" onClose={onClose}><form className="hiring-form" onSubmit={submit}>{jobs.length && candidates.length ? <><label>Job<select required value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Select job</option>{jobs.map((job) => <option value={job.id} key={job.id}>{job.title}</option>)}</select></label><label>Candidate<select required value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Select candidate</option>{candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.full_name}</option>)}</select></label></> : <p className="hiring-form-error">Create at least one job and one candidate first.</p>}{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={!jobs.length || !candidates.length}>Add to pipeline</button></footer></form></Modal>; }

function InterviewForm({ applications, onClose, onSaved }: { applications: Application[]; onClose: () => void; onSaved: () => void }) { const [applicationId, setApplicationId] = useState(""); const [scheduledAt, setScheduledAt] = useState(""); const [error, setError] = useState(""); const submit = async (event: React.FormEvent) => { event.preventDefault(); try { await api.post("/hiring/interviews", { application_id: Number(applicationId), interview_type: "structured", scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not schedule the interview.")); } }; return <Modal title="Schedule structured interview" onClose={onClose}><form className="hiring-form" onSubmit={submit}><label>Candidate<select required value={applicationId} onChange={(event) => setApplicationId(event.target.value)}><option value="">Select candidate</option>{applications.filter((application) => application.status === "active").map((application) => <option key={application.id} value={application.id}>{application.candidate.full_name} · {application.job_title}</option>)}</select></label><label>When<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label><p className="hiring-form-hint">Calendar and voice scheduling connectors can be enabled per organization after OAuth configuration.</p>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary">Schedule interview</button></footer></form></Modal>; }

function IntegrationForm({ integration, onClose, onSaved }: { integration: { provider: string; status: string; config: { external_account_name?: string; sync_scope?: string[] } }; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ status: integration.status, external_account_name: integration.config.external_account_name || "", sync_scope: (integration.config.sync_scope || []).join(", ") });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.put("/hiring/integrations", { provider: integration.provider, status: form.status, external_account_name: form.external_account_name, sync_scope: splitList(form.sync_scope) });
      onSaved();
    } catch (reason) {
      setError(apiError(reason, "Could not update the integration record."));
    } finally {
      setLoading(false);
    }
  };
  return <Modal title={`${stageLabel(integration.provider)} connection`} onClose={onClose}><form className="hiring-form" onSubmit={submit}><p className="hiring-form-hint">Record the approved account and data scope. Do not paste API keys, passwords, or OAuth tokens here.</p><label>Connection status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="not_connected">Not connected</option><option value="ready_to_connect">Ready to connect</option><option value="connected">Connected</option><option value="paused">Paused</option></select></label><label>Approved account<input value={form.external_account_name} onChange={(event) => setForm({ ...form, external_account_name: event.target.value })} placeholder="Recruiting workspace" /></label><label>Sync scope<input value={form.sync_scope} onChange={(event) => setForm({ ...form, sync_scope: event.target.value })} placeholder="candidates, jobs, interview feedback" /></label>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading}>{loading ? "Saving..." : "Save connection"}</button></footer></form></Modal>;
}

export default HiringWorkspace;
