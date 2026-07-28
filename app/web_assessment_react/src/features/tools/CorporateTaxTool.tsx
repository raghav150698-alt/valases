import {
  AlertTriangle,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FileSearch,
  FileText,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Stethoscope,
  TableProperties,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseEvidenceDesk, type CaseDocument, type CaseMessage } from "./CaseEvidenceDesk";
import "./TaxTool.css";

type CorporateTaxPage = "overview" | "corporation" | "income" | "deductions" | "reconciliation" | "diagnostics" | "forms" | "review";
type CorporateTaxInputKey =
  | "gross_receipts"
  | "returns_allowances"
  | "cost_of_goods_sold"
  | "taxable_interest"
  | "capital_gain"
  | "other_income"
  | "officer_compensation"
  | "salaries_wages"
  | "repairs_maintenance"
  | "allowable_bad_debts"
  | "rents"
  | "allowable_taxes"
  | "interest_expense"
  | "allowable_charitable_contribution"
  | "tax_depreciation"
  | "advertising"
  | "pension_profit_sharing"
  | "employee_benefits"
  | "other_deductions"
  | "estimated_payments"
  | "book_net_income"
  | "federal_tax_provision"
  | "excess_charitable_contribution"
  | "nondeductible_meals"
  | "fines_penalties"
  | "bad_debt_addback"
  | "excess_tax_depreciation";

type CorporateTaxActivity = { at: string; action: string; detail: string };

export type CorporateTaxAssessmentSubmission = {
  entered_form_values: Record<string, number>;
  identified_red_flags: string[];
  notes: string;
  corporate_tax_workspace: {
    inputs: Record<CorporateTaxInputKey, string>;
    activity_log: CorporateTaxActivity[];
    completed_sections: string[];
  };
};

export type CorporateTaxCase = {
  corporationName: string;
  maskedEin: string;
  taxYear: number;
  entityType: string;
  returnType: string;
  accountingMethod: string;
  taxYearEnd: string;
};

type CorporateTaxToolProps = {
  title?: string;
  description?: string;
  instructions?: string;
  caseData?: Partial<CorporateTaxCase>;
  initialSubmission?: CorporateTaxAssessmentSubmission | null;
  candidateMode?: boolean;
  showSubmit?: boolean;
  onAutosave?: (submission: CorporateTaxAssessmentSubmission) => void;
  onSubmit?: (submission: CorporateTaxAssessmentSubmission) => void | Promise<void>;
};

const DEFAULT_CASE: CorporateTaxCase = {
  corporationName: "Sterling Ridge Analytics, Inc.",
  maskedEin: "**-***7314",
  taxYear: 2025,
  entityType: "Domestic C corporation",
  returnType: "Form 1120",
  accountingMethod: "Accrual",
  taxYearEnd: "December 31, 2025",
};

const EMPTY_INPUTS = {
  gross_receipts: "",
  returns_allowances: "",
  cost_of_goods_sold: "",
  taxable_interest: "",
  capital_gain: "",
  other_income: "",
  officer_compensation: "",
  salaries_wages: "",
  repairs_maintenance: "",
  allowable_bad_debts: "",
  rents: "",
  allowable_taxes: "",
  interest_expense: "",
  allowable_charitable_contribution: "",
  tax_depreciation: "",
  advertising: "",
  pension_profit_sharing: "",
  employee_benefits: "",
  other_deductions: "",
  estimated_payments: "",
  book_net_income: "",
  federal_tax_provision: "",
  excess_charitable_contribution: "",
  nondeductible_meals: "",
  fines_penalties: "",
  bad_debt_addback: "",
  excess_tax_depreciation: "",
} satisfies Record<CorporateTaxInputKey, string>;

const CORPORATE_PAGES: Array<{ id: CorporateTaxPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Return overview", icon: LayoutDashboard },
  { id: "corporation", label: "Corporation", icon: Building2 },
  { id: "income", label: "Income", icon: WalletCards },
  { id: "deductions", label: "Deductions", icon: ReceiptText },
  { id: "reconciliation", label: "Book-tax reconciliation", icon: TableProperties },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
  { id: "forms", label: "Forms preview", icon: FileText },
  { id: "review", label: "Review return", icon: ClipboardCheck },
];

