import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  FileCheck2,
  FileSearch,
  FileText,
  FolderOpen,
  LayoutDashboard,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Stethoscope,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseEvidenceDesk, type CaseDocument, type CaseMessage } from "./CaseEvidenceDesk";
import "./TaxTool.css";

type TaxPage = "overview" | "taxpayer" | "income" | "business" | "adjustments" | "diagnostics" | "forms" | "review";
type TaxInputKey =
  | "wages"
  | "federal_withholding"
  | "taxable_interest"
  | "business_receipts"
  | "allowable_business_expenses"
  | "hsa_deduction"
  | "standard_deduction"
  | "pre_credit_tax"
  | "nonrefundable_credits";

type TaxActivity = { at: string; action: string; detail: string };

export type TaxAssessmentSubmission = {
  entered_form_values: Record<string, number>;
  identified_red_flags: string[];
  notes: string;
  tax_workspace: {
    inputs: Record<TaxInputKey, string>;
    activity_log: TaxActivity[];
    completed_sections: string[];
  };
};

export type TaxCase = {
  taxpayerName: string;
  maskedSsn: string;
  filingStatus: string;
  taxYear: number;
  occupation: string;
  dependentName: string;
};

type TaxToolProps = {
  title?: string;
  description?: string;
  instructions?: string;
  caseData?: Partial<TaxCase>;
  initialSubmission?: TaxAssessmentSubmission | null;
  candidateMode?: boolean;
  showSubmit?: boolean;
  onAutosave?: (submission: TaxAssessmentSubmission) => void;
  onSubmit?: (submission: TaxAssessmentSubmission) => void | Promise<void>;
};

const DEFAULT_CASE: TaxCase = {
  taxpayerName: "Alex Rivera",
  maskedSsn: "***-**-4821",
  filingStatus: "Head of household",
  taxYear: 2025,
  occupation: "Independent marketing consultant",
  dependentName: "Mateo Rivera",
};

const EMPTY_INPUTS: Record<TaxInputKey, string> = {
  wages: "",
  federal_withholding: "",
  taxable_interest: "",
  business_receipts: "",
  allowable_business_expenses: "",
  hsa_deduction: "",
  standard_deduction: "",
  pre_credit_tax: "",
  nonrefundable_credits: "",
};

const TAX_PAGES: Array<{ id: TaxPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Return overview", icon: LayoutDashboard },
  { id: "taxpayer", label: "Taxpayer", icon: CircleUserRound },
  { id: "income", label: "Income", icon: WalletCards },
  { id: "business", label: "Schedule C", icon: ReceiptText },
  { id: "adjustments", label: "Adjustments & tax", icon: Calculator },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
  { id: "forms", label: "Forms preview", icon: FileText },
  { id: "review", label: "Review return", icon: ClipboardCheck },
];

const REVIEW_FLAGS = [
  "Vehicle expense lacks mileage log",
  "Dependent SSN missing",
  "1099-NEC source document missing",
  "W-2 withholding exceeds reported wages",
  "HSA contribution exceeds the case limit",
  "Taxpayer filing status is unsupported",
  "Interest income is nontaxable",
  "Standard deduction is unavailable",
];

const INITIAL_ACTIVITY: TaxActivity[] = [
  { at: "2026-02-12T14:10:00.000Z", action: "return_assigned", detail: "2025 federal individual return assigned for preparation" },
  { at: "2026-02-12T14:12:00.000Z", action: "source_documents_received", detail: "W-2, 1099-INT, organizer, and business summary added to the client file" },
];

