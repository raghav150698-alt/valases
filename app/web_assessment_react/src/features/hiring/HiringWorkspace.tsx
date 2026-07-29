import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Pause,
  Play,
  Plug,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { BrandLogo } from "../../components/BrandLogo";
import { useSessionStore } from "../../lib/sessionStore";
import { supabase } from "../../lib/supabase";
import { readCompanyLogo, readProfileImage } from "../../lib/imageFile";
import "./HiringWorkspace.css";

const ProviderAssessments = lazy(() => import("../provider/ProviderAssessments").then((module) => ({ default: module.ProviderAssessments })));

const defaultOrganizationLogo = `${import.meta.env.BASE_URL}assets/brand/valases-logo.png`;

function organizationLogoUrl(value?: string) {
  const logoUrl = String(value || "").trim();
  if (!logoUrl) return defaultOrganizationLogo;
  if (logoUrl.startsWith("/assets/")) {
    return `${import.meta.env.BASE_URL}${logoUrl.slice(1)}`;
  }
  return logoUrl;
}

type Workspace = {
  organization: { id: number; name: string; slug: string; plan_code: string; logo_url: string };
  current_user: { full_name: string; email: string; avatar_url: string };
  membership_role: string;
  permissions: string[];
  permission_catalog: string[];
  pipeline_stages: string[];
  metrics: { open_jobs: number; applications: number; scheduled_interviews: number };
  pipeline: Record<string, number>;
  recent_jobs: Job[];
};

type BillingOverview = {
  provider: "cashfree";
  provider_ready: boolean;
  checkout_mode: "sandbox" | "production";
  account: {
    plan_code: string;
    status: string;
    currency: string;
    monthly_amount_minor: number;
    billing_email: string | null;
    billing_phone: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    last_paid_at: string | null;
  };
  plans: Array<{
    code: string;
    name: string;
    monthly_amount_minor: number;
    currency: string;
    description: string;
  }>;
  orders: Array<{
    id: string;
    plan_code: string;
    description: string;
    amount_minor: number;
    currency: string;
    status: string;
    receipt_number: string | null;
    paid_at: string | null;
    created_at: string;
  }>;
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
  ranking: {
    average_score: number;
    skills_score: number;
    experience_score: number;
    assessment_score: number | null;
    matched_skills: number;
    required_skills: number;
  };
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

type ApplicationDetail = {
  id: number;
  stage: string;
  status: string;
  human_decision: string | null;
  candidate: Candidate;
  job: Job;
  screening: {
    match_score: number | null;
    confidence: number | null;
    recommendation: string | null;
    rationale: { matched_skills?: string[]; missing_skills?: string[]; limitations?: string };
  };
  evidence_summary: {
    status: "ready_for_human_decision" | "more_evidence_required";
    human_review_required: boolean;
    screening_complete: boolean;
    scorecard_count: number;
    interview_average: number | null;
    compliance_complete: boolean;
    blocking_checks: string[];
    message: string;
  };
  interviews: Array<Pick<Interview, "id" | "status" | "interview_type" | "scheduled_at" | "duration_minutes" | "meeting_url">>;
  scorecards: Array<{
    id: number;
    interview_id: number;
    recommendation: string;
    overall_score: number | null;
    competencies: Record<string, number>;
    evidence: string;
    submitted_at: string | null;
  }>;
  compliance_checks: Array<{ check_type: string; status: string; details: Record<string, unknown> }>;
  stage_history: Array<{ id: number; from_stage: string | null; to_stage: string; reason: string; created_at: string }>;
};

type Integration = {
  provider: string;
  category: string;
  connection_mode: string;
  capabilities: string[];
  status: string;
  config: { external_account_name?: string; sync_scope?: string[] };
  connect_available: boolean;
  last_synced_at?: string | null;
};

type Member = {
  id: number;
  user_id: number;
  email: string;
  full_name: string;
  role: string;
  permissions: string[];
  status: string;
  is_current_user: boolean;
};

type Tab = "overview" | "jobs" | "candidates" | "pipeline" | "interviews" | "assessments" | "integrations" | "team" | "settings";

const stageLabel = (stage: string) => stage.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase());
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

function initials(value?: string) {
  return String(value || "User").split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
}

function apiError(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="hiring-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="hiring-modal">
        <header><h2>{title}</h2><button className="hiring-icon-button" type="button" aria-label="Close" onClick={onClose}><X size={17} /></button></header>
        {children}
      </section>
    </div>
  );
}

