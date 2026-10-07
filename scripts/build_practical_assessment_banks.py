"""Author reproducible practical case banks, with linked evidence and answer keys.

Names and transactions are fictional. Original case prompts are IRS-referenced,
not IRS questions or a representation of IRS/EA approval. Expert review remains
a separate editorial step, recorded on every bank.
"""
from copy import deepcopy
import json
from pathlib import Path
from app.services.tax_case_calculations import individual_return, corporation_return, money

ROOT = Path(__file__).resolve().parents[1]
IRS = {
    '1040': 'https://www.irs.gov/instructions/i1040gi',
    '1120': 'https://www.irs.gov/instructions/i1120',
    'schedule_c': 'https://www.irs.gov/instructions/i1040sc',
    'schedule_se': 'https://www.irs.gov/instructions/i1040sse',
    'qbi': 'https://www.irs.gov/instructions/i8995',
    'itemized': 'https://www.irs.gov/instructions/i1040sca',
    'passive': 'https://www.irs.gov/instructions/i8582',
    'capital': 'https://www.irs.gov/instructions/i1040sd',
}
INDIVIDUAL_SCENARIOS = [
    ('Consultant with dual income', 'A personal loan deposit was included in the sales export.', 'Exclude loan proceeds from business income'),
    ('Designer marketplace reconciliation', 'The platform gross total and its 1099-K describe the same sales, not additional receipts.', 'Do not double-count 1099-K receipts'),
    ('Field engineer travel review', 'The requested vehicle deduction includes undocumented commuting; only the substantiated expenses listed are supported.', 'Exclude commuting and unsupported vehicle expenses'),
    ('Therapist with medical costs', 'Medical costs must be tested against the AGI floor before itemizing.', 'Apply the medical expense AGI floor'),
    ('Photographer asset workpaper', 'Book depreciation was used in the client spreadsheet; use the supplied federal depreciation workpaper.', 'Use federal depreciation instead of book depreciation'),
    ('Consultant wash-sale review', 'The brokerage supplement identifies a disallowed loss that is already included in gross reported losses.', 'Adjust the short-term loss for the wash sale'),
    ('Retailer inventory tie-out', 'The ordinary expense subtotal includes cost of goods sold supported by the year-end count; do not expense inventory purchases again.', 'Avoid double-counting inventory costs'),
    ('IT contractor owner transfer', 'The client deducted an owner cash draw. The draw is not included in the supported ordinary expense subtotal.', 'Exclude owner draws from deductions'),
    ('Translator meals substantiation', 'Business meals are separately substantiated; personal dinners are not in the supported subtotal.', 'Limit qualifying business meals to 50%'),
    ('Nurse joint return wage base', 'Only the self-employed taxpayer’s W-2 social-security wages reduce their Schedule SE wage base; spouse wages do not.', 'Apply the social-security wage base per taxpayer'),
    ('Tutor rental-loss review', 'The rental is passive, has adequate basis and at-risk amount, and the taxpayer is not a real-estate professional.', 'Suspend the passive rental loss at the stated MAGI'),
    ('Architect insurance allocation', 'The self-employed health-insurance premium is supported; neither spouse had employer coverage available in those months.', 'Deduct eligible health insurance outside Schedule C'),
    ('Analyst rollover verification', 'The additional retirement transfer is a documented trustee-to-trustee transfer and is not taxable.', 'Exclude documented direct rollover proceeds'),
    ('Writer corrected information return', 'The corrected 1099-NEC replaces the original; use the reconciled sales ledger.', 'Use corrected information-return evidence'),
    ('Engineer capital-loss carryforward', 'No opening capital-loss carryforward exists; all transactions are short-term.', 'Limit the net capital-loss deduction to 3000'),
    ('Dentist itemization choice', 'The proposed filing worksheet claims both the standard deduction and all Schedule A costs.', 'Use the larger deduction, not both deductions'),
    ('Consultant exempt-bond interest', 'Municipal-bond interest is separately identified; it is not part of taxable interest.', 'Exclude documented tax-exempt interest from AGI'),
    ('Bookkeeper refund reconciliation', 'Returned customer payments are separately supported and must reduce receipts.', 'Reduce gross business receipts by sales refunds'),
    ('Developer QBI reconciliation', 'The client used gross receipts as QBI and omitted deductions attributable to the business.', 'Reduce QBI for deductible SE tax and health insurance'),
    ('Instructor substantiation review', 'Political gifts are excluded from qualified cash gifts. The client requests a personal deduction for them.', 'Exclude political contributions from Schedule A'),
    ('Researcher taxable distribution', 'A separate employer-plan distribution is fully taxable and is shown on the statement; no early-distribution penalty applies.', 'Include the supported taxable retirement distribution'),
    ('Advisor estimated-payment tracing', 'The fourth payment was posted in January 2026 and explicitly designated for tax year 2025.', 'Use confirmed 2025 estimated payments'),
    ('Consultant duplicate invoice', 'The reconciliation removed an invoice appearing twice in the bookkeeping export.', 'Do not restore the duplicate sales invoice'),
    ('Artist mortgage qualification', 'Mortgage interest relates to documented acquisition debt within the applicable limit; personal credit-card interest is excluded.', 'Use qualified mortgage interest only'),
    ('Engineer state-tax cap', 'The state/property-tax evidence is not deducted in the business or rental schedules.', 'Apply the 2025 SALT cap before itemizing'),
    ('Editor constructive-receipt review', 'The December unrestricted deposit was available before year end and is included in the cash-basis ledger.', 'Include unrestricted year-end receipts'),
    ('Consultant insurance reimbursement', 'The medical amount is after insurance reimbursement; an additional reimbursed bill is excluded.', 'Deduct only unreimbursed medical expenses'),
    ('Planner rent-versus-deposit review', 'A refundable tenant security deposit is shown separately and is not part of rental receipts.', 'Exclude a refundable rental security deposit'),
    ('Specialist withholding review', 'The client treated social-security and Medicare withholding as federal income-tax payments.', 'Use federal income-tax withholding only'),
    ('Joint return quality-control review', 'One spouse proposed omitting the other spouse’s W-2 income while retaining joint filing status.', 'Include both spouses’ wages on the joint return'),
]
CORPORATE_SCENARIOS = [
    ('Professional services', 'Deducted federal income-tax provision', 'Add back the federal income-tax provision'),
    ('Wholesale electronics', 'Book reserve differs from debts actually written off', 'Use specific deductible bad debts, not the reserve'),
    ('Food distributor', 'Business meals included at 100%', 'Apply the business-meal limitation'),
    ('Software studio', 'Tax and book depreciation differ', 'Reconcile federal and book depreciation'),
    ('Property management', 'Penalty expense included in deductions', 'Exclude government fines and penalties'),
    ('Marketing agency', 'Political gift included with qualified charity', 'Exclude political contributions'),
    ('Medical supplier', 'Cash gifts exceed the taxable-income limit', 'Limit charity and track carryforward'),
    ('Equipment retailer', 'Capital losses exceed capital gains', 'Do not offset ordinary income with a net capital loss'),
    ('Data services', 'Post-2017 NOL exceeds the 80% limit', 'Limit the post-2017 NOL deduction'),
    ('Logistics operator', 'Ownership change constrains NOL usage', 'Apply the section 382 limitation'),
    ('Office furnishing', 'Domestic dividend ownership below 20%', 'Use the 50% dividends-received deduction'),
    ('Industrial components', 'Domestic dividend ownership between 20% and 80%', 'Use the 65% dividends-received deduction'),
    ('Training corporation', 'Municipal interest included in book income', 'Exclude tax-exempt interest in the M-1 reconciliation'),
    ('Technical publisher', 'Estimated payments differ from the federal provision', 'Use payment confirmations rather than book tax expense'),
    ('Laboratory services', 'Sales return posted to expense instead of contra-sales', 'Net supported returns against gross receipts'),
    ('Safety equipment', 'Book capital loss treated as an ordinary deduction', 'Track the corporate capital-loss carryforward'),
    ('Cloud hosting', 'Qualified charity deducted without a limit test', 'Compute the charitable deduction base'),
    ('Architectural products', 'Duplicate bad-debt adjustment proposed', 'Add back only reserve expense less actual write-offs'),
    ('Fleet maintenance', 'Depreciation reversal signs are reversed', 'Subtract excess tax depreciation in Schedule M-1'),
    ('Design corporation', 'Meals and penalties combined in one expense account', 'Separate limited and nondeductible expenses'),
    ('Business consultancy', 'Client claims all dividend income is exempt', 'Report gross dividends before the special deduction'),
    ('Manufacturing support', 'Client deducts a cash dividend paid to shareholders', 'Exclude shareholder distributions from deductions'),
    ('Consumer wholesaler', 'Gross-profit tie-out omits merchandise returns', 'Reconcile net sales and cost of goods sold'),
    ('Compliance services', 'Political giving included in the charity carryover', 'Separate permanently denied gifts from charity carryovers'),
    ('Software licensing', 'An NOL workpaper ignores current-year income', 'Recompute the NOL limit after the special deduction'),
    ('Medical logistics', 'A post-change NOL uses the entire carryover', 'Limit utilization to the supplied section 382 capacity'),
    ('Document processing', 'Client treats overpayment as an additional expense', 'Report tax payments after computing tax liability'),
    ('Machinery supplier', 'Book income contains exempt interest and excess depreciation', 'Reconcile both permanent and timing differences'),
    ('Engineering corporation', 'Supported charity paid during the tax year', 'Distinguish qualifying paid gifts from political gifts'),
    ('Records management', 'M-1 line 10 confused with final taxable income', 'Subtract special deductions after the M-1 tie-out'),
]


