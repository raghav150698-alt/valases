import englishAssessment from "./englishAssessmentFixture.json";
import englishAssessmentUk from "./englishAssessmentUkFixture.json";
import toolFixtureData from "./toolAssessmentFixtures.json";
type PreviewPracticalDefinition = { id: string; title: string; assessment_type: string; duration_minutes: number; pass_score: number; summary: string; topics: string[]; task: { title: string; description: string; instructions: string; marks: number; metadata: Record<string, unknown>; expected_output: Record<string, unknown>; grading_config: { checkpoints?: Array<{ id: string; label: string; weight: number; source: string; expected: unknown }> } } };
const toolFixtures = toolFixtureData as unknown as { catalog_version: number; assessments: PreviewPracticalDefinition[] };
// Fictional, self-contained fixtures. Never populate these from real accounts.
const createdAt = "2026-09-01T08:00:00Z";
const stages = ["applied", "screening", "assessment", "interview", "offer", "hired"];
const permissions = ["jobs.view", "jobs.manage", "candidates.view", "candidates.manage", "pipeline.view", "pipeline.manage", "interviews.view", "interviews.manage", "offers.view", "offers.manage", "offers.release", "assessments.view", "integrations.view", "integrations.manage", "members.manage", "organization.manage", "billing.manage"];
const jobs = [
  { title: "Financial Analyst", department: "Finance", location: "Bengaluru", skills: ["Excel", "Financial analysis"] },
  { title: "Customer Success Specialist", department: "Operations", location: "Mumbai", skills: ["Communication", "Customer support"] },
  { title: "Frontend Engineer", department: "Engineering", location: "Remote", skills: ["React", "TypeScript"] },
].map((job, i) => ({ ...job, id: 93001 + i, job_code: `DEMO-${101 + i}`, employment_type: "full_time", work_arrangement: "hybrid", status: "open", headcount: 3, filled_count: i === 0 ? 1 : 0, openings_remaining: i === 0 ? 2 : 3, description: `Collaborate across teams as a ${job.title.toLowerCase()}. This is a fictional role for UI preview.`, created_at: createdAt }));
const candidates = ["Aditi Rao", "Omar Khan", "Maya Thomas", "Arjun Shah", "Leah Patel", "Dev Mehta", "Anika Sen", "Rohan Iyer", "Sara Ali", "Neel Kapoor", "Isha Roy", "Kabir Das"].map((name, i) => ({
  id: 94000 + i, full_name: name, first_name: name.split(" ")[0], last_name: name.split(" ")[1],
  email: `candidate${i + 1}@example.invalid`, headline: jobs[i % 3].title, location: jobs[i % 3].location,
  source: "referral", skills: jobs[i % 3].skills, experience_years: 2 + i % 5, consent_status: "granted", created_at: createdAt,
}));
const applications = candidates.map((candidate, i) => ({
  id: 95000 + i, job_id: jobs[i % 3].id, job_title: jobs[i % 3].title, candidate,
  stage: stages[i % stages.length], status: "active", source: "referral", applied_at: createdAt,
  ai_match_score: null, ai_confidence: null, ai_recommendation: null, ai_rationale: {},
  ranking: { average_score: 76 + i, top_choice_score: 76 + i, resume_match_score: 78, skills_score: 80, experience_score: 75, assessment_score: i > 2 ? 80 : null, matched_skills: 2, required_skills: 2 },
}));
const interviews = applications.filter(row => row.stage === "interview").map((row, i) => ({
  id: 96000 + i, application_id: row.id, candidate_name: row.candidate.full_name, job_title: row.job_title,
  interview_type: "structured", status: "scheduled", scheduled_at: "2026-09-08T09:30:00Z", duration_minutes: 45,
  meeting_url: null, calendar_provider: null, calendar_event_url: null, calendar_sync_status: "not_connected", calendar_sync_error: null,
}));
const offers = applications.filter(row => ["offer", "hired"].includes(row.stage)).map((row, i) => ({
  id: 97000 + i, application_id: row.id, offer_reference: `DEMO-OFFER-${i + 1}`, status: row.stage === "hired" ? "accepted" : "draft",
  job_title: row.job_title, candidate_name: row.candidate.full_name, candidate_email: row.candidate.email,
  currency: "INR", pay_frequency: "annual", base_compensation: 1200000, variable_compensation: 100000, benefits_value: 50000,
  earnings: [{ label: "Base salary", amount: 1200000, description: "Illustrative annual salary" }], deductions: [],
  gross_cash_compensation: 1300000, estimated_net_compensation: null, total_ctc: 1350000,
  employment_type: "full_time", work_location: "Bengaluru", reporting_manager: "Preview manager", probation_months: 3, notice_period_days: 30,
  start_date: "2026-09-21", expires_at: null, released_at: null, signed_at: null,
}));
const onboarding = applications.filter(row => row.stage === "hired").map((row, i) => ({
  id: 98000 + i, application_id: row.id, candidate: row.candidate, job_title: row.job_title, status: "in_progress",
  manager_name: "Preview manager", start_date: "2026-09-21", welcome_email_status: "pending",
  first_day_plan: "09:30 — Meet the team.\n10:30 — Workspace and systems orientation.\n14:00 — Role goals with your manager.",
  checklist: [{ id: "intro", label: "Assign onboarding buddy", owner: "Hiring manager", due_date: "2026-09-18", completed: true }, { id: "orientation", label: "Schedule orientation", owner: "People team", due_date: "2026-09-21", completed: false }],
  documents: [{ id: "agreement", label: "Employment agreement", status: "received", required: true }],
  access_requests: [{ id: "workspace", label: "Company workspace", system: "Email and collaboration", status: "requested" }],
}));
const integrations = ["google_calendar", "outlook_calendar"].map(provider => ({
  provider, category: "calendar", connection_mode: "oauth", capabilities: ["sync"], status: "not_connected",
  config: {}, connect_available: false, last_synced_at: null,
}));
const emailChannels = ["candidate_updates", "assessment_invites", "onboarding", "system"].map(purpose => ({
  purpose, label: purpose.replaceAll("_", " "), provider: "smtp", status: "not_configured", smtp_host: "", smtp_port: 587,
  smtp_username: "", sender: "", sender_name: "Valases Preview", reply_to: "", password_configured: false,
}));
const members = ["Priya Menon", "Ravi Kumar"].map((name, i) => ({ id: 99000 + i, user_id: 99000 + i, email: `recruiter${i + 1}@example.invalid`, full_name: name, role: i ? "recruiter" : "owner", permissions, status: "active", is_current_user: i === 0 }));
const workspace = {
  organization: { id: 90000, name: "Valases Preview", legal_name: "Preview Business Ltd", slug: "ui-preview-sample", plan_code: "trial", logo_url: "", business_profile: { country: "India", website: "https://preview.example", admin_email: members[0].email, work_email_status: "not_confirmed", registry_status: "not_checked" } },
  current_user: { full_name: members[0].full_name, email: members[0].email, avatar_url: "" },
  membership_role: "owner", permissions, permission_catalog: permissions, pipeline_stages: stages,
  metrics: { open_jobs: jobs.length, applications: applications.length, scheduled_interviews: interviews.length },
  pipeline: Object.fromEntries(stages.map(stage => [stage, applications.filter(row => row.stage === stage).length])), recent_jobs: jobs,
};
const checkpoints = [{ id: "clarity", label: "Clear structure", source: "field:clarity", weight: 50, expected: "Clear introduction and supporting examples" }, { id: "accuracy", label: "Accuracy", source: "field:accuracy", weight: 50, expected: "Accurate supporting details" }];
const assessments = [
  { exam_id: 91001, title: "English Language Assessment · US", assessment_type: "english_language", status: "published", duration_minutes: 60, is_platform_default: true },
  { exam_id: 91002, title: "Excel · Financial analysis", assessment_type: "spreadsheet", status: "published", duration_minutes: 30, is_platform_default: true },
  { exam_id: 91003, title: "Customer success · Role readiness", assessment_type: "mcq", status: "draft", duration_minutes: 25, is_platform_default: false },
  { exam_id: 91004, title: "English Language Assessment · UK", assessment_type: "english_language", status: "published", duration_minutes: 60, is_platform_default: true },
  ...toolFixtures.assessments.filter(row => row.assessment_type !== "spreadsheet").map((row, index) => ({ exam_id: 91005 + index, title: row.title, assessment_type: row.assessment_type, status: "published", duration_minutes: row.duration_minutes, is_platform_default: true })),
].map(row => ({ ...row, pass_score: 65, timing_mode: "assessment", time_per_question_seconds: null, questions_per_attempt: 3, question_count: row.assessment_type === "mcq" ? 3 : 0, checkpoint_count: 2, template_key: `preview-${row.exam_id}`, template_version: 1,
  task: row.assessment_type === "english_language" ? (row.exam_id === 91004 ? englishAssessmentUk.task : englishAssessment.task) : row.assessment_type === "mcq" ? null : { title: row.title, description: "Sample assessment content for exploring the recruiter interface.", instructions: "Review the submitted work against the scoring criteria.", marks: 100, metadata: {}, expected_output: {}, grading_config: { checkpoints } },
}));
// Use full platform tasks, including evidence, workbook seed and scoring keys.
// Keep stable preview IDs so existing sample attempts still resolve.
for (const row of assessments) {
  const definition = toolFixtures.assessments.find(item => item.assessment_type === row.assessment_type);
  if (!definition) continue;
  Object.assign(row, {
    title: definition.title, pass_score: definition.pass_score,
    template_key: definition.id, template_version: toolFixtures.catalog_version,
    task: structuredClone(definition.task),
    checkpoint_count: definition.task.grading_config.checkpoints?.length || 0,
  });
}
const issued = candidates.slice(0, 6).map((candidate, i) => ({
  issued_id: 92000 + i, exam_id: assessments[i % 2].exam_id, internal_id: `PREVIEW-${i + 1}`,
  candidate_name: candidate.full_name, candidate_email: candidate.email, assessment_title: assessments[i % 2].title, assessment_type: assessments[i % 2].assessment_type,
  status: i < 2 ? "review_pending" : i < 4 ? "completed" : "issued", score_pct: i < 4 ? 72 + i * 4 : null, passed: i < 2 || i >= 4 ? null : true,
  completed_at: i < 4 ? "2026-09-06T09:30:00Z" : null, issued_at: createdAt, time_taken_seconds: i < 4 ? 1260 : null,
}));
const library = assessments.filter(row => row.is_platform_default).map(row => {
  const definition = toolFixtures.assessments.find(item => item.id === row.template_key);
  return { ...row, id: row.template_key, summary: definition?.summary || "Sample Valases library assessment", topics: definition?.topics || ["English communication"], review_required: true };
});
const billing = {
  provider: "cashfree", provider_ready: false, checkout_mode: "sandbox",
  account: { plan_code: "trial", status: "trial", currency: "INR", monthly_amount_minor: 0, billing_email: members[0].email, billing_phone: null, current_period_start: null, current_period_end: null, last_paid_at: null },
  plans: [{ code: "trial", name: "Preview trial", monthly_amount_minor: 0, currency: "INR", description: "Illustrative plan. Checkout is disabled in UI preview." }], orders: [],
};