export function HiringWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<"job" | "candidate" | "application" | "interview" | "scorecard" | "integration" | "member" | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [selectedInterview, setSelectedInterview] = useState<Interview | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [notice, setNotice] = useState("");
  const [stageError, setStageError] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const clearSession = useSessionStore((state) => state.clear);
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["hiring"] });

  const workspaceQuery = useQuery({ queryKey: ["hiring", "workspace"], queryFn: async () => (await api.get<Workspace>("/hiring/workspace")).data });
  const permissions = new Set(workspaceQuery.data?.permissions || []);
  const can = (permission: string) => permissions.has(permission);
  const jobsQuery = useQuery({ queryKey: ["hiring", "jobs"], queryFn: async () => (await api.get<Job[]>("/hiring/jobs")).data, enabled: can("jobs.view") });
  const candidatesQuery = useQuery({ queryKey: ["hiring", "candidates"], queryFn: async () => (await api.get<Candidate[]>("/hiring/candidates")).data, enabled: can("candidates.view") });
  const applicationsQuery = useQuery({ queryKey: ["hiring", "applications"], queryFn: async () => (await api.get<Application[]>("/hiring/applications")).data, enabled: can("pipeline.view") });
  const interviewsQuery = useQuery({ queryKey: ["hiring", "interviews"], queryFn: async () => (await api.get<Interview[]>("/hiring/interviews")).data, enabled: can("interviews.view") });
  const integrationsQuery = useQuery({ queryKey: ["hiring", "integrations"], queryFn: async () => (await api.get<Integration[]>("/hiring/integrations")).data, enabled: can("integrations.view") });
  const membersQuery = useQuery({ queryKey: ["hiring", "members"], queryFn: async () => (await api.get<Member[]>("/hiring/members")).data, enabled: can("members.manage") });
  const applicationDetailQuery = useQuery({
    queryKey: ["hiring", "application-detail", selectedApplication?.id],
    queryFn: async () => (await api.get<ApplicationDetail>(`/hiring/applications/${selectedApplication?.id}`)).data,
    enabled: Boolean(selectedApplication?.id),
  });

  const jobs = jobsQuery.data || [];
  const candidates = candidatesQuery.data || [];
  const applications = applicationsQuery.data || [];
  const interviews = interviewsQuery.data || [];
  const workspace = workspaceQuery.data;
  const pipelineStages = workspace?.pipeline_stages || ["applied", "screening", "assessment", "interview", "offer", "hired"];
  const activeJobs = jobs.filter((job) => job.status === "open");
  const searchTerm = workspaceSearch.trim().toLowerCase();
  const filteredJobs = searchTerm ? jobs.filter((job) => `${job.title} ${job.job_code} ${job.department} ${job.location} ${job.skills.join(" ")}`.toLowerCase().includes(searchTerm)) : jobs;
  const filteredCandidates = searchTerm ? candidates.filter((candidate) => `${candidate.full_name} ${candidate.email} ${candidate.headline} ${candidate.skills.join(" ")}`.toLowerCase().includes(searchTerm)) : candidates;
  const filteredApplications = searchTerm ? applications.filter((application) => `${application.candidate.full_name} ${application.candidate.email} ${application.job_title} ${application.stage}`.toLowerCase().includes(searchTerm)) : applications;
  const filteredInterviews = searchTerm ? interviews.filter((interview) => `${interview.candidate_name} ${interview.job_title} ${interview.interview_type} ${interview.status}`.toLowerCase().includes(searchTerm)) : interviews;
  const filteredIntegrations = searchTerm ? (integrationsQuery.data || []).filter((integration) => `${integration.provider} ${integration.category} ${integration.status} ${integration.capabilities.join(" ")}`.toLowerCase().includes(searchTerm)) : (integrationsQuery.data || []);
  const busy = workspaceQuery.isLoading;

  const screenMutation = useMutation({
    mutationFn: async (applicationId: number) => (await api.post(`/hiring/applications/${applicationId}/screen`)).data,
    onSuccess: (data) => { setNotice(`Screening complete: ${data.match_score}% evidence match.`); refresh(); },
    onError: (error) => setNotice(apiError(error, "Could not screen this application.")),
  });
  const stageMutation = useMutation({
    mutationFn: async ({ id, stage, reason = "Progressed by the recruiter from the hiring workspace" }: { id: number; stage: string; reason?: string }) => api.patch(`/hiring/applications/${id}/stage`, { stage, reason }),
    onMutate: async ({ id, stage }) => {
      setStageError("");
      await queryClient.cancelQueries({ queryKey: ["hiring", "applications"] });
      const previous = queryClient.getQueryData<Application[]>(["hiring", "applications"]);
      if (!["offer", "hired", "rejected", "withdrawn"].includes(stage)) {
        queryClient.setQueryData<Application[]>(["hiring", "applications"], (rows = []) =>
          rows.map((application) => application.id === id ? { ...application, stage } : application),
        );
      }
      return { previous };
    },
    onSuccess: (_data, variables) => {
      setStageError("");
      setNotice(`Candidate moved to ${stageLabel(variables.stage)}.`);
      if (["offer", "hired", "rejected", "withdrawn"].includes(variables.stage)) setSelectedApplication(null);
      refresh();
      void applicationDetailQuery.refetch();
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["hiring", "applications"], context.previous);
      const message = apiError(error, "Could not update the stage.");
      setStageError(message);
      setNotice(message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["hiring", "applications"] }),
  });
  const jobStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => api.patch(`/hiring/jobs/${id}`, { status }),
    onSuccess: (_, variables) => { setNotice(`Job ${variables.status === "open" ? "published" : variables.status}.`); refresh(); },
    onError: (error) => setNotice(apiError(error, "Could not update the job status.")),
  });
  const complianceMutation = useMutation({
    mutationFn: async (applicationId: number) => (await api.post(`/hiring/applications/${applicationId}/compliance/run`)).data,
    onSuccess: (data) => { setNotice(`${data.checks.length} compliance checks refreshed. Review any item that is not passed.`); refresh(); },
    onError: (error) => setNotice(apiError(error, "Could not run compliance checks.")),
  });

  const selectedDetails = useMemo(() => applications.find((item) => item.id === selectedApplication?.id) || selectedApplication, [applications, selectedApplication]);
  const navigation = ([
    ["overview", "Overview", "pipeline.view", LayoutDashboard],
    ["jobs", "Jobs", "jobs.view", BriefcaseBusiness],
    ["candidates", "Candidates", "candidates.view", UserRound],
    ["pipeline", "Pipeline", "pipeline.view", Workflow],
    ["interviews", "Interviews", "interviews.view", CalendarDays],
    ["assessments", "Assessments", "assessments.view", ClipboardCheck],
    ["integrations", "Integrations", "integrations.view", Plug],
    ["team", "Team", "members.manage", Users],
    ["settings", "Settings", "", Settings],
  ] as Array<[Tab, string, string, LucideIcon]>).filter(([, , permission]) => !permission || can(permission));

  const connectIntegration = async (integration: Integration) => {
    setNotice("");
    try {
      const { data } = await api.post<{ authorization_url: string }>(`/hiring/integrations/${integration.provider}/connect`);
      window.location.assign(data.authorization_url);
    } catch (error) {
      setNotice(apiError(error, `Could not connect ${stageLabel(integration.provider)}.`));
    }
  };

  if (busy && !workspace) {
    return <main className="hiring-loading" role="status"><BrandLogo /><p>Opening hiring workspace...</p></main>;
  }

  return (
    <div className="hiring-shell">
      <aside className="hiring-sidebar">
        <div className="hiring-brand"><img className="hiring-company-logo" src={organizationLogoUrl(workspace?.organization.logo_url)} alt="" /><span>{workspace?.organization.name || "Your organization"}</span></div>
        <div className="hiring-user">
          {workspace?.current_user?.avatar_url ? <img src={workspace.current_user.avatar_url} alt="" /> : <span aria-hidden="true">{initials(workspace?.current_user?.full_name)}</span>}
          <div><strong>{workspace?.current_user?.full_name || "Recruiter"}</strong><small>{stageLabel(workspace?.membership_role || "recruiter")}</small></div>
        </div>
        <nav aria-label="Hiring navigation">
          {navigation.map(([id, label, , Icon]) => (
            <button type="button" className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} key={id} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span></button>
          ))}
        </nav>
        <div className="hiring-sidebar-foot"><BrandLogo className="hiring-footer-logo" /><span>Valases</span></div>
      </aside>

      <main className="hiring-main">
        <header className="hiring-topbar">
          <h1>{stageLabel(tab)}</h1>
          <div className="hiring-topbar-actions">
            {["jobs", "candidates", "pipeline", "interviews", "integrations"].includes(tab) && <label className="hiring-search"><Search size={17} aria-hidden="true" /><input value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} placeholder={`Search ${stageLabel(tab).toLowerCase()}`} aria-label={`Search ${tab}`} /></label>}
          </div>
        </header>

        {notice && <div className="hiring-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}

        {tab === "overview" && <Overview workspace={workspace} jobs={jobs} applications={applications} interviews={interviews} onTab={setTab} onNewJob={() => setDialog("job")} onNewApplication={() => setDialog("application")} />}
        {tab === "jobs" && <JobsView jobs={filteredJobs} applications={applications} onNewJob={() => setDialog("job")} onCreateApplication={() => setDialog("application")} onStatusChange={(id, status) => jobStatusMutation.mutate({ id, status })} />}
        {tab === "candidates" && <CandidatesView candidates={filteredCandidates} applications={applications} onNewCandidate={() => setDialog("candidate")} onCreateApplication={() => setDialog("application")} />}
        {tab === "pipeline" && <PipelineView stages={pipelineStages} applications={filteredApplications} movingId={stageMutation.isPending ? stageMutation.variables?.id : undefined} onSelect={(application) => { setStageError(""); setSelectedApplication(application); }} onMove={(id, stage) => stageMutation.mutate({ id, stage })} onOpenAssessments={() => setTab("assessments")} />}
        {tab === "interviews" && <InterviewsView interviews={filteredInterviews} applications={filteredApplications} onSchedule={() => setDialog("interview")} onScorecard={(interview) => { setSelectedInterview(interview); setDialog("scorecard"); }} />}
        {tab === "assessments" && <Suspense fallback={<div className="hiring-section-empty">Loading assessment workspace...</div>}><ProviderAssessments embedded /></Suspense>}
        {tab === "integrations" && <IntegrationsView integrations={filteredIntegrations} canManage={can("integrations.manage")} onConnect={(integration) => void connectIntegration(integration)} onConfigure={(integration) => { setSelectedIntegration(integration); setDialog("integration"); }} />}
        {tab === "team" && <TeamView members={membersQuery.data || []} onAddMember={() => setDialog("member")} onRefresh={refresh} />}
        {tab === "settings" && <SettingsView organization={workspace?.organization} currentUser={workspace?.current_user} role={workspace?.membership_role || "recruiter"} permissions={workspace?.permissions || []} onRefresh={refresh} onSignOut={async () => { try { if (supabase) await supabase.auth.signOut(); } finally { clearSession(); } }} />}
      </main>

      {selectedDetails && <ApplicationDrawer key={selectedDetails.id} application={selectedDetails} detail={applicationDetailQuery.data} loading={applicationDetailQuery.isLoading} transitionError={stageError} stages={pipelineStages} onClose={() => { setStageError(""); setSelectedApplication(null); }} onScreen={() => screenMutation.mutate(selectedDetails.id)} onCompliance={() => complianceMutation.mutate(selectedDetails.id)} onOpenInterviews={() => { setSelectedApplication(null); setTab("interviews"); }} onAddScorecard={() => {
        const interview = interviews.find((item) => item.application_id === selectedDetails.id);
        if (interview) {
          setSelectedInterview(interview);
          setDialog("scorecard");
        } else {
          setSelectedApplication(null);
          setTab("interviews");
          setNotice("Schedule the interview before recording a scorecard.");
        }
      }} onMove={(stage, reason) => stageMutation.mutate({ id: selectedDetails.id, stage, reason })} />}
      {dialog === "job" && <JobForm onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Job published and ready for candidate intake."); refresh(); setTab("jobs"); }} />}
      {dialog === "candidate" && <CandidateForm jobs={activeJobs} onClose={() => setDialog(null)} onSaved={(addedToPipeline) => { setDialog(null); setNotice(addedToPipeline ? "Candidate added to Screening and is available for assessment." : "Candidate added. Assign an open role to make them assessment-eligible."); refresh(); setTab(addedToPipeline ? "pipeline" : "candidates"); }} />}
      {dialog === "application" && <ApplicationForm jobs={activeJobs.length ? activeJobs : jobs} candidates={candidates} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Application added to the pipeline."); refresh(); setTab("pipeline"); }} />}
      {dialog === "interview" && <InterviewForm applications={applications} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice("Interview scheduled and the candidate moved to interview stage."); refresh(); setTab("interviews"); }} />}
      {dialog === "scorecard" && selectedInterview && <ScorecardForm interview={selectedInterview} onClose={() => { setDialog(null); setSelectedInterview(null); }} onSaved={() => { setDialog(null); setSelectedInterview(null); setNotice("Structured interview scorecard saved."); refresh(); }} />}
      {dialog === "integration" && selectedIntegration && <IntegrationForm integration={selectedIntegration} onClose={() => { setDialog(null); setSelectedIntegration(null); }} onSaved={() => { setDialog(null); setSelectedIntegration(null); setNotice("Integration record updated. Connect credentials only through the approved OAuth or secret-management flow."); refresh(); }} />}
      {dialog === "member" && workspace && <MemberForm permissionCatalog={workspace.permission_catalog} onClose={() => setDialog(null)} onSaved={(message) => { setDialog(null); setNotice(message); refresh(); }} />}
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
    <section className="hiring-panel"><div className="hiring-panel-header"><div><h2>Active requisitions</h2><p>Start from a well-defined role, then attach assessments and interview plans.</p></div><button type="button" className="hiring-button primary" onClick={onNewJob}><Plus size={16} />New job</button></div>{jobs.length ? <div className="hiring-table"><div className="hiring-table-head"><span>Role</span><span>Department</span><span>Status</span><span>Candidates</span><span></span></div>{jobs.slice(0, 5).map((job) => <div className="hiring-table-row" key={job.id}><div><strong>{job.title}</strong><small>{job.job_code} | {job.location}</small></div><span>{job.department}</span><span><StatusPill status={job.status} /></span><span>{applications.filter((application) => application.job_id === job.id).length}</span><button type="button" className="hiring-row-command" onClick={onNewApplication}><UserPlus size={15} />Add candidate</button></div>)}</div> : <Empty text="Create your first role to start building a structured hiring process." action="Create job" onClick={onNewJob} />}</section>
  </>;
}

