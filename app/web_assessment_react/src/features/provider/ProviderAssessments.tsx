import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, RefreshCw, X } from "lucide-react";
import { BrandLogo } from "../../components/BrandLogo";
import { AssessmentToolIcon } from "../../components/AssessmentToolIcon";
import { api } from "../../lib/api";
import { useSessionStore } from "../../lib/sessionStore";
import { supabase } from "../../lib/supabase";
import type { ExcelAssessmentSubmission } from "../tools/ExcelSimulator";
import { ProctorEventReviewControls } from "./ProctorEventReviewControls";

const ExcelSimulator = lazy(() => import("../tools/ExcelSimulator").then((module) => ({ default: module.ExcelSimulator })));

function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

function readableReviewValue(value: unknown): string {
  if (value == null || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (Array.isArray(value)) return value.map(readableReviewValue).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key.replaceAll("_", " ")}: ${readableReviewValue(item)}`).join(" · ");
  return String(value);
}

type Assessment = {
  exam_id: number;
  title: string;
  status: string;
  pass_score: number;
  assessment_type: string;
  timing_mode: "question" | "assessment";
  duration_minutes: number;
  time_per_question_seconds: number | null;
  questions_per_attempt: number;
  question_count: number;
  checkpoint_count?: number;
  is_platform_default?: boolean;
  template_version?: number | null;
  task?: {
    title: string;
    description: string;
    instructions: string;
    marks: number;
    metadata: Record<string, unknown>;
    expected_output: Record<string, unknown>;
    grading_config: { checkpoints?: Array<{ id: string; label: string; weight: number; source: string; expected: unknown }> };
  } | null;
};

type QuestionOption = { option_text: string; is_correct: boolean; position: number };

type QuestionRow = {
  question_id: number;
  question_text: string;
  question_type: string;
  marks: number;
  negative_marks: number;
  options: { option_id: number; option_text: string; is_correct: boolean; position: number }[];
};

type IssuedRow = {
  issued_id: number;
  exam_id: number;
  internal_id: string;
  candidate_name: string;
  candidate_email: string;
  assessment_title: string;
  assessment_type?: string;
  status: string;
  score_pct: number | null;
  passed: boolean | null;
  completed_at?: string | null;
  issued_at?: string | null;
  time_taken_seconds?: number | null;
  submission_status?: string | null;
  access_expires_at?: string | null;
  invite_delivery?: { sent?: boolean; reason?: string | null } | null;
};

type ScreeningApplication = {
  id: number;
  job_title: string;
  stage: string;
  status: string;
  candidate: {
    id: number;
    full_name: string;
    email: string;
  };
};

type WorkspaceTab = "dashboard" | "assessments" | "publish" | "results";
type AssessmentToolFilter = "all" | "spreadsheet" | "coding" | "accounting" | "tax_simulator" | "tax_1120";

const WORKSPACE_TABS: WorkspaceTab[] = ["dashboard", "assessments", "publish", "results"];
const WORKSPACE_TAB_LABELS: Record<WorkspaceTab, string> = {
  dashboard: "Overview",
  assessments: "Library",
  publish: "Invitations",
  results: "Review queue",
};
const BUILDER_DRAFT_KEY = "valases:assessment-builder-draft";

type AccountContext = {
  full_name: string;
};

type DefaultAssessment = {
  id: string;
  title: string;
  summary: string;
  assessment_type: string;
  duration_minutes: number;
  pass_score: number;
  topics: string[];
  checkpoint_count: number;
  question_count: number;
  review_required: boolean;
};

type DefaultAssessmentDetail = DefaultAssessment & {
  task?: {
    expected_output?: Record<string, unknown>;
    grading_config?: { checkpoints?: BuilderCheckpoint[] };
    metadata?: {
      sections?: Array<{
        id: string;
        label: string;
        minutes?: number;
        description?: string;
        passage?: string;
        prompt?: string;
        audio?: Array<{ id: string; label: string }>;
        questions?: Array<{ id: string; prompt: string; options?: string[] }>;
      }>;
    };
  };
  scoring?: { checkpoints?: Array<{ id: string; label: string; weight: number; threshold: number }> };
  questions?: Array<{ question_text: string; competency?: string; difficulty?: string; options: Array<{ option_text: string; is_correct: boolean }> }>;
};

type BuilderCheckpoint = {
  id: string;
  label: string;
  source: string;
  comparator: "numeric" | "exact" | "contains" | "contains_all" | "regex" | "set_contains_all";
  expected: string;
  weight: number;
  tolerance: number;
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="9" r="5.2" />
      <path d="M13.4 13.4 17 17" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  );
}

function ToolGridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.07 14H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63h.01A1.7 1.7 0 0 0 10 3.07V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9v.01A1.7 1.7 0 0 0 20.93 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}

function NavIcon({ type }: { type: WorkspaceTab }) {
  if (type === "dashboard") {
    return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></svg>;
  }
  if (type === "assessments") {
    return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 4h12v12H4zM7 7h6M7 10h6M7 13h3" strokeLinecap="round"/></svg>;
  }
  if (type === "results") {
    return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 16V9M10 16V4M16 16v-6" strokeLinecap="round"/><path d="M3 16.5h14"/></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 4h8l2 2v10H4V6l2-2Z"/><path d="M7 9h6M7 12h6" strokeLinecap="round"/></svg>;
}

function StatusBadge({ value }: { value: string }) {
  const normalized = String(value || "draft").toLowerCase();
  return <span className={`status-badge status-${normalized.replace(/\s+/g, "-")}`}>{normalized}</span>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="workspace-empty-state">
      <span className="workspace-empty-icon" aria-hidden="true"><PlusIcon /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function AssessmentLoadError({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div className="assessment-service-error" role="alert">
      <div>
        <strong>Assessment service unavailable</strong>
        <span>We could not load your assessments. Check the service connection, then try again.</span>
      </div>
      <button type="button" onClick={onRetry} disabled={retrying}>
        <RefreshCw size={14} aria-hidden="true" />
        {retrying ? "Retrying..." : "Try again"}
      </button>
    </div>
  );
}

function ButtonBusyLabel({ label }: { label: string }) {
  return <><span className="workspace-button-spinner" aria-hidden="true" /><span>{label}</span></>;
}

function WorkspaceSkeleton({ rows = 4, variant = "list" }: { rows?: number; variant?: "list" | "cards" }) {
  return (
    <div className={`workspace-skeleton workspace-skeleton-${variant}`} role="status" aria-live="polite" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="workspace-skeleton-row" key={`skeleton-${index}`}>
          <span className="workspace-skeleton-icon" />
          <div><i /><i /></div>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 1) return "--";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatResultDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function ProviderAssessments({ embedded = false, onOpenPipeline }: { embedded?: boolean; onOpenPipeline?: () => void }) {
  const qc = useQueryClient();
  const clearSession = useSessionStore((state) => state.clear);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [toolFilter, setToolFilter] = useState<AssessmentToolFilter>("all");
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [issueExamId, setIssueExamId] = useState<number | null>(null);
  const [candidateApplicationId, setCandidateApplicationId] = useState<number | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [issueNotice, setIssueNotice] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [questionType, setQuestionType] = useState<"mcq_single_correct" | "mcq_multiple_correct">("mcq_single_correct");
  const [marks, setMarks] = useState(1);
  const [negativeMarks, setNegativeMarks] = useState(0);
  const [options, setOptions] = useState<QuestionOption[]>([
    { option_text: "", is_correct: true, position: 1 },
    { option_text: "", is_correct: false, position: 2 },
    { option_text: "", is_correct: false, position: 3 },
    { option_text: "", is_correct: false, position: 4 },
  ]);
  const [form, setForm] = useState({
    title: "",
    instructions: "",
    about: "",
    tools: "",
    topics: "",
    pass_score: 70,
    assessment_type: "mcq" as "mcq" | "spreadsheet" | "coding" | "accounting" | "tax_simulator" | "tax_1120" | "case_study" | "english_language",
    max_attempts: 3,
    questions_per_attempt: 25,
    timing_mode: "question" as "question" | "assessment",
    duration_minutes: 25,
    time_per_question_seconds: 25,
    negative_marking: false,
    task_prompt: "",
    task_marks: 25,
    attachment_links: "",
    answer_format: "long_text" as "long_text" | "file_or_text" | "code",
    coding_language: "javascript",
    starter_code: "",
    test_cases: "",
    grading_rubric: "",
    expected_values: "",
    red_flags: "",
    manual_review: true,
  });
  const [showBuilder, setShowBuilder] = useState(false);
  const [excelTemplate, setExcelTemplate] = useState<ExcelAssessmentSubmission | null>(null);
  const [reviewIssueId, setReviewIssueId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [resultAssessmentFilter, setResultAssessmentFilter] = useState("all");
  const [resultStatusFilter, setResultStatusFilter] = useState("all");
  const [builderStep, setBuilderStep] = useState(1);
  const [checkpoints, setCheckpoints] = useState<BuilderCheckpoint[]>([
    { id: "checkpoint-1", label: "Required result", source: "field:result", comparator: "numeric", expected: "", weight: 100, tolerance: 0.01 },
  ]);
  const [reviewScore, setReviewScore] = useState(0);
  const [reviewNotes, setReviewNotes] = useState("");
  const [previewDefaultId, setPreviewDefaultId] = useState<string | null>(null);
  const [previewAssessmentId, setPreviewAssessmentId] = useState<number | null>(null);
  const [selectedDefaultId, setSelectedDefaultId] = useState("");
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [builderSaveState, setBuilderSaveState] = useState<"saved" | "saving">("saved");

  const account = useQuery({
    queryKey: ["auth-me-context"],
    enabled: !embedded,
    queryFn: async () => (await api.get<AccountContext>("/auth/me/context")).data,
  });

  const exams = useQuery({
    queryKey: ["provider-assessments"],
    queryFn: async () => (await api.get<Assessment[]>("/provider/workspace/assessments")).data,
  });

  const questions = useQuery({
    queryKey: ["provider-assessment-questions", selectedExamId],
    enabled: Boolean(selectedExamId),
    queryFn: async () => (await api.get<QuestionRow[]>(`/exams/${selectedExamId}/questions`)).data,
  });

  const issued = useQuery({
    queryKey: ["issued-by-me"],
    queryFn: async () => (await api.get<IssuedRow[]>("/exams/issued/by-me")).data,
  });

  const screeningApplications = useQuery({
    queryKey: ["hiring", "applications", "screening"],
    queryFn: async () => (await api.get<ScreeningApplication[]>("/hiring/applications", { params: { stage: "screening" } })).data,
  });

  const defaultAssessments = useQuery({
    queryKey: ["default-assessment-library"],
    queryFn: async () => (await api.get<DefaultAssessment[]>("/exams/default-library")).data,
  });

  const defaultAssessmentDetail = useQuery({
    queryKey: ["default-assessment-detail", previewDefaultId],
    enabled: Boolean(previewDefaultId),
    queryFn: async () => (await api.get<DefaultAssessmentDetail>(`/exams/default-library/${previewDefaultId}`)).data,
  });

  const review = useQuery({
    queryKey: ["issued-review", reviewIssueId],
    enabled: Boolean(reviewIssueId),
    queryFn: async () => (await api.get(`/exams/issued/${reviewIssueId}/review`)).data,
  });

  useEffect(() => {
    if (!review.data) return;
    const provisional = Number(review.data.result?.provisional_score_pct ?? review.data.score_pct ?? 0);
    setReviewScore(Number.isFinite(provisional) ? provisional : 0);
    setReviewNotes(String(review.data.result?.review?.notes || ""));
  }, [review.data]);

  useEffect(() => {
    if (!reviewIssueId && !previewAssessmentId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReviewIssueId(null);
        setPreviewAssessmentId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewAssessmentId, reviewIssueId]);

  useEffect(() => {
    if (!showBuilder) return;
    setBuilderSaveState("saving");
    const saveTimer = window.setTimeout(() => {
      window.sessionStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify({ form, checkpoints, builderStep }));
      setBuilderSaveState("saved");
    }, 500);
    return () => window.clearTimeout(saveTimer);
  }, [builderStep, checkpoints, form, showBuilder]);

  const installDefault = useMutation({
    mutationFn: async (templateId: string) => (await api.post(`/exams/default-library/${templateId}/install`)).data,
    onSuccess: async (data) => {
      setSelectedExamId(Number(data.id));
      setIssueExamId(Number(data.id));
      setActiveTab("publish");
      await qc.invalidateQueries({ queryKey: ["provider-assessments"] });
    },
  });

  const finalizeReview = useMutation({
    mutationFn: async () => {
      if (!reviewIssueId) throw new Error("Select a submission first.");
      return (await api.post(`/exams/issued/${reviewIssueId}/review/finalize`, { score_pct: reviewScore, reviewer_notes: reviewNotes })).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["issued-review", reviewIssueId] });
      await qc.invalidateQueries({ queryKey: ["issued-by-me"] });
      await qc.invalidateQueries({ queryKey: ["hiring"] });
    },
  });

  const createAssessment = useMutation({
    mutationFn: async () => {
      const assessmentType = form.assessment_type;
      const primaryTool = assessmentType === "spreadsheet" ? "Excel" : assessmentType === "coding" ? "Coding environment" : assessmentType === "accounting" ? "Accounting workspace" : assessmentType === "tax_simulator" ? "1040 Individual Tax" : assessmentType === "tax_1120" ? "1120 Corporate Tax" : "Assessment workspace";
      const payload = {
        title: form.title,
        assessment_type: assessmentType,
        instructions: form.instructions,
        about: form.about,
        tools: [
          ...new Set([primaryTool, ...form.tools.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean)].filter(Boolean)),
        ],
        topics: form.topics.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean),
        duration_minutes: Number(form.duration_minutes),
        timing_mode: assessmentType === "mcq" ? form.timing_mode : "assessment",
        time_per_question_seconds:
          assessmentType === "mcq" && form.timing_mode === "question" ? Number(form.time_per_question_seconds) : null,
        questions_per_attempt: assessmentType === "mcq" ? Number(form.questions_per_attempt) : 0,
        pass_score: Number(form.pass_score),
        negative_marking: Boolean(form.negative_marking),
        shuffle_questions: false,
        shuffle_options: false,
        max_attempts: Number(form.max_attempts),
        certificate_enabled: false,
      };
      const created = (await api.post("/exams", payload)).data;
      if (assessmentType !== "mcq") {
        const normalizedCheckpoints = checkpoints
          .filter((checkpoint) => checkpoint.label.trim() && checkpoint.source.trim() && checkpoint.weight > 0)
          .map((checkpoint) => {
            const expected = checkpoint.comparator === "numeric" && checkpoint.expected.trim() !== ""
              ? Number(checkpoint.expected)
              : ["contains_all", "set_contains_all"].includes(checkpoint.comparator)
                ? checkpoint.expected.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
                : checkpoint.expected;
            return { ...checkpoint, expected };
          });
        const attachments = form.attachment_links
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean)
          .map((url) => ({ name: url.split("/").pop() || "Reference", url }));
        const baseTask = {
          type: assessmentType,
          title: form.title,
          description: form.task_prompt,
          instructions: form.instructions,
          marks: Number(form.task_marks),
          metadata: { attachments, answer_format: form.answer_format },
          expected_output: {},
          grading_config: { evaluation_mode: "deterministic", manual_review_required: form.manual_review, checkpoints: normalizedCheckpoints },
        };
        if (assessmentType === "coding") {
          const testCases = form.test_cases.split(/\r?\n/).map((line, index) => {
            const [name, expectedOutput] = line.split("|").map((value) => value.trim());
            return expectedOutput ? { name: name || `Test ${index + 1}`, expected_output: expectedOutput } : null;
          }).filter(Boolean);
          await api.put(`/exams/${created.id}/task`, {
            ...baseTask,
            metadata: { ...baseTask.metadata, language: form.coding_language, starter_code: form.starter_code },
            expected_output: { test_cases: testCases },
            grading_config: { evaluation_mode: "deterministic_static_review", manual_review_required: true, checkpoints: normalizedCheckpoints },
          });
        } else if (assessmentType === "tax_simulator" || assessmentType === "tax_1120" || assessmentType === "accounting") {
          const expectedFormValues = Object.fromEntries(form.expected_values.split(/\r?\n/).map((line) => {
            const separator = line.indexOf("=");
            return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : null;
          }).filter((entry): entry is [string, string] => Boolean(entry)));
          await api.put(`/exams/${created.id}/task`, {
            ...baseTask,
            metadata: { ...baseTask.metadata, workspace: assessmentType === "tax_simulator" ? "tax" : assessmentType === "tax_1120" ? "tax_1120" : "accounting", form_fields: [...new Set(normalizedCheckpoints.filter((item) => String(item.source).startsWith("field:")).map((item) => String(item.source).split(":", 2)[1]))] },
            expected_output: {
              expected_form_values: expectedFormValues,
              red_flags: form.red_flags.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
            },
          });
        } else if (assessmentType === "case_study") {
          await api.put(`/exams/${created.id}/task`, {
            ...baseTask,
            grading_config: { evaluation_mode: "deterministic_with_review", manual_review_required: true, rubric: form.grading_rubric, checkpoints: normalizedCheckpoints },
            expected_output: { rubric: form.grading_rubric },
          });
        } else if (assessmentType === "spreadsheet") {
        const sheet = excelTemplate?.final_sheet_json || {
          A1: "Metric",
          B1: "Value",
          A2: "Sales",
          B2: 125000,
          A3: "Cost",
          B3: 76000,
          A4: "Profit",
          B4: "=B2-B3",
          A5: "Margin %",
          B5: "=ROUND(B4/B2,3)",
        };
        await api.put(`/exams/${created.id}/task`, {
          type: "spreadsheet",
          title: form.title || "Excel Assessment",
          description: form.about || "Complete the workbook using Excel formulas.",
          instructions: form.instructions || "Edit only unlocked answer cells.",
          marks: Number(form.task_marks),
          metadata: {
            initial_spreadsheet_data: sheet,
            locked_cells: excelTemplate?.locked_cells || ["A1", "B1", "A2", "B2", "A3", "B3", "A4", "A5"],
            attachments,
            answer_format: "spreadsheet",
          },
          expected_output: {},
          grading_config: {
            auto_grading_enabled: true,
            evaluation_mode: "deterministic",
            checkpoints: normalizedCheckpoints,
          },
        });
        }
      }
      return created;
    },
    onSuccess: async (data) => {
      setSelectedExamId(Number(data.id));
      setShowBuilder(false);
      setActiveTab("publish");
      window.sessionStorage.removeItem(BUILDER_DRAFT_KEY);
      await qc.invalidateQueries({ queryKey: ["provider-assessments"] });
    },
  });

  const addQuestion = useMutation({
    mutationFn: async () => {
      if (!selectedExamId) throw new Error("Select assessment first.");
      const normalized = options
        .map((o, i) => ({ ...o, position: i + 1, option_text: String(o.option_text || "").trim() }))
        .filter((o) => o.option_text);
      const payload = {
        question_text: questionText,
        question_type: questionType,
        marks: Number(marks),
        negative_marks: Number(negativeMarks),
        options: normalized,
      };
      return (await api.post(`/exams/${selectedExamId}/questions`, payload)).data;
    },
    onSuccess: async () => {
      setQuestionText("");
      setOptions([
        { option_text: "", is_correct: true, position: 1 },
        { option_text: "", is_correct: false, position: 2 },
        { option_text: "", is_correct: false, position: 3 },
        { option_text: "", is_correct: false, position: 4 },
      ]);
      await qc.invalidateQueries({ queryKey: ["provider-assessment-questions", selectedExamId] });
      await qc.invalidateQueries({ queryKey: ["provider-assessments"] });
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!selectedExamId) throw new Error("Select assessment first.");
      return (await api.post(`/exams/${selectedExamId}/publish`)).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["provider-assessments"] });
    },
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!issueExamId) throw new Error("Select exam to issue.");
      return (
        await api.post(`/exams/${issueExamId}/issue`, {
          application_id: candidateApplicationId,
          candidate_name: candidateName,
          candidate_email: candidateEmail,
        })
      ).data;
    },
    onSuccess: async (data) => {
      setCandidateName("");
      setCandidateEmail("");
      setCandidateApplicationId(null);
      setIssueNotice(data?.email_delivery?.sent
        ? "Invitation sent. The candidate received the secure assessment link."
        : `Assessment issued, but email delivery failed: ${data?.email_delivery?.reason || "SMTP settings are incomplete."} Use the secure link and temporary password shown by the API response.`);
      await qc.invalidateQueries({ queryKey: ["issued-by-me"] });
      await qc.invalidateQueries({ queryKey: ["provider-assessments"] });
      await qc.invalidateQueries({ queryKey: ["hiring"] });
    },
  });

  const resendInvitation = useMutation({
    mutationFn: async (issuedId: number) => (await api.post(`/exams/issued/${issuedId}/resend`)).data,
    onSuccess: async (data) => {
      setIssueNotice(data?.email_delivery?.sent
        ? "A new secure link and password were sent to the candidate."
        : `New credentials were created, but email delivery failed: ${data?.email_delivery?.reason || "Check the SMTP configuration."}`);
      await qc.invalidateQueries({ queryKey: ["issued-by-me"] });
    },
  });

  const revokeInvitation = useMutation({
    mutationFn: async (issuedId: number) => (
      await api.post(`/exams/issued/${issuedId}/revoke`, { reason: "Revoked by recruiter" })
    ).data,
    onSuccess: async () => {
      setIssueNotice("The assessment invitation was revoked and its active session was closed.");
      await qc.invalidateQueries({ queryKey: ["issued-by-me"] });
    },
  });

  const assessmentRows = exams.data || [];
  const issuedRows = issued.data || [];
  const searchToken = searchQuery.trim().toLowerCase();
  const filteredAssessments = useMemo(
    () => assessmentRows.filter((row) => {
      const matchesTool = toolFilter === "all" || row.assessment_type === toolFilter;
      const matchesSearch = !searchToken
        || [row.title, row.status, row.assessment_type].some((value) => String(value).toLowerCase().includes(searchToken));
      return matchesTool && matchesSearch;
    }),
    [assessmentRows, searchToken, toolFilter],
  );
  const filteredDefaultAssessments = useMemo(
    () => (defaultAssessments.data || []).filter((row) => toolFilter === "all" || row.assessment_type === toolFilter),
    [defaultAssessments.data, toolFilter],
  );
  const selectedDefaultTemplate = useMemo(
    () => filteredDefaultAssessments.find((template) => template.id === selectedDefaultId) || null,
    [filteredDefaultAssessments, selectedDefaultId],
  );
  const previewAssessment = useMemo(
    () => assessmentRows.find((assessment) => assessment.exam_id === previewAssessmentId) || null,
    [assessmentRows, previewAssessmentId],
  );

  const switchAssessmentTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setToolMenuOpen(false);
  };
  const filteredIssued = useMemo(
    () =>
      searchToken
        ? issuedRows.filter((row) =>
            [row.assessment_title, row.candidate_email, row.internal_id, row.status].some((value) =>
              String(value).toLowerCase().includes(searchToken),
            ),
          )
        : issuedRows,
    [issuedRows, searchToken],
  );
  const selectedExam = useMemo(
    () => assessmentRows.find((x) => x.exam_id === selectedExamId) || null,
    [assessmentRows, selectedExamId],
  );
  const issueSelectedExam = useMemo(
    () => assessmentRows.find((assessment) => assessment.exam_id === issueExamId) || null,
    [assessmentRows, issueExamId],
  );
  const publishedCount = assessmentRows.filter((x) => x.status === "published").length;
  const draftCount = assessmentRows.filter((x) => x.status !== "published").length;
  const activeIssueCount = issuedRows.filter((row) => !["review_pending", "reviewed", "completed"].includes(row.status)).length;
  const completedIssueCount = issuedRows.filter((row) => ["review_pending", "reviewed", "completed"].includes(row.status)).length;
  const scoredResults = issuedRows.filter((row) => row.score_pct != null);
  const passedResults = scoredResults.filter((row) => row.passed === true);
  const averageScore = scoredResults.length ? scoredResults.reduce((sum, row) => sum + Number(row.score_pct || 0), 0) / scoredResults.length : 0;
  const passRate = scoredResults.length ? (passedResults.length / scoredResults.length) * 100 : 0;
  const pendingReviewCount = issuedRows.filter((row) => row.status === "review_pending").length;
  const activeIssuedRows = filteredIssued.filter((row) => !["review_pending", "reviewed", "completed"].includes(row.status) && row.passed == null);
  const revokingIssuedId = revokeInvitation.isPending ? revokeInvitation.variables : null;
  const resendingIssuedId = resendInvitation.isPending ? resendInvitation.variables : null;
  const resultRows = issuedRows.filter((row) => {
    if (!["review_pending", "reviewed", "completed"].includes(row.status) && row.passed == null) return false;
    const assessmentMatches = resultAssessmentFilter === "all" || String(row.exam_id) === resultAssessmentFilter;
    const statusMatches = resultStatusFilter === "all"
      || (resultStatusFilter === "passed" && row.passed === true)
      || (resultStatusFilter === "failed" && row.passed === false)
      || (resultStatusFilter === "review" && row.status === "review_pending")
      || row.status === resultStatusFilter;
    return assessmentMatches && statusMatches;
  }).sort((left, right) => Number(right.status === "review_pending") - Number(left.status === "review_pending"));
  const assessmentMetrics = assessmentRows.map((assessment) => {
    const attempts = issuedRows.filter((row) => row.exam_id === assessment.exam_id);
    const completed = attempts.filter((row) => ["review_pending", "reviewed", "completed"].includes(row.status));
    const scored = completed.filter((row) => row.score_pct != null);
    const average = scored.length ? scored.reduce((sum, row) => sum + Number(row.score_pct || 0), 0) / scored.length : 0;
    const passed = scored.filter((row) => row.passed === true).length;
    return { assessment, attempts: attempts.length, completed: completed.length, average, passRate: scored.length ? (passed / scored.length) * 100 : 0 };
  }).filter((metric) => metric.attempts > 0);
  const validQuestionOptions = options.filter((option) => option.option_text.trim());
  const isMcqForm = form.assessment_type === "mcq";
  const checkpointWeight = checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.weight || 0), 0);
  const checkpointsAreComplete = checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.label.trim() && checkpoint.source.trim() && checkpoint.expected.trim() && checkpoint.weight > 0);
  const builderBasicsComplete = form.title.trim().length >= 3
    && form.about.trim().length >= 3
    && form.topics.trim().length >= 2
    && form.duration_minutes > 0;
  const builderTaskComplete = form.instructions.trim().length >= 3
    && (isMcqForm || (form.task_prompt.trim().length >= 10 && form.task_marks > 0));
  const builderKeyComplete = isMcqForm || (checkpointsAreComplete && checkpointWeight === 100);
  const builderStepCanContinue = builderStep === 1
    ? builderBasicsComplete
    : builderStep === 2
      ? builderTaskComplete
      : builderStep === 3
        ? builderKeyComplete
        : true;
  const canCreateAssessment = form.title.trim().length >= 3
    && form.instructions.trim().length >= 3
    && form.about.trim().length >= 3
    && form.topics.trim().length >= 2
    && form.duration_minutes > 0
    && form.pass_score >= 70
    && form.pass_score <= 100
    && (isMcqForm || (form.task_prompt.trim().length >= 10 && form.task_marks > 0 && checkpointsAreComplete && checkpointWeight === 100));
  const canAddQuestion = questionText.trim().length >= 5 && validQuestionOptions.length >= 2 && validQuestionOptions.some((option) => option.is_correct);
  const canIssueAssessment = Boolean(issueExamId && candidateApplicationId && candidateName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail.trim()));
  const accountName = account.data?.full_name?.trim() || "Recruiter";
  const accountInitials = accountName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const pageCopy = {
    dashboard: ["Overview", "See what needs attention and move assessment work forward."],
    assessments: ["Assessment library", "Create, organize, and prepare assessments for candidates."],
    publish: ["Invitations", "Send published assessments and monitor active candidate sessions."],
    results: ["Review queue", "Resolve submissions that need a recruiter decision first."],
  } as const;
  const tabCounts: Record<WorkspaceTab, number> = {
    dashboard: pendingReviewCount + draftCount,
    assessments: assessmentRows.length,
    publish: activeIssueCount,
    results: pendingReviewCount,
  };

  const startAssessmentBuilder = () => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(BUILDER_DRAFT_KEY) || "null") as { form?: Partial<typeof form>; checkpoints?: BuilderCheckpoint[]; builderStep?: number } | null;
      if (saved?.form) setForm((current) => ({ ...current, ...saved.form }));
      if (Array.isArray(saved?.checkpoints) && saved.checkpoints.length) setCheckpoints(saved.checkpoints);
      setBuilderStep(Math.min(4, Math.max(1, Number(saved?.builderStep || 1))));
    } catch {
      setBuilderStep(1);
    }
    switchAssessmentTab("assessments");
    setShowBuilder(true);
  };

  const openInvitationFlow = (assessment: Assessment) => {
    setSelectedExamId(assessment.exam_id);
    setIssueExamId(assessment.status === "published" ? assessment.exam_id : null);
    switchAssessmentTab("publish");
  };

  const logout = async () => {
    try {
      if (supabase) await supabase.auth.signOut();
    } finally {
      clearSession();
    }
  };

  return (
    <section className={`provider-workspace hrms-shell ${embedded ? "provider-embedded" : ""}${showBuilder ? " assessment-builder-mode" : ""}`}>
      {!embedded && <aside className="workspace-rail">
        <div className="workspace-rail-brand">
          <BrandLogo className="workspace-brand-logo" />
        </div>
        <div className="workspace-rail-label">Workspace</div>
        <nav className="workspace-rail-nav" aria-label="Workspace navigation">
          {WORKSPACE_TABS.map((tab) => (
            <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => switchAssessmentTab(tab)}>
              <NavIcon type={tab} />
              <span>{WORKSPACE_TAB_LABELS[tab]}</span>
              {tabCounts[tab] > 0 && <em>{tabCounts[tab]}</em>}
            </button>
          ))}
        </nav>
        <div className="workspace-rail-footer">
          <button type="button" onClick={() => setShowSettings(true)}><SettingsIcon /><span>Settings</span></button>
          <div className="workspace-user-chip"><span>{accountInitials}</span><div><strong>{accountName}</strong></div></div>
        </div>
      </aside>}

      <main className={`workspace-product-main${embedded ? " assessment-section-page" : ""}`}>
      {embedded && <nav className="assessment-section-nav" aria-label="Assessment workspace navigation">
        {WORKSPACE_TABS.map((tab) => (
          <button key={tab} type="button" aria-current={activeTab === tab ? "page" : undefined} className={activeTab === tab ? "active" : ""} onClick={() => switchAssessmentTab(tab)}>
            <span>{WORKSPACE_TAB_LABELS[tab]}</span>
            <strong aria-label={`${tabCounts[tab]} items`}>{tabCounts[tab]}</strong>
          </button>
        ))}
      </nav>}
      <div className="assessment-section-content">
      <header className="workspace-appbar">
        <div className="workspace-appbar-left">
          <div className="workspace-appbar-title">
            <strong>{pageCopy[activeTab][0]}</strong>
            <span>{pageCopy[activeTab][1]}</span>
          </div>
        </div>
        <div className="workspace-appbar-right">
          {activeTab === "assessments" && <details className="workspace-tool-menu" open={toolMenuOpen} onToggle={(event) => setToolMenuOpen(event.currentTarget.open)}>
            <summary className={`workspace-tools-mark${toolFilter !== "all" ? " active" : ""}`} title="Filter by assessment tool" aria-label="Filter by assessment tool">
              <ToolGridIcon />
            </summary>
            <div className="workspace-tool-menu-panel" role="menu" aria-label="Assessment tools">
              <button type="button" role="menuitem" className={toolFilter === "all" ? "active" : ""} onClick={() => { setToolFilter("all"); setSelectedDefaultId(""); setToolMenuOpen(false); }}>
                <span className="workspace-tool-menu-glyph"><ToolGridIcon /></span>
                <span><strong>All tools</strong><small>Show every assessment</small></span>
              </button>
              {([
                ["spreadsheet", "Microsoft Excel"],
                ["coding", "Visual Studio Code"],
                ["accounting", "LedgeBook"],
                ["tax_simulator", "1040 Individual Tax"],
                ["tax_1120", "1120 Corporate Tax"],
              ] as Array<[Exclude<AssessmentToolFilter, "all">, string]>).map(([assessmentType, label]) => (
                <button type="button" role="menuitem" key={assessmentType} className={toolFilter === assessmentType ? "active" : ""} onClick={() => { setToolFilter(assessmentType); setSelectedDefaultId(""); switchAssessmentTab("assessments"); }}>
                  <AssessmentToolIcon assessmentType={assessmentType} />
                  <span><strong>{label}</strong><small>Filter assessment library</small></span>
                </button>
              ))}
            </div>
          </details>}
          {activeTab !== "publish" && <label className="workspace-search">
            <SearchIcon />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === "results" ? "Search candidates or assessments" : "Search assessments"}
              aria-label="Search workspace"
            />
          </label>}
          {(activeTab === "dashboard" || activeTab === "assessments") && <button
            type="button"
            className="workspace-new-btn"
            aria-label="Create new assessment"
            onClick={startAssessmentBuilder}
            title="New assessment"
          >
            <PlusIcon />
            <span>New assessment</span>
          </button>}
        </div>
      </header>

      {activeTab === "dashboard" && (
        <section className="workspace-dashboard">
          <div className="workspace-kpi-grid">
            <button type="button" className={`workspace-kpi-card${pendingReviewCount ? " attention" : ""}`} onClick={() => { setResultStatusFilter("review"); switchAssessmentTab("results"); }}>
              <span>Needs review</span>
              <strong>{pendingReviewCount}</strong>
              <small>{pendingReviewCount ? "Recruiter decisions required" : "No submissions waiting"}</small>
            </button>
            <button type="button" className="workspace-kpi-card" onClick={() => switchAssessmentTab("assessments")}>
              <span>Drafts to finish</span>
              <strong>{draftCount}</strong>
              <small>{publishedCount} assessments are ready to send</small>
            </button>
            <button type="button" className="workspace-kpi-card" onClick={() => switchAssessmentTab("publish")}>
              <span>Active invitations</span>
              <strong>{activeIssueCount}</strong>
              <small>{issuedRows.length} total candidates issued</small>
            </button>
            <button type="button" className="workspace-kpi-card" onClick={() => { setResultStatusFilter("all"); switchAssessmentTab("results"); }}>
              <span>Completed attempts</span>
              <strong>{completedIssueCount}</strong>
              <small>Open scored and reviewed outcomes</small>
            </button>
          </div>

          <div className="workspace-dashboard-grid">
            <section className="workspace-surface">
              <div className="workspace-surface-head">
                <div>
                  <h3>Recent assessments</h3>
                  <p>Track what is live, what still needs setup, and what to review next.</p>
                </div>
              </div>
              <div className="assessment-table">
                {exams.isLoading && <WorkspaceSkeleton rows={5} />}
                {exams.isError && <AssessmentLoadError retrying={exams.isFetching} onRetry={() => void exams.refetch()} />}
                {!exams.isError && filteredAssessments.slice(0, 6).map((assessment) => (
                  <button
                    key={assessment.exam_id}
                    type="button"
                    className="assessment-table-row"
                    onClick={() => assessment.status === "published" ? openInvitationFlow(assessment) : setPreviewAssessmentId(assessment.exam_id)}
                  >
                    <div>
                      <strong>{assessment.title}</strong>
                      <small>{assessment.assessment_type}{assessment.is_platform_default ? ` | Default v${assessment.template_version}` : ""}</small>
                    </div>
                    <StatusBadge value={assessment.status} />
                    <span>{assessment.assessment_type === "mcq" ? `${assessment.question_count} questions` : `${assessment.checkpoint_count || 0} checkpoints`}</span>
                  </button>
                ))}
                {!exams.isLoading && !exams.isError && filteredAssessments.length === 0 && (
                  <EmptyState title="No assessments yet" detail="Create your first assessment to begin inviting candidates." action={<button type="button" onClick={startAssessmentBuilder}>Create assessment</button>} />
                )}
              </div>
            </section>

            <section className="workspace-surface">
              <div className="workspace-surface-head">
                <div>
                  <h3>Issued activity</h3>
                  <p>See which candidate assessments are active and which ones are completed.</p>
                </div>
              </div>
              <div className="issued-list-panel">
                {issued.isLoading && <WorkspaceSkeleton rows={5} />}
                {filteredIssued.slice(0, 6).map((row) => (
                  <article key={`${row.internal_id}-${row.candidate_email}`} className="issued-list-row">
                    <div>
                      <strong>{row.assessment_title}</strong>
                      <small>{row.candidate_email}{row.invite_delivery?.sent === false ? " | Delivery failed" : ""}</small>
                    </div>
                    <StatusBadge value={row.status} />
                    <div className="issued-list-actions">
                      {["issued", "revoked"].includes(row.status) && (
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={resendInvitation.isPending}
                          onClick={() => void resendInvitation.mutate(row.issued_id)}
                        >
                          {resendingIssuedId === row.issued_id ? <ButtonBusyLabel label="Sending..." /> : "Resend"}
                        </button>
                      )}
                      {["issued", "started"].includes(row.status) && (
                        <button
                          type="button"
                          className="issued-revoke-btn"
                          disabled={revokeInvitation.isPending}
                          onClick={() => {
                            if (window.confirm("Revoke this invitation and close any active candidate session?")) {
                              revokeInvitation.mutate(row.issued_id);
                            }
                          }}
                        >
                          {revokingIssuedId === row.issued_id ? <ButtonBusyLabel label="Revoking..." /> : "Revoke"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!issued.isLoading && filteredIssued.length === 0 && <EmptyState title="No candidate activity" detail="Send a published assessment to a screening candidate." action={<button type="button" onClick={() => switchAssessmentTab("publish")}>Open invitations</button>} />}
              </div>
            </section>
          </div>
        </section>
      )}

      {activeTab === "assessments" && (
        <section className={`workspace-library${showBuilder ? " assessment-builder-only" : ""}`}>
          <div className="workspace-main-column">
            <section className="workspace-surface">
              <div className="workspace-surface-head">
                <div><h3>Your assessments</h3><p>Keep drafts moving and send published assessments from one place.</p></div>
              </div>
              <div className="assessment-library-list">
                {exams.isLoading && <WorkspaceSkeleton rows={6} />}
                {exams.isError && <AssessmentLoadError retrying={exams.isFetching} onRetry={() => void exams.refetch()} />}
                {!exams.isLoading && !exams.isError && filteredAssessments.length > 0 && <div className="assessment-library-header" aria-hidden="true"><span /><span>Assessment</span><span>Content</span><span>Status</span><span>Action</span></div>}
                {!exams.isError && filteredAssessments.map((assessment) => (
                  <article className="assessment-library-row" key={assessment.exam_id}>
                    <AssessmentToolIcon assessmentType={assessment.assessment_type} title={assessment.title} />
                    <div><button type="button" className="assessment-title-button" onClick={() => setPreviewAssessmentId(assessment.exam_id)}>{assessment.title}</button><small>{assessment.assessment_type.replaceAll("_", " ")} | {assessment.duration_minutes} min</small></div>
                    <span>{assessment.assessment_type === "mcq" ? `${assessment.question_count} questions` : `${assessment.checkpoint_count || 0} checkpoints`}</span>
                    <StatusBadge value={assessment.status} />
                    <button type="button" onClick={() => openInvitationFlow(assessment)}>
                      {assessment.status === "published" ? "Send invitation" : "Continue setup"}
                    </button>
                  </article>
                ))}
                {!exams.isLoading && !exams.isError && filteredAssessments.length === 0 && <EmptyState title="No matching assessments" detail="Clear the search or create a new assessment." action={<button type="button" onClick={startAssessmentBuilder}>Create assessment</button>} />}
              </div>
            </section>

            <section className="workspace-surface default-library">
              <div className="workspace-surface-head"><div><h3>Create from a template</h3><p>Start with a validated assessment and tailor it to the role.</p></div></div>
              <div className="default-template-bar">
                <div><strong>Validated templates</strong><span>{filteredDefaultAssessments.length} available{toolFilter !== "all" ? ` for ${toolFilter.replaceAll("_", " ")}` : ""}</span></div>
                <label>
                  <span>Default assessment</span>
                  <select value={selectedDefaultId} onChange={(event) => { setSelectedDefaultId(event.target.value); setPreviewDefaultId(""); }}>
                    <option value="">Select a template</option>
                    {filteredDefaultAssessments.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                  </select>
                </label>
                <button type="button" className="secondary-btn" disabled={!selectedDefaultTemplate} onClick={() => selectedDefaultTemplate && setPreviewDefaultId((current) => current === selectedDefaultTemplate.id ? null : selectedDefaultTemplate.id)}>Preview</button>
                <button type="button" disabled={!selectedDefaultTemplate || installDefault.isPending} onClick={() => selectedDefaultTemplate && installDefault.mutate(selectedDefaultTemplate.id)}>{installDefault.isPending && installDefault.variables === selectedDefaultTemplate?.id ? <ButtonBusyLabel label="Adding..." /> : "Add"}</button>
              </div>
              {defaultAssessments.isLoading && <WorkspaceSkeleton rows={2} />}
              {selectedDefaultTemplate && <div className="default-template-summary">
                <AssessmentToolIcon assessmentType={selectedDefaultTemplate.assessment_type} title={selectedDefaultTemplate.title} />
                <div><strong>{selectedDefaultTemplate.title}</strong><small>{selectedDefaultTemplate.summary}</small></div>
                <span>{selectedDefaultTemplate.duration_minutes} min</span>
                <span>{selectedDefaultTemplate.question_count ? `${selectedDefaultTemplate.question_count} questions` : `${selectedDefaultTemplate.checkpoint_count} checkpoints`}</span>
              </div>}
              {previewDefaultId && defaultAssessmentDetail.data && <div className="default-key-preview"><div className="workspace-surface-head"><div><strong>{defaultAssessmentDetail.data.title}</strong><p>Answer key and scoring checkpoints</p></div><button type="button" className="workspace-icon-btn" aria-label="Close scoring key" onClick={() => setPreviewDefaultId(null)}><X size={17} /></button></div>
                {(defaultAssessmentDetail.data.scoring?.checkpoints || []).length > 0 && <div className="key-checkpoint-list">{(defaultAssessmentDetail.data.scoring?.checkpoints || []).map((checkpoint) => <div key={checkpoint.id}><strong>{checkpoint.label}</strong><span>{checkpoint.weight}%</span><small>Minimum checkpoint score: {checkpoint.threshold}%</small></div>)}</div>}
                {defaultAssessmentDetail.data.questions ? <ol>{defaultAssessmentDetail.data.questions.map((question, questionIndex) => <li key={`${question.question_text}-${questionIndex}`}><strong>{question.question_text}</strong><span>{question.options.find((option) => option.is_correct)?.option_text || "No answer configured"}</span>{question.competency && <small>{question.competency}{question.difficulty ? ` | ${question.difficulty}` : ""}</small>}</li>)}</ol> : <div className="key-checkpoint-list">{(defaultAssessmentDetail.data.task?.grading_config?.checkpoints || []).map((checkpoint) => <div key={checkpoint.id}><strong>{checkpoint.label}</strong><span>{checkpoint.weight}%</span><small>Expected answer: {readableReviewValue(checkpoint.expected)}</small></div>)}</div>}
                {defaultAssessmentDetail.data.task?.metadata?.sections && <div className="english-preview-sections"><strong>Candidate experience</strong>{defaultAssessmentDetail.data.task.metadata.sections.map((section) => <article key={section.id}><div><strong>{section.label}</strong><span>{section.minutes ? `${section.minutes} minutes` : "Response section"}</span></div><p>{section.description}</p>{section.passage && <blockquote>{section.passage}</blockquote>}{section.prompt && <div className="preview-prompt">{section.prompt}</div>}{section.audio?.map((clip) => <small key={clip.id}>Audio clip: {clip.label}</small>)}{section.questions && <small>{section.questions.length} comprehension questions</small>}</article>)}</div>}
              </div>}
              {installDefault.isError && <div className="workspace-error">{apiErrorMessage(installDefault.error, "The default assessment could not be added.")}</div>}
            </section>

            {showBuilder && <section className="workspace-surface assessment-builder-v2">
              <div className="workspace-surface-head"><div><button type="button" className="builder-back-link" onClick={() => setShowBuilder(false)}>← Back to library</button><h3>New assessment</h3><p>Define the candidate experience and the evidence recruiters will use.</p></div><span className={`builder-save-state ${builderSaveState}`}>{builderSaveState === "saving" ? "Saving…" : "Saved for this session"}</span></div>
              <div className="builder-stepper" aria-label="Assessment builder progress">
                {["Basics", "Candidate task", "Answer key", "Review"].map((label, stepIndex) => <button type="button" key={label} disabled={stepIndex + 1 > builderStep} aria-current={builderStep === stepIndex + 1 ? "step" : undefined} className={builderStep === stepIndex + 1 ? "active" : builderStep > stepIndex + 1 ? "complete" : ""} onClick={() => setBuilderStep(stepIndex + 1)}><span>{stepIndex + 1}</span>{label}</button>)}
              </div>

              {builderStep === 1 && <div className="builder-stage workspace-form-grid">
                <label className="field-stack"><span>Assessment title <b aria-hidden="true">*</b></span><input required value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Senior accountant practical" /></label>
                <label className="field-stack"><span>Format <b aria-hidden="true">*</b></span><select required value={form.assessment_type} onChange={(e) => setForm((p) => ({ ...p, assessment_type: e.target.value as typeof form.assessment_type }))}><option value="mcq">Multiple choice</option><option value="spreadsheet">Excel</option><option value="coding">Coding</option><option value="accounting">Accounting</option><option value="tax_simulator">1040 Individual Tax</option><option value="tax_1120">1120 Corporate Tax</option><option value="case_study">Case study</option></select></label>
                <label className="field-stack workspace-span-2"><span>Internal purpose <b aria-hidden="true">*</b></span><input required value={form.about} onChange={(e) => setForm((p) => ({ ...p, about: e.target.value }))} placeholder="Role, seniority, and what this assessment should prove" /><small>Visible to your hiring team, not candidates.</small></label>
                <label className="field-stack"><span>Topics <b aria-hidden="true">*</b></span><input required value={form.topics} onChange={(e) => setForm((p) => ({ ...p, topics: e.target.value }))} placeholder="Close, reconciliations, controls" /></label>
                <label className="field-stack"><span>Duration <b aria-hidden="true">*</b></span><div className="input-with-suffix"><input required type="number" min="1" value={form.duration_minutes} onChange={(e) => setForm((p) => ({ ...p, duration_minutes: Number(e.target.value) }))} /><span>minutes</span></div></label>
              </div>}

              {builderStep === 2 && <div className="builder-stage workspace-form-grid">
                <label className="field-stack workspace-span-2"><span>Candidate instructions <b aria-hidden="true">*</b></span><textarea required rows={3} value={form.instructions} onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))} placeholder="What the candidate should know before starting" /></label>
                {isMcqForm ? <div className="builder-info workspace-span-2"><strong>Build the question set after saving</strong><span>Save the assessment as a draft, then add, score, and validate every question before publishing.</span></div> : <label className="field-stack workspace-span-2"><span>Task brief <b aria-hidden="true">*</b></span><textarea required rows={7} value={form.task_prompt} onChange={(e) => setForm((p) => ({ ...p, task_prompt: e.target.value }))} placeholder="State the facts, required outputs, constraints, and acceptable assumptions." /></label>}
                {!isMcqForm && <label className="field-stack workspace-span-2"><span>Reference links</span><textarea rows={2} value={form.attachment_links} onChange={(e) => setForm((p) => ({ ...p, attachment_links: e.target.value }))} placeholder="One URL per line" /></label>}
                {form.assessment_type === "coding" && <><label className="field-stack"><span>Language</span><select value={form.coding_language} onChange={(e) => setForm((p) => ({ ...p, coding_language: e.target.value }))}><option value="python">Python</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="java">Java</option><option value="sql">SQL</option></select></label><label className="field-stack workspace-span-2"><span>Starter code</span><textarea className="code-input" rows={5} value={form.starter_code} onChange={(e) => setForm((p) => ({ ...p, starter_code: e.target.value }))} /></label></>}
                {form.assessment_type === "spreadsheet" && <div className="workspace-span-2 builder-workbook">
                  <strong>Candidate workbook</strong>
                  <Suspense fallback={<div className="tool-loading-state" role="status">Loading workbook setup...</div>}>
                    <ExcelSimulator
                      title="Workbook setup"
                      description="Prepare the workbook the candidate will receive."
                      instructions="Upload an xlsx file or prepare the grid, then keep answer cells unlocked."
                      onAutosave={(submission) => setExcelTemplate(submission)}
                    />
                  </Suspense>
                </div>}
              </div>}

              {builderStep === 3 && <div className="builder-stage">
                {isMcqForm ? <div className="builder-info"><strong>MCQ answer keys are set per question</strong><span>Correct options and marks are configured while adding each question.</span></div> : <>
                  <div className="checkpoint-heading"><div><strong>Scoring checkpoints</strong><span>Describe what a correct response contains. Weights must total 100%.</span></div><strong className={checkpointWeight === 100 ? "weight-valid" : "weight-invalid"}>{checkpointWeight}%</strong></div>
                  <div className="checkpoint-list">{checkpoints.map((checkpoint, checkpointIndex) => <article className="checkpoint-row" key={checkpoint.id}>
                    <label className="field-stack"><span>What are you scoring? <b aria-hidden="true">*</b></span><input required value={checkpoint.label} onChange={(event) => setCheckpoints((items) => items.map((item, indexValue) => indexValue === checkpointIndex ? { ...item, label: event.target.value } : item))} placeholder="Calculated gross margin" /></label>
                    <label className="field-stack"><span>How should it match?</span><select value={checkpoint.comparator} onChange={(event) => setCheckpoints((items) => items.map((item, indexValue) => indexValue === checkpointIndex ? { ...item, comparator: event.target.value as BuilderCheckpoint["comparator"] } : item))}><option value="numeric">Matches the number</option><option value="exact">Matches exactly</option><option value="contains">Includes this text</option><option value="contains_all">Includes every item</option><option value="regex">Matches a pattern</option><option value="set_contains_all">Includes every selection</option></select></label>
                    <label className="field-stack"><span>Correct answer <b aria-hidden="true">*</b></span><input required value={checkpoint.expected} onChange={(event) => setCheckpoints((items) => items.map((item, indexValue) => indexValue === checkpointIndex ? { ...item, expected: event.target.value } : item))} placeholder="49,000" /></label>
                    <label className="field-stack"><span>Weight</span><div className="input-with-suffix"><input type="number" min="1" max="100" value={checkpoint.weight} onChange={(event) => setCheckpoints((items) => items.map((item, indexValue) => indexValue === checkpointIndex ? { ...item, weight: Number(event.target.value) } : item))} /><span>%</span></div></label>
                    <details className="checkpoint-advanced-source"><summary>Advanced evidence source</summary><label className="field-stack"><span>Submitted value reference</span><input value={checkpoint.source} onChange={(event) => setCheckpoints((items) => items.map((item, indexValue) => indexValue === checkpointIndex ? { ...item, source: event.target.value } : item))} placeholder={form.assessment_type === "spreadsheet" ? "spreadsheet_value:B12" : form.assessment_type === "coding" ? "code" : "field:taxable_income"} /></label></details>
                    <button type="button" className="checkpoint-remove" aria-label="Remove checkpoint" onClick={() => setCheckpoints((items) => items.filter((_, indexValue) => indexValue !== checkpointIndex))}>Remove</button>
                  </article>)}</div>
                  <button type="button" className="secondary-btn" onClick={() => setCheckpoints((items) => [...items, { id: `checkpoint-${Date.now()}`, label: "", source: `field:result_${items.length + 1}`, comparator: "numeric", expected: "", weight: 0, tolerance: 0.01 }])}>Add scoring checkpoint</button>
                </>}
              </div>}

              {builderStep === 4 && <div className="builder-stage builder-review">
                <div><span>Assessment</span><strong>{form.title || "Untitled assessment"}</strong></div><div><span>Format</span><strong>{form.assessment_type.replaceAll("_", " ")}</strong></div><div><span>Duration</span><strong>{form.duration_minutes} minutes</strong></div><div><span>Scoring</span><strong>{isMcqForm ? "Per-question key" : `${checkpoints.length} checkpoints / ${checkpointWeight}%`}</strong></div>
                <details className="builder-advanced"><summary>Advanced settings</summary><div className="workspace-form-grid compact"><label className="field-stack"><span>Pass score</span><input type="number" min="70" max="100" value={form.pass_score} onChange={(e) => setForm((p) => ({ ...p, pass_score: Number(e.target.value) }))} /></label><label className="field-stack"><span>Maximum attempts</span><input type="number" min="1" max="3" value={form.max_attempts} onChange={(e) => setForm((p) => ({ ...p, max_attempts: Number(e.target.value) }))} /></label></div></details>
              </div>}

              <div className="workspace-form-footer builder-footer">
                <span>{builderSaveState === "saving" ? "Saving progress…" : "Progress saved in this browser session"}</span>
                {builderStep > 1 && <button type="button" className="secondary-btn" onClick={() => setBuilderStep((step) => Math.max(1, step - 1))}>Back</button>}
                {builderStep < 4 ? <button type="button" disabled={!builderStepCanContinue} onClick={() => setBuilderStep((step) => Math.min(4, step + 1))}>Continue</button> : <button onClick={() => createAssessment.mutate()} disabled={createAssessment.isPending || !canCreateAssessment}>{createAssessment.isPending ? <ButtonBusyLabel label="Creating..." /> : "Create draft"}</button>}
              </div>
              {!builderStepCanContinue && builderStep < 4 && <div className="workspace-form-note builder-validation-note">Complete the required fields to continue.</div>}
              {!canCreateAssessment && builderStep === 4 && <div className="workspace-form-note">Complete the required fields{isMcqForm ? "." : " and make checkpoint weights total 100%."}</div>}
              {createAssessment.isError && <div className="workspace-error">{apiErrorMessage(createAssessment.error, "The assessment could not be created. Review the fields and try again.")}</div>}
            </section>}
          </div>
          {previewAssessment && <div className="workspace-modal-backdrop" role="presentation" onMouseDown={() => setPreviewAssessmentId(null)}>
            <section className="assessment-preview-modal" role="dialog" aria-modal="true" aria-labelledby="assessment-preview-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="workspace-surface-head"><div><h3 id="assessment-preview-title">{previewAssessment.title}</h3><p>Recruiter-ready assessment summary</p></div><button type="button" className="workspace-icon-btn" aria-label="Close assessment preview" onClick={() => setPreviewAssessmentId(null)}><X size={17} /></button></div>
              <div className="assessment-preview-summary">
                <div><span>Status</span><StatusBadge value={previewAssessment.status} /></div>
                <div><span>Format</span><strong>{previewAssessment.assessment_type.replaceAll("_", " ")}</strong></div>
                <div><span>Duration</span><strong>{previewAssessment.duration_minutes} minutes</strong></div>
                <div><span>Pass score</span><strong>{previewAssessment.pass_score}%</strong></div>
              </div>
              {previewAssessment.task && <div className="assessment-preview-copy"><span>Candidate task</span><strong>{previewAssessment.task.title}</strong><p>{previewAssessment.task.description || previewAssessment.task.instructions}</p></div>}
              <div className="assessment-preview-key"><div><strong>Scoring key</strong><span>Shown in plain language for recruiter review.</span></div>{previewAssessment.assessment_type === "mcq" ? <p>{previewAssessment.question_count} questions. Correct answers and marks are stored with each question.</p> : <div className="key-checkpoint-list">{(previewAssessment.task?.grading_config?.checkpoints || []).map((checkpoint) => <div key={checkpoint.id}><strong>{checkpoint.label}</strong><span>{checkpoint.weight}%</span><small>Expected answer: {readableReviewValue(checkpoint.expected)}</small></div>)}</div>}</div>
              <div className="workspace-form-footer"><button type="button" className="secondary-btn" onClick={() => setPreviewAssessmentId(null)}>Close</button><button type="button" onClick={() => { setPreviewAssessmentId(null); openInvitationFlow(previewAssessment); }}>{previewAssessment.status === "published" ? "Send invitation" : "Continue setup"}</button></div>
            </section>
          </div>}
        </section>
      )}

      {activeTab === "publish" && (
        <section className="workspace-publish">
          <div className="workspace-main-column">
            {selectedExam && selectedExam.status !== "published" && <section className="workspace-surface setup-attention-surface">
              <div className="workspace-surface-head">
                <div>
                  <h3>Finish assessment setup</h3>
                  <p>Complete the scoring content and publish this draft before inviting candidates.</p>
                </div>
                <StatusBadge value={selectedExam.status} />
              </div>
              <div className="workspace-form-grid compact">
                <label className="field-stack workspace-span-2">
                  <span>Draft assessment</span>
                  <span className="assessment-select-with-icon">
                    {selectedExam && <AssessmentToolIcon assessmentType={selectedExam.assessment_type} title={selectedExam.title} />}
                    <select value={selectedExamId ?? ""} onChange={(e) => setSelectedExamId(Number(e.target.value))}>
                      <option value="">Select assessment</option>
                      {filteredAssessments.filter((assessment) => assessment.status !== "published").map((x) => (
                        <option key={x.exam_id} value={x.exam_id}>
                          {x.title} ({x.status}) {x.assessment_type === "mcq" ? `${x.question_count} questions` : `${x.checkpoint_count || 0} checkpoints`}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                {selectedExam && (
                  <div className="workspace-selection-summary workspace-span-2">
                    <strong>{selectedExam.title}</strong>
                    <span>{selectedExam.assessment_type} | {selectedExam.status} | duration {selectedExam.duration_minutes} min{selectedExam.is_platform_default ? ` | Default v${selectedExam.template_version}` : ""}</span>
                  </div>
                )}
              </div>

              {selectedExam?.task && (
                <div className="assessment-definition">
                  <div><span>Practical task</span><strong>{selectedExam.task.title}</strong><p>{selectedExam.task.description}</p></div>
                  <div className="assessment-definition-stats"><span><strong>{Object.keys((selectedExam.task.metadata?.initial_spreadsheet_data as Record<string, unknown>) || {}).length}</strong> workbook cells</span><span><strong>{selectedExam.checkpoint_count || 0}</strong> scored checkpoints</span><span><strong>{selectedExam.task.marks}</strong> total marks</span></div>
                  <details><summary>View recruiter scoring key</summary><div className="key-checkpoint-list">{(selectedExam.task.grading_config?.checkpoints || []).map((checkpoint) => <div key={checkpoint.id}><strong>{checkpoint.label}</strong><span>{checkpoint.weight}%</span><small>Expected answer: {readableReviewValue(checkpoint.expected)}</small></div>)}</div></details>
                </div>
              )}

              {selectedExam && selectedExam.status !== "published" && selectedExam.assessment_type === "mcq" && (
                <div className="workspace-builder-panel">
                  <label className="field-stack workspace-span-2">
                    <span>Question text</span>
                    <input value={questionText} onChange={(e) => setQuestionText(e.target.value)} placeholder="Question text" />
                  </label>
                  <div className="workspace-form-grid compact">
                    <label className="field-stack">
                      <span>Question type</span>
                      <select value={questionType} onChange={(e) => setQuestionType(e.target.value as "mcq_single_correct" | "mcq_multiple_correct")}>
                        <option value="mcq_single_correct">Single correct</option>
                        <option value="mcq_multiple_correct">Multiple correct</option>
                      </select>
                    </label>
                    <label className="field-stack">
                      <span>Marks</span>
                      <input type="number" value={marks} onChange={(e) => setMarks(Number(e.target.value))} />
                    </label>
                    <label className="field-stack">
                      <span>Negative marks</span>
                      <input type="number" value={negativeMarks} onChange={(e) => setNegativeMarks(Number(e.target.value))} />
                    </label>
                  </div>
                  <div className="option-editor-list">
                    {options.map((o, idx) => (
                      <div key={idx} className="option-editor-row">
                        <input
                          placeholder={`Option ${idx + 1}`}
                          value={o.option_text}
                          onChange={(e) => setOptions((prev) => prev.map((x, i) => (i === idx ? { ...x, option_text: e.target.value } : x)))}
                        />
                        <label className="toggle-row">
                          <input
                            type={questionType === "mcq_single_correct" ? "radio" : "checkbox"}
                            checked={o.is_correct}
                            name="correct-option"
                            onChange={(e) =>
                              setOptions((prev) =>
                                prev.map((x, i) => {
                                  if (questionType === "mcq_single_correct") return { ...x, is_correct: i === idx };
                                  if (i === idx) return { ...x, is_correct: e.target.checked };
                                  return x;
                                }),
                              )
                            }
                          />
                          <span>Correct answer</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="workspace-form-footer">
                    <button onClick={() => addQuestion.mutate()} disabled={addQuestion.isPending || !canAddQuestion}>
                      {addQuestion.isPending ? <ButtonBusyLabel label="Adding..." /> : "Add question"}
                    </button>
                    <button onClick={() => publish.mutate()} disabled={publish.isPending}>
                      {publish.isPending ? <ButtonBusyLabel label="Publishing..." /> : "Publish assessment"}
                    </button>
                  </div>
                  {!canAddQuestion && <div className="workspace-form-note">Add a question, at least two options, and mark one correct answer.</div>}
                  {addQuestion.isError && <div className="workspace-error">The question could not be added. Check the content and try again.</div>}
                </div>
              )}

              {selectedExam && selectedExam.status !== "published" && selectedExam.assessment_type !== "mcq" && (
                <div className="workspace-selection-summary">
                  <strong>{selectedExam.assessment_type} workspace attached</strong>
                  <span>Non-MCQ assessments use their dedicated task workspace. Publish once the setup is ready.</span>
                  <div className="workspace-inline-actions">
                    <button onClick={() => publish.mutate()} disabled={publish.isPending}>
                      {publish.isPending ? <ButtonBusyLabel label="Publishing..." /> : "Publish assessment"}
                    </button>
                  </div>
                </div>
              )}

              <div className="question-list">
                {(questions.data || []).map((q) => (
                  <article key={q.question_id} className="question-card">
                    <strong>{q.question_text}</strong>
                    <small>{q.question_type} | marks {q.marks} | negative {q.negative_marks}</small>
                  </article>
                ))}
              </div>
            </section>}

            <section className="workspace-surface">
              <div className="workspace-surface-head">
                <div>
                  <h3>Send an invitation</h3>
                  <p>Choose a ready assessment and a candidate currently in Screening.</p>
                </div>
              </div>
              <div className="workspace-form-grid compact">
                <div className="field-stack">
                  <span>Published assessment</span>
                  <div className="assessment-select-with-icon issue-assessment-select">
                    {issueSelectedExam
                      ? <AssessmentToolIcon assessmentType={issueSelectedExam.assessment_type} title={issueSelectedExam.title} />
                      : <span className="issue-assessment-placeholder-icon"><ToolGridIcon /></span>}
                    <select aria-label="Published assessment" value={issueExamId ?? ""} onChange={(event) => setIssueExamId(event.target.value ? Number(event.target.value) : null)}>
                      <option value="">Select published assessment</option>
                      {assessmentRows.filter((x) => x.status === "published").map((x) => (
                        <option value={x.exam_id} key={x.exam_id}>{x.title} | {x.duration_minutes} min</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="field-stack">
                  <span>Screening candidate</span>
                  <select
                    value={candidateApplicationId ?? ""}
                    disabled={screeningApplications.isLoading}
                    onChange={(event) => {
                      const application = (screeningApplications.data || []).find((item) => item.id === Number(event.target.value));
                      setCandidateApplicationId(application?.id || null);
                      setCandidateName(application?.candidate.full_name || "");
                      setCandidateEmail(application?.candidate.email || "");
                    }}
                  >
                    <option value="">Select candidate</option>
                    {(screeningApplications.data || []).map((application) => (
                      <option key={application.id} value={application.id}>
                        {application.candidate.full_name} | {application.job_title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {screeningApplications.isLoading && <WorkspaceSkeleton rows={2} />}
              <div className="workspace-form-footer">
                <button onClick={() => issueMutation.mutate()} disabled={issueMutation.isPending || !canIssueAssessment}>
                  {issueMutation.isPending ? <ButtonBusyLabel label="Sending..." /> : "Send invite"}
                </button>
              </div>
              {!screeningApplications.isLoading && !(screeningApplications.data || []).length && (
                <div className="workspace-form-note workspace-form-note-action"><span>No candidates are currently in Screening. Add a candidate to an open role or move an existing application to Screening.</span>{onOpenPipeline && <button type="button" className="secondary-btn" onClick={onOpenPipeline}>Open candidate pipeline</button>}</div>
              )}
              {!canIssueAssessment && Boolean((screeningApplications.data || []).length) && <div className="workspace-form-note">Choose a published assessment and a screening candidate.</div>}
              {issueMutation.isError && <div className="workspace-error">The invite could not be issued. Check the candidate details and try again.</div>}
              {issueNotice && <div className="workspace-success">{issueNotice}</div>}
            </section>

            <section className="workspace-surface">
              <div className="workspace-surface-head"><div><h3>Active invitations</h3><p>Monitor delivery, candidate progress, and access that may need action.</p></div></div>
              <div className="published-activity-list">
                {issued.isLoading && <WorkspaceSkeleton rows={4} />}
                {activeIssuedRows.map((row) => (
                  <article className="published-activity-row" key={row.issued_id}>
                    <AssessmentToolIcon assessmentType={row.assessment_type} title={row.assessment_title} />
                    <div><strong>{row.assessment_title}</strong><small>{row.candidate_name} | {row.candidate_email}</small></div>
                    <span>{formatResultDate(row.issued_at)}</span>
                    <StatusBadge value={row.status} />
                    <div className="issued-list-actions">
                      {["issued", "revoked"].includes(row.status) && <button type="button" className="secondary-btn" disabled={resendInvitation.isPending} onClick={() => void resendInvitation.mutate(row.issued_id)}>{resendingIssuedId === row.issued_id ? <ButtonBusyLabel label="Sending..." /> : "Resend"}</button>}
                      {["issued", "started"].includes(row.status) && <button type="button" className="issued-revoke-btn" disabled={revokeInvitation.isPending} onClick={() => {
                        if (window.confirm("Revoke this invitation and close any active candidate session?")) revokeInvitation.mutate(row.issued_id);
                      }}>{revokingIssuedId === row.issued_id ? <ButtonBusyLabel label="Revoking..." /> : "Revoke"}</button>}
                    </div>
                  </article>
                ))}
                {!issued.isLoading && activeIssuedRows.length === 0 && <EmptyState title="No active invitations" detail="Choose a published assessment and a screening candidate above." />}
              </div>
            </section>
          </div>
        </section>
      )}
      {activeTab === "results" && (
        <section className="results-workspace">
          <div className="results-kpi-grid">
            <article className="results-kpi-card"><span>Completed attempts</span><strong>{completedIssueCount}</strong><small>of {issuedRows.length} issued assessments</small></article>
            <article className="results-kpi-card"><span>Average score</span><strong>{averageScore.toFixed(1)}%</strong><small>Across {scoredResults.length} scored attempts</small></article>
            <article className="results-kpi-card"><span>Pass rate</span><strong>{passRate.toFixed(0)}%</strong><small>{passedResults.length} candidates passed</small></article>
            <button type="button" className={`results-kpi-card${pendingReviewCount ? " attention" : ""}`} onClick={() => setResultStatusFilter("review")}><span>Pending review</span><strong>{pendingReviewCount}</strong><small>Show manual decisions first</small></button>
          </div>

          <section className="workspace-surface results-performance-surface">
            <div className="workspace-surface-head">
              <div><h3>Assessment performance</h3><p>Compare participation, completion, average score, and pass rate by assessment.</p></div>
            </div>
            {assessmentMetrics.length ? <div className="results-performance-table">
              <div className="results-table-header"><span>Assessment</span><span>Issued</span><span>Completed</span><span>Average</span><span>Pass rate</span></div>
              {assessmentMetrics.map(({ assessment, attempts, completed, average, passRate: assessmentPassRate }) => (
                <button type="button" key={assessment.exam_id} className="results-performance-row" onClick={() => setResultAssessmentFilter(String(assessment.exam_id))}>
                  <div><strong>{assessment.title}</strong><small>{assessment.assessment_type}</small></div>
                  <span>{attempts}</span>
                  <span>{completed}<small>{attempts ? ` ${Math.round((completed / attempts) * 100)}%` : ""}</small></span>
                  <strong>{average.toFixed(1)}%</strong>
                  <div className="metric-progress"><span><i style={{ width: `${assessmentPassRate}%` }} /></span><strong>{assessmentPassRate.toFixed(0)}%</strong></div>
                </button>
              ))}
            </div> : <EmptyState title="No assessment results yet" detail="Performance metrics will appear after candidates begin completing issued assessments." />}
          </section>

          <section className="workspace-surface review-queue-surface">
            <div className="workspace-surface-head results-list-head">
              <div><h3>Candidate review queue</h3><p>Submissions awaiting a decision are pinned to the top.</p></div>
              <div className="results-filters">
                <select aria-label="Filter results by assessment" value={resultAssessmentFilter} onChange={(event) => setResultAssessmentFilter(event.target.value)}>
                  <option value="all">All assessments</option>
                  {assessmentRows.map((assessment) => <option key={assessment.exam_id} value={assessment.exam_id}>{assessment.title}</option>)}
                </select>
                <select aria-label="Filter results by status" value={resultStatusFilter} onChange={(event) => setResultStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option><option value="completed">Completed</option><option value="active">Active</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="review">Needs review</option>
                </select>
              </div>
            </div>
            {resultRows.length ? <div className="candidate-results-table">
              <div className="candidate-results-header"><span>Candidate</span><span>Assessment</span><span>Completed</span><span>Time</span><span>Score</span><span>Outcome</span><span /></div>
              {resultRows.map((row) => (
                <div className="candidate-results-row" key={row.issued_id}>
                  <div className="candidate-result-person"><span>{(row.candidate_name || row.candidate_email).slice(0, 2).toUpperCase()}</span><div><strong>{row.candidate_name || "Candidate"}</strong><small>{row.candidate_email}</small></div></div>
                  <div><strong>{row.assessment_title}</strong><small>{row.assessment_type || row.internal_id}</small></div>
                  <span>{formatResultDate(row.completed_at)}</span>
                  <span>{formatDuration(row.time_taken_seconds)}</span>
                  <strong className="result-score">{row.score_pct == null ? "Pending" : `${Number(row.score_pct).toFixed(1)}%`}</strong>
                  {row.status === "review_pending" ? <StatusBadge value="Needs review" /> : row.passed === true ? <StatusBadge value="Passed" /> : row.passed === false ? <StatusBadge value="Failed" /> : <StatusBadge value={row.status} />}
                  <button type="button" className={`candidate-review-action${row.status === "review_pending" ? " priority" : ""}`} onClick={() => setReviewIssueId(row.issued_id)}><span>{row.status === "review_pending" ? "Review candidate" : "View result"}</span><ArrowRight size={14} aria-hidden="true" /></button>
                </div>
              ))}
            </div> : <EmptyState title="No matching candidates" detail="Change the filters or send an assessment to a candidate." action={<button type="button" onClick={() => switchAssessmentTab("publish")}>Open invitations</button>} />}
          </section>

          {reviewIssueId && (
            <div className="result-review-backdrop" role="presentation" onMouseDown={() => setReviewIssueId(null)}>
            {review.isLoading ? <section className="result-review-drawer workspace-loading" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><WorkspaceSkeleton rows={6} /></section> : review.data ? (
            <section className="workspace-surface result-detail-panel result-review-drawer" role="dialog" aria-modal="true" aria-labelledby="candidate-result-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="workspace-surface-head"><div><h3 id="candidate-result-title">{review.data.candidate_name || review.data.candidate_email}</h3><p>{review.data.assessment_title} | Candidate result detail</p></div><button type="button" className="workspace-icon-btn" aria-label="Close result detail" onClick={() => setReviewIssueId(null)}><X size={17} /></button></div>
              <div className="result-detail-summary">
                <div><span>Provisional score</span><strong>{review.data.result?.provisional_score_pct == null ? "Manual" : `${Number(review.data.result.provisional_score_pct).toFixed(1)}%`}</strong></div>
                <div><span>Raw checkpoint score</span><strong>{review.data.result?.raw_provisional_score_pct == null ? "--" : `${Number(review.data.result.raw_provisional_score_pct).toFixed(1)}%`}</strong></div>
                <div><span>Integrity adjustment</span><strong>{Number(review.data.result?.integrity_penalty_pct || 0) > 0 ? `-${Number(review.data.result.integrity_penalty_pct).toFixed(1)} pts` : "None"}</strong></div>
                <div><span>Phone detections</span><strong>{Number(review.data.result?.proctoring?.mobile_phone_detection_count || 0)}</strong></div>
                <div><span>Review status</span><strong>{review.data.status === "reviewed" ? "Finalized" : "Awaiting decision"}</strong></div>
                <div><span>Time taken</span><strong>{formatDuration(review.data.submission?.time_taken_seconds)}</strong></div>
                <div><span>Submitted</span><strong>{formatResultDate(review.data.submission?.submitted_at)}</strong></div>
              </div>
              <div className="review-panels">
                <div className="review-panel checkpoint-review"><strong>Scoring checkpoints</strong><p className="review-panel-intro">Each row compares the candidate’s submitted result with the assessment key.</p>{Array.isArray(review.data.result?.detail?.checkpoints) ? review.data.result.detail.checkpoints.map((checkpoint: { id: string; label: string; matched: boolean; earned_weight: number; weight: number; actual: unknown; expected: unknown }) => <div className={`checkpoint-review-row ${checkpoint.matched ? "matched" : "missed"}`} key={checkpoint.id}><div><strong>{checkpoint.label}</strong><small>{checkpoint.matched ? "Matches the key" : "Needs recruiter review"}</small></div><span>{readableReviewValue(checkpoint.earned_weight)} / {readableReviewValue(checkpoint.weight)} pts</span><small><b>Submitted:</b> {readableReviewValue(checkpoint.actual)} <b>Expected:</b> {readableReviewValue(checkpoint.expected)}</small></div>) : <div className="review-readable-summary">{Object.entries((review.data.result?.detail || {}) as Record<string, unknown>).map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ")}</span><strong>{readableReviewValue(value)}</strong></div>)}</div>}</div>
                <div className="review-panel"><strong>Answer key</strong><p className="review-panel-intro">Recruiter reference for the expected scoring points.</p>{Array.isArray(review.data.task?.grading_config?.checkpoints) ? <div className="review-readable-summary">{review.data.task.grading_config.checkpoints.map((checkpoint: { id: string; label: string; expected: unknown; weight: number }) => <div key={checkpoint.id}><span>{checkpoint.label}</span><strong>{readableReviewValue(checkpoint.expected)} · {readableReviewValue(checkpoint.weight)} pts</strong></div>)}</div> : <p className="review-panel-intro">This assessment uses its configured scoring guide; no separate checkpoint key is available.</p>}</div>
                <div className="review-panel"><strong>Candidate submission</strong><p className="review-panel-intro">Submitted values are formatted for quick recruiter review.</p><div className="review-readable-summary">{Object.entries((review.data.submission?.submitted_data || {}) as Record<string, unknown>).map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ")}</span><strong>{readableReviewValue(value)}</strong></div>)}</div></div>
                <ProctorEventReviewControls issueId={reviewIssueId} events={review.data.submission?.proctoring_events} labels={review.data.proctor_review_labels} onSaved={() => qc.invalidateQueries({ queryKey: ["issued-review", reviewIssueId] })} />
                <div className="review-panel review-clips-panel"><strong>Clips for review</strong><p className="review-panel-intro">Only cropped clips around flagged events are retained. Full camera and screen recordings are discarded.</p>{Array.isArray(review.data.review_clips) && review.data.review_clips.length ? <div className="review-clips-grid">{review.data.review_clips.map((clip: { id: number; evidence_type: string; event_type: string; url: string; duration_seconds: number }) => <figure key={clip.id}><video controls preload="metadata" src={clip.url} /><figcaption><strong>{clip.evidence_type === "screen" ? "Screen" : "Camera"}</strong><span>{clip.event_type.replaceAll("_", " ")} · {Number(clip.duration_seconds).toFixed(1)}s</span></figcaption></figure>)}</div> : <p className="review-panel-intro">No flagged clips were retained.</p>}</div>
              </div>
              <div className="review-decision">
                <div><strong>Recruiter decision</strong><span>Confirm or adjust the provisional score. Candidates do not receive this result from the assessment session.</span></div>
                <label className="field-stack"><span>Final score</span><div className="input-with-suffix"><input type="number" min="0" max="100" value={reviewScore} onChange={(event) => setReviewScore(Number(event.target.value))} /><span>%</span></div></label>
                <label className="field-stack review-notes"><span>Decision rationale</span><textarea rows={3} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Record the evidence and reason for this decision" /><small>Required for the audit history. Minimum 10 characters.</small></label>
                <button type="button" onClick={() => finalizeReview.mutate()} disabled={finalizeReview.isPending || reviewNotes.trim().length < 10}>{finalizeReview.isPending ? "Finalizing..." : review.data.status === "reviewed" ? "Update final review" : "Finalize review"}</button>
                {finalizeReview.isError && <div className="workspace-error">{apiErrorMessage(finalizeReview.error, "The review could not be finalized.")}</div>}
              </div>
            </section>
            ) : <section className="result-review-drawer workspace-error" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>The candidate result could not be loaded.<button type="button" onClick={() => setReviewIssueId(null)}>Close</button></section>}
            </div>
          )}
        </section>
      )}
      {showSettings && (
        <div className="workspace-modal-backdrop" role="presentation" onMouseDown={() => setShowSettings(false)}>
          <section className="workspace-settings-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="workspace-surface-head">
              <div><h3 id="workspace-settings-title">Workspace settings</h3><p>Organization defaults will be stored in Supabase when it is connected.</p></div>
              <button type="button" className="workspace-icon-btn" aria-label="Close settings" onClick={() => setShowSettings(false)}><X size={17} /></button>
            </div>
            <div className="workspace-form-grid compact">
              <label className="field-stack"><span>Workspace name</span><input defaultValue="Valases Recruiting" /></label>
              <label className="field-stack"><span>Default pass score</span><input type="number" defaultValue="70" /></label>
              <label className="field-stack workspace-span-2"><span>Timezone</span><select defaultValue="Asia/Calcutta"><option value="Asia/Calcutta">India Standard Time (IST)</option><option value="UTC">UTC</option></select></label>
            </div>
            <div className="workspace-settings-account">
              <div><strong>Account access</strong><span>End your session on this device.</span></div>
              <button type="button" className="workspace-signout-btn" onClick={() => void logout()}>Sign out</button>
            </div>
            <div className="workspace-form-footer"><button type="button" className="secondary-btn" onClick={() => setShowSettings(false)}>Cancel</button><button type="button" onClick={() => setShowSettings(false)}>Save settings</button></div>
          </section>
        </div>
      )}
      </div>
      </main>
    </section>
  );
}
