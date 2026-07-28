import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeDollarSign,
  Banknote,
  Bell,
  BookOpenCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  FileBarChart,
  FileText,
  History,
  Landmark,
  LayoutDashboard,
  Plus,
  ReceiptText,
  RotateCcw,
  Rows3,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseEvidenceDesk, type CaseDocument, type CaseMessage } from "./CaseEvidenceDesk";
import "./AccountingTool.css";

type WorkspacePage = "overview" | "banking" | "transactions" | "register" | "receivables" | "expenses" | "journal" | "reports" | "audit" | "review";
type ReconciliationTreatment = "add" | "subtract" | "exclude" | "";

type ReconciliationItem = {
  id: string;
  date: string;
  description: string;
  reference: string;
  amount: number;
  evidence: string;
};

type LedgerTransaction = {
  id: string;
  date: string;
  type: "Expense" | "Bill" | "Invoice" | "Payment" | "Deposit";
  name: string;
  category: string;
  amount: number;
  status: "Cleared" | "Open" | "Overdue" | "Unreviewed";
  reference: string;
};

type JournalLine = {
  account: string;
  debit: string;
  credit: string;
};

type PostedJournalEntry = {
  id: string;
  date: string;
  memo: string;
  lines: JournalLine[];
  total: number;
  postedAt: string;
};

type ActivityItem = {
  at: string;
  action: string;
  detail: string;
};

export type AccountingCase = {
  companyName: string;
  periodLabel: string;
  statementBalance: number;
  ledgerCashBalance: number;
  arControlBalance: number;
  arSubledgerBalance: number;
  bankItems: ReconciliationItem[];
};

export type AccountingAssessmentSubmission = {
  entered_form_values: Record<string, number>;
  identified_red_flags: string[];
  notes: string;
  accounting_workspace: {
    bank_treatments: Record<string, ReconciliationTreatment>;
    book_treatments: Record<string, ReconciliationTreatment>;
    ar_adjustment: number;
    duplicate_invoice_voided: boolean;
    transactions: LedgerTransaction[];
    posted_journal_entries: PostedJournalEntry[];
    activity_log: ActivityItem[];
    completed_workflows: string[];
  };
};

type AccountingToolProps = {
  title?: string;
  description?: string;
  instructions?: string;
  caseData?: Partial<AccountingCase>;
  initialSubmission?: AccountingAssessmentSubmission | null;
  candidateMode?: boolean;
  showSubmit?: boolean;
  onAutosave?: (submission: AccountingAssessmentSubmission) => void;
  onSubmit?: (submission: AccountingAssessmentSubmission) => void | Promise<void>;
};

const DEFAULT_CASE: AccountingCase = {
  companyName: "Northstar Services LLC",
  periodLabel: "June 2026 close",
  statementBalance: 486_240,
  ledgerCashBalance: 456_380,
  arControlBalance: 612_900,
  arSubledgerBalance: 606_400,
  bankItems: [
    { id: "outstanding-checks", date: "Jun 27-30", description: "Outstanding checks", reference: "4 checks", amount: 42_800, evidence: "Issued before period end; not cleared by bank." },
    { id: "deposits-transit", date: "Jun 30", description: "Deposits in transit", reference: "DEP-0630", amount: 31_500, evidence: "Recorded in ledger; credited by bank on July 1." },
    { id: "bank-charge", date: "Jun 30", description: "Bank service charge", reference: "BANK-FEE", amount: 640, evidence: "Appears on statement; not recorded in ledger." },
    { id: "customer-receipt", date: "Jun 30", description: "Customer ACH receipt", reference: "ACH-8841", amount: 18_200, evidence: "Bank received directly; not recorded in ledger." },
  ],
};

const INITIAL_TRANSACTIONS: LedgerTransaction[] = [
  { id: "TX-1048", date: "Jun 30", type: "Deposit", name: "Brightline Studio", category: "Uncategorized income", amount: 18_200, status: "Unreviewed", reference: "ACH-8841" },
  { id: "TX-1047", date: "Jun 30", type: "Expense", name: "First National Bank", category: "Uncategorized expense", amount: 640, status: "Unreviewed", reference: "BANK-FEE" },
  { id: "AP-7782B", date: "Jun 28", type: "Bill", name: "Northstar Consulting", category: "Professional fees", amount: 9_800, status: "Open", reference: "NS-7782" },
  { id: "AP-7782A", date: "Jun 27", type: "Bill", name: "Northstar Consulting", category: "Professional fees", amount: 9_800, status: "Open", reference: "NS-7782" },
  { id: "AR-3039", date: "Jun 24", type: "Invoice", name: "Cedar & Stone Inc.", category: "Service revenue", amount: 42_600, status: "Overdue", reference: "INV-3039" },
  { id: "TX-1038", date: "Jun 20", type: "Payment", name: "Beacon Retail Group", category: "Accounts receivable", amount: 36_200, status: "Cleared", reference: "ACH-8702" },
];

const AR_CUSTOMERS = [
  { customer: "Beacon Retail Group", balance: 184_300, aging: "Current", status: "Matched" },
  { customer: "Cedar & Stone Inc.", balance: 128_600, aging: "31-60 days", status: "Past due" },
  { customer: "Hawthorne Partners", balance: 151_900, aging: "Current", status: "Matched" },
  { customer: "Meridian Works", balance: 141_600, aging: "1-30 days", status: "Matched" },
];

const ACCOUNT_OPTIONS = [
  "Cash - Operating",
  "Accounts receivable",
  "Accounts payable",
  "Accrued expenses",
  "Professional fees expense",
  "Depreciation expense",
  "Accumulated depreciation",
  "Bank service charges",
  "Service revenue",
];

const PAYEE_DEFAULTS: Record<string, string> = {
  "First National Bank": "Bank service charges",
  "Northstar Consulting": "Professional fees expense",
  "Brightline Studio": "Accounts receivable",
  "Cedar & Stone Inc.": "Service revenue",
};

const CONTROL_FLAGS = [
  "Duplicate vendor invoice",
  "AR control/subledger mismatch",
  "Unrecorded bank charge",
  "Unrecorded customer receipt",
  "Missing service accrual",
  "Bank statement ending balance transposed",
  "Deposit in transit recorded twice",
  "Customer balance requires write-off",
  "Fixed-asset schedule is unsupported",
  "Vendor payment was posted to the wrong period",
];