def document(doc_id, name, facts, note=''):
    return {'id': doc_id, 'name': name, 'format': 'PDF', 'description': 'Fictional source evidence for this assessment only', 'pages': 2,
            'sections': [{'heading': name, 'lines': [{'label': key.replace('_', ' ').title(), 'value': str(value)} for key, value in facts.items()], 'note': note}]}


def checkpoint_fields(expected):
    return [{'id': key, 'label': key.replace('_', ' ').title(), 'section': 'Federal return workpaper'} for key in expected]


def workpaper_task(case_id, title, expected, facts, documents, flags, references, scope, kind, reviewer_note):
    fields = checkpoint_fields(expected)
    weight = 80 / len(expected)
    checkpoints = [{'id': key, 'label': key.replace('_', ' ').title(), 'weight': weight, 'source': f'field:{key}', 'comparator': 'numeric', 'expected': value, 'tolerance': 1} for key, value in expected.items()]
    checkpoints += [{'id': 'diagnostics', 'label': 'Evidence-supported diagnostics', 'weight': 20, 'source': 'identified_red_flags', 'comparator': 'set_exact', 'expected': flags}]
    distractors = {
        'tax': ['Apply the active-participation rental allowance despite the supplied modified AGI', 'Use the section 199A wage/property limitation for this below-threshold return', 'Combine spouse Social Security wages when limiting the self-employed taxpayer wage base'],
        'tax_1120': ['Reduce Schedule M-1 income by the dividends-received deduction', 'Use book depreciation in place of the supplied federal tax depreciation', 'Offset corporate ordinary income with the net capital loss'],
        'accounting': ['Record deposits in transit as a second cash receipt', 'Reverse outstanding cheques from the cash ledger', 'Recognize the full annual insurance premium in December expense'],
    }[kind]
    all_flags = list(dict.fromkeys([*flags, *distractors]))
    instructions = ('Use the stated 2025 federal facts and IRS references. Enter whole-dollar outputs, including zero where appropriate. Select only evidence-supported diagnostics. Document each unresolved issue and calculation assumptions. This is an original advanced hiring case, not an IRS exam or tax-filing service.'
        if kind.startswith('tax') else 'Prepare the accrual-basis close from the linked evidence. Enter every gross journal or reconciliation output in whole dollars, including zero where appropriate. Select supported diagnostics and document journal directions, evidence IDs and unresolved differences. Do not invent reconciliation plugs.')
    return {'title': title, 'description': 'Prepare the complete scoped workpaper from the source pack, resolve conflicting client requests, reconcile every output, and leave a reviewer handoff note.',
            'instructions': instructions,
            'marks': 100, 'metadata': {'workspace': kind, 'answer_format': f'{kind}_workbench',
                'case_id': case_id, 'case_version': 1, 'tax_year': 2025 if kind.startswith('tax') else None,
                'workpaper': {'case_id': case_id, 'title': title, 'fields': fields, 'documents': documents,
                    'messages': [{'id': 'review-request', 'sender': 'Case client', 'senderRole': 'Client', 'subject': 'Preparation and reviewer handoff', 'receivedAt': '2026-02-20T10:00:00Z', 'preview': reviewer_note, 'body': [reviewer_note, scope], 'attachmentIds': [doc['id'] for doc in documents], 'unread': True}],
                    'diagnostic_options': all_flags, 'scope': scope, 'references': references},
                'editorial_review_status': 'Independent subject-expert review pending', 'difficulty': 'Advanced'},
            'expected_output': {'expected_form_values': expected, 'red_flags': flags, 'reviewer_explanation': reviewer_note},
            'grading_config': {'evaluation_mode': 'deterministic_with_review', 'manual_review_required': True, 'checkpoints': checkpoints}}