const TAX_DOCUMENTS: CaseDocument[] = [
  {
    id: "w2",
    name: "Rivera_2025_W2.pdf",
    format: "PDF",
    pages: 1,
    description: "Form W-2 from Hartwell Media Group",
    sections: [
      {
        heading: "2025 Form W-2 - Wage and Tax Statement",
        lines: [
          { label: "Employee", value: "Alex Rivera" },
          { label: "Employer", value: "Hartwell Media Group" },
          { label: "Box 1 - Wages, tips, other compensation", value: "$118,000.00", emphasis: true },
          { label: "Box 2 - Federal income tax withheld", value: "$24,500.00" },
          { label: "Box 3 - Social Security wages", value: "$118,000.00" },
          { label: "Box 5 - Medicare wages and tips", value: "$118,000.00" },
        ],
      },
    ],
  },
  {
    id: "1099-int",
    name: "First_National_1099INT.pdf",
    format: "PDF",
    pages: 1,
    description: "Taxable interest statement",
    sections: [
      {
        heading: "2025 Form 1099-INT",
        lines: [
          { label: "Payer", value: "First National Bank" },
          { label: "Recipient", value: "Alex Rivera" },
          { label: "Box 1 - Interest income", value: "$2,400.00", emphasis: true },
          { label: "Box 4 - Federal income tax withheld", value: "$0.00" },
        ],
      },
    ],
  },
  {
    id: "business-summary",
    name: "Rivera_Consulting_PandL.xlsx",
    format: "XLSX",
    description: "Client-provided Schedule C income and expense summary",
    sections: [
      {
        heading: "Rivera Consulting - 2025 activity",
        table: {
          columns: ["Account", "Amount", "Support received"],
          rows: [
            ["Gross receipts", "$46,000", "Bank summary only"],
            ["Advertising", "$3,200", "Invoices"],
            ["Office expense", "$4,100", "Receipts"],
            ["Contract labor", "$6,800", "Vendor invoices"],
            ["Business insurance", "$2,000", "Policy statement"],
            ["Business meals paid", "$4,800", "Receipts and attendees"],
            ["Vehicle expense claim", "$6,200", "No mileage log"],
          ],
        },
      },
      { note: "Determine the allowable Schedule C expenses from the available substantiation. Business meals are subject to the applicable limitation." },
    ],
  },
  {
    id: "organizer",
    name: "Rivera_2025_Organizer.pdf",
    format: "PDF",
    pages: 4,
    description: "Signed client organizer and dependent information",
    sections: [
      {
        heading: "Taxpayer and dependent information",
        lines: [
          { label: "Taxpayer", value: "Alex Rivera" },
          { label: "Filing status requested", value: "Head of household" },
          { label: "Dependent", value: "Mateo Rivera - son - lived with taxpayer 12 months" },
          { label: "Dependent SSN", value: "Not provided", emphasis: true },
          { label: "HSA contribution paid directly", value: "$3,850.00" },
        ],
      },
      {
        heading: "Return assumptions supplied by reviewer",
        lines: [
          { label: "Standard deduction", value: "$23,625.00" },
          { label: "Tax before nonrefundable credits", value: "$20,010.00" },
          { label: "Supported nonrefundable credits", value: "$2,000.00" },
        ],
      },
    ],
  },
  {
    id: "source-checklist",
    name: "Source_Document_Checklist.docx",
    format: "DOCX",
    description: "Firm intake checklist for outstanding source documents",
    sections: [
      {
        heading: "Document intake status",
        table: {
          columns: ["Document", "Status", "Follow-up"],
          rows: [
            ["2025 Form W-2", "Received", "Matched to taxpayer"],
            ["2025 Form 1099-INT", "Received", "Matched to taxpayer"],
            ["2025 Form 1099-NEC", "Not received", "Client reports consulting receipts"],
            ["Vehicle mileage log", "Not received", "Client supplied expense total only"],
            ["Dependent SSN documentation", "Not received", "Organizer field is blank"],
          ],
        },
      },
    ],
  },
];

const TAX_MESSAGES: CaseMessage[] = [
  {
    id: "assignment",
    sender: "Morgan Reed",
    senderRole: "Tax Manager",
    subject: "Rivera 1040 preparation",
    receivedAt: "9:10 AM",
    preview: "Prepare the federal return from the source documents and clear supported diagnostics.",
    body: [
      "Please prepare Alex Rivera's 2025 federal individual return from the documents in the client file.",
      "Do not assume unsupported deductions or identification data. Record every unresolved source-document issue in diagnostics and leave a concise reviewer note.",
      "The organizer includes the reviewer-supplied standard deduction, pre-credit tax, and supported credit amounts for this assessment case.",
    ],
    attachmentIds: ["organizer", "source-checklist"],
    unread: true,
  },
  {
    id: "wage-documents",
    sender: "Priya Shah",
    senderRole: "Tax Associate",
    subject: "Rivera wage and interest statements",
    receivedAt: "9:34 AM",
    preview: "The wage and bank statements passed the taxpayer-name review.",
    body: [
      "The W-2 and 1099-INT are attached. Both match the taxpayer name in the organizer.",
      "Please enter the federal amounts exactly as reported and retain the source references in the return file.",
    ],
    attachmentIds: ["w2", "1099-int"],
    unread: true,
  },
  {
    id: "business-documents",
    sender: "Morgan Reed",
    senderRole: "Tax Manager",
    subject: "Schedule C support",
    receivedAt: "10:02 AM",
    preview: "Review the business summary and determine the supported deductions.",
    body: [
      "The client-provided business summary is attached.",
      "Evaluate deductibility and substantiation rather than entering the expense total mechanically. The intake checklist identifies records that remain outstanding.",
    ],
    attachmentIds: ["business-summary", "source-checklist"],
  },
];