const ACCOUNT_REGISTER = [
  { date: "Jun 3", reference: "DEP-0603", source: "Deposit", name: "Customer receipts batch", payment: 0, deposit: 126_000, cleared: true, balance: 528_180 },
  { date: "Jun 7", reference: "PAY-0607", source: "Payroll", name: "June payroll cycle 1", payment: 71_400, deposit: 0, cleared: true, balance: 456_780 },
  { date: "Jun 12", reference: "CHK-9138", source: "Check", name: "Operating vendors", payment: 42_800, deposit: 0, cleared: false, balance: 413_980 },
  { date: "Jun 20", reference: "ACH-8702", source: "Payment", name: "Beacon Retail Group", payment: 0, deposit: 36_200, cleared: true, balance: 450_180 },
  { date: "Jun 25", reference: "ACH-8779", source: "Expense", name: "Office and occupancy", payment: 18_400, deposit: 0, cleared: true, balance: 431_780 },
  { date: "Jun 29", reference: "DEP-0629", source: "Deposit", name: "Customer receipts batch", payment: 0, deposit: 24_600, cleared: true, balance: 456_380 },
];

const INITIAL_ACTIVITY: ActivityItem[] = [
  { at: "2026-06-30T13:42:00.000Z", action: "close_file_assigned", detail: "June close file assigned by Corporate Controller" },
  { at: "2026-06-30T13:44:00.000Z", action: "bank_statement_received", detail: "Operating statement ending 4821 added to case documents" },
  { at: "2026-06-30T14:06:00.000Z", action: "subledger_received", detail: "June 30 accounts receivable aging added to case documents" },
];

const CASE_DOCUMENTS: CaseDocument[] = [
  {
    id: "bank-statement",
    name: "FNB_Operating_4821_June.pdf",
    format: "PDF",
    pages: 3,
    description: "June operating-account bank statement",
    sections: [
      {
        heading: "Account summary",
        lines: [
          { label: "Account", value: "Operating checking · ending 4821" },
          { label: "Statement period", value: "June 1-30, 2026" },
          { label: "Beginning balance", value: "$431,865.00" },
          { label: "Deposits and credits", value: "$284,375.00" },
          { label: "Checks and debits", value: "($230,000.00)" },
          { label: "Service charges", value: "($640.00)" },
          { label: "Ending balance", value: "$486,240.00", emphasis: true },
        ],
      },
      {
        heading: "Selected June 30 activity",
        table: {
          columns: ["Date", "Description", "Reference", "Amount"],
          rows: [
            ["Jun 30", "ACH credit - Brightline Studio", "ACH-8841", "$18,200.00"],
            ["Jun 30", "Monthly service charge", "BANK-FEE", "($640.00)"],
            ["Jun 30", "Deposit", "DEP-0629", "$24,600.00"],
          ],
        },
      },
      { note: "Deposit DEP-0630 for $31,500 was credited on July 1 and is not included in this statement ending balance." },
    ],
  },
  {
    id: "vendor-invoices",
    name: "Northstar_Consulting_Invoices.pdf",
    format: "PDF",
    pages: 2,
    description: "Vendor invoices received for June services",
    sections: [
      {
        heading: "Invoice comparison",
        table: {
          columns: ["Entry", "Invoice no.", "Invoice date", "Service period", "Amount"],
          rows: [
            ["AP-7782A", "NS-7782", "Jun 27", "June advisory", "$9,800.00"],
            ["AP-7782B", "NS-7782", "Jun 28", "June advisory", "$9,800.00"],
          ],
        },
      },
      { note: "Both entries use the same vendor invoice number, amount, and service description. Confirm whether one entry should be voided." },
    ],
  },
  {
    id: "ar-aging",
    name: "AR_Aging_June_30.xlsx",
    format: "XLSX",
    description: "Customer subledger aging exported June 30",
    sections: [
      {
        heading: "Accounts receivable aging",
        table: {
          columns: ["Customer", "Current", "1-30", "31-60", "Total"],
          rows: [
            ["Beacon Retail Group", "$184,300", "$0", "$0", "$184,300"],
            ["Cedar & Stone Inc.", "$0", "$0", "$128,600", "$128,600"],
            ["Hawthorne Partners", "$151,900", "$0", "$0", "$151,900"],
            ["Meridian Works", "$0", "$141,600", "$0", "$141,600"],
            ["Subledger total", "$336,200", "$141,600", "$128,600", "$606,400"],
          ],
        },
      },
      { note: "The general-ledger control account reports $612,900. Investigate and record the supported adjustment." },
    ],
  },
  {
    id: "fixed-assets",
    name: "Fixed_Asset_Rollforward.xlsx",
    format: "XLSX",
    description: "June depreciation schedule and rollforward",
    sections: [
      {
        heading: "Monthly depreciation",
        table: {
          columns: ["Asset class", "Cost", "Method", "June depreciation"],
          rows: [
            ["Computer equipment", "$128,000", "Straight line", "$5,400"],
            ["Office equipment", "$84,000", "Straight line", "$2,850"],
            ["Leasehold improvements", "$360,000", "Straight line", "$6,000"],
            ["Total", "$572,000", "", "$14,250"],
          ],
        },
      },
    ],
  },
];

const CASE_MESSAGES: CaseMessage[] = [
  {
    id: "close-instructions",
    sender: "Maya Chen",
    senderRole: "Corporate Controller",
    subject: "June close priorities and operating statement",
    receivedAt: "8:42 AM",
    preview: "Please complete the cash reconciliation first and document every exception.",
    body: [
      "Good morning,",
      "Please complete the June operating-cash reconciliation first. The bank statement is attached. Keep all supported reconciling items in the close file and do not force an unexplained difference.",
      "After cash, review the receivables tie-out, duplicate payable, missing service accrual, and monthly depreciation. Add concise notes for anything the reviewer should follow up.",
      "Thanks, Maya",
    ],
    attachmentIds: ["bank-statement"],
    unread: true,
  },
  {
    id: "ap-duplicate",
    sender: "Jordan Bell",
    senderRole: "Accounts Payable Manager",
    subject: "Northstar Consulting source review",
    receivedAt: "9:17 AM",
    preview: "Two June ledger entries require source-document review.",
    body: [
      "Two June ledger entries for Northstar Consulting require source-document review before the AP period is closed.",
      "The supporting pages are attached together. Compare the ledger records with the vendor documentation and make any correction supported by the evidence.",
      "Jordan",
    ],
    attachmentIds: ["vendor-invoices"],
    unread: true,
  },
  {
    id: "ar-tieout",
    sender: "Elena Ruiz",
    senderRole: "Revenue Accounting Lead",
    subject: "AR subledger export",
    receivedAt: "10:06 AM",
    preview: "The final customer aging is ready for the control-account tie-out.",
    body: [
      "Attached is the final customer aging exported after June billing.",
      "Please tie the customer schedule to the general-ledger control account, record any supported adjustment, and document the nature of the difference.",
    ],
    attachmentIds: ["ar-aging"],
  },
  {
    id: "depreciation",
    sender: "Noah Williams",
    senderRole: "Senior Accountant",
    subject: "June fixed-asset rollforward",
    receivedAt: "11:31 AM",
    preview: "The final fixed-asset rollforward is attached for close review.",
    body: [
      "The final fixed-asset rollforward is attached.",
      "Review the schedule, determine the June adjustment, and post the supported entry to the appropriate accounts.",
    ],
    attachmentIds: ["fixed-assets"],
  },
];