const REVIEW_FLAGS = [
  "Federal income tax provision is nondeductible",
  "Meals require a 50% limitation",
  "Fines and penalties are nondeductible",
  "Bad-debt allowance requires a tax adjustment",
  "Charitable contribution exceeds the current-year limit",
  "Tax depreciation exceeds book depreciation",
  "Contractor information-return support is incomplete",
  "Corporation qualifies for S corporation treatment",
  "Tax-exempt interest is taxable",
  "All charitable contributions are fully deductible",
  "Schedule M-3 is required",
];

const INITIAL_ACTIVITY: CorporateTaxActivity[] = [
  { at: "2026-02-18T13:15:00.000Z", action: "return_assigned", detail: "2025 Form 1120 assigned for preparation" },
  { at: "2026-02-18T13:18:00.000Z", action: "source_documents_received", detail: "Trial balance, tax workpapers, and corporate records added" },
];

const CORPORATE_DOCUMENTS: CaseDocument[] = [
  {
    id: "trial-balance",
    name: "Sterling_Ridge_2025_Tax_Trial_Balance.xlsx",
    format: "XLSX",
    description: "Final book trial balance and income statement",
    sections: [
      {
        heading: "Income statement - year ended December 31, 2025",
        table: {
          columns: ["Book account", "Debit", "Credit"],
          rows: [
            ["Gross receipts", "", "$2,980,000"],
            ["Returns and allowances", "$45,000", ""],
            ["Cost of goods sold", "$1,065,000", ""],
            ["Taxable interest income", "", "$18,500"],
            ["Net long-term capital gain", "", "$42,000"],
            ["Other taxable income", "", "$12,000"],
            ["Officer compensation", "$310,000", ""],
            ["Salaries and wages", "$420,000", ""],
            ["Repairs and maintenance", "$37,500", ""],
            ["Bad-debt provision", "$28,000", ""],
            ["Rents", "$96,000", ""],
            ["State taxes and licenses", "$72,000", ""],
            ["Federal income tax provision", "$105,000", ""],
            ["Interest expense", "$24,000", ""],
            ["Charitable contributions", "$90,000", ""],
            ["Book depreciation", "$92,000", ""],
            ["Advertising", "$64,000", ""],
            ["Pension and profit sharing", "$48,000", ""],
            ["Employee benefits", "$61,000", ""],
            ["Professional fees", "$55,000", ""],
            ["Insurance", "$44,000", ""],
            ["Utilities", "$38,000", ""],
            ["Business meals", "$32,000", ""],
            ["Regulatory fines", "$7,500", ""],
            ["Net income after federal tax", "$318,500", ""],
          ],
        },
      },
    ],
  },
  {
    id: "tax-adjustments",
    name: "2025_Book_Tax_Adjustment_Memo.docx",
    format: "DOCX",
    pages: 3,
    description: "Controller memo supporting federal tax adjustments",
    sections: [
      {
        heading: "Tax adjustment summary",
        table: {
          columns: ["Item", "Book amount", "Tax support"],
          rows: [
            ["Bad debts", "$28,000 provision", "$16,000 specifically charged off"],
            ["Business meals", "$32,000", "Receipts and business purpose supplied"],
            ["Regulatory fines", "$7,500", "Government penalty"],
            ["Federal income tax", "$105,000", "Book provision"],
            ["Charitable contribution", "$90,000", "Qualified cash contribution"],
          ],
        },
      },
      { note: "Apply federal deductibility and limitation rules. Do not treat a book classification as a tax conclusion." },
    ],
  },
  {
    id: "fixed-assets",
    name: "2025_Fixed_Asset_and_Depreciation_Report.xlsx",
    format: "XLSX",
    description: "Book and federal depreciation workpaper",
    sections: [
      {
        heading: "Depreciation reconciliation",
        lines: [
          { label: "Book depreciation", value: "$92,000" },
          { label: "Federal tax depreciation", value: "$118,000", emphasis: true },
          { label: "Tax depreciation in excess of book", value: "$26,000" },
        ],
      },
    ],
  },
  {
    id: "corporate-records",
    name: "Corporate_Organizer_and_Balance_Sheet.pdf",
    format: "PDF",
    pages: 5,
    description: "Signed organizer, stock data, and Schedule L balances",
    sections: [
      {
        heading: "Corporate return information",
        lines: [
          { label: "Entity", value: "Sterling Ridge Analytics, Inc." },
          { label: "Entity classification", value: "Domestic C corporation" },
          { label: "Accounting method", value: "Accrual" },
          { label: "Tax year end", value: "December 31, 2025" },
          { label: "Total assets at year end", value: "$2,240,000" },
          { label: "Cash dividends paid", value: "$33,500" },
        ],
      },
      {
        heading: "Schedule L control totals",
        table: {
          columns: ["Balance", "Beginning", "Ending"],
          rows: [
            ["Total assets", "$1,860,000", "$2,240,000"],
            ["Total liabilities", "$710,000", "$805,000"],
            ["Capital stock", "$400,000", "$400,000"],
            ["Retained earnings", "$750,000", "$1,035,000"],
          ],
        },
      },
    ],
  },
  {
    id: "payments-checklist",
    name: "Payments_and_Information_Return_Checklist.pdf",
    format: "PDF",
    pages: 2,
    description: "Estimated tax confirmations and filing-support checklist",
    sections: [
      {
        heading: "Federal estimated tax payments",
        table: {
          columns: ["Payment", "Date", "Amount"],
          rows: [
            ["Q1", "04/15/2025", "$22,500"],
            ["Q2", "06/16/2025", "$22,500"],
            ["Q3", "09/15/2025", "$22,500"],
            ["Q4", "12/15/2025", "$22,500"],
          ],
        },
      },
      {
        heading: "Information-return support",
        lines: [
          { label: "Contractor payments requiring Forms 1099", value: "Yes" },
          { label: "Vendor W-9 and TIN validation file", value: "Incomplete", emphasis: true },
          { label: "Forms 1099 filed", value: "Pending documentation" },
        ],
      },
    ],
  },
];

