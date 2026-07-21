"""Certora-owned assessment templates with deterministic answer keys."""

from copy import deepcopy

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    AssessmentTask,
    AssessmentTemplate,
    AssessmentType,
    AssessmentIssue,
    Course,
    Exam,
    ExamRule,
    ExamStatus,
    Option,
    ProviderAssessmentTemplateInstall,
    ProviderProfile,
    Question,
    QuestionType,
)


TEMPLATE_CATALOG_VERSION = 4
STANDALONE_ASSESSMENT_CATEGORY = "__standalone_assessment__"
SUPERSEDED_TEMPLATE_PREFIX = "__certora_superseded__"


MCQ_QUESTIONS = [
    ("A company records revenue before control transfers. Which assertion is primarily misstated?", ["Occurrence", "Completeness", "Classification", "Rights and obligations"], 0),
    ("Which control best prevents duplicate vendor payments?", ["Sequential invoice numbering", "Three-way match plus duplicate-invoice validation", "Monthly bank reconciliation", "Quarterly vendor confirmation"], 1),
    ("Inventory cost is 120 and NRV is 108. What carrying amount is appropriate?", ["120", "114", "108", "12"], 2),
    ("A bank reconciliation has an outstanding cheque. How should it be treated?", ["Add to book balance", "Deduct from bank statement balance", "Deduct from book balance", "Record as bank income"], 1),
    ("Which ratio most directly tests short-term liquidity without inventory?", ["Current ratio", "Quick ratio", "Debt-to-equity", "Asset turnover"], 1),
    ("An accrued expense was omitted at year end. What is the effect?", ["Liabilities and expenses understated", "Assets and income understated", "Liabilities overstated", "No effect on profit"], 0),
    ("Which item is normally a financing cash flow?", ["Interest received", "Purchase of inventory", "Repayment of loan principal", "Sale of equipment"], 2),
    ("Gross margin fell while selling prices were stable. Which explanation is most plausible?", ["Lower cost of goods sold", "Higher input cost or adverse sales mix", "Lower depreciation", "Faster receivable collection"], 1),
    ("What is the strongest evidence that a receivable exists?", ["Aged receivables report", "Customer confirmation", "Sales forecast", "Approved price list"], 1),
    ("A 10,000 annual insurance policy begins 1 October. Expense at 31 December is?", ["2,500", "7,500", "10,000", "833"], 0),
    ("Which journal corrects a customer receipt posted as revenue?", ["Dr Revenue, Cr Accounts receivable", "Dr Cash, Cr Revenue", "Dr Accounts receivable, Cr Cash", "Dr Revenue, Cr Cash"], 0),
    ("A favorable material price variance means?", ["Actual price exceeded standard", "Actual price was below standard", "Usage was below standard", "Output exceeded budget"], 1),
    ("Which situation is the clearest segregation-of-duties conflict?", ["Buyer approves purchase orders", "Cashier records and reconciles bank receipts", "Controller reviews journals", "Warehouse counts inventory"], 1),
    ("EBITDA should exclude which item?", ["Wages", "Rent", "Depreciation", "Revenue"], 2),
    ("A customer balance is demonstrably uncollectible. The direct write-off entry is?", ["Dr Bad debt expense, Cr Accounts receivable", "Dr Cash, Cr Accounts receivable", "Dr Accounts receivable, Cr Revenue", "Dr Allowance, Cr Revenue"], 0),
    ("Which analytical pattern most strongly signals possible duplicate invoices?", ["Same vendor, amount and invoice number", "Different vendors with equal totals", "Round-dollar payroll entries", "Monthly rent entries"], 0),
    ("Days sales outstanding rises from 42 to 61. What should be investigated first?", ["Inventory obsolescence", "Collection performance and revenue cut-off", "Fixed asset lives", "Payroll taxes"], 1),
    ("A capital expenditure was expensed. Current-period profit and assets are?", ["Both overstated", "Profit understated and assets understated", "Profit overstated and assets understated", "Unaffected"], 1),
    ("Which budget best updates when activity volume changes?", ["Static budget", "Flexible budget", "Capital budget", "Cash forecast only"], 1),
    ("What is the primary purpose of a trial balance?", ["Prove every transaction is valid", "Verify total debits equal total credits", "Determine cash flow", "Confirm all assets exist"], 1),
    ("A credit balance in an expense account most likely indicates?", ["A normal expense position", "Reversal, refund, or posting error requiring review", "Unrecorded revenue", "Inventory shrinkage"], 1),
    ("Which metric best measures operating profit generated per sales dollar?", ["Current ratio", "Operating margin", "Receivable turnover", "Debt ratio"], 1),
    ("A vendor statement shows an invoice missing from the ledger. The first action is?", ["Ignore until payment", "Validate receipt and record the liability if incurred", "Debit revenue", "Write off the vendor"], 1),
    ("Which control most directly supports journal-entry authorization?", ["Role-based approval workflow", "Faster month-end close", "Vendor aging", "Bank lockbox"], 0),
    ("Revenue is 800,000, variable cost 480,000, fixed cost 200,000. Contribution margin ratio is?", ["15%", "25%", "40%", "60%"], 2),
]