function Metric({ label, value, note, action, onClick }: { label: string; value: string | number; note: string; action: string; onClick: () => void }) { return <div className="hiring-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small><button type="button" onClick={onClick}>{action}</button></div>; }
function StatusPill({ status }: { status: string }) { return <span className={`hiring-status ${status}`}>{stageLabel(status)}</span>; }
function Empty({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) { return <div className="hiring-section-empty"><p>{text}</p>{action && <button type="button" className="hiring-button primary" onClick={onClick}>{action}</button>}</div>; }

function JobsView({ jobs, applications, onNewJob, onCreateApplication, onStatusChange }: { jobs: Job[]; applications: Application[]; onNewJob: () => void; onCreateApplication: () => void; onStatusChange: (id: number, status: string) => void }) {
  return <section className="hiring-panel hiring-full-panel">
    <div className="hiring-panel-header"><div><h2>Requisitions</h2><p>Define the role, publish it, and manage candidate intake from one place.</p></div><button type="button" className="hiring-button primary" onClick={onNewJob}><Plus size={16} />New job</button></div>
    {jobs.length ? <div className="hiring-table">
      <div className="hiring-table-head jobs"><span>Role</span><span>Work setup</span><span>Skills</span><span>Pipeline</span><span>Status</span><span>Actions</span></div>
      {jobs.map((job) => <div className="hiring-table-row jobs" key={job.id}>
        <div><strong>{job.title}</strong><small>{job.job_code} | {job.department}</small></div>
        <div><strong>{job.location}</strong><small>{stageLabel(job.work_arrangement)}</small></div>
        <div className="hiring-skills">{job.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}{job.skills.length > 3 && <span>+{job.skills.length - 3}</span>}</div>
        <span>{applications.filter((item) => item.job_id === job.id).length} candidates</span>
        <StatusPill status={job.status} />
        <div className="hiring-row-actions">
          {job.status !== "open" && job.status !== "closed" && <button type="button" className="hiring-row-command" onClick={() => onStatusChange(job.id, "open")}><Play size={14} />Publish</button>}
          {job.status === "open" && <button type="button" className="hiring-row-command" onClick={() => onStatusChange(job.id, "paused")}><Pause size={14} />Pause</button>}
          {job.status !== "closed" && <button type="button" className="hiring-row-command" onClick={onCreateApplication}><UserPlus size={14} />Add</button>}
          {job.status !== "closed" && <button type="button" className="hiring-row-command danger" onClick={() => onStatusChange(job.id, "closed")}><X size={14} />Close</button>}
        </div>
      </div>)}
    </div> : <Empty text="No jobs created yet." action="Create job" onClick={onNewJob} />}
  </section>;
}

function CandidatesView({ candidates, applications, onNewCandidate, onCreateApplication }: { candidates: Candidate[]; applications: Application[]; onNewCandidate: () => void; onCreateApplication: () => void }) { return <section className="hiring-panel hiring-full-panel"><div className="hiring-panel-header"><div><h2>Candidate directory</h2><p>Keep candidate information, consent and skills visible to the hiring team.</p></div><button type="button" className="hiring-button primary" onClick={onNewCandidate}><UserPlus size={16} />Add candidate</button></div>{candidates.length ? <div className="hiring-table"><div className="hiring-table-head candidates"><span>Candidate</span><span>Skills</span><span>Experience</span><span>Consent</span><span>Applications</span><span></span></div>{candidates.map((candidate) => <div className="hiring-table-row candidates" key={candidate.id}><div><strong>{candidate.full_name}</strong><small>{candidate.headline || candidate.email}</small></div><div className="hiring-skills">{candidate.skills.length ? candidate.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>) : <small>No skills added</small>}</div><span>{candidate.experience_years ?? "-"}{candidate.experience_years !== null ? " yrs" : ""}</span><StatusPill status={candidate.consent_status} /><span>{applications.filter((application) => application.candidate.id === candidate.id).length}</span><button type="button" className="hiring-row-command" onClick={onCreateApplication}><ArrowRight size={15} />Add to role</button></div>)}</div> : <Empty text="Add candidates manually or through an ATS connection." action="Add candidate" onClick={onNewCandidate} />}</section>; }

function PipelineView({ stages, applications, movingId, onSelect, onMove, onOpenAssessments }: { stages: string[]; applications: Application[]; movingId?: number; onSelect: (application: Application) => void; onMove: (id: number, stage: string) => void; onOpenAssessments: () => void }) {
  const visibleStages = stages.slice(0, 6);
  const firstPopulatedStage = visibleStages.find((stage) => applications.some((item) => item.stage === stage)) || "screening";
  const [selectedStage, setSelectedStage] = useState(firstPopulatedStage);
  const stageRows = applications
    .filter((application) => application.stage === selectedStage)
    .sort((left, right) => right.ranking.average_score - left.ranking.average_score);
  const nextStage = visibleStages[visibleStages.indexOf(selectedStage) + 1];
  return <section className="hiring-pipeline">
    <div className="hiring-stage-nav" role="tablist" aria-label="Pipeline stages">
      {visibleStages.map((stage) => <button type="button" role="tab" aria-selected={selectedStage === stage} className={selectedStage === stage ? "active" : ""} key={stage} onClick={() => setSelectedStage(stage)}><span>{stageLabel(stage)}</span><strong>{applications.filter((item) => item.stage === stage).length}</strong></button>)}
    </div>
    <div className="hiring-pipeline-list">
      <div className="hiring-pipeline-list-head"><span>Candidate</span><span>Role</span><span>Skills</span><span>Experience</span><span>Assessment</span><span>Average</span><span /></div>
      {stageRows.map((application) => <article className="hiring-pipeline-row" key={application.id} onClick={() => onSelect(application)}>
        <div><strong>{application.candidate.full_name}</strong><small>{application.candidate.email}</small></div>
        <span>{application.job_title}</span>
        <span>{application.ranking.skills_score.toFixed(0)}%</span>
        <span>{application.candidate.experience_years ?? 0} yrs</span>
        <span>{application.ranking.assessment_score !== null ? `${application.ranking.assessment_score.toFixed(0)}%` : "--"}</span>
        <strong className="hiring-rank-score">{application.ranking.average_score.toFixed(0)}</strong>
        <div className="hiring-pipeline-action">
          {selectedStage === "screening" ? <button type="button" onClick={(event) => { event.stopPropagation(); onOpenAssessments(); }}>Send assessment</button> : selectedStage === "assessment" ? <small>Awaiting result</small> : selectedStage === "interview" ? <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(application); }}>Review decision</button> : nextStage && selectedStage !== "offer" ? <button type="button" disabled={movingId === application.id} onClick={(event) => { event.stopPropagation(); onMove(application.id, nextStage); }}>{movingId === application.id ? "Moving..." : `Move to ${stageLabel(nextStage)}`}</button> : <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(application); }}>Review</button>}
        </div>
      </article>)}
      {!stageRows.length && <Empty text={`No candidates in ${stageLabel(selectedStage)}.`} />}
    </div>
  </section>;
}