const PAGE_ITEMS: Array<{ id: WorkspacePage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "banking", label: "Reconcile", icon: Landmark },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "register", label: "Account register", icon: Rows3 },
  { id: "receivables", label: "Receivables", icon: Users },
  { id: "expenses", label: "Payables", icon: ReceiptText },
  { id: "journal", label: "Journal entries", icon: BookOpenCheck },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "audit", label: "Audit trail", icon: History },
  { id: "review", label: "Close review", icon: ClipboardCheck },
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0);
}

function numeric(value: string | number | undefined) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function treatmentAmount(item: ReconciliationItem, treatment: ReconciliationTreatment) {
  if (treatment === "add") return item.amount;
  if (treatment === "subtract") return -item.amount;
  return 0;
}

function emptyJournalLines(): JournalLine[] {
  return [
    { account: "", debit: "", credit: "" },
    { account: "", debit: "", credit: "" },
  ];
}

function entryAmount(entries: PostedJournalEntry[], debitAccount: string, creditAccount: string) {
  const match = entries.find((entry) => {
    const hasDebit = entry.lines.some((line) => line.account === debitAccount && numeric(line.debit) > 0);
    const hasCredit = entry.lines.some((line) => line.account === creditAccount && numeric(line.credit) > 0);
    return hasDebit && hasCredit;
  });
  return match?.total || 0;
}