DEFAULT_ASSESSMENTS = [
    {
        "id": "financial-controls-core",
        "title": "Certora Financial Controls Challenge",
        "summary": "Advanced accounting, controls, analysis, and close-readiness screening.",
        "assessment_type": "mcq",
        "duration_minutes": 40,
        "pass_score": 72,
        "topics": ["Financial accounting", "Controls", "Analysis", "Audit evidence"],
        "tools": ["Certora question workspace"],
        "instructions": "Answer all questions. Select the single best response using the facts provided.",
        "about": "Certora default screening assessment for finance and accounting professionals.",
        "questions": [
            {"question_text": text, "question_type": "mcq_single_correct", "marks": 4, "negative_marks": 1,
             "options": [{"option_text": option, "is_correct": index == answer, "position": index + 1} for index, option in enumerate(options)]}
            for text, options, answer in MCQ_QUESTIONS
        ],
    },
    {
        "id": "working-capital-model",
        "title": "Certora Advanced FP&A and Working Capital Model",
        "summary": "Analyze a 12-month operating dataset, build KPIs, diagnose exceptions, and produce a forecast.",
        "assessment_type": "spreadsheet", "duration_minutes": 90, "pass_score": 78,
        "topics": ["Advanced Excel", "FP&A", "Variance analysis", "Working capital", "Revenue quality", "Controls"], "tools": ["Excel"],
        "instructions": "Complete all required outputs using formulas. Preserve source data and use the assumptions supplied in the workbook.",
        "about": "Complex Certora default Excel assessment for senior finance, FP&A, controllership, and accounting candidates.",
        "task": {
            "title": "Advanced FP&A and working capital model", "marks": 100,
            "description": "Analyze twelve months of actual and budget revenue, COGS, operating expense, AR, inventory, AP, cash collections, and invoice-risk data. Build a management-ready KPI and forecast output block.",
            "instructions": "Enter formulas only in Assessment!B19:B42. Use annual totals for year metrics, December balances for working-capital days, and the assumptions in N3:N5. Round ratios to four decimals and days to two decimals.",
            "metadata": {
                "workspace": "spreadsheet", "answer_format": "spreadsheet",
                "locked_cells": [
                    *[f"{c}{r}" for r in range(1, 17) for c in "ABCDEFGHIJKL"],
                    *[f"A{r}" for r in range(18, 43)], "M2", "N2", "M3", "N3", "M4", "N4", "M5", "N5",
                ],
                "initial_spreadsheet_data": {
                    "A1":"FY2026 Operating Performance and Working Capital Review",
                    "A2":"Month","B2":"Actual Revenue","C2":"Budget Revenue","D2":"Actual COGS","E2":"Budget COGS","F2":"Actual OpEx","G2":"Budget OpEx","H2":"Ending AR","I2":"Ending Inventory","J2":"Ending AP","K2":"Cash Collected","L2":"High-risk Invoices",
                    "A3":"Jan","B3":920000,"C3":900000,"D3":570000,"E3":555000,"F3":210000,"G3":205000,"H3":1100000,"I3":800000,"J3":620000,"K3":880000,"L3":2,
                    "A4":"Feb","B4":980000,"C4":950000,"D4":600000,"E4":580000,"F4":218000,"G4":215000,"H4":1180000,"I4":840000,"J4":650000,"K4":940000,"L4":3,
                    "A5":"Mar","B5":1010000,"C5":1000000,"D5":625000,"E5":610000,"F5":225000,"G5":220000,"H5":1260000,"I5":880000,"J5":690000,"K5":980000,"L5":3,
                    "A6":"Apr","B6":970000,"C6":1020000,"D6":615000,"E6":620000,"F6":230000,"G6":225000,"H6":1310000,"I6":920000,"J6":720000,"K6":950000,"L6":4,
                    "A7":"May","B7":1040000,"C7":1050000,"D7":640000,"E7":635000,"F7":235000,"G7":230000,"H7":1390000,"I7":970000,"J7":760000,"K7":1000000,"L7":4,
                    "A8":"Jun","B8":1080000,"C8":1070000,"D8":655000,"E8":650000,"F8":240000,"G8":238000,"H8":1480000,"I8":1020000,"J8":800000,"K8":1040000,"L8":5,
                    "A9":"Jul","B9":1120000,"C9":1100000,"D9":680000,"E9":670000,"F9":245000,"G9":242000,"H9":1560000,"I9":1080000,"J9":850000,"K9":1090000,"L9":5,
                    "A10":"Aug","B10":1150000,"C10":1140000,"D10":705000,"E10":690000,"F10":252000,"G10":248000,"H10":1650000,"I10":1150000,"J10":900000,"K10":1100000,"L10":6,
                    "A11":"Sep","B11":1110000,"C11":1160000,"D11":700000,"E11":700000,"F11":260000,"G11":255000,"H11":1740000,"I11":1220000,"J11":950000,"K11":1070000,"L11":7,
                    "A12":"Oct","B12":1180000,"C12":1200000,"D12":720000,"E12":720000,"F12":265000,"G12":262000,"H12":1840000,"I12":1300000,"J12":1000000,"K12":1140000,"L12":7,
                    "A13":"Nov","B13":1210000,"C13":1250000,"D13":735000,"E13":750000,"F13":275000,"G13":270000,"H13":1940000,"I13":1380000,"J13":1050000,"K13":1160000,"L13":8,
                    "A14":"Dec","B14":1290000,"C14":1300000,"D14":790000,"E14":780000,"F14":290000,"G14":282000,"H14":2050000,"I14":1450000,"J14":1100000,"K14":1210000,"L14":11,
                    "M2":"Assumption","N2":"Value","M3":"Next-year growth","N3":0.08,"M4":"Collection target","N4":0.95,"M5":"Maximum DSO","N5":55,
                    "A18":"Required management outputs","A19":"Total actual revenue","A20":"Total budget revenue","A21":"Revenue variance","A22":"Revenue variance %","A23":"Total actual COGS","A24":"Gross profit","A25":"Gross margin","A26":"Total actual OpEx","A27":"OpEx variance","A28":"EBITDA","A29":"EBITDA margin","A30":"December DSO","A31":"December inventory days","A32":"December payable days","A33":"Cash conversion cycle","A34":"Total cash collected","A35":"Collection rate","A36":"High-risk invoice count","A37":"Q4 actual revenue","A38":"Q4 budget revenue","A39":"Q4 variance %","A40":"Next-year revenue forecast","A41":"Average monthly revenue","A42":"Months below revenue budget",
                },
            },
            "expected_output": {
                "expected_final_values":{"B19":13060000,"B20":13140000,"B21":-80000,"B22":-0.0061,"B23":8035000,"B24":5025000,"B25":0.3848,"B26":2945000,"B27":53000,"B28":2080000,"B29":0.1593,"B30":57.29,"B31":65.87,"B32":49.97,"B33":73.19,"B34":12560000,"B35":0.9617,"B36":65,"B37":3680000,"B38":3750000,"B39":-0.0187,"B40":14104800,"B41":1088333.33,"B42":6},
                "expected_formulas":{"B19":"=SUM(B3:B14)","B20":"=SUM(C3:C14)","B21":"=B19-B20","B22":"=ROUND(B21/B20,4)","B23":"=SUM(D3:D14)","B24":"=B19-B23","B25":"=ROUND(B24/B19,4)","B26":"=SUM(F3:F14)","B27":"=SUM(F3:F14)-SUM(G3:G14)","B28":"=B24-B26","B29":"=ROUND(B28/B19,4)","B30":"=ROUND(H14/B19*365,2)","B31":"=ROUND(I14/B23*365,2)","B32":"=ROUND(J14/B23*365,2)","B33":"=ROUND(B30+B31-B32,2)","B34":"=SUM(K3:K14)","B35":"=ROUND(B34/B19,4)","B36":"=SUM(L3:L14)","B37":"=SUM(B12:B14)","B38":"=SUM(C12:C14)","B39":"=ROUND((B37-B38)/B38,4)","B40":"=B19*(1+N3)","B41":"=AVERAGE(B3:B14)","B42":"=IF(B3<C3,1,0)+IF(B4<C4,1,0)+IF(B5<C5,1,0)+IF(B6<C6,1,0)+IF(B7<C7,1,0)+IF(B8<C8,1,0)+IF(B9<C9,1,0)+IF(B10<C10,1,0)+IF(B11<C11,1,0)+IF(B12<C12,1,0)+IF(B13<C13,1,0)+IF(B14<C14,1,0)"}
            },
            "grading_config": {"evaluation_mode":"deterministic","numeric_tolerance":0.02,"checkpoints":[
                {"id":"revenue","label":"Total actual revenue","weight":5,"source":"spreadsheet_value:Assessment!B19","comparator":"numeric","expected":13060000,"tolerance":1},
                {"id":"budget-revenue","label":"Total budget revenue","weight":4,"source":"spreadsheet_value:Assessment!B20","comparator":"numeric","expected":13140000,"tolerance":1},
                {"id":"revenue-variance","label":"Revenue variance","weight":5,"source":"spreadsheet_value:Assessment!B21","comparator":"numeric","expected":-80000,"tolerance":1},
                {"id":"revenue-variance-pct","label":"Revenue variance percent","weight":4,"source":"spreadsheet_value:Assessment!B22","comparator":"numeric","expected":-0.0061,"tolerance":0.0001},
                {"id":"cogs","label":"Total actual COGS","weight":4,"source":"spreadsheet_value:Assessment!B23","comparator":"numeric","expected":8035000,"tolerance":1},
                {"id":"gross-profit","label":"Gross profit","weight":5,"source":"spreadsheet_value:Assessment!B24","comparator":"numeric","expected":5025000,"tolerance":1},
                {"id":"gross-margin","label":"Gross margin","weight":5,"source":"spreadsheet_value:Assessment!B25","comparator":"numeric","expected":0.3848,"tolerance":0.0001},
                {"id":"opex","label":"Total actual OpEx","weight":4,"source":"spreadsheet_value:Assessment!B26","comparator":"numeric","expected":2945000,"tolerance":1},
                {"id":"opex-variance","label":"OpEx variance","weight":4,"source":"spreadsheet_value:Assessment!B27","comparator":"numeric","expected":53000,"tolerance":1},
                {"id":"ebitda","label":"EBITDA","weight":5,"source":"spreadsheet_value:Assessment!B28","comparator":"numeric","expected":2080000,"tolerance":1},
                {"id":"ebitda-margin","label":"EBITDA margin","weight":4,"source":"spreadsheet_value:Assessment!B29","comparator":"numeric","expected":0.1593,"tolerance":0.0001},
                {"id":"dso","label":"December DSO","weight":5,"source":"spreadsheet_value:Assessment!B30","comparator":"numeric","expected":57.29,"tolerance":0.02},
                {"id":"inventory-days","label":"December inventory days","weight":4,"source":"spreadsheet_value:Assessment!B31","comparator":"numeric","expected":65.87,"tolerance":0.02},
                {"id":"payable-days","label":"December payable days","weight":4,"source":"spreadsheet_value:Assessment!B32","comparator":"numeric","expected":49.97,"tolerance":0.02},
                {"id":"ccc","label":"Cash conversion cycle","weight":5,"source":"spreadsheet_value:Assessment!B33","comparator":"numeric","expected":73.19,"tolerance":0.03},
                {"id":"cash","label":"Total cash collected","weight":4,"source":"spreadsheet_value:Assessment!B34","comparator":"numeric","expected":12560000,"tolerance":1},
                {"id":"collection-rate","label":"Collection rate","weight":4,"source":"spreadsheet_value:Assessment!B35","comparator":"numeric","expected":0.9617,"tolerance":0.0001},
                {"id":"risk","label":"High-risk invoice count","weight":3,"source":"spreadsheet_value:Assessment!B36","comparator":"numeric","expected":65,"tolerance":0},
                {"id":"q4-actual","label":"Q4 actual revenue","weight":3,"source":"spreadsheet_value:Assessment!B37","comparator":"numeric","expected":3680000,"tolerance":1},
                {"id":"q4-budget","label":"Q4 budget revenue","weight":3,"source":"spreadsheet_value:Assessment!B38","comparator":"numeric","expected":3750000,"tolerance":1},
                {"id":"q4-variance","label":"Q4 variance percent","weight":4,"source":"spreadsheet_value:Assessment!B39","comparator":"numeric","expected":-0.0187,"tolerance":0.0001},
                {"id":"forecast","label":"Next-year revenue forecast","weight":6,"source":"spreadsheet_value:Assessment!B40","comparator":"numeric","expected":14104800,"tolerance":1},
                {"id":"average-revenue","label":"Average monthly revenue","weight":3,"source":"spreadsheet_value:Assessment!B41","comparator":"numeric","expected":1088333.33,"tolerance":0.02},
                {"id":"below-budget","label":"Months below budget","weight":3,"source":"spreadsheet_value:Assessment!B42","comparator":"numeric","expected":6,"tolerance":0}
            ]},
        },
    },
    {
        "id": "invoice-reconciliation-engine", "title": "Certora Invoice Reconciliation Engine",
        "summary": "Implement a deterministic reconciliation function with validation and duplicate controls.",
        "assessment_type": "coding", "duration_minutes": 75, "pass_score": 75,
        "topics": ["Python", "Data validation", "Reconciliation", "Edge cases"], "tools": ["Coding environment"],
        "instructions": "Implement the requested Python function. Keep the signature unchanged and document assumptions.",
        "about": "Tough default coding assessment grounded in finance operations.",
        "task": {"title":"Invoice reconciliation engine","marks":100,
            "description":"Implement reconcile_invoices(invoices, payments). Match by invoice_id, reject duplicate payment IDs, tolerate currency amounts within 0.01, and return matched, underpaid, overpaid, unpaid, duplicate_payment_ids, and invalid_records in stable sorted order.",
            "instructions":"Use Python 3.11 standard library only. Return a dictionary. Do not hardcode the sample values.",
            "metadata":{"workspace":"coding","language":"python","answer_format":"code","starter_code":"def reconcile_invoices(invoices, payments):\n    # Return the required reconciliation dictionary.\n    pass\n","public_examples":[{"invoices":[{"invoice_id":"I-1","amount":100}],"payments":[{"payment_id":"P-1","invoice_id":"I-1","amount":100}],"expected":{"matched":["I-1"]}}]},
            "expected_output":{"reference_answer":"Validate records, de-duplicate payment_id, aggregate valid payments by invoice_id, compare using Decimal with 0.01 tolerance, classify each invoice, and sort every identifier list.","test_cases":["exact match","partial payment","overpayment","unpaid invoice","duplicate payment ID","invalid record","decimal tolerance","stable ordering"]},
            "grading_config":{"evaluation_mode":"deterministic_static_review","manual_review_required":True,"checkpoints":[
                {"id":"signature","label":"Required function signature","weight":10,"source":"code","comparator":"regex","expected":"def\\s+reconcile_invoices\\s*\\("},
                {"id":"return-shape","label":"All required result categories","weight":20,"source":"code","comparator":"contains_all","expected":["matched","underpaid","overpaid","unpaid","duplicate_payment_ids","invalid_records"]},
                {"id":"duplicate-control","label":"Duplicate payment control","weight":15,"source":"code","comparator":"contains_all","expected":["payment_id","duplicate"]},
                {"id":"invoice-match","label":"Invoice matching logic","weight":15,"source":"code","comparator":"contains_all","expected":["invoice_id","amount"]},
                {"id":"precision","label":"Currency precision handling","weight":15,"source":"code","comparator":"regex","expected":"Decimal|0\\.01|isclose"},
                {"id":"validation","label":"Invalid-record handling","weight":15,"source":"code","comparator":"contains","expected":"invalid_records"},
                {"id":"stable-order","label":"Stable sorted output","weight":10,"source":"code","comparator":"contains","expected":"sorted("}]},
        },
    },
    {
        "id":"month-end-close","title":"Certora Month-End Close & Exception Review","summary":"Complete a bank, receivables, accrual, and control close with traceable outputs.",
        "assessment_type":"accounting","duration_minutes":70,"pass_score":75,"topics":["Month-end close","Reconciliation","Accruals","Controls"],"tools":["Accounting workspace"],
        "instructions":"Enter the calculated close balances and identify every control exception supported by the case.","about":"Tough default practical assessment for accounting and controllership candidates.",
        "task":{"title":"Month-end close and exception review","marks":100,"description":"The bank statement is 486,240. Outstanding cheques are 42,800; deposits in transit 31,500; bank charges 640; and an unrecorded customer receipt is 18,200. Ledger cash before adjustments is 456,380. AR control is 612,900 while the subledger totals 606,400. Services received but unbilled are 27,500. Depreciation is 14,250. A vendor invoice of 9,800 appears twice.",
            "instructions":"Calculate adjusted bank and book cash, reconciliation difference, AR adjustment, accrual, depreciation, corrected AP duplicate amount, and identify the exceptions.",
            "metadata":{"workspace":"accounting","answer_format":"structured","form_fields":["adjusted_bank_cash","adjusted_book_cash","cash_difference","ar_adjustment","expense_accrual","depreciation_entry","duplicate_ap_correction"],"red_flag_options":["Duplicate vendor invoice","AR control/subledger mismatch","Unrecorded bank charge","Unrecorded customer receipt","Missing service accrual"]},
            "expected_output":{"expected_form_values":{"adjusted_bank_cash":474940,"adjusted_book_cash":473940,"cash_difference":1000,"ar_adjustment":6500,"expense_accrual":27500,"depreciation_entry":14250,"duplicate_ap_correction":9800},"red_flags":["Duplicate vendor invoice","AR control/subledger mismatch","Unrecorded bank charge","Unrecorded customer receipt","Missing service accrual"]},
            "grading_config":{"evaluation_mode":"deterministic","checkpoints":[
                {"id":"bank-cash","label":"Adjusted bank cash","weight":15,"source":"field:adjusted_bank_cash","comparator":"numeric","expected":474940,"tolerance":1},
                {"id":"book-cash","label":"Adjusted book cash","weight":15,"source":"field:adjusted_book_cash","comparator":"numeric","expected":473940,"tolerance":1},
                {"id":"difference","label":"Unresolved cash difference","weight":10,"source":"field:cash_difference","comparator":"numeric","expected":1000,"tolerance":1},
                {"id":"ar","label":"AR control adjustment","weight":10,"source":"field:ar_adjustment","comparator":"numeric","expected":6500,"tolerance":1},
                {"id":"accrual","label":"Missing expense accrual","weight":15,"source":"field:expense_accrual","comparator":"numeric","expected":27500,"tolerance":1},
                {"id":"depreciation","label":"Depreciation entry","weight":10,"source":"field:depreciation_entry","comparator":"numeric","expected":14250,"tolerance":1},
                {"id":"duplicate","label":"Duplicate AP correction","weight":10,"source":"field:duplicate_ap_correction","comparator":"numeric","expected":9800,"tolerance":1},
                {"id":"flags","label":"Control exceptions","weight":15,"source":"identified_red_flags","comparator":"set_contains_all","expected":["Duplicate vendor invoice","AR control/subledger mismatch","Unrecorded bank charge","Unrecorded customer receipt","Missing service accrual"]}]},
        },
    },
    {
        "id":"individual-tax-review","title":"Certora Complex Individual Tax Review","summary":"Calculate a return and identify documentation and compliance exceptions.",
        "assessment_type":"tax_simulator","duration_minutes":65,"pass_score":75,"topics":["Individual tax","Adjustments","Credits","Compliance review"],"tools":["Tax software"],
        "instructions":"Use the supplied case values. Enter calculated fields and select every supported review flag.","about":"Tough default tax-preparer and reviewer assessment.",
        "task":{"title":"Individual return calculation and review","marks":100,"description":"Case: wages 118,000; interest 2,400; Schedule C receipts 46,000 and substantiated expenses 18,500; deductible HSA contribution 3,850; standard deduction 14,600; pre-credit tax 22,940; nonrefundable credits 2,000; withholding 24,500. A 6,200 vehicle claim has no mileage log, a dependent SSN is missing, and a 1099-NEC is absent from source documents.",
            "instructions":"Calculate Schedule C profit, AGI, taxable income, tax after credits, and refund/balance due. Identify all documentation exceptions.",
            "metadata":{"workspace":"tax","answer_format":"structured","form_fields":["schedule_c_profit","adjusted_gross_income","taxable_income","tax_after_credits","refund"],"red_flag_options":["Vehicle expense lacks mileage log","Dependent SSN missing","1099-NEC source document missing"]},
            "expected_output":{"expected_form_values":{"schedule_c_profit":27500,"adjusted_gross_income":144050,"taxable_income":129450,"tax_after_credits":20940,"refund":3560},"red_flags":["Vehicle expense lacks mileage log","Dependent SSN missing","1099-NEC source document missing"]},
            "grading_config":{"evaluation_mode":"deterministic","checkpoints":[
                {"id":"schedule-c","label":"Schedule C profit","weight":20,"source":"field:schedule_c_profit","comparator":"numeric","expected":27500,"tolerance":1},
                {"id":"agi","label":"Adjusted gross income","weight":20,"source":"field:adjusted_gross_income","comparator":"numeric","expected":144050,"tolerance":1},
                {"id":"taxable","label":"Taxable income","weight":20,"source":"field:taxable_income","comparator":"numeric","expected":129450,"tolerance":1},
                {"id":"tax","label":"Tax after credits","weight":15,"source":"field:tax_after_credits","comparator":"numeric","expected":20940,"tolerance":1},
                {"id":"refund","label":"Refund","weight":10,"source":"field:refund","comparator":"numeric","expected":3560,"tolerance":1},
                {"id":"flags","label":"Compliance exceptions","weight":15,"source":"identified_red_flags","comparator":"set_contains_all","expected":["Vehicle expense lacks mileage log","Dependent SSN missing","1099-NEC source document missing"]}]},
        },
    },
]