function InterviewsView({ interviews, applications, onSchedule, onScorecard }: { interviews: Interview[]; applications: Application[]; onSchedule: () => void; onScorecard: (interview: Interview) => void }) {
  const ranked = applications
    .filter((application) => application.stage === "interview" && application.status === "active")
    .sort((left, right) => right.ranking.average_score - left.ranking.average_score);
  return <section className="hiring-panel hiring-full-panel">
    <div className="hiring-panel-header"><div><h2>Interview plan</h2><p>Schedule structured conversations and capture comparable evidence before a decision.</p></div><button type="button" className="hiring-button primary" disabled={!applications.length} onClick={onSchedule}><CalendarPlus size={16} />Schedule interview</button></div>
    {ranked.length > 0 && <div className="hiring-shortlist">
      <div className="hiring-shortlist-head"><div><h3>Recommended interview order</h3><p>Ranked by the average of relevant skills, experience, and finalized assessment score.</p></div></div>
      {ranked.slice(0, 5).map((application, index) => <div className="hiring-shortlist-row" key={application.id}><strong>{index + 1}</strong><div><b>{application.candidate.full_name}</b><small>{application.job_title}</small></div><span>Skills <b>{application.ranking.skills_score.toFixed(0)}%</b></span><span>Experience <b>{application.ranking.experience_score.toFixed(0)}%</b></span><span>Assessment <b>{application.ranking.assessment_score !== null ? `${application.ranking.assessment_score.toFixed(0)}%` : "--"}</b></span><em>{application.ranking.average_score.toFixed(0)}</em></div>)}
    </div>}
    {interviews.length ? <div className="hiring-table">
      <div className="hiring-table-head interviews"><span>When</span><span>Candidate</span><span>Role</span><span>Format</span><span>Review</span></div>
      {interviews.map((interview) => <div className="hiring-table-row interviews" key={interview.id}>
        <span>{interview.scheduled_at ? new Date(interview.scheduled_at).toLocaleString() : "Needs scheduling"}</span>
        <strong>{interview.candidate_name}</strong>
        <span>{interview.job_title}</span>
        <span>{stageLabel(interview.interview_type)} | {interview.duration_minutes} min</span>
        <button type="button" onClick={() => onScorecard(interview)}>Scorecard</button>
      </div>)}
    </div> : <Empty text="No interviews scheduled. Move a candidate into the pipeline, then schedule a structured interview." action={applications.length ? "Schedule interview" : undefined} onClick={onSchedule} />}
  </section>;
}

function IntegrationsView({ integrations, canManage, onConnect, onConfigure }: { integrations: Integration[]; canManage: boolean; onConnect: (integration: Integration) => void; onConfigure: (integration: Integration) => void }) {
  return <section className="hiring-panel hiring-full-panel">
    <div className="hiring-panel-header"><div><h2>Integration center</h2><p>Connect recruiting, calendar, meeting, and voice systems to this organization.</p></div></div>
    <div className="hiring-integration-grid">{integrations.map((integration) => <div className="hiring-integration-row" key={integration.provider}>
      <div><strong>{stageLabel(integration.provider)}</strong><small>{stageLabel(integration.category)} | {integration.config.external_account_name || stageLabel(integration.connection_mode)}</small><span>{integration.capabilities.slice(0, 3).map(stageLabel).join(", ")}</span></div>
      <StatusPill status={integration.status} />
      <div className="hiring-integration-actions">
        {integration.status !== "connected" && <button className="hiring-button primary" type="button" disabled={!canManage} onClick={() => onConnect(integration)}>{integration.connect_available ? "Connect" : "Set up"}</button>}
        <button className="hiring-button secondary" type="button" disabled={!canManage} onClick={() => onConfigure(integration)}>{integration.status === "connected" ? "Manage" : "Scope"}</button>
      </div>
    </div>)}</div>
  </section>;
}

function SettingsView({ organization, currentUser, role, permissions, onRefresh, onSignOut }: {
  organization?: Workspace["organization"];
  currentUser?: Workspace["current_user"];
  role: string;
  permissions: string[];
  onRefresh: () => void;
  onSignOut: () => Promise<void>;
}) {
  const canManageOrganization = permissions.includes("organization.manage");
  return <section className="hiring-panel hiring-full-panel hiring-settings">
    <div className="hiring-settings-section">
      <div className="hiring-panel-header"><div><h2>Personal profile</h2><p>Your identity in this organization.</p></div></div>
      {currentUser && <CurrentUserProfileForm currentUser={currentUser} onSaved={onRefresh} />}
    </div>
    <div className="hiring-settings-section">
      <div className="hiring-panel-header"><div><h2>Company profile</h2><p>The identity shown to your hiring team across Valases.</p></div></div>
      {organization && canManageOrganization ? <OrganizationProfileForm organization={organization} onSaved={onRefresh} /> : <div className="hiring-settings-row"><div><strong>Company</strong><span>{organization?.name || "Your organization"}</span></div></div>}
    </div>
    <div className="hiring-settings-row"><div><strong>Access role</strong><span>{stageLabel(role)}</span></div><small>{permissions.length} permissions</small></div>
    {permissions.includes("billing.manage") && <OrganizationBilling />}
    <div className="hiring-settings-row danger"><div><strong>Sign out</strong><span>End this browser session on this device.</span></div><button type="button" className="hiring-button secondary" onClick={() => void onSignOut()}><LogOut size={16} />Sign out</button></div>
  </section>;
}

function billingMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amountMinor / 100);
}

async function loadCashfreeCheckout() {
  const active = window as typeof window & { Cashfree?: (options: { mode: "sandbox" | "production" }) => { checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<unknown> } };
  if (active.Cashfree) return active.Cashfree;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-valases-cashfree="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Payment checkout could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.dataset.valasesCashfree = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Payment checkout could not be loaded."));
    document.head.appendChild(script);
  });
  if (!active.Cashfree) throw new Error("Payment checkout could not be initialized.");
  return active.Cashfree;
}

function OrganizationBilling() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const billing = useQuery<BillingOverview>({
    queryKey: ["organization-billing"],
    queryFn: async () => (await api.get("/billing/organization")).data,
  });
  useEffect(() => {
    if (billing.data?.account.billing_phone) setPhone(billing.data.account.billing_phone);
  }, [billing.data?.account.billing_phone]);
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("billing_return");
    if (!orderId) return;
    let active = true;
    setMessage("Confirming payment...");
    api.post(`/billing/orders/${encodeURIComponent(orderId)}/verify`)
      .then((response) => {
        if (!active) return;
        setMessage(response.data.order.status === "paid" ? "Payment verified. Your billing plan is active." : "Payment is still processing. Refresh shortly.");
        void queryClient.invalidateQueries({ queryKey: ["organization-billing"] });
      })
      .catch((reason) => {
        if (active) setMessage(apiError(reason, "Payment could not be verified yet."));
      })
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("billing_return");
        window.history.replaceState({}, "", url);
      });
    return () => { active = false; };
  }, [queryClient]);
  const startCheckout = async (planCode: string) => {
    if (!/^\+?[0-9]{8,15}$/.test(phone.trim())) {
      setMessage("Enter a valid billing phone number before continuing.");
      return;
    }
    setMessage("Preparing secure checkout...");
    try {
      const { data } = await api.post("/billing/checkout", { plan_code: planCode, billing_phone: phone.trim() });
      const Cashfree = await loadCashfreeCheckout();
      const checkout = Cashfree({ mode: data.checkout_mode });
      await checkout.checkout({ paymentSessionId: data.payment_session_id, redirectTarget: "_self" });
    } catch (reason) {
      setMessage(apiError(reason, "Secure checkout could not be started."));
    }
  };
  const downloadReceipt = async (orderId: string, receiptNumber: string) => {
    setMessage("Preparing receipt...");
    try {
      const { data } = await api.get(`/billing/orders/${encodeURIComponent(orderId)}/receipt`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${receiptNumber}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setMessage("Receipt downloaded.");
    } catch (reason) {
      setMessage(apiError(reason, "Receipt could not be downloaded."));
    }
  };
  return <div className="hiring-settings-section hiring-billing-section">
    <div className="hiring-panel-header"><div><h2>Billing</h2><p>Manage the organization plan and verified payment history.</p></div><CreditCard size={19} aria-hidden="true" /></div>
    {billing.isLoading && <div className="hiring-settings-loading">Loading billing...</div>}
    {billing.isError && <p className="hiring-form-error">{apiError(billing.error, "Billing information could not be loaded.")}</p>}
    {billing.data && <>
      <div className="hiring-billing-summary">
        <div><span>Current plan</span><strong>{stageLabel(billing.data.account.plan_code)}</strong></div>
        <div><span>Status</span><StatusPill status={billing.data.account.status} /></div>
        <div><span>Current period</span><strong>{billing.data.account.current_period_end ? `Through ${new Date(billing.data.account.current_period_end).toLocaleDateString()}` : "Trial period"}</strong></div>
      </div>
      <label className="hiring-billing-phone">Billing phone<input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+919876543210" /><small>Used by the payment provider for checkout verification.</small></label>
      <div className="hiring-plan-grid">
        {billing.data.plans.map((plan) => <article key={plan.code} className={billing.data.account.plan_code === plan.code && billing.data.account.status === "active" ? "current" : ""}>
          <div><strong>{plan.name}</strong>{billing.data.account.plan_code === plan.code && billing.data.account.status === "active" && <span>Current</span>}</div>
          <b>{billingMoney(plan.monthly_amount_minor, plan.currency)}<small>/month</small></b>
          <p>{plan.description}</p>
          <button type="button" className="hiring-button primary" disabled={!billing.data.provider_ready} onClick={() => void startCheckout(plan.code)}>{billing.data.account.plan_code === plan.code ? "Renew plan" : "Choose plan"}</button>
        </article>)}
      </div>
      {!billing.data.provider_ready && <p className="hiring-billing-provider-note">Online checkout is ready for activation. Add the Cashfree production credentials to enable payments.</p>}
      {billing.data.orders.length > 0 && <div className="hiring-billing-history"><h3>Payment history</h3>{billing.data.orders.map((order) => <div key={order.id}><span><strong>{order.description}</strong><small>{order.receipt_number || new Date(order.created_at).toLocaleDateString()}</small></span><b>{billingMoney(order.amount_minor, order.currency)}</b><StatusPill status={order.status} />{order.receipt_number && <button type="button" className="hiring-button secondary" onClick={() => void downloadReceipt(order.id, order.receipt_number!)}>Receipt</button>}</div>)}</div>}
    </>}
    {message && <p className="hiring-billing-message" role="status">{message}</p>}
  </div>;
}

function TeamView({ members, onAddMember, onRefresh }: { members: Member[]; onAddMember: () => void; onRefresh: () => void }) {
  const removeMember = async (member: Member) => {
    if (!window.confirm(`Remove ${member.full_name || member.email} from this organization?`)) return;
    await api.delete(`/hiring/members/${member.id}`);
    onRefresh();
  };
  return <section className="hiring-panel hiring-full-panel">
    <div className="hiring-panel-header"><div><h2>Team access</h2><p>Add recruiters and assign organization-wide or custom permissions.</p></div><button type="button" className="hiring-button primary" onClick={onAddMember}><UserPlus size={16} />Add team member</button></div>
    <div className="hiring-member-table">
      <div className="hiring-member-head"><span>Member</span><span>Role</span><span>Status</span><span>Access</span></div>
      {members.map((member) => <div className="hiring-member-row" key={member.id}><div><strong>{member.full_name}</strong><small>{member.email}</small></div><span>{stageLabel(member.role)}</span><StatusPill status={member.status} /><button type="button" disabled={member.role === "owner" || member.is_current_user} onClick={() => void removeMember(member)}>Remove</button></div>)}
    </div>
    {!members.length && <Empty text="No organization members have been added yet." action="Add team member" onClick={onAddMember} />}
  </section>;
}