function amount(value: string | number | undefined) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function inputComplete(value: string) {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

export function TaxTool({
  title = "1040 Individual Tax",
  description = "Complex individual return preparation and review",
  instructions = "Prepare the return from source documents, resolve supported diagnostics, and document unresolved compliance issues.",
  caseData,
  initialSubmission,
  candidateMode = false,
  showSubmit = true,
  onAutosave,
  onSubmit,
}: TaxToolProps) {
  const taxCase = useMemo(() => ({ ...DEFAULT_CASE, ...(caseData || {}) }), [caseData]);
  const restored = initialSubmission?.tax_workspace;
  const [activePage, setActivePage] = useState<TaxPage>("overview");
  const [inputs, setInputs] = useState<Record<TaxInputKey, string>>({ ...EMPTY_INPUTS, ...(restored?.inputs || {}) });
  const [selectedFlags, setSelectedFlags] = useState<string[]>(initialSubmission?.identified_red_flags || []);
  const [notes, setNotes] = useState(initialSubmission?.notes || "");
  const [activityLog, setActivityLog] = useState<TaxActivity[]>(restored?.activity_log?.length ? restored.activity_log : INITIAL_ACTIVITY);
  const [search, setSearch] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const logAction = useCallback((action: string, detail: string) => {
    setActivityLog((current) => [...current.slice(-99), { at: new Date().toISOString(), action, detail }]);
  }, []);

  const scheduleCProfit = amount(inputs.business_receipts) - amount(inputs.allowable_business_expenses);
  const adjustedGrossIncome = amount(inputs.wages) + amount(inputs.taxable_interest) + scheduleCProfit - amount(inputs.hsa_deduction);
  const taxableIncome = Math.max(0, adjustedGrossIncome - amount(inputs.standard_deduction));
  const taxAfterCredits = Math.max(0, amount(inputs.pre_credit_tax) - amount(inputs.nonrefundable_credits));
  const refund = amount(inputs.federal_withholding) - taxAfterCredits;

  const completedSections = useMemo(() => {
    const complete: string[] = [];
    if (inputComplete(inputs.wages) && inputComplete(inputs.federal_withholding) && inputComplete(inputs.taxable_interest)) complete.push("income");
    if (inputComplete(inputs.business_receipts) && inputComplete(inputs.allowable_business_expenses)) complete.push("schedule_c");
    if (inputComplete(inputs.hsa_deduction) && inputComplete(inputs.standard_deduction)) complete.push("adjustments");
    if (inputComplete(inputs.pre_credit_tax) && inputComplete(inputs.nonrefundable_credits)) complete.push("tax");
    if (selectedFlags.length > 0) complete.push("diagnostics");
    if (notes.trim()) complete.push("review");
    return complete;
  }, [inputs, notes, selectedFlags.length]);

  const submission = useMemo<TaxAssessmentSubmission>(() => ({
    entered_form_values: {
      wages: amount(inputs.wages),
      federal_withholding: amount(inputs.federal_withholding),
      taxable_interest: amount(inputs.taxable_interest),
      business_receipts: amount(inputs.business_receipts),
      allowable_business_expenses: amount(inputs.allowable_business_expenses),
      hsa_deduction: amount(inputs.hsa_deduction),
      standard_deduction: amount(inputs.standard_deduction),
      pre_credit_tax: amount(inputs.pre_credit_tax),
      nonrefundable_credits: amount(inputs.nonrefundable_credits),
      schedule_c_profit: scheduleCProfit,
      adjusted_gross_income: adjustedGrossIncome,
      taxable_income: taxableIncome,
      tax_after_credits: taxAfterCredits,
      refund,
    },
    identified_red_flags: selectedFlags,
    notes,
    tax_workspace: {
      inputs,
      activity_log: activityLog,
      completed_sections: completedSections,
    },
  }), [activityLog, adjustedGrossIncome, completedSections, inputs, notes, refund, scheduleCProfit, selectedFlags, taxAfterCredits, taxableIncome]);

  useEffect(() => {
    if (!onAutosave) return;
    const timeout = window.setTimeout(() => onAutosave(submission), 500);
    return () => window.clearTimeout(timeout);
  }, [onAutosave, submission]);

  function updateInput(key: TaxInputKey, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
    logAction("return_input_updated", key);
  }

  function toggleFlag(flag: string) {
    setSelectedFlags((current) => current.includes(flag) ? current.filter((item) => item !== flag) : [...current, flag]);
    logAction("diagnostic_updated", flag);
  }

  function navigate(page: TaxPage) {
    setActivePage(page);
    setMobileNavOpen(false);
  }

  function saveReturn() {
    onAutosave?.(submission);
    logAction("return_saved", "Federal return draft saved");
    setSavedNotice("Return saved");
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  function showNotice(message: string) {
    setSavedNotice(message);
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  const progress = Math.round((completedSections.length / 6) * 100);
  const pageIndex = TAX_PAGES.findIndex((page) => page.id === activePage);

  const moneyField = (key: TaxInputKey, label: string, source: string) => (
    <label className="tax-field" key={key}>
      <span>{label}<small>{source}</small></span>
      <div><b>$</b><input aria-label={label} inputMode="decimal" value={inputs[key]} onChange={(event) => updateInput(key, event.target.value)} placeholder="0" /></div>
    </label>
  );

  return (
    <div className={`tax-app${candidateMode ? " candidate-mode" : ""}`}>
      <aside className={`tax-sidebar${mobileNavOpen ? " open" : ""}`}>
        <div className="tax-product"><span><FileCheck2 size={18} /></span><div><strong>1040 Individual Tax</strong><small>Professional individual return</small></div></div>
        <button className="tax-client-switcher" type="button" onClick={() => showNotice("This assessment contains one assigned client return")}>
          <span><CircleUserRound size={17} /></span><span><strong>{taxCase.taxpayerName}</strong><small>Federal 1040 / {taxCase.taxYear}</small></span><ChevronRight size={15} />
        </button>
        <nav aria-label="Tax return navigation">
          {TAX_PAGES.map(({ id, label, icon: Icon }) => <button key={id} className={activePage === id ? "active" : ""} type="button" onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span>{id === "diagnostics" && <em>{selectedFlags.length}</em>}</button>)}
        </nav>
        <div className="tax-sidebar-footer"><span className="tax-avatar">AR</span><span><strong>Rivera 1040</strong><small>Autosave enabled</small></span></div>
      </aside>

      <main className="tax-main">
        <header className="tax-topbar">
          <div className="tax-title-block">
            <button className="tax-mobile-menu" type="button" aria-label="Open tax navigation" onClick={() => setMobileNavOpen((value) => !value)}><FileCheck2 size={18} /></button>
            <div><span>{title}</span><h1>{TAX_PAGES[pageIndex]?.label}</h1></div>
          </div>
          <div className="tax-top-actions">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search forms and fields" /></label>
            <button type="button" onClick={saveReturn}><Save size={15} />Save</button>
            <span className="tax-return-status">In preparation</span>
          </div>
        </header>

        {activePage === "overview" && (
          <div className="tax-page">
            <section className="tax-page-heading"><div><span className="tax-eyebrow">2025 federal individual</span><h2>{description}</h2><p>{instructions}</p></div><button className="tax-primary" type="button" onClick={() => navigate("income")}>Continue preparation<ChevronRight size={16} /></button></section>
            <section className="tax-metrics">
              <article><span>Return status</span><strong>{progress}%</strong><div><i style={{ width: `${progress}%` }} /></div></article>
              <article><span>Source documents</span><strong>{TAX_DOCUMENTS.length}</strong><small>Client file received</small></article>
              <article><span>Diagnostics selected</span><strong>{selectedFlags.length}</strong><small>Review support before finalizing</small></article>
              <article><span>Refund / amount due</span><strong className={refund < 0 ? "due" : ""}>{completedSections.includes("tax") ? money(Math.abs(refund)) : "Not calculated"}</strong><small>{refund < 0 ? "Estimated amount due" : "Estimated refund"}</small></article>
            </section>
            <section className="tax-overview-grid">
              <article className="tax-panel tax-return-map">
                <header><div><h3>Preparation workflow</h3><p>Complete source entry, calculation, diagnostics, and reviewer documentation.</p></div><span>{completedSections.length}/6</span></header>
                {[
                  ["income", "Enter wage and interest statements", "Use the W-2 and 1099-INT source documents", "income"],
                  ["schedule_c", "Prepare Schedule C", "Determine gross receipts and supported deductions", "business"],
                  ["adjustments", "Enter adjustments and deductions", "Review the organizer and filing assumptions", "adjustments"],
                  ["tax", "Complete tax and credit inputs", "Enter reviewer-supplied computation values", "adjustments"],
                  ["diagnostics", "Resolve diagnostics", "Select only issues supported by the client file", "diagnostics"],
                  ["review", "Document the reviewer note", "Explain unresolved documents and assumptions", "review"],
                ].map(([key, label, detail, destination]) => {
                  const complete = completedSections.includes(key);
                  return <button key={key} type="button" onClick={() => navigate(destination as TaxPage)}><span className={complete ? "complete" : ""}>{complete ? <Check size={14} /> : <span />}</span><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={15} /></button>;
                })}
              </article>
              <aside className="tax-panel tax-source-queue">
                <header><h3>Client file</h3><span>{TAX_DOCUMENTS.length} documents</span></header>
                <div><FileText size={17} /><span><strong>Income statements</strong><small>W-2 and 1099-INT received</small></span></div>
                <div><ReceiptText size={17} /><span><strong>Business records</strong><small>Client summary requires tax review</small></span></div>
                <div><FolderOpen size={17} /><span><strong>Organizer and checklist</strong><small>Review intake completeness</small></span></div>
              </aside>
            </section>
          </div>
        )}

        {activePage === "taxpayer" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Form 1040</span><h2>Taxpayer information</h2><p>Confirm identity and filing information against the signed organizer.</p></div></section>
            <section className="tax-panel tax-taxpayer-card">
              <div><span>Taxpayer name</span><strong>{taxCase.taxpayerName}</strong></div>
              <div><span>Social Security number</span><strong>{taxCase.maskedSsn}</strong></div>
              <div><span>Filing status</span><strong>{taxCase.filingStatus}</strong></div>
              <div><span>Occupation</span><strong>{taxCase.occupation}</strong></div>
              <div><span>Dependent</span><strong>{taxCase.dependentName}</strong></div>
              <div><span>Tax year</span><strong>{taxCase.taxYear}</strong></div>
            </section>
            <section className="tax-panel tax-neutral-note"><ShieldAlert size={18} /><div><strong>Identity data is read-only in this assessment.</strong><p>Use diagnostics to record unsupported or missing dependent information.</p></div></section>
          </div>
        )}

        {activePage === "income" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Income input</span><h2>Wages and interest</h2><p>Enter federal amounts exactly as shown on the source statements.</p></div></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Income statements</h3><p>Source references remain available from Mail and Documents.</p></div><WalletCards size={18} /></div>
              <div className="tax-fields-grid">
                {moneyField("wages", "Wages, salaries, and tips", "Form W-2 / box 1")}
                {moneyField("federal_withholding", "Federal income tax withheld", "Form W-2 / box 2")}
                {moneyField("taxable_interest", "Taxable interest", "Form 1099-INT / box 1")}
              </div>
            </section>
          </div>
        )}

        {activePage === "business" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Schedule C</span><h2>Rivera Consulting</h2><p>Determine gross receipts and allowable expenses from the client records and substantiation.</p></div><span className="tax-calculated-balance"><small>Calculated net profit</small><strong>{money(scheduleCProfit)}</strong></span></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Profit or loss from business</h3><p>Do not enter an unsupported expense merely because it appears on the client summary.</p></div><ReceiptText size={18} /></div>
              <div className="tax-fields-grid">
                {moneyField("business_receipts", "Gross receipts or sales", "Schedule C / line 1")}
                {moneyField("allowable_business_expenses", "Total allowable expenses", "Schedule C / lines 8-30")}
              </div>
              <div className="tax-computation-line"><span>Schedule C net profit</span><strong>{money(scheduleCProfit)}</strong></div>
            </section>
          </div>
        )}

        {activePage === "adjustments" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Form 1040 computation</span><h2>Adjustments, deductions, and tax</h2><p>Complete the federal calculation using the organizer and supported return assumptions.</p></div></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Return computation inputs</h3><p>Amounts entered here flow to the calculated return preview.</p></div><Calculator size={18} /></div>
              <div className="tax-fields-grid">
                {moneyField("hsa_deduction", "HSA deduction", "Schedule 1 adjustment")}
                {moneyField("standard_deduction", "Standard deduction", "Form 1040 deduction")}
                {moneyField("pre_credit_tax", "Tax before credits", "Reviewer computation")}
                {moneyField("nonrefundable_credits", "Nonrefundable credits", "Supported credit amount")}
              </div>
            </section>
            <section className="tax-calculation-strip">
              <div><span>Adjusted gross income</span><strong>{money(adjustedGrossIncome)}</strong></div>
              <div><span>Taxable income</span><strong>{money(taxableIncome)}</strong></div>
              <div><span>Tax after credits</span><strong>{money(taxAfterCredits)}</strong></div>
              <div><span>{refund >= 0 ? "Refund" : "Amount due"}</span><strong>{money(Math.abs(refund))}</strong></div>
            </section>
          </div>
        )}

        {activePage === "diagnostics" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Pre-filing review</span><h2>Diagnostics</h2><p>Select only issues supported by the return data, source checklist, and client documents.</p></div><span className="tax-calculated-balance"><small>Selected for review</small><strong>{selectedFlags.length}</strong></span></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Return diagnostics</h3><p>Unsupported selections are treated as false-positive review conclusions.</p></div><Stethoscope size={18} /></div>
              <div className="tax-diagnostic-list">{REVIEW_FLAGS.map((flag) => <label key={flag} className={selectedFlags.includes(flag) ? "selected" : ""}><input type="checkbox" checked={selectedFlags.includes(flag)} onChange={() => toggleFlag(flag)} /><span>{selectedFlags.includes(flag) ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><strong>{flag}</strong><small>{selectedFlags.includes(flag) ? "Included in reviewer diagnostics" : "Review evidence before selecting"}</small></label>)}</div>
            </section>
          </div>
        )}

        {activePage === "forms" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Calculated forms</span><h2>Federal return preview</h2><p>Review the forms generated from the current return inputs.</p></div><button className="tax-secondary" type="button" onClick={() => showNotice("Return preview refreshed")}><RefreshCw size={15} />Refresh</button></section>
            <section className="tax-form-preview-layout">
              <article className="tax-form-paper">
                <header><div><strong>Form 1040</strong><span>U.S. Individual Income Tax Return</span></div><b>{taxCase.taxYear}</b></header>
                <div className="tax-form-identity"><span>{taxCase.taxpayerName}</span><span>{taxCase.maskedSsn}</span><span>{taxCase.filingStatus}</span></div>
                <dl>
                  <div><dt>1a</dt><dd>Wages, salaries, tips</dd><strong>{money(amount(inputs.wages))}</strong></div>
                  <div><dt>2b</dt><dd>Taxable interest</dd><strong>{money(amount(inputs.taxable_interest))}</strong></div>
                  <div><dt>8</dt><dd>Additional income from Schedule 1</dd><strong>{money(scheduleCProfit)}</strong></div>
                  <div><dt>11</dt><dd>Adjusted gross income</dd><strong>{money(adjustedGrossIncome)}</strong></div>
                  <div><dt>12</dt><dd>Standard deduction</dd><strong>{money(amount(inputs.standard_deduction))}</strong></div>
                  <div><dt>15</dt><dd>Taxable income</dd><strong>{money(taxableIncome)}</strong></div>
                  <div><dt>24</dt><dd>Total tax after credits</dd><strong>{money(taxAfterCredits)}</strong></div>
                  <div><dt>25a</dt><dd>Federal income tax withheld</dd><strong>{money(amount(inputs.federal_withholding))}</strong></div>
                  <div className="total"><dt>34</dt><dd>{refund >= 0 ? "Overpayment / refund" : "Amount you owe"}</dd><strong>{money(Math.abs(refund))}</strong></div>
                </dl>
              </article>
              <article className="tax-form-paper compact">
                <header><div><strong>Schedule C</strong><span>Profit or Loss From Business</span></div><b>{taxCase.taxYear}</b></header>
                <dl>
                  <div><dt>1</dt><dd>Gross receipts or sales</dd><strong>{money(amount(inputs.business_receipts))}</strong></div>
                  <div><dt>28</dt><dd>Total expenses</dd><strong>{money(amount(inputs.allowable_business_expenses))}</strong></div>
                  <div className="total"><dt>31</dt><dd>Net profit</dd><strong>{money(scheduleCProfit)}</strong></div>
                </dl>
              </article>
            </section>
          </div>
        )}

        {activePage === "review" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Final review</span><h2>Complete return workpaper</h2><p>Review calculated outputs, diagnostics, and documentation before submission.</p></div></section>
            <section className="tax-review-layout">
              <article className="tax-panel tax-output-review">
                <div className="tax-panel-title"><div><h3>Calculated outputs</h3><p>Generated from the current return inputs.</p></div><Calculator size={18} /></div>
                {[
                  ["Schedule C profit", scheduleCProfit, completedSections.includes("schedule_c")],
                  ["Adjusted gross income", adjustedGrossIncome, completedSections.includes("adjustments")],
                  ["Taxable income", taxableIncome, completedSections.includes("adjustments")],
                  ["Tax after credits", taxAfterCredits, completedSections.includes("tax")],
                  [refund >= 0 ? "Refund" : "Amount due", Math.abs(refund), completedSections.includes("tax")],
                ].map(([label, value, complete]) => <div key={String(label)}><span className={complete ? "complete" : ""}>{complete ? <Check size={13} /> : <span />}</span><span>{String(label)}</span><strong>{money(Number(value))}</strong></div>)}
              </article>
              <article className="tax-panel tax-review-note">
                <div className="tax-panel-title"><div><h3>Preparer note</h3><p>Document unresolved source records, tax assumptions, and reviewer follow-up.</p></div><FileSearch size={18} /></div>
                <label><span>Reviewer note</span><textarea rows={9} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Summarize unresolved documentation and any return positions requiring review." /></label>
                <div><span>Diagnostics selected</span><strong>{selectedFlags.length}</strong></div>
              </article>
            </section>
            {showSubmit && <footer className="tax-submit-bar"><div><strong>{progress === 100 ? "Return workpaper ready" : "Complete all preparation workflows before submitting"}</strong><span>Results are provided only to the recruiting organization.</span></div><button className="tax-primary" type="button" onClick={() => void onSubmit?.(submission)}><ClipboardCheck size={16} />Submit assessment</button></footer>}
          </div>
        )}

        <footer className="tax-section-navigation">
          <button className="tax-secondary" type="button" disabled={pageIndex <= 0} onClick={() => navigate(TAX_PAGES[Math.max(0, pageIndex - 1)].id)}><ChevronLeft size={15} />Previous</button>
          <span>{pageIndex + 1} of {TAX_PAGES.length}</span>
          <button className="tax-secondary" type="button" disabled={pageIndex >= TAX_PAGES.length - 1} onClick={() => navigate(TAX_PAGES[Math.min(TAX_PAGES.length - 1, pageIndex + 1)].id)}>Next<ChevronRight size={15} /></button>
        </footer>
      </main>

      <CaseEvidenceDesk productName="1040 Individual Tax" documents={TAX_DOCUMENTS} messages={TAX_MESSAGES} onActivity={logAction} />
      {savedNotice && <div className="tax-saved-notice" role="status"><CheckCircle2 size={16} />{savedNotice}</div>}
    </div>
  );
}