def list_default_assessments() -> list[dict]:
    return deepcopy(DEFAULT_ASSESSMENTS)


def get_default_assessment(template_id: str) -> dict | None:
    return next((deepcopy(item) for item in DEFAULT_ASSESSMENTS if item["id"] == template_id), None)


def seed_default_assessment_templates(db: Session) -> list[AssessmentTemplate]:
    """Upsert versioned Certora templates into the configured application database."""
    existing = {
        row.template_key: row
        for row in db.scalars(select(AssessmentTemplate)).all()
    }
    rows: list[AssessmentTemplate] = []
    for definition in list_default_assessments():
        template_key = str(definition["id"])
        row = existing.get(template_key)
        if not row:
            row = AssessmentTemplate(template_key=template_key)
        if not row.id or int(row.version or 0) < TEMPLATE_CATALOG_VERSION:
            row.version = TEMPLATE_CATALOG_VERSION
            row.title = str(definition["title"])
            row.assessment_type = str(definition["assessment_type"])
            row.definition_json = definition
            row.is_active = True
            db.add(row)
        rows.append(row)
    db.flush()
    return rows


def _standalone_course(db: Session, provider: ProviderProfile) -> Course:
    course = db.scalar(
        select(Course).where(
            Course.provider_id == provider.id,
            Course.category == STANDALONE_ASSESSMENT_CATEGORY,
        ),
    )
    if course:
        return course
    course = Course(
        provider_id=provider.id,
        title="Standalone Assessments",
        description="Hidden course container for standalone assessments.",
        category=STANDALONE_ASSESSMENT_CATEGORY,
        suitable_age_ranges=[],
        is_published=False,
    )
    db.add(course)
    db.flush()
    return course