export const PREVIEW_READ_ONLY_MESSAGE = "View-only preview: nothing was saved or sent. Use the signed-in workspace to make changes.";
export class PreviewRequestError extends Error {
  response: { status: number; data: { detail: string } };
  constructor(message: string, status = 403) {
    super(message);
    this.response = { status, data: { detail: message } };
  }
}

/** Strict allow-list: an unhandled endpoint must fail, never fall through to a server. */
export function previewResponse(method: string, url: string, params?: Record<string, unknown>): unknown {
  if (method.toLowerCase() !== "get") throw new PreviewRequestError(PREVIEW_READ_ONLY_MESSAGE);
  const path = url.split("?")[0];
  const routes: Record<string, unknown> = {
    "/hiring/workspace": workspace, "/hiring/jobs": jobs, "/hiring/candidates": candidates,
    "/hiring/applications": params?.stage ? applications.filter(row => row.stage === params.stage) : applications,
    "/hiring/interviews": interviews, "/hiring/offers": offers, "/hiring/onboarding": onboarding,
    "/hiring/integrations": integrations, "/hiring/members": members,
    "/hiring/email/status": { provider: "smtp", status: "not_configured", sender: "", sender_name: "Valases Preview", reply_to: "", channels_configured: 0, channels_total: 4 },
    "/hiring/email/channels": emailChannels,
    "/hiring/calendar/status": { status: "not_connected", provider: null, provider_label: null, available: false },
    "/hiring/automations/status": { supported: [], rules: [], execution_model: "external_trigger", delivery_count: 0, last_run_at: null, last_run: null },
    "/billing/organization/allowance": { paid_assess_enabled: true, month: "Demo", remaining: { candidates: 5, english_language: 5, mcq: 10 } },
    "/billing/organization": billing, "/auth/me/context": workspace.current_user,
    "/provider/workspace/assessments": assessments, "/exams/issued/by-me": issued, "/exams/default-library": library,
  };
  if (Object.hasOwn(routes, path)) return structuredClone(routes[path]);
  const application = applications.find(row => path === `/hiring/applications/${row.id}`);
  if (application) return structuredClone({ ...application, human_decision: null, job: jobs.find(row => row.id === application.job_id), screening: { match_score: null, confidence: null, recommendation: null, rationale: {} }, evidence_summary: { status: "more_evidence_required", human_review_required: true, screening_complete: false, scorecard_count: 0, interview_average: null, compliance_complete: false, blocking_checks: [], message: "Sample candidate record. No real screening has been performed." }, interviews: interviews.filter(row => row.application_id === application.id), scorecards: [], compliance_checks: [], stage_history: [{ id: 1, from_stage: null, to_stage: application.stage, reason: "Illustrative pipeline stage", created_at: createdAt }] });
  const attempt = issued.find(row => path === `/exams/issued/${row.issued_id}/review`);
  if (attempt) return structuredClone({ ...attempt, task: assessments.find(row => row.exam_id === attempt.exam_id)?.task, result: { provisional_score_pct: attempt.score_pct, detail: { checkpoints: checkpoints.map((row, i) => ({ ...row, matched: i === 0, earned_weight: i === 0 ? 50 : 22, actual: i === 0 ? row.expected : "Supporting details need verification" })) } }, submission: { submitted_at: attempt.completed_at, time_taken_seconds: attempt.time_taken_seconds, submitted_data: attempt.assessment_type === "english_language" ? { writing_responses: { sample: "Thank you for your enquiry. I will confirm the delivery schedule with our operations team today." }, objective_answers: {} } : { total_revenue: 250000, reporting_period: "September (sample)" }, proctoring_events: [] }, review_clips: [], language_responses: [] });
  const template = library.find(row => path === `/exams/default-library/${row.id}`);
  if (template) return structuredClone(template);
  const exam = assessments.find(row => path === `/exams/${row.exam_id}/questions`);
  if (exam) return exam.assessment_type === "mcq" ? [1, 2, 3].map(id => ({ question_id: id, question_text: "Which response best addresses the customer's immediate need? (Sample question)", question_type: "single", marks: 1, negative_marks: 0, options: [{ option_id: id * 10, option_text: "Clarify their request and confirm next steps", is_correct: true, position: 1 }, { option_id: id * 10 + 1, option_text: "Send a generic response", is_correct: false, position: 2 }] })) : [];
  throw new PreviewRequestError("This action is not available in the sample preview.", 404);
}