function ImagePicker({ image, label, fallback, round = false, onPick, onRemove }: {
  image: string;
  label: string;
  fallback: string;
  round?: boolean;
  onPick: (file: File) => Promise<void>;
  onRemove?: () => void;
}) {
  return <div className={`hiring-image-picker${round ? " round" : ""}`}>
    <div className="hiring-image-preview">{image ? <img src={image} alt="" /> : <span aria-hidden="true">{fallback}</span>}</div>
    <div>
      <strong>{label}</strong>
      <small>PNG, JPEG, or WebP up to 12 MB. The image is resized before upload.</small>
      <div className="hiring-image-actions">
        <label className="hiring-upload-button"><Upload size={15} /><span>Choose image</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) await onPick(file);
        }} /></label>
        {image && onRemove && <button type="button" className="hiring-button quiet-danger" onClick={onRemove}><Trash2 size={15} />Remove</button>}
      </div>
    </div>
  </div>;
}

function CurrentUserProfileForm({ currentUser, onSaved }: { currentUser: Workspace["current_user"]; onSaved: () => void }) {
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [avatar, setAvatar] = useState(currentUser.avatar_url);
  const [newAvatar, setNewAvatar] = useState("");
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setFullName(currentUser.full_name);
    setAvatar(currentUser.avatar_url);
  }, [currentUser.avatar_url, currentUser.full_name]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const { data } = await api.patch<Workspace["current_user"]>("/hiring/profile", {
        full_name: fullName.trim(),
        avatar_data_url: newAvatar,
        remove_avatar: removeAvatar,
      });
      setAvatar(data.avatar_url);
      setNewAvatar("");
      setRemoveAvatar(false);
      setMessage("Personal profile updated.");
      onSaved();
    } catch (reason) {
      setMessage(apiError(reason, "Personal profile could not be updated."));
    } finally {
      setLoading(false);
    }
  };
  const preview = removeAvatar ? "" : newAvatar || avatar;
  return <form className="hiring-organization-profile" onSubmit={submit}>
    <ImagePicker image={preview} label="Profile photo" fallback={initials(fullName)} round onPick={async (file) => {
      try {
        setNewAvatar(await readProfileImage(file));
        setRemoveAvatar(false);
        setMessage("Photo ready. Save changes to apply it.");
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : "The photo could not be used.");
      }
    }} onRemove={() => {
      setNewAvatar("");
      setRemoveAvatar(true);
      setMessage("Photo will be removed when you save.");
    }} />
    <label>Full name<input required minLength={2} maxLength={200} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
    <label>Email<input value={currentUser.email} disabled /></label>
    <div><button type="submit" className="hiring-button primary" disabled={loading || fullName.trim().length < 2}>{loading ? "Saving..." : "Save changes"}</button>{message && <span role="status">{message}</span>}</div>
  </form>;
}

function OrganizationProfileForm({ organization, onSaved }: { organization: Workspace["organization"]; onSaved: () => void }) {
  const [name, setName] = useState(organization.name);
  const [logo, setLogo] = useState(organization.logo_url);
  const [newLogo, setNewLogo] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setName(organization.name);
    setLogo(organization.logo_url);
  }, [organization.logo_url, organization.name]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const { data } = await api.patch<Workspace["organization"]>("/hiring/organization/profile", { name: name.trim(), logo_data_url: newLogo });
      setLogo(data.logo_url);
      setNewLogo("");
      setMessage("Company profile updated.");
      onSaved();
    } catch (reason) {
      setMessage(apiError(reason, "Company profile could not be updated."));
    } finally {
      setLoading(false);
    }
  };
  return <form className="hiring-organization-profile" onSubmit={submit}>
    <ImagePicker image={newLogo || organizationLogoUrl(logo)} label="Company logo" fallback={initials(name)} onPick={async (file) => {
      try {
        setNewLogo(await readCompanyLogo(file));
        setMessage("Logo ready. Save changes to apply it.");
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : "The logo could not be used.");
      }
    }} />
    <label>Company profile name<input required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div><button type="submit" className="hiring-button primary" disabled={loading || name.trim().length < 2}>{loading ? "Saving..." : "Save changes"}</button>{message && <span role="status">{message}</span>}</div>
  </form>;
}

