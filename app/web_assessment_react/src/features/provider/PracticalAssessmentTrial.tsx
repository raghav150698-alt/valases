import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLocalUiPreview } from "../../lib/uiPreview";
import type { AccountingAssessmentSubmission, AccountingCase } from "../tools/AccountingTool";
import type { TaxAssessmentSubmission, TaxCase } from "../tools/TaxTool";
import type { CorporateTaxAssessmentSubmission, CorporateTaxCase } from "../tools/CorporateTaxTool";
import type { ExcelAssessmentSubmission } from "../tools/ExcelSimulator";
import type { CodingFile } from "../tools/CodingEnv";
import type { CaseWorkpaper } from "../tools/CaseWorkpaperWorkbench";
import { createPracticalTrial, type PracticalTask } from "./practicalCaseBank";
import "./EnglishAssessmentTrial.css";

const AccountingTool = lazy(() => import("../tools/AccountingTool").then(module => ({ default: module.AccountingTool })));
const TaxTool = lazy(() => import("../tools/TaxTool").then(module => ({ default: module.TaxTool })));
const CorporateTaxTool = lazy(() => import("../tools/CorporateTaxTool").then(module => ({ default: module.CorporateTaxTool })));
const ExcelSimulator = lazy(() => import("../tools/ExcelSimulator").then(module => ({ default: module.ExcelSimulator })));
const CodingEnv = lazy(() => import("../tools/CodingEnv"));

export type PracticalTrialAssessment = {
  title: string;
  assessment_type: string;
  task?: {
    title?: string; description?: string; instructions?: string;
    metadata?: Record<string, unknown>; expected_output?: Record<string, unknown>;
    grading_config?: { checkpoints?: Array<{ id: string; label: string; weight: number; expected: unknown }> };
  } | null;
};

type Submission = AccountingAssessmentSubmission | TaxAssessmentSubmission | CorporateTaxAssessmentSubmission | ExcelAssessmentSubmission | { code: string; files: CodingFile[] };

/** Real workbenches with local practice submission; never issues an assessment. */
export function PracticalAssessmentTrial({ assessment, onClose }: { assessment: PracticalTrialAssessment; onClose: () => void }) {
  const [version, setVersion] = useState(0);
  const [submitted, setSubmitted] = useState<Submission | null>(null);
  const [restartRequested, setRestartRequested] = useState(false);
  const currentFiles = useRef<CodingFile[]>([]);
  const draft = useRef<Submission | null>(null);
  const [task, setTask] = useState<PracticalTask | null>(() => assessment.task ? createPracticalTrial(assessment.task) : null);
  const metadata = useMemo(() => task?.metadata || {}, [task]);
  const initialFiles = useMemo<CodingFile[]>(() => {
    const language = String(metadata.language || "python");
    const supported = ["python", "javascript", "typescript", "sql"].includes(language) ? language as CodingFile["language"] : "python";
    const extension = { python: "py", javascript: "js", typescript: "ts", sql: "sql" }[supported];
    return [{ id: "solution", name: `solution.${extension}`, language: supported, value: String(metadata.starter_code || "") }];
  }, [metadata]);
  const saveFiles = useCallback((files: CodingFile[]) => { currentFiles.current = files; }, []);
  const saveDraft = useCallback((value: Submission) => { draft.current = value; }, []);
  const submit = useCallback((value: Submission) => { draft.current = value; setSubmitted(value); }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const common = { title: task?.title || assessment.title, description: task?.description, instructions: task?.instructions, candidateMode: true, workpaper: metadata.workpaper as CaseWorkpaper | undefined };
  return <div className="english-trial practical-trial" role="dialog" aria-modal="true" aria-label={`Explore ${assessment.title}`} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, input, [tabindex="0"]')).filter(element => element.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="english-trial-toolbar"><div><strong>{assessment.title} · tool trial</strong><small>Practice work stays in this session. No invitation, result or message is sent. Timers and proctoring require a live candidate session.</small></div><button type="button" onClick={() => setRestartRequested(true)}>Restart tool</button><button type="button" onClick={onClose} autoFocus>Close trial</button></header>
    {restartRequested && <section className="english-trial-restart" role="alertdialog" aria-label="Restart tool"><p>Restart with a fresh case and discard your practice work?</p><button type="button" onClick={() => { setTask(assessment.task ? createPracticalTrial(assessment.task, [String(task?.metadata?.case_id)]) : null); setVersion(value => value + 1); setSubmitted(null); draft.current = null; currentFiles.current = []; setRestartRequested(false); }}>Restart</button><button type="button" onClick={() => setRestartRequested(false)}>Keep working</button></section>}
    {!task ? <p role="alert">This assessment has no practical task configured.</p> : submitted ? <section className="english-trial-review"><h1>Practice submission</h1><p>Your work was captured locally. This is a tool trial, not a graded candidate attempt.</p><h2>Your work</h2><pre>{JSON.stringify(submitted, null, 2)}</pre><h2>Reviewer reference</h2><p>These are the configured scoring checkpoints. Coding correctness requires execution and reviewer verification.</p>{task.grading_config?.checkpoints?.map(checkpoint => <article key={checkpoint.id}><strong>{checkpoint.label} · {checkpoint.weight}%</strong><pre>{JSON.stringify(checkpoint.expected, null, 2)}</pre></article>)}<button type="button" onClick={() => setRestartRequested(true)}>Start a fresh trial</button></section> : <Suspense fallback={<p role="status">Opening tool workspace…</p>}>
      {assessment.assessment_type === "accounting" && <AccountingTool key={version} {...common} caseData={metadata.accounting_case as Partial<AccountingCase>} onAutosave={saveDraft} onSubmit={submit} />}
      {assessment.assessment_type === "tax_simulator" && <TaxTool key={version} {...common} caseData={metadata.tax_case as Partial<TaxCase>} onAutosave={saveDraft} onSubmit={submit} />}
      {assessment.assessment_type === "tax_1120" && <CorporateTaxTool key={version} {...common} caseData={metadata.corporate_tax_case as Partial<CorporateTaxCase>} onAutosave={saveDraft} onSubmit={submit} />}
      {assessment.assessment_type === "spreadsheet" && <ExcelSimulator key={version} {...common} initialSheet={metadata.initial_spreadsheet_data as Record<string, string | number | boolean | null>} lockedCells={metadata.locked_cells as string[]} showTopbarActions={false} onAutosave={saveDraft} onSubmit={submit} />}
      {assessment.assessment_type === "coding" && <><section className="english-trial-review"><h1>{task.title}</h1><p>{task.description}</p><p>{task.instructions}</p>{Array.isArray(metadata.public_examples) && <><h2>Public examples</h2><pre>{JSON.stringify(metadata.public_examples, null, 2)}</pre></>}</section><CodingEnv key={version} assessmentMode initialFiles={initialFiles} onFilesChange={saveFiles} executionDisabledReason={isLocalUiPreview ? "Demo mode: edit and submit code here. Execution requires the signed-in workspace and its execution service." : undefined} /><div className="practical-trial-submit"><button type="button" onClick={() => submit({ code: currentFiles.current.find(file => file.id === "solution")?.value || "", files: currentFiles.current })}>Submit practice code</button></div></>}
    </Suspense>}
  </div>;
}