def _create_exam_from_template(
    db: Session,
    provider: ProviderProfile,
    template: AssessmentTemplate,
    existing_exam: Exam | None = None,
) -> Exam:
    definition = deepcopy(template.definition_json or {})
    assessment_type = str(definition["assessment_type"])
    questions = definition.get("questions") or []
    course = _standalone_course(db, provider)
    exam = existing_exam or Exam(course_id=course.id, title=str(definition["title"]))
    if existing_exam:
        question_ids = list(db.scalars(select(Question.id).where(Question.exam_id == exam.id)).all())
        if question_ids:
            db.execute(delete(Option).where(Option.question_id.in_(question_ids)))
            db.execute(delete(Question).where(Question.id.in_(question_ids)))
        db.execute(delete(AssessmentTask).where(AssessmentTask.assessment_id == exam.id))
    exam.course_id = course.id
    exam.title = str(definition["title"])
    exam.assessment_type = assessment_type
    exam.instructions = str(definition.get("instructions") or "")
    exam.assessment_about = str(definition.get("about") or "")
    exam.tools_json = list(definition.get("tools") or [])
    exam.topics_json = list(definition.get("topics") or [])
    exam.duration_minutes = int(definition.get("duration_minutes") or 60)
    exam.timing_mode = "assessment"
    exam.time_per_question_seconds = None
    exam.questions_per_attempt = len(questions)
    exam.total_marks = 100
    exam.pass_score = float(definition.get("pass_score") or 75)
    exam.negative_marking = assessment_type == AssessmentType.MCQ.value
    exam.shuffle_questions = False
    exam.shuffle_options = False
    exam.max_attempts = 1
    exam.certificate_enabled = False
    exam.status = ExamStatus.PUBLISHED
    db.add(exam)
    db.flush()
    if not existing_exam:
        db.add(ExamRule(exam_id=exam.id))
    if assessment_type == AssessmentType.MCQ.value:
        total_marks = 0.0
        for question_data in questions:
            qtype = QuestionType(str(question_data["question_type"]))
            question = Question(
                exam_id=exam.id,
                question_text=str(question_data["question_text"]),
                question_type=qtype.name,
                marks=float(question_data.get("marks") or 0),
                negative_marks=float(question_data.get("negative_marks") or 0),
            )
            db.add(question)
            db.flush()
            total_marks += float(question.marks or 0)
            for option_data in question_data.get("options") or []:
                db.add(Option(question_id=question.id, **option_data))
        exam.total_marks = total_marks
    else:
        task_data = definition["task"]
        task = AssessmentTask(
            assessment_id=exam.id,
            type=assessment_type,
            title=str(task_data["title"]),
            description=str(task_data.get("description") or ""),
            instructions=str(task_data.get("instructions") or ""),
            marks=float(task_data.get("marks") or 100),
            metadata_json=task_data.get("metadata") or {},
            expected_output_json=task_data.get("expected_output") or {},
            grading_config_json=task_data.get("grading_config") or {},
        )
        db.add(task)
        exam.total_marks = float(task.marks)
    db.add(exam)
    db.flush()
    return exam


