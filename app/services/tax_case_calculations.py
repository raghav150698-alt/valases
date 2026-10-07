"""2025 federal assessment workpapers; calculations are scoped to stated case facts.

Not a filing engine. Cases exclude AMT, NIIT, preferential-rate gains and credits
unless specifically supplied. References are carried with every generated case.
"""
from decimal import Decimal, ROUND_HALF_UP


def money(value):
    return float(Decimal(str(value)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def ordinary_tax(income, status):
    limits = [23850, 96950, 206700, 394600, 501050, 751600] if status == 'Married filing jointly' else [11925, 48475, 103350, 197300, 250525, 626350]
    rates = [Decimal(x) for x in ['.10', '.12', '.22', '.24', '.32', '.35', '.37']]
    taxable = Decimal(str(max(0, income)))
    if taxable == 0:
        return 0.0
    # IRS tax table uses $50 income bands below $100,000. All bank cases have
    # positive taxable income; use the band's midpoint for the stated statuses.
    if taxable < 100000:
        taxable = (taxable // 50) * 50 + 25
    result = Decimal(0)
    previous = Decimal(0)
    for limit, rate in zip([*limits, Decimal('Infinity')], rates):
        upper = min(taxable, Decimal(str(limit)))
        result += max(Decimal(0), upper - previous) * rate
        if taxable <= upper:
            break
        previous = upper
    return money(result)


def individual_return(f):
    """Full federal summary for the specific non-AMT, non-NIIT case scope."""
    profit = money(f['gross_receipts'] - f['sales_refunds'] - f['ordinary_expenses'] - f['business_meals'] * .5 - f['tax_depreciation'])
    net_se = money(profit * .9235)
    # One self-employed taxpayer; spouse wages do not consume their SS wage base.
    ss_base = min(net_se, max(0, 176100 - f['taxpayer_ss_wages']))
    se_tax = money(ss_base * .124 + net_se * .029)
    half_se = money(se_tax / 2)
    capital = f['short_term_gain'] - f['short_term_loss'] + f['wash_sale_disallowed_loss']
    capital_reported = max(-3000, capital)
    capital_carry = max(0, -capital - 3000)
    # Every case has modified AGI >= $150k: the $25k special rental allowance
    # is fully phased out. Given basis/at-risk support; no real-estate professional.
    rental = f['rent_received'] - f['rental_expenses'] - f['rental_depreciation']
    allowed_rental = max(0, rental)
    suspended_rental = max(0, -rental)
    agi = money(f['wages'] + f['taxable_interest'] + f['taxable_retirement'] + capital_reported + profit + allowed_rental - half_se - f['se_health_insurance'])
    if agi < 150000:
        raise ValueError('Case requires explicit rental phase-out calculation below $150,000')
    standard = 31500 if f['filing_status'] == 'Married filing jointly' else 15750
    itemized = min(40000, f['salt']) + f['qualified_mortgage_interest'] + f['qualified_cash_gifts'] + max(0, f['medical_expenses'] - agi * .075)
    deduction = money(max(standard, itemized))
    before_qbi = max(0, agi - deduction)
    threshold = 394600 if f['filing_status'] == 'Married filing jointly' else 197300
    if before_qbi > threshold:
        raise ValueError('Case requires Form 8995-A beyond the simplified threshold')
    # Rental is explicitly non-business for section 199A; all gains short-term.
    qbi = money(min(max(0, profit - half_se - f['se_health_insurance']) * .2, before_qbi * .2))
    taxable = max(0, before_qbi - qbi)
    tax = ordinary_tax(taxable, f['filing_status'])
    total = tax + se_tax
    payments = f['federal_withholding'] + f['estimated_payments']
    return {'schedule_c_profit': profit, 'net_se_earnings': net_se, 'self_employment_tax': se_tax,
            'deductible_se_tax': half_se, 'capital_gain_or_loss': capital_reported,
            'capital_loss_carryforward': capital_carry, 'allowed_rental_income': allowed_rental,
            'suspended_passive_loss': suspended_rental, 'adjusted_gross_income': agi,
            'deduction_used': deduction, 'qbi_deduction': qbi, 'taxable_income': taxable,
            'regular_income_tax': tax, 'total_tax': total, 'total_payments': payments,
            'refund': max(0, payments - total), 'amount_owed': max(0, total - payments)}


def corporation_return(f):
    net_sales = f['gross_receipts'] - f['returns_allowances']
    capital = max(0, f['capital_gains'] - f['capital_losses'])
    capital_carry = max(0, f['capital_losses'] - f['capital_gains'])
    income = net_sales - f['cost_of_goods_sold'] + f['taxable_interest'] + f['dividends'] + capital + f['other_income']
    meals_allowed = money(f['business_meals'] * .5)
    before_char = f['ordinary_deductions'] + f['actual_bad_debts'] + meals_allowed + f['tax_depreciation']
    base = income - before_char
    # The case NOL is post-2017; charity base takes the NOL deduction into account.
    # Cases with NOL explicitly use no charitable deduction to avoid an iterative
    # charity/NOL ordering problem. Their denied gifts are political contributions.
    charity = money(min(f['qualified_cash_charity'], max(0, base) * .1))
    if f['nol_carryover'] and f['qualified_cash_charity']:
        raise ValueError('Combined charity/NOL case needs an explicit ordering workpaper')
    after_char = base - charity
    drd_rate = .65 if f['domestic_stock_ownership_percent'] >= 20 else .5
    drd = money(min(f['dividends'] * drd_rate, max(0, after_char) * drd_rate))
    before_nol = max(0, after_char - drd)
    nol = money(min(f['nol_carryover'], before_nol * .8, f['section382_limit']))
    taxable = money(before_nol - nol)
    tax = money(taxable * .21)
    m1_additions = f['federal_tax_provision'] + (f['book_bad_debt_expense'] - f['actual_bad_debts']) + (f['business_meals'] - meals_allowed) + f['penalties'] + f['political_gifts'] + (f['qualified_cash_charity'] - charity) + capital_carry
    m1_deductions = f['tax_exempt_interest'] + (f['tax_depreciation'] - f['book_depreciation'])
    book = money(after_char - m1_additions + m1_deductions)
    return {'net_sales': net_sales, 'gross_profit': net_sales - f['cost_of_goods_sold'], 'total_income': income,
            'allowable_meals': meals_allowed, 'allowable_bad_debts': f['actual_bad_debts'],
            'charitable_contribution_deduction': charity, 'charitable_carryforward': f['qualified_cash_charity'] - charity,
            'capital_loss_carryforward': capital_carry, 'total_deductions': before_char + charity,
            'taxable_income_before_special_deductions': after_char, 'dividends_received_deduction': drd,
            'nol_deduction': nol, 'nol_carryforward': f['nol_carryover'] - nol, 'taxable_income': taxable,
            'income_tax': tax, 'estimated_payments': f['estimated_payments'],
            'amount_owed': max(0, tax - f['estimated_payments']), 'overpayment': max(0, f['estimated_payments'] - tax),
            'book_net_income': book, 'm1_additions': m1_additions, 'm1_deductions': m1_deductions,
            'm1_income_before_special_deductions': after_char}
