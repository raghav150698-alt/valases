import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseEvidenceDesk, type CaseDocument, type CaseMessage } from "./CaseEvidenceDesk";
import "./CaseWorkpaperWorkbench.css";

export type CaseWorkpaper = {
  case_id: string; title: string; scope: string;
  fields: Array<{ id: string; label: string; section: string }>;
  documents: CaseDocument[]; messages: CaseMessage[];
  diagnostic_options: string[]; references: string[];
};
export type CaseWorkpaperSubmission = {
  entered_form_values: Record<string, number>; identified_red_flags: string[]; notes: string;
  workpaper_state: { case_id: string; inputs: Record<string, string>; activity_log: Array<{ at: string; action: string; detail: string }> };
  tax_workspace?: Record<string, unknown>; corporate_tax_workspace?: Record<string, unknown>; accounting_workspace?: Record<string, unknown>;
};
type Props = {
  workpaper: CaseWorkpaper; workspace: "tax" | "tax_1120" | "accounting";
  initialSubmission?: unknown; onAutosave?: (value: CaseWorkpaperSubmission) => void;
  onSubmit?: (value: CaseWorkpaperSubmission) => void | Promise<void>; showSubmit?: boolean;
};

/** A complete case pack travels with the workpaper; no default case evidence. */
export function CaseWorkpaperWorkbench({ workpaper, workspace, initialSubmission, onAutosave, onSubmit, showSubmit = true }: Props) {
  const initial = initialSubmission as Partial<CaseWorkpaperSubmission> | undefined;
  const sameCase = initial?.workpaper_state?.case_id === workpaper.case_id;
  const [inputs, setInputs] = useState<Record<string, string>>(sameCase ? initial?.workpaper_state?.inputs || {} : {});
  const [flags, setFlags] = useState<string[]>(sameCase ? initial?.identified_red_flags || [] : []);
  const [notes, setNotes] = useState(sameCase ? initial?.notes || "" : "");
  const [activity, setActivity] = useState(sameCase ? initial?.workpaper_state?.activity_log || [] : []);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const log = useCallback((action: string, detail: string) => setActivity(current => [...current.slice(-199), { at: new Date().toISOString(), action, detail }]), []);
  const valid = (value: string | undefined) => Boolean(value?.trim()) && Number.isFinite(Number(value));
  const completed = workpaper.fields.filter(field => valid(inputs[field.id])).length;
  const submission = useMemo<CaseWorkpaperSubmission>(() => {
    const state = { case_id: workpaper.case_id, inputs, activity_log: activity };
    const workspaceKey = workspace === "tax" ? "tax_workspace" : workspace === "tax_1120" ? "corporate_tax_workspace" : "accounting_workspace";
    return { entered_form_values: Object.fromEntries(workpaper.fields.filter(field => valid(inputs[field.id])).map(field => [field.id, Number(inputs[field.id])])), identified_red_flags: flags, notes, workpaper_state: state, [workspaceKey]: state };
  }, [workpaper, workspace, inputs, activity, flags, notes]);
  useEffect(() => { const timeout = window.setTimeout(() => onAutosave?.(submission), 500); return () => window.clearTimeout(timeout); }, [onAutosave, submission]);
  const submit = async () => {
    if (completed !== workpaper.fields.length || !notes.trim()) { setMessage("Complete every output, entering zero where appropriate, and add your reviewer note."); return; }
    setSubmitting(true); setMessage("");
    try { await onSubmit?.(submission); }
    catch { setMessage("Submission failed. Your work remains here; retry when the connection is restored."); }
    finally { setSubmitting(false); }
  };
  return <section className="case-workpaper-workbench">
    <header><span>Advanced case · {workpaper.case_id}</span><h1>{workpaper.title}</h1><p>{workpaper.scope}</p><strong>{completed} / {workpaper.fields.length} outputs completed</strong></header>
    <div className="case-workpaper-layout"><aside><h2>Source pack</h2><p>Use the case files and mailbox in the evidence desk. Trace your conclusions to source documents.</p>{workpaper.documents.map(document => <details key={document.id} onToggle={event => { if (event.currentTarget.open) log("evidence_viewed", document.id); }}><summary>{document.name}</summary>{document.sections.map((section, index) => <div key={index}><h3>{section.heading}</h3>{section.lines?.map(line => <p key={line.label}><strong>{line.label}:</strong> {line.value}</p>)}{section.table && <div className="case-workpaper-table"><table><thead><tr>{section.table.columns.map(col => <th key={col}>{col}</th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, col) => <td key={col}>{value}</td>)}</tr>)}</tbody></table></div>}{section.note && <p>{section.note}</p>}</div>)}</details>)}<h2>Client handoff</h2>{workpaper.messages.map(message => <article key={message.id}><strong>{message.subject}</strong>{message.body.map((paragraph,index) => <p key={index}>{paragraph}</p>)}</article>)}{workpaper.references.length > 0 && <><h2>IRS references</h2>{workpaper.references.map(reference => <p key={reference}><span>{reference.replace("https://www.irs.gov/", "IRS · ")}</span></p>)}</>}</aside>
      <main><h2>Preparation workpaper</h2><p>Calculate each output from evidence. Amounts are whole dollars; negative amounts are allowed where the line requires them.</p><div className="case-workpaper-fields">{workpaper.fields.map(field => <label key={field.id}><span>{field.label}</span><input inputMode="decimal" value={inputs[field.id] || ""} onChange={event => { setInputs(current => ({ ...current, [field.id]: event.target.value })); log("workpaper_field_updated", field.id); }} /></label>)}</div><h2>Diagnostics</h2><p>Select only supported findings. Unsupported selections reduce the diagnostic score.</p>{workpaper.diagnostic_options.map(flag => <label className="case-workpaper-flag" key={flag}><input type="checkbox" checked={flags.includes(flag)} onChange={event => { setFlags(current => event.target.checked ? [...current, flag] : current.filter(value => value !== flag)); log("diagnostic_updated", flag); }} /><span>{flag}</span></label>)}<label className="case-workpaper-note"><span>Reviewer note · calculations, evidence IDs and unresolved items</span><textarea rows={7} value={notes} onChange={event => setNotes(event.target.value)} /></label>{message && <p role="alert">{message}</p>}{showSubmit && <button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit assessment"}</button>}</main></div>
    <CaseEvidenceDesk productName={workpaper.title} documents={workpaper.documents} messages={workpaper.messages} onActivity={log} />
  </section>;
}