def ensure_provider_default_assessments(db: Session, provider: ProviderProfile) -> list[Exam]:
    """Provision one current published copy of every active Certora template."""
    templates = [row for row in seed_default_assessment_templates(db) if row.is_active]
    installs = {
        row.template_id: row
        for row in db.scalars(
            select(ProviderAssessmentTemplateInstall).where(
                ProviderAssessmentTemplateInstall.provider_id == provider.id,
            ),
        ).all()
    }
    exams: list[Exam] = []
    for template in templates:
        install = installs.get(template.id)
        exam = db.get(Exam, install.exam_id) if install else None
        if not install or not exam or int(install.template_version or 0) < int(template.version or 1):
            can_upgrade_in_place = bool(
                install
                and exam
                and not db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.exam_id == exam.id))
            )
            previous_exam = exam
            exam = _create_exam_from_template(db, provider, template, existing_exam=exam if can_upgrade_in_place else None)
            if previous_exam and not can_upgrade_in_place:
                previous_exam.assessment_about = f"{SUPERSEDED_TEMPLATE_PREFIX} {previous_exam.assessment_about or ''}".strip()
                previous_exam.status = ExamStatus.REJECTED
                db.add(previous_exam)
            if not install:
                install = ProviderAssessmentTemplateInstall(provider_id=provider.id, template_id=template.id, exam_id=exam.id)
            install.exam_id = exam.id
            install.template_version = int(template.version or 1)
            db.add(install)
        exams.append(exam)
    current_exam_ids = {exam.id for exam in exams}
    template_titles = {template.title for template in templates}
    provider_courses = select(Course.id).where(Course.provider_id == provider.id)
    for stale_exam in db.scalars(
        select(Exam).where(
            Exam.course_id.in_(provider_courses),
            Exam.title.in_(template_titles),
            Exam.id.not_in(current_exam_ids),
        ),
    ).all():
        if not str(stale_exam.assessment_about or "").startswith(SUPERSEDED_TEMPLATE_PREFIX):
            stale_exam.assessment_about = f"{SUPERSEDED_TEMPLATE_PREFIX} {stale_exam.assessment_about or ''}".strip()
            stale_exam.status = ExamStatus.REJECTED
            db.add(stale_exam)
    db.commit()
    return exams