export function AccountingTool({
  title = "LedgeBook",
  description = "Month-end close and exception review",
  instructions = "Complete the close, post the required adjustments, and document every supported exception.",
  caseData,
  initialSubmission,
  candidateMode = false,
  showSubmit = true,
  onAutosave,
  onSubmit,
}: AccountingToolProps) {
  const accountingCase = useMemo(() => ({ ...DEFAULT_CASE, ...(caseData || {}), bankItems: caseData?.bankItems || DEFAULT_CASE.bankItems }), [caseData]);
  const restored = initialSubmission?.accounting_workspace;
  const [activePage, setActivePage] = useState<WorkspacePage>("overview");
  const [search, setSearch] = useState("");
  const [bankTreatments, setBankTreatments] = useState<Record<string, ReconciliationTreatment>>(restored?.bank_treatments || {});
  const [bookTreatments, setBookTreatments] = useState<Record<string, ReconciliationTreatment>>(restored?.book_treatments || {});
  const [transactions, setTransactions] = useState(restored?.transactions || INITIAL_TRANSACTIONS);
  const [arAdjustment, setArAdjustment] = useState(String(restored?.ar_adjustment || ""));
  const [duplicateVoided, setDuplicateVoided] = useState(Boolean(restored?.duplicate_invoice_voided));
  const [postedEntries, setPostedEntries] = useState<PostedJournalEntry[]>(restored?.posted_journal_entries || []);
  const [selectedFlags, setSelectedFlags] = useState<string[]>(initialSubmission?.identified_red_flags || []);
  const [notes, setNotes] = useState(initialSubmission?.notes || "");
  const [activityLog, setActivityLog] = useState<ActivityItem[]>(restored?.activity_log?.length ? restored.activity_log : INITIAL_ACTIVITY);
  const [journalDate, setJournalDate] = useState("2026-06-30");
  const [journalMemo, setJournalMemo] = useState("");
  const [journalLines, setJournalLines] = useState<JournalLine[]>(emptyJournalLines);
  const [formError, setFormError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionForm, setTransactionForm] = useState({
    date: "2026-06-30",
    type: "Expense" as LedgerTransaction["type"],
    name: "",
    reference: "",
    category: "",
    amount: "",
  });

  const logAction = useCallback((action: string, detail: string) => {
    setActivityLog((current) => [...current.slice(-99), { at: new Date().toISOString(), action, detail }]);
  }, []);

  const adjustedBankCash = useMemo(
    () => accountingCase.statementBalance + accountingCase.bankItems.reduce((sum, item) => sum + treatmentAmount(item, bankTreatments[item.id] || ""), 0),
    [accountingCase, bankTreatments],
  );
  const adjustedBookCash = useMemo(
    () => accountingCase.ledgerCashBalance + accountingCase.bankItems.reduce((sum, item) => sum + treatmentAmount(item, bookTreatments[item.id] || ""), 0),
    [accountingCase, bookTreatments],
  );
  const cashDifference = adjustedBankCash - adjustedBookCash;
  const expenseAccrual = entryAmount(postedEntries, "Professional fees expense", "Accrued expenses");
  const depreciationEntry = entryAmount(postedEntries, "Depreciation expense", "Accumulated depreciation");
  const duplicateCorrection = duplicateVoided ? 9_800 : 0;

  const completedWorkflows = useMemo(() => {
    const completed: string[] = [];
    if (accountingCase.bankItems.every((item) => bankTreatments[item.id] && bookTreatments[item.id])) completed.push("bank_reconciliation");
    if (numeric(arAdjustment) > 0) completed.push("receivables_reconciliation");
    if (duplicateVoided) completed.push("duplicate_invoice_review");
    if (expenseAccrual > 0) completed.push("expense_accrual");
    if (depreciationEntry > 0) completed.push("depreciation");
    if (selectedFlags.length > 0) completed.push("control_review");
    return completed;
  }, [accountingCase.bankItems, arAdjustment, bankTreatments, bookTreatments, depreciationEntry, duplicateVoided, expenseAccrual, selectedFlags.length]);

  const submission = useMemo<AccountingAssessmentSubmission>(() => ({
    entered_form_values: {
      adjusted_bank_cash: adjustedBankCash,
      adjusted_book_cash: adjustedBookCash,
      cash_difference: cashDifference,
      ar_adjustment: numeric(arAdjustment),
      expense_accrual: expenseAccrual,
      depreciation_entry: depreciationEntry,
      duplicate_ap_correction: duplicateCorrection,
    },
    identified_red_flags: selectedFlags,
    notes,
    accounting_workspace: {
      bank_treatments: bankTreatments,
      book_treatments: bookTreatments,
      ar_adjustment: numeric(arAdjustment),
      duplicate_invoice_voided: duplicateVoided,
      transactions,
      posted_journal_entries: postedEntries,
      activity_log: activityLog,
      completed_workflows: completedWorkflows,
    },
  }), [activityLog, adjustedBankCash, adjustedBookCash, arAdjustment, bankTreatments, bookTreatments, cashDifference, completedWorkflows, depreciationEntry, duplicateCorrection, duplicateVoided, expenseAccrual, notes, postedEntries, selectedFlags, transactions]);

  useEffect(() => {
    if (!onAutosave) return;
    const timeout = window.setTimeout(() => onAutosave(submission), 500);
    return () => window.clearTimeout(timeout);
  }, [onAutosave, submission]);

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return transactions;
    return transactions.filter((transaction) => Object.values(transaction).some((value) => String(value).toLowerCase().includes(query)));
  }, [search, transactions]);

  const journalTotals = useMemo(() => ({
    debit: journalLines.reduce((sum, line) => sum + numeric(line.debit), 0),
    credit: journalLines.reduce((sum, line) => sum + numeric(line.credit), 0),
  }), [journalLines]);

  function setTreatment(side: "bank" | "book", item: ReconciliationItem, value: ReconciliationTreatment) {
    const setter = side === "bank" ? setBankTreatments : setBookTreatments;
    setter((current) => ({ ...current, [item.id]: value }));
    logAction("reconciliation_classified", `${item.reference} classified as ${value || "unassigned"} on the ${side} side`);
  }

  function categorizeTransaction(id: string, category: string) {
    setTransactions((current) => current.map((transaction) => transaction.id === id
      ? { ...transaction, category, status: "Cleared" }
      : transaction));
    logAction("transaction_categorized", `${id} categorized to ${category}`);
  }

  function updateTransactionPayee(name: string) {
    setTransactionForm((current) => ({
      ...current,
      name,
      category: PAYEE_DEFAULTS[name] || current.category,
    }));
  }

  function saveTransaction() {
    const amount = numeric(transactionForm.amount);
    if (!transactionForm.name.trim() || !transactionForm.reference.trim() || !transactionForm.category.trim() || amount <= 0) {
      setFormError("Enter a payee or customer, reference, category, and positive amount.");
      return;
    }
    const next: LedgerTransaction = {
      id: `TX-${Date.now()}`,
      date: new Date(`${transactionForm.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      type: transactionForm.type,
      name: transactionForm.name.trim(),
      reference: transactionForm.reference.trim(),
      category: transactionForm.category.trim(),
      amount,
      status: transactionForm.type === "Bill" || transactionForm.type === "Invoice" ? "Open" : "Cleared",
    };
    setTransactions((current) => [next, ...current]);
    logAction("transaction_created", `${next.reference}: ${next.name} (${money(next.amount)})`);
    setTransactionForm({ date: "2026-06-30", type: "Expense", name: "", reference: "", category: "", amount: "" });
    setFormError("");
    setShowTransactionForm(false);
    setSavedNotice("Transaction saved");
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  function voidDuplicate() {
    setDuplicateVoided(true);
    setTransactions((current) => current.filter((transaction) => transaction.id !== "AP-7782B"));
    if (!selectedFlags.includes("Duplicate vendor invoice")) setSelectedFlags((current) => [...current, "Duplicate vendor invoice"]);
    logAction("duplicate_invoice_voided", "AP-7782B was voided after matching vendor, amount, and reference");
    setSavedNotice("Duplicate invoice voided");
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  function loadJournalTemplate(kind: "accrual" | "depreciation" | "bank-fee" | "receipt") {
    const templates = {
      accrual: { memo: "Accrue June professional services", debit: "Professional fees expense", credit: "Accrued expenses", amount: "27500" },
      depreciation: { memo: "Record June depreciation", debit: "Depreciation expense", credit: "Accumulated depreciation", amount: "14250" },
      "bank-fee": { memo: "Record June bank service charge", debit: "Bank service charges", credit: "Cash - Operating", amount: "640" },
      receipt: { memo: "Record customer ACH receipt", debit: "Cash - Operating", credit: "Accounts receivable", amount: "18200" },
    };
    const template = templates[kind];
    setJournalMemo(template.memo);
    setJournalLines([
      { account: "", debit: template.amount, credit: "" },
      { account: "", debit: "", credit: template.amount },
    ]);
    setFormError("");
  }

  function updateJournalLine(index: number, patch: Partial<JournalLine>) {
    setJournalLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function postJournalEntry() {
    const debit = journalTotals.debit;
    const credit = journalTotals.credit;
    if (!journalMemo.trim() || journalLines.some((line) => !line.account) || debit <= 0 || Math.abs(debit - credit) > 0.005) {
      setFormError("Enter a memo, select every account, and make sure debits equal credits.");
      return;
    }
    const entry: PostedJournalEntry = {
      id: `JE-${String(postedEntries.length + 1).padStart(4, "0")}`,
      date: journalDate,
      memo: journalMemo.trim(),
      lines: journalLines,
      total: debit,
      postedAt: new Date().toISOString(),
    };
    setPostedEntries((current) => [...current, entry]);
    logAction("journal_entry_posted", `${entry.id}: ${entry.memo} (${money(entry.total)})`);
    setJournalMemo("");
    setJournalLines(emptyJournalLines());
    setFormError("");
    setSavedNotice(`${entry.id} posted`);
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  function removeJournalEntry(id: string) {
    setPostedEntries((current) => current.filter((entry) => entry.id !== id));
    logAction("journal_entry_reversed", `${id} removed from the close file`);
  }

  function toggleFlag(flag: string) {
    setSelectedFlags((current) => current.includes(flag) ? current.filter((item) => item !== flag) : [...current, flag]);
    logAction("control_flag_updated", flag);
  }

  function navigate(page: WorkspacePage) {
    setActivePage(page);
    setMobileNavOpen(false);
  }

  function exportWorkpaper() {
    const rows = [
      ["Close output", "Amount"],
      ["Adjusted bank cash", String(adjustedBankCash)],
      ["Adjusted book cash", String(adjustedBookCash)],
      ["Cash difference", String(cashDifference)],
      ["AR control adjustment", String(numeric(arAdjustment))],
      ["Missing service accrual", String(expenseAccrual)],
      ["Depreciation entry", String(depreciationEntry)],
      ["Duplicate AP correction", String(duplicateCorrection)],
      [],
      ["Control exceptions"],
      ...selectedFlags.map((flag) => [flag]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "june-2026-close-workpaper.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    logAction("workpaper_exported", "June 2026 close workpaper exported as CSV");
    setSavedNotice("Workpaper exported");
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  function showLockedNotice(message: string) {
    setSavedNotice(message);
    window.setTimeout(() => setSavedNotice(""), 2200);
  }

  const progress = Math.round((completedWorkflows.length / 6) * 100);
  const pendingWorkflows = Math.max(0, 6 - completedWorkflows.length);

  return (
    <div className={`accounting-app${candidateMode ? " candidate-mode" : ""}`}>
      <aside className={`accounting-sidebar${mobileNavOpen ? " open" : ""}`}>
        <div className="accounting-product">
          <span className="accounting-product-mark"><BookOpenCheck size={18} /></span>
          <div><strong>LedgeBook</strong><small>US accounting</small></div>
        </div>
        <button className="accounting-company-switcher" type="button" onClick={() => showLockedNotice("This assessment is assigned to one company dataset")}>
          <span><Building2 size={17} /></span>
          <span><strong>{accountingCase.companyName}</strong><small>{accountingCase.periodLabel}</small></span>
          <ChevronDown size={15} />
        </button>
        <nav aria-label="Accounting navigation">
          {PAGE_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activePage === id ? "active" : ""} type="button" onClick={() => navigate(id)}>
              <Icon size={17} /><span>{label}</span>
              {id === "review" && pendingWorkflows > 0 && <em>{pendingWorkflows}</em>}
            </button>
          ))}
        </nav>
        <div className="accounting-sidebar-footer">
          <div><span className="accounting-avatar">NS</span><span><strong>June close file</strong><small>Autosave enabled</small></span></div>
        </div>
      </aside>

      <main className="accounting-main">
        <header className="accounting-topbar">
          <div className="accounting-mobile-heading">
            <button className="accounting-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen((value) => !value)}>
              <BookOpenCheck size={19} />
            </button>
            <div>
              <span>{title}</span>
              <h1>{PAGE_ITEMS.find((item) => item.id === activePage)?.label}</h1>
            </div>
          </div>
          <div className="accounting-top-actions">
            <div className="accounting-global-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") navigate("transactions"); }} placeholder="Search transactions, customers, reports" /></div>
            <button className="accounting-icon-button" type="button" aria-label="Notifications" onClick={() => showLockedNotice("No new close notifications")}><Bell size={18} /></button>
            <span className="accounting-avatar">NS</span>
          </div>
        </header>

        {activePage === "overview" && (
          <div className="accounting-page">
            <section className="accounting-page-heading">
              <div><span className="accounting-eyebrow">{accountingCase.periodLabel}</span><h2>{description}</h2><p>{instructions}</p></div>
              <button className="accounting-primary" type="button" onClick={() => navigate("banking")}><Landmark size={16} />Continue close</button>
            </section>
            <section className="accounting-metric-grid">
              <article><span>Ledger cash</span><strong>{money(accountingCase.ledgerCashBalance)}</strong><small>Before close adjustments</small></article>
              <article><span>Accounts receivable</span><strong>{money(accountingCase.arControlBalance)}</strong><small>Tie to the customer schedule</small></article>
              <article><span>Open payables</span><strong>{money(74_650)}</strong><small>Source review not completed</small></article>
              <article><span>Close progress</span><strong>{progress}%</strong><div className="accounting-progress"><i style={{ width: `${progress}%` }} /></div></article>
            </section>
            <section className="accounting-overview-grid">
              <article className="accounting-panel accounting-close-plan">
                <header><div><h3>Close checklist</h3><p>Complete each workflow and retain its audit evidence.</p></div><span>{completedWorkflows.length}/6</span></header>
                {[
                  ["bank_reconciliation", "Reconcile operating cash", "Classify statement and book-side adjustments", "banking"],
                  ["receivables_reconciliation", "Tie receivables to the subledger", "Investigate the control account difference", "receivables"],
                  ["duplicate_invoice_review", "Review June payables", "Compare ledger entries with source documents", "expenses"],
                  ["expense_accrual", "Evaluate unbilled services", "Determine whether a June adjustment is required", "journal"],
                  ["depreciation", "Review fixed assets", "Evaluate the monthly rollforward", "journal"],
                  ["control_review", "Document close exceptions", "Select supported findings and reviewer notes", "review"],
                ].map(([key, label, detail, destination]) => {
                  const complete = completedWorkflows.includes(key);
                  return <button key={key} type="button" onClick={() => navigate(destination as WorkspacePage)}><span className={complete ? "done" : ""}>{complete ? <Check size={15} /> : <span />}</span><span><strong>{label}</strong><small>{detail}</small></span><ChevronDown size={16} /></button>;
                })}
              </article>
              <aside className="accounting-panel accounting-attention">
                <header><h3>Close queue</h3><span>{pendingWorkflows}</span></header>
                <button type="button" onClick={() => navigate("banking")}><CircleDollarSign size={17} /><span><strong>Operating cash</strong><small>Statement and ledger activity are ready for reconciliation.</small></span></button>
                <button type="button" onClick={() => navigate("expenses")}><ReceiptText size={17} /><span><strong>Payables evidence</strong><small>June source documents are available for review.</small></span></button>
                <button type="button" onClick={() => navigate("receivables")}><FileText size={17} /><span><strong>Receivables schedule</strong><small>The final customer aging has been received.</small></span></button>
              </aside>
            </section>
          </div>
        )}

        {activePage === "banking" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact">
              <div><span className="accounting-eyebrow">Operating account · 4821</span><h2>Bank reconciliation</h2><p>Classify each reconciling item independently for the bank and book balances.</p></div>
              <div className={`accounting-balance-status${Math.abs(cashDifference) <= 1 ? " balanced" : ""}`}><span>{Math.abs(cashDifference) <= 1 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{Math.abs(cashDifference) <= 1 ? "Reconciled" : `${money(Math.abs(cashDifference))} difference`}</span></div>
            </section>
            <section className="accounting-reconcile-summary">
              <article><span>Statement ending balance</span><strong>{money(accountingCase.statementBalance)}</strong><small>First National Bank · Jun 30</small></article>
              <article><span>Adjusted bank balance</span><strong>{money(adjustedBankCash)}</strong><small>Based on your classifications</small></article>
              <article><span>Ledger ending balance</span><strong>{money(accountingCase.ledgerCashBalance)}</strong><small>Cash - Operating</small></article>
              <article><span>Adjusted book balance</span><strong>{money(adjustedBookCash)}</strong><small>Based on your classifications</small></article>
            </section>
            <section className="accounting-panel">
              <div className="accounting-panel-title"><div><h3>Reconciling items</h3><p>Select how each item affects the two reconciliation sides.</p></div><button type="button" className="accounting-secondary" onClick={() => { setBankTreatments({}); setBookTreatments({}); }}><RotateCcw size={15} />Reset</button></div>
              <div className="accounting-table-scroll">
                <table className="accounting-data-table reconciliation">
                  <thead><tr><th>Date</th><th>Item and evidence</th><th>Reference</th><th className="numeric">Amount</th><th>Bank side</th><th>Book side</th></tr></thead>
                  <tbody>{accountingCase.bankItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      <td><strong>{item.description}</strong><small>{item.evidence}</small></td>
                      <td>{item.reference}</td>
                      <td className="numeric"><strong>{money(item.amount)}</strong></td>
                      <td><select aria-label={`${item.description} bank treatment`} value={bankTreatments[item.id] || ""} onChange={(event) => setTreatment("bank", item, event.target.value as ReconciliationTreatment)}><option value="">Choose</option><option value="add">Add</option><option value="subtract">Subtract</option><option value="exclude">No adjustment</option></select></td>
                      <td><select aria-label={`${item.description} book treatment`} value={bookTreatments[item.id] || ""} onChange={(event) => setTreatment("book", item, event.target.value as ReconciliationTreatment)}><option value="">Choose</option><option value="add">Add</option><option value="subtract">Subtract</option><option value="exclude">No adjustment</option></select></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activePage === "transactions" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Bank feed</span><h2>Transaction review</h2><p>Review imported activity, apply categories, and preserve the source reference.</p></div><button className="accounting-primary" type="button" onClick={() => { setFormError(""); setShowTransactionForm(true); }}><Plus size={16} />New transaction</button></section>
            <section className="accounting-panel">
              <div className="accounting-table-toolbar"><div><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this register" /></div><select aria-label="Transaction filter"><option>All activity</option><option>Unreviewed</option><option>Open</option><option>Overdue</option></select></div>
              <div className="accounting-table-scroll"><table className="accounting-data-table"><thead><tr><th>Date</th><th>Type</th><th>Payee or customer</th><th>Reference</th><th>Category</th><th>Status</th><th className="numeric">Amount</th></tr></thead><tbody>
                {filteredTransactions.map((transaction) => <tr key={transaction.id}><td>{transaction.date}</td><td><span className="accounting-type">{transaction.type}</span></td><td><strong>{transaction.name}</strong></td><td>{transaction.reference}</td><td>{transaction.status === "Unreviewed" ? <select aria-label={`Category for ${transaction.reference}`} value={transaction.category} onChange={(event) => categorizeTransaction(transaction.id, event.target.value)}><option>Uncategorized income</option><option>Uncategorized expense</option><option>Accounts receivable</option><option>Bank service charges</option><option>Professional fees</option></select> : transaction.category}</td><td><span className={`accounting-status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td><td className="numeric"><strong>{money(transaction.amount)}</strong></td></tr>)}
              </tbody></table></div>
            </section>
          </div>
        )}

        {activePage === "register" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Cash - Operating · 1000</span><h2>Account register</h2><p>Review transaction history, source references, clearing status, and the running ledger balance.</p></div><span className="accounting-register-balance"><small>Ending ledger balance</small><strong>{money(accountingCase.ledgerCashBalance)}</strong></span></section>
            <section className="accounting-panel">
              <div className="accounting-table-toolbar"><div><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the account register" /></div><select aria-label="Register period"><option>June 2026</option><option>May 2026</option></select></div>
              <div className="accounting-table-scroll"><table className="accounting-data-table register"><thead><tr><th>Date</th><th>Reference</th><th>Source</th><th>Name</th><th>Status</th><th className="numeric">Payment</th><th className="numeric">Deposit</th><th className="numeric">Balance</th></tr></thead><tbody>
                {ACCOUNT_REGISTER.filter((entry) => !search.trim() || Object.values(entry).some((value) => String(value).toLowerCase().includes(search.trim().toLowerCase()))).map((entry) => <tr key={entry.reference}><td>{entry.date}</td><td><strong>{entry.reference}</strong></td><td>{entry.source}</td><td>{entry.name}</td><td><span className={`accounting-status ${entry.cleared ? "cleared" : "open"}`}>{entry.cleared ? "Cleared" : "Uncleared"}</span></td><td className="numeric">{entry.payment ? money(entry.payment) : "—"}</td><td className="numeric">{entry.deposit ? money(entry.deposit) : "—"}</td><td className="numeric"><strong>{money(entry.balance)}</strong></td></tr>)}
              </tbody></table></div>
            </section>
          </div>
        )}

        {activePage === "receivables" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Accounts receivable</span><h2>Subledger reconciliation</h2><p>Tie customer balances to the general ledger control account.</p></div></section>
            <section className="accounting-receivable-layout">
              <div className="accounting-panel">
                <div className="accounting-panel-title"><div><h3>Customer balances</h3><p>Open invoices as of June 30.</p></div><strong>{money(accountingCase.arSubledgerBalance)}</strong></div>
                <div className="accounting-table-scroll"><table className="accounting-data-table"><thead><tr><th>Customer</th><th>Aging</th><th>Status</th><th className="numeric">Balance</th></tr></thead><tbody>{AR_CUSTOMERS.map((item) => <tr key={item.customer}><td><strong>{item.customer}</strong></td><td>{item.aging}</td><td><span className={`accounting-status ${item.status === "Past due" ? "overdue" : "cleared"}`}>{item.status}</span></td><td className="numeric"><strong>{money(item.balance)}</strong></td></tr>)}</tbody></table></div>
              </div>
              <aside className="accounting-panel accounting-tie-out">
                <h3>Control tie-out</h3>
                <dl><div><dt>General ledger control</dt><dd>{money(accountingCase.arControlBalance)}</dd></div><div><dt>Customer subledger</dt><dd>{money(accountingCase.arSubledgerBalance)}</dd></div><div className="difference"><dt>Difference</dt><dd>{money(accountingCase.arControlBalance - accountingCase.arSubledgerBalance)}</dd></div></dl>
                <label><span>Required control adjustment</span><div className="accounting-money-input"><span>$</span><input inputMode="decimal" value={arAdjustment} onChange={(event) => { setArAdjustment(event.target.value); logAction("ar_adjustment_updated", event.target.value); }} placeholder="0.00" /></div></label>
                <p>Enter the amount needed to resolve the difference. Document the underlying exception during close review.</p>
              </aside>
            </section>
          </div>
        )}

        {activePage === "expenses" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Accounts payable</span><h2>Vendor bill review</h2><p>Compare vendor, invoice reference, amount, and supporting evidence before posting.</p></div></section>
            <section className="accounting-panel">
              <div className="accounting-panel-title"><div><h3>Open bills</h3><p>June activity requiring source-document review.</p></div><span>2 records</span></div>
              <div className="accounting-table-scroll"><table className="accounting-data-table"><thead><tr><th>Bill</th><th>Vendor</th><th>Invoice reference</th><th>Entered</th><th>Evidence</th><th className="numeric">Amount</th><th /></tr></thead><tbody>
                <tr><td><strong>AP-7782A</strong></td><td>Northstar Consulting</td><td>NS-7782</td><td>Jun 27</td><td><span className="accounting-evidence good"><Check size={14} />PDF attached</span></td><td className="numeric"><strong>{money(9_800)}</strong></td><td><button className="accounting-link-button" type="button">Open</button></td></tr>
                {!duplicateVoided && <tr><td><strong>AP-7782B</strong></td><td>Northstar Consulting</td><td>NS-7782</td><td>Jun 28</td><td><span className="accounting-evidence bad"><AlertTriangle size={14} />Document ID matches another entry</span></td><td className="numeric"><strong>{money(9_800)}</strong></td><td><button className="accounting-danger-button" type="button" onClick={voidDuplicate}><Trash2 size={14} />Void entry</button></td></tr>}
                {duplicateVoided && <tr><td colSpan={7}><div className="accounting-resolved-row"><CheckCircle2 size={17} /><span><strong>Duplicate resolved</strong> AP-7782B was removed; AP-7782A remains payable.</span></div></td></tr>}
              </tbody></table></div>
            </section>
          </div>
        )}

        {activePage === "journal" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">General ledger</span><h2>Adjusting journal entries</h2><p>Post balanced entries. Suggested workflows populate source amounts; account selection remains reviewable.</p></div></section>
            <section className="accounting-journal-layout">
              <aside className="accounting-panel accounting-journal-tasks">
                <h3>Close adjustments</h3>
                <button type="button" onClick={() => loadJournalTemplate("accrual")}><ReceiptText size={17} /><span><strong>Unbilled services</strong><small>June services received · $27,500</small></span></button>
                <button type="button" onClick={() => loadJournalTemplate("depreciation")}><FileText size={17} /><span><strong>Monthly depreciation</strong><small>Fixed-asset schedule · $14,250</small></span></button>
                <button type="button" onClick={() => loadJournalTemplate("bank-fee")}><Banknote size={17} /><span><strong>Bank service charge</strong><small>Statement item · $640</small></span></button>
                <button type="button" onClick={() => loadJournalTemplate("receipt")}><BadgeDollarSign size={17} /><span><strong>Direct customer receipt</strong><small>ACH-8841 · $18,200</small></span></button>
              </aside>
              <div className="accounting-panel accounting-journal-form">
                <div className="accounting-panel-title"><div><h3>New journal entry</h3><p>Debits and credits must balance before posting.</p></div><span>Draft</span></div>
                <div className="accounting-journal-header"><label><span>Journal date</span><input type="date" value={journalDate} onChange={(event) => setJournalDate(event.target.value)} /></label><label><span>Memo</span><input value={journalMemo} onChange={(event) => setJournalMemo(event.target.value)} placeholder="Purpose of this entry" /></label></div>
                <div className="accounting-table-scroll"><table className="accounting-data-table journal"><thead><tr><th>Account</th><th className="numeric">Debit</th><th className="numeric">Credit</th></tr></thead><tbody>{journalLines.map((line, lineIndex) => <tr key={lineIndex}><td><select aria-label={`Journal account ${lineIndex + 1}`} value={line.account} onChange={(event) => updateJournalLine(lineIndex, { account: event.target.value })}><option value="">Select account</option>{ACCOUNT_OPTIONS.map((account) => <option key={account}>{account}</option>)}</select></td><td><input aria-label={`Debit ${lineIndex + 1}`} inputMode="decimal" value={line.debit} onChange={(event) => updateJournalLine(lineIndex, { debit: event.target.value, credit: event.target.value ? "" : line.credit })} placeholder="0.00" /></td><td><input aria-label={`Credit ${lineIndex + 1}`} inputMode="decimal" value={line.credit} onChange={(event) => updateJournalLine(lineIndex, { credit: event.target.value, debit: event.target.value ? "" : line.debit })} placeholder="0.00" /></td></tr>)}</tbody><tfoot><tr><td>Entry total</td><td className="numeric">{money(journalTotals.debit)}</td><td className="numeric">{money(journalTotals.credit)}</td></tr></tfoot></table></div>
                {formError && <div className="accounting-form-error"><AlertTriangle size={15} />{formError}</div>}
                <footer><button className="accounting-secondary" type="button" onClick={() => { setJournalMemo(""); setJournalLines(emptyJournalLines()); setFormError(""); }}>Clear</button><button className="accounting-primary" type="button" onClick={postJournalEntry}><BookOpenCheck size={16} />Post entry</button></footer>
              </div>
            </section>
            {postedEntries.length > 0 && <section className="accounting-panel accounting-posted-entries"><div className="accounting-panel-title"><div><h3>Posted this session</h3><p>Entries included in the close output.</p></div><span>{postedEntries.length}</span></div>{postedEntries.map((entry) => <div key={entry.id}><span className="accounting-entry-id">{entry.id}</span><span><strong>{entry.memo}</strong><small>{entry.date} · {entry.lines.map((line) => line.account).join(" / ")}</small></span><strong>{money(entry.total)}</strong><button type="button" aria-label={`Remove ${entry.id}`} onClick={() => removeJournalEntry(entry.id)}><X size={15} /></button></div>)}</section>}
          </div>
        )}

        {activePage === "reports" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Financial reports</span><h2>Close reports</h2><p>Review balances after the adjustments posted in this close file.</p></div><button className="accounting-secondary" type="button" onClick={exportWorkpaper}><FileText size={15} />Export workpaper</button></section>
            <section className="accounting-report-grid">
              <article className="accounting-panel accounting-report"><header><div><h3>Adjusted trial balance</h3><p>As of June 30, 2026</p></div><FileBarChart size={20} /></header><dl>
                <div><dt>Cash - Operating</dt><dd>{money(adjustedBookCash)}</dd></div>
                <div><dt>Accounts receivable</dt><dd>{money(accountingCase.arControlBalance - numeric(arAdjustment))}</dd></div>
                <div><dt>Accounts payable</dt><dd>{money(74_650 - duplicateCorrection)}</dd></div>
                <div><dt>Accrued expenses</dt><dd>{money(expenseAccrual)}</dd></div>
                <div><dt>Accumulated depreciation</dt><dd>{money(138_400 + depreciationEntry)}</dd></div>
              </dl><footer><span>Adjusting entries posted</span><strong>{postedEntries.length}</strong></footer></article>
              <article className="accounting-panel accounting-report"><header><div><h3>Close analytics</h3><p>Control and completeness indicators</p></div><ClipboardCheck size={20} /></header><dl>
                <div><dt>Cash reconciliation difference</dt><dd className={Math.abs(cashDifference) <= 1 ? "positive" : "negative"}>{money(cashDifference)}</dd></div>
                <div><dt>Receivables difference unresolved</dt><dd>{money(Math.max(0, 6_500 - numeric(arAdjustment)))}</dd></div>
                <div><dt>Duplicate bill exposure</dt><dd>{money(duplicateVoided ? 0 : 9_800)}</dd></div>
                <div><dt>Documented exceptions</dt><dd>{selectedFlags.length} selected</dd></div>
              </dl><footer><span>Close completion</span><strong>{progress}%</strong></footer></article>
            </section>
          </div>
        )}

        {activePage === "audit" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Company file history</span><h2>Audit trail</h2><p>Review system events and every change made during this close session.</p></div><span className="accounting-register-balance"><small>Recorded events</small><strong>{activityLog.length}</strong></span></section>
            <section className="accounting-panel accounting-audit-log">
              <div className="accounting-panel-title"><div><h3>June close activity</h3><p>Events are recorded automatically and cannot be edited.</p></div><History size={18} /></div>
              {activityLog.slice().reverse().map((item, index) => <article key={`${item.at}-${index}`}><span className="accounting-audit-icon"><History size={14} /></span><div><strong>{item.action.replaceAll("_", " ")}</strong><p>{item.detail}</p></div><time>{new Date(item.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></article>)}
            </section>
          </div>
        )}

        {activePage === "review" && (
          <div className="accounting-page">
            <section className="accounting-page-heading compact"><div><span className="accounting-eyebrow">Close review</span><h2>Finalize workpaper</h2><p>Verify calculated outputs, document supported exceptions, and submit the completed close.</p></div></section>
            <section className="accounting-review-grid">
              <div className="accounting-panel accounting-output-review">
                <div className="accounting-panel-title"><div><h3>Close outputs</h3><p>Calculated from your reconciliation and posted entries.</p></div><span>{completedWorkflows.length}/6 complete</span></div>
                {[
                  ["Adjusted bank cash", adjustedBankCash, bankTreatments],
                  ["Adjusted book cash", adjustedBookCash, bookTreatments],
                  ["Cash difference", cashDifference, null],
                  ["AR control adjustment", numeric(arAdjustment), arAdjustment],
                  ["Missing service accrual", expenseAccrual, expenseAccrual],
                  ["Depreciation entry", depreciationEntry, depreciationEntry],
                  ["Duplicate AP correction", duplicateCorrection, duplicateVoided],
                ].map(([label, value, evidence]) => {
                  const complete = typeof evidence === "object" && evidence !== null ? Object.keys(evidence).length === accountingCase.bankItems.length : Boolean(evidence);
                  return <div key={String(label)}><span className={complete ? "complete" : ""}>{complete ? <Check size={14} /> : <span />}</span><span>{String(label)}</span><strong>{money(Number(value))}</strong></div>;
                })}
              </div>
              <div className="accounting-panel accounting-control-review">
                <div className="accounting-panel-title"><div><h3>Control exceptions</h3><p>Select only findings supported by the workpapers.</p></div><span>{selectedFlags.length} selected</span></div>
                <div className="accounting-flag-list">{CONTROL_FLAGS.map((flag) => <label key={flag} className={selectedFlags.includes(flag) ? "selected" : ""}><input type="checkbox" checked={selectedFlags.includes(flag)} onChange={() => toggleFlag(flag)} /><span>{selectedFlags.includes(flag) ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}{flag}</span></label>)}</div>
                <label className="accounting-notes"><span>Reviewer notes and assumptions</span><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Document unresolved items, assumptions, and recommended follow-up." /></label>
              </div>
            </section>
            {showSubmit && <footer className="accounting-submit-bar"><div><strong>{progress === 100 ? "Close workpaper ready" : "Review incomplete workflows before submitting"}</strong><span>Your work is saved automatically. Results are provided to the recruiting organization.</span></div><button className="accounting-primary submit" type="button" onClick={() => void onSubmit?.(submission)}><ClipboardCheck size={17} />Submit assessment</button></footer>}
          </div>
        )}
      </main>

      {showTransactionForm && (
        <div className="accounting-modal-backdrop" role="presentation" onMouseDown={() => setShowTransactionForm(false)}>
          <section className="accounting-modal" role="dialog" aria-modal="true" aria-labelledby="accounting-transaction-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="accounting-eyebrow">General ledger</span><h2 id="accounting-transaction-title">New transaction</h2><p>Known payees fill their usual category automatically.</p></div><button type="button" aria-label="Close transaction form" onClick={() => setShowTransactionForm(false)}><X size={18} /></button></header>
            <div className="accounting-modal-fields">
              <label><span>Date</span><input type="date" value={transactionForm.date} onChange={(event) => setTransactionForm((current) => ({ ...current, date: event.target.value }))} /></label>
              <label><span>Type</span><select value={transactionForm.type} onChange={(event) => setTransactionForm((current) => ({ ...current, type: event.target.value as LedgerTransaction["type"] }))}><option>Expense</option><option>Bill</option><option>Invoice</option><option>Payment</option><option>Deposit</option></select></label>
              <label className="wide"><span>Payee or customer</span><input list="accounting-payee-list" autoFocus value={transactionForm.name} onChange={(event) => updateTransactionPayee(event.target.value)} placeholder="Search or enter a name" /><datalist id="accounting-payee-list">{Object.keys(PAYEE_DEFAULTS).map((name) => <option key={name} value={name} />)}</datalist></label>
              <label><span>Reference</span><input value={transactionForm.reference} onChange={(event) => setTransactionForm((current) => ({ ...current, reference: event.target.value }))} placeholder="Invoice, check, or ACH" /></label>
              <label><span>Amount</span><div className="accounting-money-input"><span>$</span><input inputMode="decimal" value={transactionForm.amount} onChange={(event) => setTransactionForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></div></label>
              <label className="wide"><span>Category</span><select value={transactionForm.category} onChange={(event) => setTransactionForm((current) => ({ ...current, category: event.target.value }))}><option value="">Select category</option>{ACCOUNT_OPTIONS.map((account) => <option key={account}>{account}</option>)}</select></label>
            </div>
            {formError && <div className="accounting-form-error"><AlertTriangle size={15} />{formError}</div>}
            <footer><button className="accounting-secondary" type="button" onClick={() => setShowTransactionForm(false)}>Cancel</button><button className="accounting-primary" type="button" onClick={saveTransaction}>Save transaction</button></footer>
          </section>
        </div>
      )}
      <CaseEvidenceDesk productName="LedgeBook" documents={CASE_DOCUMENTS} messages={CASE_MESSAGES} onActivity={logAction} />
      {savedNotice && <div className="accounting-saved-notice" role="status"><CheckCircle2 size={17} />{savedNotice}</div>}
    </div>
  );
}