def tax1040_cases():
    cases = []
    for i, (theme, issue, diagnostic) in enumerate(INDIVIDUAL_SCENARIOS):
        joint = i % 2 == 1
        # Keep individual MAGI below NIIT/additional Medicare thresholds but
        # above the passive-rental special-allowance phase-out threshold.
        wages = 170000 + (i % 5) * 1000 if joint else 128000 + (i % 5) * 1000
        f = {'filing_status': 'Married filing jointly' if joint else 'Single', 'wages': wages,
             'taxpayer_ss_wages': 125000 + (i % 4) * 4000, 'gross_receipts': 98000 + i * 900,
             'sales_refunds': 4000 + i * 100, 'ordinary_expenses': 30000 + i * 450,
             'business_meals': 4500 + (i % 6) * 500, 'tax_depreciation': 9000 + (i % 4) * 1000,
             'se_health_insurance': 4200 + (i % 3) * 600, 'taxable_interest': 1500 + i * 50,
             'tax_exempt_interest': 800 + i * 25, 'taxable_retirement': 6000 if i in (12, 20, 29) else 0,
             'short_term_gain': 12000 + i * 100, 'short_term_loss': 8000 + (i % 4) * 3000,
             'wash_sale_disallowed_loss': 1800 + i * 20 if i in (5, 14, 22) else 0,
             'rent_received': 36000 + i * 100, 'rental_expenses': 28000 + i * 100, 'rental_depreciation': 14000,
             'salt': 35000 + (i % 5) * 2500, 'qualified_mortgage_interest': 8000 + i * 75,
             'qualified_cash_gifts': 2800 + i * 60, 'medical_expenses': 10000 + (i % 6) * 2000,
             'federal_withholding': 26000 + i * 200, 'estimated_payments': 9000 + (i % 4) * 1500}
        expected = individual_return(f)
        threshold = 250000 if joint else 200000
        if expected['adjusted_gross_income'] >= threshold or f['wages'] + expected['net_se_earnings'] >= threshold:
            raise ValueError('Case exceeds stated no-NIIT/no-additional-Medicare scope')
        name = f'Fictional taxpayer {i+1:02d}'
        docs = [document('organizer', '2025 Client organizer', {'name': name, 'filing_status': f['filing_status'], 'taxpayer_age': 58, 'spouse_age_if_joint': 57, 'dependents': 'None', 'residency': 'US citizen, full-year resident', 'other_income_and_credits': 'None', 'filing_status_support': 'Unmarried all year if single; married December 31 and both spouses elect joint filing if joint'}, issue),
                document('wages', 'W-2 and investment statements', {key: f[key] for key in ['wages', 'taxpayer_ss_wages', 'taxable_interest', 'tax_exempt_interest', 'taxable_retirement', 'federal_withholding']}, 'For joint returns, total wages include spouse wages. All retirement distributions shown as taxable are penalty-exempt; other direct rollovers are not in these totals.'),
                document('business', 'Cash-basis business ledger and expense evidence', {key: f[key] for key in ['gross_receipts', 'sales_refunds', 'ordinary_expenses', 'business_meals', 'tax_depreciation', 'se_health_insurance']}, 'Ordinary expenses are substantiated and exclude meals, depreciation, owner draws, personal costs and health insurance. Receipts are reconciled once to bank and information returns. Health premiums eligible all covered months. Business is materially participated, US-based and eligible QBI.'),
                document('broker', 'Brokerage lot and wash-sale supplement', {key: f[key] for key in ['short_term_gain', 'short_term_loss', 'wash_sale_disallowed_loss']}, 'All transactions held one year or less. No qualified dividends, long-term gains, collectibles or prior capital-loss carryforward.'),
                document('rental', 'Passive residential rental workpaper', {key: f[key] for key in ['rent_received', 'rental_expenses', 'rental_depreciation']}, 'No personal use; adequate basis and at-risk amount; no prior losses or other passive income. Actively participating owner is not a real-estate professional. Activity is not a section 199A trade/business under the case facts.'),
                document('deductions', 'Schedule A evidence and payment confirmations', {key: f[key] for key in ['salt', 'qualified_mortgage_interest', 'qualified_cash_gifts', 'medical_expenses', 'estimated_payments']}, 'SALT is personal income/property tax not deducted elsewhere. Mortgage is qualified acquisition debt within the debt limit. Gifts are to qualifying public charities with receipts, medical costs are unreimbursed, and estimated payments are designated to 2025.')]
        flags = list(dict.fromkeys([diagnostic, 'Suspend the passive rental loss at the stated MAGI', 'Reduce QBI for deductible SE tax and health insurance']))
        scope = 'Federal 2025 Form 1040 summary including Schedules A, C, D, E, SE and Form 8995. No AMT preference items, NIIT, additional Medicare tax, child/education credits, foreign income, tips/overtime deduction, senior deduction or other unstated items. Use supplied depreciation workpaper; all ages are under 65. Whole-dollar rounding. Use the IRS tax table below 100000 taxable income and computation worksheet above it.'
        case_id = f'tax-1040-{i+1:02d}'
        cases.append(workpaper_task(case_id, f'1040 · {theme}', expected, f, docs, flags, list(IRS.values()), scope, 'tax', issue))
    return cases