const CORPORATE_MESSAGES: CaseMessage[] = [
  {
    id: "assignment",
    sender: "Dana Walsh",
    senderRole: "Corporate Tax Manager",
    subject: "Sterling Ridge 2025 Form 1120",
    receivedAt: "8:45 AM",
    preview: "Prepare Page 1, Schedule J, Schedule L, and Schedule M-1 from the final records.",
    body: [
      "Prepare Sterling Ridge Analytics, Inc.'s 2025 federal corporate return from the attached final records.",
      "Use the book-tax memo to determine supported deductions. Resolve the contribution limit, tax depreciation adjustment, and information-return support before completing the reviewer note.",
      "Do not assume an S election or Schedule M-3 filing requirement without evidence.",
    ],
    attachmentIds: ["trial-balance", "tax-adjustments", "corporate-records"],
    unread: true,
  },
  {
    id: "payments",
    sender: "Leah Monroe",
    senderRole: "Senior Tax Associate",
    subject: "Estimated payments and open vendor support",
    receivedAt: "10:20 AM",
    preview: "Four federal payments cleared; contractor TIN support remains incomplete.",
    body: [
      "The four federal estimated tax payments each cleared for $22,500.",
      "The information-return checklist is still missing complete vendor W-9 and TIN validation support. Keep that item open in diagnostics.",
    ],
    attachmentIds: ["payments-checklist"],
    unread: true,
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
  return value.trim() !== "" && Number.isFinite(Number(value.replaceAll(",", "")));
}

export function CorporateTaxTool({
  title = "1120 Corporate Tax",
  description = "Corporate return preparation and book-tax reconciliation",
  instructions = "Prepare Form 1120 from source documents, complete the tax reconciliation, and resolve supported diagnostics.",
  caseData,
  initialSubmission,
  candidateMode = false,
  showSubmit = true,
  onAutosave,
  onSubmit,
}: CorporateTaxToolProps) {
  const corporateCase = useMemo(() => ({ ...DEFAULT_CASE, ...(caseData || {}) }), [caseData]);
  const restored = initialSubmission?.corporate_tax_workspace;
  const [activePage, setActivePage] = useState<CorporateTaxPage>("overview");
  const [inputs, setInputs] = useState<Record<CorporateTaxInputKey, string>>({ ...EMPTY_INPUTS, ...(restored?.inputs || {}) });
  const [selectedFlags, setSelectedFlags] = useState<string[]>(initialSubmission?.identified_red_flags || []);
  const [notes, setNotes] = useState(initialSubmission?.notes || "");
  const [activityLog, setActivityLog] = useState<CorporateTaxActivity[]>(restored?.activity_log?.length ? restored.activity_log : INITIAL_ACTIVITY);
  const [search, setSearch] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const logAction = useCallback((action: string, detail: string) => {
    setActivityLog((current) => [...current.slice(-99), { at: new Date().toISOString(), action, detail }]);
  }, []);

  const netSales = amount(inputs.gross_receipts) - amount(inputs.returns_allowances);
  const grossProfit = netSales - amount(inputs.cost_of_goods_sold);
  const totalIncome = grossProfit + amount(inputs.taxable_interest) + amount(inputs.capital_gain) + amount(inputs.other_income);
  const totalDeductions = [
    "officer_compensation", "salaries_wages", "repairs_maintenance", "allowable_bad_debts", "rents",
    "allowable_taxes", "interest_expense", "allowable_charitable_contribution", "tax_depreciation",
    "advertising", "pension_profit_sharing", "employee_benefits", "other_deductions",
  ].reduce((sum, key) => sum + amount(inputs[key as CorporateTaxInputKey]), 0);
  const taxableIncome = Math.max(0, totalIncome - totalDeductions);
  const incomeTax = Math.round(taxableIncome * 0.21);
  const amountOwed = Math.max(0, incomeTax - amount(inputs.estimated_payments));
  const m1Additions = amount(inputs.federal_tax_provision)
    + amount(inputs.excess_charitable_contribution)
    + amount(inputs.nondeductible_meals)
    + amount(inputs.fines_penalties)
    + amount(inputs.bad_debt_addback);
  const m1Deductions = amount(inputs.excess_tax_depreciation);
  const m1TaxableIncome = amount(inputs.book_net_income) + m1Additions - m1Deductions;

  const completedSections = useMemo(() => {
    const complete: string[] = [];
    if (["gross_receipts", "returns_allowances", "cost_of_goods_sold", "taxable_interest", "capital_gain", "other_income"].every((key) => inputComplete(inputs[key as CorporateTaxInputKey]))) complete.push("income");
    if (["officer_compensation", "salaries_wages", "repairs_maintenance", "allowable_bad_debts", "rents", "allowable_taxes", "interest_expense", "allowable_charitable_contribution", "tax_depreciation", "advertising", "pension_profit_sharing", "employee_benefits", "other_deductions", "estimated_payments"].every((key) => inputComplete(inputs[key as CorporateTaxInputKey]))) complete.push("deductions");
    if (["book_net_income", "federal_tax_provision", "excess_charitable_contribution", "nondeductible_meals", "fines_penalties", "bad_debt_addback", "excess_tax_depreciation"].every((key) => inputComplete(inputs[key as CorporateTaxInputKey]))) complete.push("reconciliation");
    if (selectedFlags.length > 0) complete.push("diagnostics");
    if (notes.trim()) complete.push("review");
    return complete;
  }, [inputs, notes, selectedFlags.length]);

  const submission = useMemo<CorporateTaxAssessmentSubmission>(() => ({
    entered_form_values: {
      ...Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, amount(value)])),
      net_sales: netSales,
      gross_profit: grossProfit,
      total_income: totalIncome,
      total_deductions: totalDeductions,
      taxable_income: taxableIncome,
      income_tax: incomeTax,
      amount_owed: amountOwed,
      m1_additions: m1Additions,
      m1_deductions: m1Deductions,
      m1_taxable_income: m1TaxableIncome,
    },
    identified_red_flags: selectedFlags,
    notes,
    corporate_tax_workspace: { inputs, activity_log: activityLog, completed_sections: completedSections },
  }), [activityLog, amountOwed, completedSections, grossProfit, incomeTax, inputs, m1Additions, m1Deductions, m1TaxableIncome, netSales, notes, selectedFlags, taxableIncome, totalDeductions, totalIncome]);

  useEffect(() => {
    if (!onAutosave) return;
    const timeout = window.setTimeout(() => onAutosave(submission), 500);
    return () => window.clearTimeout(timeout);
  }, [onAutosave, submission]);

  function updateInput(key: CorporateTaxInputKey, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
    logAction("return_input_updated", key);
  }

  function toggleFlag(flag: string) {
    setSelectedFlags((current) => current.includes(flag) ? current.filter((item) => item !== flag) : [...current, flag]);
    logAction("diagnostic_updated", flag);
  }

  function navigate(page: CorporateTaxPage) {
    setActivePage(page);
    setMobileNavOpen(false);
  }

  function showNotice(message: string) {
    setSavedNotice(message);
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  function saveReturn() {
    onAutosave?.(submission);
    logAction("return_saved", "Form 1120 draft saved");
    showNotice("Return saved");
  }

  const progress = Math.round((completedSections.length / 5) * 100);
  const pageIndex = CORPORATE_PAGES.findIndex((page) => page.id === activePage);
  const moneyField = (key: CorporateTaxInputKey, label: string, source: string) => (
    <label className="tax-field" key={key}>
      <span>{label}<small>{source}</small></span>
      <div><b>$</b><input aria-label={label} inputMode="decimal" value={inputs[key]} onChange={(event) => updateInput(key, event.target.value)} placeholder="0" /></div>
    </label>
  );

  return (
    <div className={`tax-app${candidateMode ? " candidate-mode" : ""}`}>
      <aside className={`tax-sidebar${mobileNavOpen ? " open" : ""}`}>
        <div className="tax-product"><span><FileCheck2 size={18} /></span><div><strong>1120 Corporate Tax</strong><small>Professional corporate return</small></div></div>
        <button className="tax-client-switcher" type="button" onClick={() => showNotice("This assessment contains one assigned corporate return")}>
          <span><Building2 size={17} /></span><span><strong>{corporateCase.corporationName}</strong><small>Federal 1120 / {corporateCase.taxYear}</small></span><ChevronRight size={15} />
        </button>
        <nav aria-label="Corporate tax return navigation">
          {CORPORATE_PAGES.map(({ id, label, icon: Icon }) => <button key={id} className={activePage === id ? "active" : ""} type="button" onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span>{id === "diagnostics" && <em>{selectedFlags.length}</em>}</button>)}
        </nav>
        <div className="tax-sidebar-footer"><span className="tax-avatar">SR</span><span><strong>Sterling Ridge 1120</strong><small>Autosave enabled</small></span></div>
      </aside>

      <main className="tax-main">
        <header className="tax-topbar">
          <div className="tax-title-block">
            <button className="tax-mobile-menu" type="button" aria-label="Open tax navigation" onClick={() => setMobileNavOpen((value) => !value)}><FileCheck2 size={18} /></button>
            <div><span>{title}</span><h1>{CORPORATE_PAGES[pageIndex]?.label}</h1></div>
          </div>
          <div className="tax-top-actions">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search forms and fields" /></label>
            <button type="button" onClick={saveReturn}><Save size={15} />Save</button>
            <span className="tax-return-status">In preparation</span>
          </div>
        </header>

        {activePage === "overview" && (
          <div className="tax-page">
            <section className="tax-page-heading"><div><span className="tax-eyebrow">2025 federal corporate</span><h2>{description}</h2><p>{instructions}</p></div><button className="tax-primary" type="button" onClick={() => navigate("income")}>Continue preparation<ChevronRight size={16} /></button></section>
            <section className="tax-metrics">
              <article><span>Return status</span><strong>{progress}%</strong><div><i style={{ width: `${progress}%` }} /></div></article>
              <article><span>Source documents</span><strong>{CORPORATE_DOCUMENTS.length}</strong><small>Corporate file received</small></article>
              <article><span>Diagnostics selected</span><strong>{selectedFlags.length}</strong><small>Evidence review required</small></article>
              <article><span>Estimated balance due</span><strong>{completedSections.includes("deductions") ? money(amountOwed) : "Not calculated"}</strong><small>Schedule J result</small></article>
            </section>
            <section className="tax-overview-grid">
              <article className="tax-panel tax-return-map">
                <header><div><h3>Preparation workflow</h3><p>Complete the corporate return, reconciliation, diagnostics, and reviewer documentation.</p></div><span>{completedSections.length}/5</span></header>
                {([
                  ["income", "Prepare Page 1 income", "Reconcile receipts, COGS, interest, gain, and other income", "income"],
                  ["deductions", "Determine allowable deductions", "Apply federal limitations and supported tax amounts", "deductions"],
                  ["reconciliation", "Complete Schedule M-1", "Bridge book net income to taxable income", "reconciliation"],
                  ["diagnostics", "Resolve corporate diagnostics", "Select only evidence-supported issues", "diagnostics"],
                  ["review", "Document reviewer follow-up", "Explain unresolved source records and tax positions", "review"],
                ] as Array<[string, string, string, CorporateTaxPage]>).map(([id, label, detail, page]) => (
                  <button type="button" key={id} onClick={() => navigate(page)}><span>{completedSections.includes(id) ? <CheckCircle2 size={17} /> : <span />}</span><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={15} /></button>
                ))}
              </article>
              <aside className="tax-panel tax-source-queue">
                <header><h3>Corporate file</h3><span>{CORPORATE_DOCUMENTS.length} documents</span></header>
                <div><ReceiptText size={17} /><span><strong>Trial balance</strong><small>Book income and expense accounts</small></span></div>
                <div><TableProperties size={17} /><span><strong>Tax workpapers</strong><small>Adjustments and depreciation</small></span></div>
                <div><Landmark size={17} /><span><strong>Corporate records</strong><small>Schedule L and payment support</small></span></div>
              </aside>
            </section>
          </div>
        )}

        {activePage === "corporation" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Form 1120</span><h2>Corporation information</h2><p>Confirm entity classification, accounting method, and return period against the signed organizer.</p></div></section>
            <section className="tax-panel tax-taxpayer-card">
              <div><span>Corporation name</span><strong>{corporateCase.corporationName}</strong></div>
              <div><span>Employer identification number</span><strong>{corporateCase.maskedEin}</strong></div>
              <div><span>Entity classification</span><strong>{corporateCase.entityType}</strong></div>
              <div><span>Return type</span><strong>{corporateCase.returnType}</strong></div>
              <div><span>Accounting method</span><strong>{corporateCase.accountingMethod}</strong></div>
              <div><span>Tax year end</span><strong>{corporateCase.taxYearEnd}</strong></div>
            </section>
            <section className="tax-panel tax-neutral-note"><ShieldAlert size={18} /><div><strong>Entity data is read-only in this assessment.</strong><p>Do not infer an S election, consolidated filing, or Schedule M-3 requirement without source support.</p></div></section>
          </div>
        )}

        {activePage === "income" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Form 1120 - income</span><h2>Income and cost of goods sold</h2><p>Enter federal amounts from the trial balance and supporting workpapers.</p></div><span className="tax-calculated-balance"><small>Calculated total income</small><strong>{money(totalIncome)}</strong></span></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Page 1 income</h3><p>Amounts flow to the calculated Form 1120 preview.</p></div><WalletCards size={18} /></div>
              <div className="tax-fields-grid">
                {moneyField("gross_receipts", "Gross receipts or sales", "Page 1 / line 1a")}
                {moneyField("returns_allowances", "Returns and allowances", "Page 1 / line 1b")}
                {moneyField("cost_of_goods_sold", "Cost of goods sold", "Page 1 / line 2")}
                {moneyField("taxable_interest", "Taxable interest", "Page 1 / line 5")}
                {moneyField("capital_gain", "Net capital gain", "Page 1 / line 8")}
                {moneyField("other_income", "Other income", "Page 1 / line 10")}
              </div>
              <div className="tax-calculation-strip">
                <div><span>Net sales</span><strong>{money(netSales)}</strong></div>
                <div><span>Gross profit</span><strong>{money(grossProfit)}</strong></div>
                <div><span>Total income</span><strong>{money(totalIncome)}</strong></div>
              </div>
            </section>
          </div>
        )}

        {activePage === "deductions" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Form 1120 - deductions</span><h2>Federal deductions and Schedule J</h2><p>Enter allowable tax amounts, not unadjusted book expenses.</p></div><span className="tax-calculated-balance"><small>Calculated taxable income</small><strong>{money(taxableIncome)}</strong></span></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Page 1 deductions</h3><p>Review the adjustment memo, depreciation workpaper, and contribution limitation.</p></div><Calculator size={18} /></div>
              <div className="tax-fields-grid">
                {moneyField("officer_compensation", "Compensation of officers", "Line 12")}
                {moneyField("salaries_wages", "Salaries and wages", "Line 13")}
                {moneyField("repairs_maintenance", "Repairs and maintenance", "Line 14")}
                {moneyField("allowable_bad_debts", "Allowable bad debts", "Line 15")}
                {moneyField("rents", "Rents", "Line 16")}
                {moneyField("allowable_taxes", "Allowable taxes and licenses", "Line 17")}
                {moneyField("interest_expense", "Interest expense", "Line 18")}
                {moneyField("allowable_charitable_contribution", "Allowable charitable contribution", "Line 19")}
                {moneyField("tax_depreciation", "Tax depreciation", "Line 20")}
                {moneyField("advertising", "Advertising", "Line 22")}
                {moneyField("pension_profit_sharing", "Pension and profit sharing", "Line 23")}
                {moneyField("employee_benefits", "Employee benefit programs", "Line 24")}
                {moneyField("other_deductions", "Other deductions", "Line 26 statement")}
                {moneyField("estimated_payments", "Estimated tax payments", "Schedule J")}
              </div>
              <div className="tax-calculation-strip">
                <div><span>Total deductions</span><strong>{money(totalDeductions)}</strong></div>
                <div><span>Income tax at 21%</span><strong>{money(incomeTax)}</strong></div>
                <div><span>Amount owed</span><strong>{money(amountOwed)}</strong></div>
              </div>
            </section>
          </div>
        )}

        {activePage === "reconciliation" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Schedule M-1</span><h2>Book-to-tax income reconciliation</h2><p>Reconcile net income per books to income per return using the supported permanent and temporary differences.</p></div><span className="tax-calculated-balance"><small>M-1 income per return</small><strong>{money(m1TaxableIncome)}</strong></span></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Reconciliation inputs</h3><p>Positive additions increase book income; the tax depreciation adjustment reduces it.</p></div><TableProperties size={18} /></div>
              <div className="tax-fields-grid">
                {moneyField("book_net_income", "Net income per books", "Schedule M-1 / line 1")}
                {moneyField("federal_tax_provision", "Federal income tax per books", "Add back")}
                {moneyField("excess_charitable_contribution", "Contribution exceeding current limit", "Add back")}
                {moneyField("nondeductible_meals", "Nondeductible meals", "Add back")}
                {moneyField("fines_penalties", "Fines and penalties", "Add back")}
                {moneyField("bad_debt_addback", "Bad-debt provision adjustment", "Add back")}
                {moneyField("excess_tax_depreciation", "Tax depreciation over book", "Deduct")}
              </div>
              <div className="tax-calculation-strip">
                <div><span>Total M-1 additions</span><strong>{money(m1Additions)}</strong></div>
                <div><span>Total M-1 deductions</span><strong>{money(m1Deductions)}</strong></div>
                <div><span>Income per return</span><strong>{money(m1TaxableIncome)}</strong></div>
              </div>
            </section>
          </div>
        )}

        {activePage === "diagnostics" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Pre-filing review</span><h2>Corporate return diagnostics</h2><p>Select only issues supported by the client file and current return data.</p></div><span className="tax-calculated-balance"><small>Selected for review</small><strong>{selectedFlags.length}</strong></span></section>
            <section className="tax-panel">
              <div className="tax-panel-title"><div><h3>Return diagnostics</h3><p>Unsupported selections are treated as false-positive tax conclusions.</p></div><Stethoscope size={18} /></div>
              <div className="tax-diagnostic-list">{REVIEW_FLAGS.map((flag) => <label key={flag} className={selectedFlags.includes(flag) ? "selected" : ""}><input type="checkbox" checked={selectedFlags.includes(flag)} onChange={() => toggleFlag(flag)} /><span>{selectedFlags.includes(flag) ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><strong>{flag}</strong><small>{selectedFlags.includes(flag) ? "Included in reviewer diagnostics" : "Review evidence before selecting"}</small></label>)}</div>
            </section>
          </div>
        )}

        {activePage === "forms" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Calculated forms</span><h2>Corporate return preview</h2><p>Review Page 1, Schedule J, Schedule L, and Schedule M-1 generated from the current inputs.</p></div><button className="tax-secondary" type="button" onClick={() => showNotice("Return preview refreshed")}><RefreshCw size={15} />Refresh</button></section>
            <section className="tax-form-preview-layout">
              <article className="tax-form-paper">
                <header><div><strong>Form 1120</strong><span>U.S. Corporation Income Tax Return</span></div><b>{corporateCase.taxYear}</b></header>
                <div className="tax-form-identity"><span>{corporateCase.corporationName}</span><span>{corporateCase.maskedEin}</span><span>{corporateCase.accountingMethod}</span></div>
                <dl>
                  <div><dt>1c</dt><dd>Balance, net sales</dd><strong>{money(netSales)}</strong></div>
                  <div><dt>3</dt><dd>Gross profit</dd><strong>{money(grossProfit)}</strong></div>
                  <div><dt>11</dt><dd>Total income</dd><strong>{money(totalIncome)}</strong></div>
                  <div><dt>27</dt><dd>Total deductions</dd><strong>{money(totalDeductions)}</strong></div>
                  <div><dt>30</dt><dd>Taxable income</dd><strong>{money(taxableIncome)}</strong></div>
                  <div><dt>31</dt><dd>Total tax</dd><strong>{money(incomeTax)}</strong></div>
                  <div><dt>35</dt><dd>Amount owed</dd><strong>{money(amountOwed)}</strong></div>
                </dl>
              </article>
              <article className="tax-form-paper compact">
                <header><div><strong>Schedules J, L, and M-1</strong><span>Tax, balance sheet, and book-tax reconciliation</span></div><b>{corporateCase.taxYear}</b></header>
                <dl>
                  <div><dt>J-1a</dt><dd>Income tax</dd><strong>{money(incomeTax)}</strong></div>
                  <div><dt>J-14</dt><dd>Estimated tax payments</dd><strong>{money(amount(inputs.estimated_payments))}</strong></div>
                  <div><dt>L-15</dt><dd>Total assets, end of year</dd><strong>{money(2240000)}</strong></div>
                  <div><dt>L-28</dt><dd>Liabilities and equity, end of year</dd><strong>{money(2240000)}</strong></div>
                  <div><dt>M-1</dt><dd>Net income per books</dd><strong>{money(amount(inputs.book_net_income))}</strong></div>
                  <div><dt>M-1</dt><dd>Total additions</dd><strong>{money(m1Additions)}</strong></div>
                  <div><dt>M-1</dt><dd>Income per return</dd><strong>{money(m1TaxableIncome)}</strong></div>
                </dl>
              </article>
            </section>
          </div>
        )}

        {activePage === "review" && (
          <div className="tax-page">
            <section className="tax-page-heading compact"><div><span className="tax-eyebrow">Final review</span><h2>Complete corporate return workpaper</h2><p>Review calculated outputs, diagnostics, and documentation before submission.</p></div></section>
            <section className="tax-review-layout">
              <article className="tax-panel tax-output-review">
                <div className="tax-panel-title"><div><h3>Calculated outputs</h3><p>Generated from the current return inputs.</p></div><Calculator size={18} /></div>
                <dl>
                  {[["Total income", totalIncome], ["Total deductions", totalDeductions], ["Taxable income", taxableIncome], ["Income tax", incomeTax], ["Amount owed", amountOwed], ["M-1 income per return", m1TaxableIncome]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}
                </dl>
              </article>
              <article className="tax-panel tax-review-note">
                <div className="tax-panel-title"><div><h3>Preparer note</h3><p>Document unresolved records, limitations, and reviewer follow-up.</p></div><FileSearch size={18} /></div>
                <textarea aria-label="Preparer note" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Summarize the book-tax adjustments, outstanding information-return support, and items requiring reviewer attention." />
              </article>
            </section>
            {showSubmit && <footer className="tax-submit-bar"><div><strong>{progress === 100 ? "Corporate return workpaper ready" : "Complete all preparation workflows before submitting"}</strong><span>Results are provided only to the recruiting organization.</span></div><button className="tax-primary" type="button" onClick={() => void onSubmit?.(submission)}><ClipboardCheck size={16} />Submit assessment</button></footer>}
          </div>
        )}

        <footer className="tax-section-navigation">
          <button className="tax-secondary" type="button" disabled={pageIndex <= 0} onClick={() => navigate(CORPORATE_PAGES[Math.max(0, pageIndex - 1)].id)}><ChevronLeft size={15} />Previous</button>
          <span>{pageIndex + 1} of {CORPORATE_PAGES.length}</span>
          <button className="tax-secondary" type="button" disabled={pageIndex >= CORPORATE_PAGES.length - 1} onClick={() => navigate(CORPORATE_PAGES[Math.min(CORPORATE_PAGES.length - 1, pageIndex + 1)].id)}>Next<ChevronRight size={15} /></button>
        </footer>
      </main>

      <CaseEvidenceDesk productName="1120 Corporate Tax" documents={CORPORATE_DOCUMENTS} messages={CORPORATE_MESSAGES} onActivity={logAction} />
      {savedNotice && <div className="tax-saved-notice" role="status"><CheckCircle2 size={16} />{savedNotice}</div>}
    </div>
  );
}