function ApplicationDrawer({ application, detail, loading, transitionError, stages, onClose, onScreen, onCompliance, onAddScorecard, onOpenInterviews, onMove }: {
  application: Application;
  detail?: ApplicationDetail;
  loading: boolean;
  transitionError: string;
  stages: string[];
  onClose: () => void;
  onScreen: () => void;
  onCompliance: () => void;
  onAddScorecard: () => void;
  onOpenInterviews: () => void;
  onMove: (stage: string, reason: string) => void;
}) {
  const [nextStage, setNextStage] = useState(application.stage);
  const [reason, setReason] = useState("");
  const terminal = ["offer", "hired", "rejected", "withdrawn"].includes(nextStage);
  const requiresScorecard = ["offer", "hired"].includes(nextStage);
  const checkingScorecard = requiresScorecard && !detail;
  const missingScorecard = requiresScorecard && Boolean(detail) && detail!.evidence_summary.scorecard_count < 1;
  const screening = detail?.screening || { match_score: application.ai_match_score, recommendation: application.ai_recommendation, rationale: application.ai_rationale };
  return <aside className="hiring-drawer" aria-label="Candidate application details">
    <header><div><small>{application.job_title}</small><h2>{application.candidate.full_name}</h2><span>{application.candidate.headline || application.candidate.email}</span></div><button type="button" className="hiring-icon-button" aria-label="Close candidate details" onClick={onClose}><X size={18} /></button></header>
    {loading && <div className="hiring-drawer-loading">Loading decision evidence...</div>}
    {detail && <section className={`hiring-readiness ${detail.evidence_summary.status}`}>
      <div><h3>Decision readiness</h3><StatusPill status={detail.evidence_summary.status} /></div>
      <p>{detail.evidence_summary.message}</p>
      <div className="hiring-evidence-metrics"><span>Screening<strong>{detail.evidence_summary.screening_complete ? "Complete" : "Missing"}</strong></span><span>Scorecards<strong>{detail.evidence_summary.scorecard_count}</strong></span><span>Compliance<strong>{detail.evidence_summary.blocking_checks.length ? `${detail.evidence_summary.blocking_checks.length} open` : detail.evidence_summary.compliance_complete ? "Passed" : "Not run"}</strong></span></div>
    </section>}
    <section><h3>Screening signal</h3>{screening.match_score !== null ? <><strong className="hiring-score">{screening.match_score}%</strong><p>{screening.recommendation?.replace(/_/g, " ")}</p><div className="hiring-skill-detail"><span>Matched</span>{(screening.rationale.matched_skills || []).join(", ") || "No matched skills recorded"}</div><div className="hiring-skill-detail"><span>Still to verify</span>{(screening.rationale.missing_skills || []).join(", ") || "No gaps recorded"}</div></> : <p>No screening signal yet. Use it as a review aid, never a decision-maker.</p>}<button type="button" className="hiring-button secondary" onClick={onScreen}>Run evidence screen</button></section>
    <section><h3>Interview evidence</h3>{detail?.scorecards.length ? detail.scorecards.map((scorecard) => <article className="hiring-scorecard-summary" key={scorecard.id}><div><strong>{scorecard.overall_score?.toFixed(1) || "-"} / 5</strong><StatusPill status={scorecard.recommendation} /></div><p>{scorecard.evidence}</p></article>) : <p>No structured scorecard has been submitted.</p>}</section>
    <section><h3>Compliance</h3>{detail?.compliance_checks.length ? <div className="hiring-check-list">{detail.compliance_checks.map((check) => <div key={check.check_type}><span>{stageLabel(check.check_type)}</span><StatusPill status={check.status} /></div>)}</div> : <p>Consent, structured evidence and automated-decision guardrails have not been checked yet.</p>}<button type="button" className="hiring-button secondary" onClick={onCompliance}>Run checks</button></section>
    <section>
      <h3>Record stage decision</h3>
      <select value={nextStage} disabled={application.status === "closed"} onChange={(event) => setNextStage(event.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select>
      {missingScorecard && <div className="hiring-transition-blocker" role="note"><strong>Interview scorecard required</strong><p>Add structured interview evidence before moving this candidate to {stageLabel(nextStage)}.</p><div><button type="button" className="hiring-button secondary" onClick={onAddScorecard}>Add scorecard</button><button type="button" className="hiring-button secondary" onClick={onOpenInterviews}>Open interviews</button></div></div>}
      <textarea rows={3} value={reason} disabled={application.status === "closed"} onChange={(event) => setReason(event.target.value)} placeholder="Reason and supporting evidence" />
      {transitionError && <p className="hiring-transition-error" role="alert">{transitionError}</p>}
      <button type="button" className="hiring-button primary" disabled={application.status === "closed" || nextStage === application.stage || checkingScorecard || missingScorecard || (terminal && reason.trim().length < 10)} onClick={() => onMove(nextStage, reason.trim() || "Progressed by the recruiter from the hiring workspace")}>{checkingScorecard ? "Checking evidence..." : "Save stage"}</button>
      {terminal && reason.trim().length < 10 && <small>Offer and final decisions require a rationale of at least 10 characters.</small>}
    </section>
    {detail && <section><h3>Activity</h3><div className="hiring-activity-list">{detail.stage_history.map((event) => <div key={event.id}><i aria-hidden="true" /><span><strong>{stageLabel(event.to_stage)}</strong><small>{event.reason || "No reason recorded"} | {new Date(event.created_at).toLocaleString()}</small></span></div>)}</div></section>}
  </aside>;
}

function JobForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [form, setForm] = useState({ job_code: "", title: "", department: "", location: "Remote", skills: "", description: "" }); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const draft = async () => { if (!form.title) return; setLoading(true); try { const { data } = await api.post("/hiring/jobs/draft-description", { title: form.title, department: form.department || "General", location: form.location, skills: splitList(form.skills) }); setForm((current) => ({ ...current, description: data.description })); } catch (reason) { setError(apiError(reason, "Could not create the job description.")); } finally { setLoading(false); } }; const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { await api.post("/hiring/jobs", { ...form, department: form.department || "General", skills: splitList(form.skills) }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not create the job.")); } finally { setLoading(false); } }; return <Modal title="New job requisition" onClose={onClose}><form className="hiring-form" onSubmit={submit}><div className="hiring-form-grid"><label>Job code<input required value={form.job_code} onChange={(event) => setForm({ ...form, job_code: event.target.value })} placeholder="FIN-104" /></label><label>Role title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Senior Accountant" /></label><label>Department<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="Finance" /></label><label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label></div><label>Required skills<input value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} placeholder="GAAP, Excel, reconciliations" /></label><div className="hiring-description-label"><label>Job description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Write the role purpose, responsibilities and requirements." /></label><button type="button" className="hiring-button secondary" disabled={!form.title || loading} onClick={() => void draft()}>Generate description</button></div>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading}>{loading ? "Publishing..." : "Publish job"}</button></footer></form></Modal>; }

function CandidateForm({ jobs, onClose, onSaved }: { jobs: Job[]; onClose: () => void; onSaved: (addedToPipeline: boolean) => void }) { const [form, setForm] = useState({ first_name: "", last_name: "", email: "", headline: "", skills: "", experience_years: "", resume_text: "", consent_obtained: false }); const [jobId, setJobId] = useState(jobs.length === 1 ? String(jobs[0].id) : ""); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { const candidate = (await api.post<Candidate>("/hiring/candidates", { ...form, skills: splitList(form.skills), experience_years: form.experience_years ? Number(form.experience_years) : null })).data; if (jobId) await api.post("/hiring/applications", { job_id: Number(jobId), candidate_id: candidate.id }); onSaved(Boolean(jobId)); } catch (reason) { setError(apiError(reason, "Could not add the candidate.")); } finally { setLoading(false); } }; return <Modal title="Add candidate" onClose={onClose}><form className="hiring-form" onSubmit={submit}><div className="hiring-form-grid"><label>First name<input required value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label><label>Last name<input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Experience<input type="number" min="0" max="80" value={form.experience_years} onChange={(event) => setForm({ ...form, experience_years: event.target.value })} placeholder="Years" /></label></div>{jobs.length > 0 && <label>Open role<select required value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Select role</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>}<label>Headline<input value={form.headline} onChange={(event) => setForm({ ...form, headline: event.target.value })} placeholder="Accounting professional" /></label><label>Skills<input value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} placeholder="GAAP, Excel, forecasting" /></label><label>Resume text<textarea value={form.resume_text} onChange={(event) => setForm({ ...form, resume_text: event.target.value })} placeholder="Paste a resume or relevant work history for evidence-based screening." /></label><label className="hiring-checkbox"><input type="checkbox" checked={form.consent_obtained} onChange={(event) => setForm({ ...form, consent_obtained: event.target.checked })} />Candidate consent to process hiring data has been recorded</label>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading || (jobs.length > 0 && !jobId)}>{loading ? "Saving..." : "Add to screening"}</button></footer></form></Modal>; }