def tax1120_cases():
    cases = []
    for i, (theme, issue, diagnostic) in enumerate(CORPORATE_SCENARIOS):
        nol_case = i in (8, 9, 24, 25)
        f = {'gross_receipts': 2200000 + i * 32000, 'returns_allowances': 35000 + i * 700,
             'cost_of_goods_sold': 760000 + i * 13000, 'taxable_interest': 8500 + i * 250,
             'dividends': 18000 + i * 600, 'domestic_stock_ownership_percent': 25 if i % 3 == 2 else 10,
             'capital_gains': 28000 + i * 200, 'capital_losses': 39000 if i % 4 == 3 else 7000,
             'other_income': 6000 + i * 120, 'ordinary_deductions': 680000 + i * 12000,
             'actual_bad_debts': 7000 + i * 100, 'book_bad_debt_expense': 16000 + i * 150,
             'business_meals': 24000 + i * 350, 'tax_depreciation': 94000 + i * 800,
             'book_depreciation': 72000 + i * 500, 'penalties': 2500 + i * 50,
             'political_gifts': 3000 + i * 70, 'qualified_cash_charity': 0 if nol_case else 68000 + i * 400,
             'tax_exempt_interest': 4500 + i * 80, 'federal_tax_provision': 82000 + i * 1200,
             'nol_carryover': 550000 if nol_case else 0, 'section382_limit': 60000 if i in (9, 25) else 10000000,
             'estimated_payments': 78000 + i * 950}
        expected = corporation_return(f)
        docs = [document('entity', '2025 Corporate organizer', {'corporation': f'Fictional {theme} Corporation {i+1:02d}', 'entity': 'Domestic C corporation', 'method': 'Accrual', 'tax_year': 'Calendar 2025', 'three_year_average_gross_receipts': 9500000, 'tax_shelter': 'No', 'ownership_change': 'Section 382 limit supplied where relevant', 'stock_holding_period': 'Eligible domestic dividends meet the required holding period; no debt-financed stock'}, 'No consolidated return, personal holding company tax, accumulated earnings tax, international income or tax credits. Gross receipts exemption applies for section 163(j).'),
                document('income', 'Sales and investment income subledger', {key: f[key] for key in ['gross_receipts', 'returns_allowances', 'cost_of_goods_sold', 'taxable_interest', 'dividends', 'domestic_stock_ownership_percent', 'capital_gains', 'capital_losses', 'other_income', 'tax_exempt_interest']}, 'Investment capital gains/losses are from corporate capital assets; no section 1231/1245 amounts or prior capital losses. All dividends are eligible domestic dividends.'),
                document('deductions', 'Expense ledger with source review', {key: f[key] for key in ['ordinary_deductions', 'actual_bad_debts', 'book_bad_debt_expense', 'business_meals', 'penalties', 'political_gifts', 'qualified_cash_charity', 'federal_tax_provision']}, 'Ordinary deductions exclude every separately stated item. Bad debts actually became worthless and were charged off in 2025. Meals are qualifying business meals, not employee recreation. Fines are governmental penalties. Qualified gifts were paid to qualifying charities during 2025; political gifts are not charitable gifts.'),
                document('assets', 'Federal depreciation and book-tax ledger', {'tax_depreciation': f['tax_depreciation'], 'book_depreciation': f['book_depreciation'], 'book_net_income': expected['book_net_income']}, 'Supplied depreciation workpapers are finalized and substantiated. Book net income includes federal provision, full meals, full charity, fines, political gifts, reserve expense, net capital result and exempt interest.'),
                document('carryovers', 'NOL and payment confirmation file', {key: f[key] for key in ['nol_carryover', 'section382_limit', 'estimated_payments']}, 'All NOLs arose after 2017, no pre-2018 losses. Section 382 annual capacity is given, with no unused limitation carryforward; ignore the capacity only when no ownership change. Cases with NOL contain no qualifying charity. Payments are for this return year, not book expense.')]
        flags = list(dict.fromkeys([diagnostic, 'Add back the federal income-tax provision', 'Apply the business-meal limitation', 'Use specific deductible bad debts, not the reserve']))
        case_id = f'tax-1120-{i+1:02d}'
        cases.append(workpaper_task(case_id, f'1120 · {theme}', expected, f, docs, flags, [IRS['1120']], 'Federal 2025 Form 1120, Schedule J and Schedule M-1 workpaper with DRD, post-2017 NOL and carryover schedules. The documented small-business exemption applies. No credits or AMT. Complete M-1 before the special deductions; no filing transmission. All unlisted return lines are zero.', 'tax_1120', issue))
    return cases


def main():
    target = ROOT / 'app/content/practical_assessment_banks.json'
    existing = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'version': 1, 'banks': {}}
    existing['banks']['individual-tax-review'] = {'case_count': 30, 'difficulty': 'Advanced IRS-referenced return preparation', 'review_status': 'Independent EA/CPA review pending', 'cases': tax1040_cases()}
    existing['banks']['corporate-tax-1120-review'] = {'case_count': 30, 'difficulty': 'Advanced IRS-referenced corporate return preparation', 'review_status': 'Independent EA/CPA review pending', 'cases': tax1120_cases()}
    target.write_text(json.dumps(existing, indent=2) + '\n', encoding='utf-8')
    print({key: len(bank['cases']) for key, bank in existing['banks'].items()})


if __name__ == '__main__':
    main()