def install_default_assessment_for_provider(
    db: Session,
    provider: ProviderProfile,
    template_key: str,
) -> tuple[Exam, AssessmentTemplate]:
    templates = seed_default_assessment_templates(db)
    template = next((row for row in templates if row.template_key == template_key and row.is_active), None)
    if not template:
        raise KeyError(template_key)
    existing = db.scalar(
        select(ProviderAssessmentTemplateInstall).where(
            ProviderAssessmentTemplateInstall.provider_id == provider.id,
            ProviderAssessmentTemplateInstall.template_id == template.id,
        ),
    )
    if existing and int(existing.template_version or 0) >= int(template.version or 1):
        exam = db.get(Exam, existing.exam_id)
        if exam:
            db.commit()
            return exam, template
    current_exam = db.get(Exam, existing.exam_id) if existing else None
    can_upgrade_in_place = bool(
        current_exam
        and not db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.exam_id == current_exam.id))
    )
    exam = _create_exam_from_template(db, provider, template, existing_exam=current_exam if can_upgrade_in_place else None)
    if not existing:
        existing = ProviderAssessmentTemplateInstall(provider_id=provider.id, template_id=template.id, exam_id=exam.id)
    existing.exam_id = exam.id
    existing.template_version = int(template.version or 1)
    db.add(existing)
    db.commit()
    db.refresh(exam)
    return exam, template