function ApplicationForm({ jobs, candidates, onClose, onSaved }: { jobs: Job[]; candidates: Candidate[]; onClose: () => void; onSaved: () => void }) { const [jobId, setJobId] = useState(""); const [candidateId, setCandidateId] = useState(""); const [error, setError] = useState(""); const submit = async (event: React.FormEvent) => { event.preventDefault(); try { await api.post("/hiring/applications", { job_id: Number(jobId), candidate_id: Number(candidateId) }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not create the application.")); } }; return <Modal title="Add candidate to role" onClose={onClose}><form className="hiring-form" onSubmit={submit}>{jobs.length && candidates.length ? <><label>Job<select required value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Select job</option>{jobs.map((job) => <option value={job.id} key={job.id}>{job.title}</option>)}</select></label><label>Candidate<select required value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Select candidate</option>{candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.full_name}</option>)}</select></label></> : <p className="hiring-form-error">Create at least one job and one candidate first.</p>}{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={!jobs.length || !candidates.length}>Add to pipeline</button></footer></form></Modal>; }

function InterviewForm({ applications, onClose, onSaved }: { applications: Application[]; onClose: () => void; onSaved: () => void }) { const [applicationId, setApplicationId] = useState(""); const [scheduledAt, setScheduledAt] = useState(""); const [error, setError] = useState(""); const eligible = applications.filter((application) => application.status === "active" && application.stage === "interview").sort((left, right) => right.ranking.average_score - left.ranking.average_score); const submit = async (event: React.FormEvent) => { event.preventDefault(); try { await api.post("/hiring/interviews", { application_id: Number(applicationId), interview_type: "structured", scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null }); onSaved(); } catch (reason) { setError(apiError(reason, "Could not schedule the interview.")); } }; return <Modal title="Schedule structured interview" onClose={onClose}><form className="hiring-form" onSubmit={submit}><label>Candidate<select required value={applicationId} onChange={(event) => setApplicationId(event.target.value)}><option value="">Select candidate</option>{eligible.map((application) => <option key={application.id} value={application.id}>{application.candidate.full_name} | {application.job_title} | {application.ranking.average_score.toFixed(0)} average</option>)}</select></label><label>When<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label><p className="hiring-form-hint">Calendar and voice scheduling connectors can be enabled per organization after OAuth configuration.</p>{!eligible.length && <p className="hiring-form-error">No candidates have cleared assessment and reached Interview.</p>}{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={!eligible.length || !applicationId}>Schedule interview</button></footer></form></Modal>; }

function ScorecardForm({ interview, onClose, onSaved }: { interview: Interview; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    recommendation: "mixed",
    overall_score: "3",
    role_expertise: "3",
    problem_solving: "3",
    communication: "3",
    judgment: "3",
    evidence: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post(`/hiring/interviews/${interview.id}/scorecard`, {
        recommendation: form.recommendation,
        overall_score: Number(form.overall_score),
        competencies: {
          "Role expertise": Number(form.role_expertise),
          "Problem solving": Number(form.problem_solving),
          Communication: Number(form.communication),
          Judgment: Number(form.judgment),
        },
        evidence: form.evidence.trim(),
      });
      onSaved();
    } catch (reason) {
      setError(apiError(reason, "Could not save the interview scorecard."));
    } finally {
      setLoading(false);
    }
  };
  const scoreField = (key: "role_expertise" | "problem_solving" | "communication" | "judgment", label: string) => (
    <label>{label}<select value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}>{[1, 2, 3, 4, 5].map((score) => <option value={score} key={score}>{score} / 5</option>)}</select></label>
  );
  return <Modal title="Structured interview scorecard" onClose={onClose}>
    <form className="hiring-form" onSubmit={submit}>
      <div className="hiring-form-context"><strong>{interview.candidate_name}</strong><span>{interview.job_title}</span></div>
      <div className="hiring-form-grid">{scoreField("role_expertise", "Role expertise")}{scoreField("problem_solving", "Problem solving")}{scoreField("communication", "Communication")}{scoreField("judgment", "Judgment")}</div>
      <div className="hiring-form-grid">
        <label>Overall score<select value={form.overall_score} onChange={(event) => setForm({ ...form, overall_score: event.target.value })}>{[1, 2, 3, 4, 5].map((score) => <option value={score} key={score}>{score} / 5</option>)}</select></label>
        <label>Recommendation<select value={form.recommendation} onChange={(event) => setForm({ ...form, recommendation: event.target.value })}><option value="strong_yes">Strong yes</option><option value="yes">Yes</option><option value="mixed">Mixed</option><option value="no">No</option><option value="strong_no">Strong no</option></select></label>
      </div>
      <label>Evidence<textarea required minLength={10} value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} placeholder="Record job-relevant examples from the interview. Avoid personal or protected information." /></label>
      <p className="hiring-form-hint">This scorecard is decision evidence. It does not send a result to the candidate.</p>
      {error && <p className="hiring-form-error">{error}</p>}
      <footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading || form.evidence.trim().length < 10}>{loading ? "Saving..." : "Save scorecard"}</button></footer>
    </form>
  </Modal>;
}

const permissionDescription: Record<string, string> = {
  "jobs.view": "View job requisitions",
  "jobs.manage": "Create and edit jobs",
  "candidates.view": "View candidate records",
  "candidates.manage": "Add and edit candidates",
  "pipeline.view": "View hiring pipelines",
  "pipeline.manage": "Move and screen candidates",
  "assessments.view": "Open the assessment workspace",
  "assessments.manage": "Build and issue assessments",
  "assessment_results.view": "Review assessment results",
  "interviews.view": "View interview schedules",
  "interviews.manage": "Schedule and score interviews",
  "integrations.view": "View connected systems",
  "integrations.manage": "Connect and manage integrations",
  "reports.view": "View hiring reports",
  "members.manage": "Invite and remove organization members",
  "organization.manage": "Manage organization settings",
  "billing.manage": "Manage billing",
};

function MemberForm({ permissionCatalog, onClose, onSaved }: { permissionCatalog: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({ full_name: "", email: "", role: "recruiter", permissions: [] as string[], authentication: "email_invite" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const togglePermission = (permission: string) => setForm((current) => ({
    ...current,
    permissions: current.permissions.includes(permission) ? current.permissions.filter((item) => item !== permission) : [...current.permissions, permission],
  }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/hiring/members", form);
      onSaved(data.status === "pending_sso" ? `${form.email} is ready for the first company SSO login.` : data.invitation_sent ? `Invitation sent to ${form.email}.` : `${form.email} now has organization access.`);
    } catch (reason) {
      setError(apiError(reason, "Could not add this organization member."));
    } finally {
      setLoading(false);
    }
  };
  return <Modal title="Invite organization member" onClose={onClose}>
    <form className="hiring-form" onSubmit={submit}>
      <div className="hiring-form-grid"><label>Full name<input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label><label>Work email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label></div>
      <fieldset className="hiring-auth-options">
        <legend>Sign-in method</legend>
        <label><input type="radio" name="member-authentication" value="email_invite" checked={form.authentication === "email_invite"} onChange={(event) => setForm({ ...form, authentication: event.target.value })} /><span><strong>Email invitation</strong><small>Create a standard Supabase account and send an invitation.</small></span></label>
        <label><input type="radio" name="member-authentication" value="sso_only" checked={form.authentication === "sso_only"} onChange={(event) => setForm({ ...form, authentication: event.target.value })} /><span><strong>Company SSO</strong><small>Pre-authorize this user without creating a password identity.</small></span></label>
      </fieldset>
      <fieldset className="hiring-role-options">
        <legend>Access role</legend>
        <label><input type="radio" name="member-role" value="org_admin" checked={form.role === "org_admin"} onChange={(event) => setForm({ ...form, role: event.target.value })} /><span><strong>Organization admin</strong><small>All organization controls, including people, SSO, integrations, and billing.</small></span></label>
        <label><input type="radio" name="member-role" value="recruiter" checked={form.role === "recruiter"} onChange={(event) => setForm({ ...form, role: event.target.value })} /><span><strong>Recruiter</strong><small>Complete hiring access without member, organization security, or billing administration.</small></span></label>
        <label><input type="radio" name="member-role" value="custom" checked={form.role === "custom"} onChange={(event) => setForm({ ...form, role: event.target.value })} /><span><strong>Other</strong><small>Choose exactly what this person can access.</small></span></label>
      </fieldset>
      {form.role === "custom" && <fieldset className="hiring-permission-grid"><legend>Custom access</legend>{permissionCatalog.map((permission) => <label key={permission}><input type="checkbox" checked={form.permissions.includes(permission)} onChange={() => togglePermission(permission)} /><span>{permissionDescription[permission] || stageLabel(permission)}</span></label>)}</fieldset>}
      {error && <p className="hiring-form-error">{error}</p>}
      <footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading || (form.role === "custom" && !form.permissions.length)}>{loading ? "Saving..." : form.authentication === "sso_only" ? "Pre-authorize member" : "Send invitation"}</button></footer>
    </form>
  </Modal>;
}

function IntegrationForm({ integration, onClose, onSaved }: { integration: Integration; onClose: () => void; onSaved: () => void }) {
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
  return <Modal title={`${stageLabel(integration.provider)} connection`} onClose={onClose}><form className="hiring-form" onSubmit={submit}><p className="hiring-form-hint">Record the approved account and data scope. Do not paste API keys, passwords, or OAuth tokens here. Connected status is set only after a verified provider callback.</p><div className="hiring-form-context"><strong>{stageLabel(integration.connection_mode)}</strong><span>{integration.capabilities.map(stageLabel).join(", ")}</span></div><label>Connection status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="not_connected">Not connected</option><option value="ready_to_connect">Ready to connect</option>{integration.status === "connected" && <option value="connected">Connected</option>}<option value="paused">Paused</option></select></label><label>Approved account<input value={form.external_account_name} onChange={(event) => setForm({ ...form, external_account_name: event.target.value })} placeholder="Recruiting workspace" /></label><label>Sync scope<input value={form.sync_scope} onChange={(event) => setForm({ ...form, sync_scope: event.target.value })} placeholder={integration.capabilities.join(", ")} /></label>{error && <p className="hiring-form-error">{error}</p>}<footer><button type="button" className="hiring-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="hiring-button primary" disabled={loading}>{loading ? "Saving..." : "Save connection"}</button></footer></form></Modal>;
}

export default HiringWorkspace;
