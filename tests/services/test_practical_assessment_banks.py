import unittest
from copy import deepcopy
from types import SimpleNamespace

from app.services.default_assessments import DEFAULT_ASSESSMENTS, get_default_assessment, list_default_assessments
from app.services.practical_assessment_banks import load_practical_banks, select_practical_task, practical_task_for_issued_attempt
from app.services.tax_case_calculations import ordinary_tax, corporation_return
from app.api.routes.exams import _candidate_task_to_dict, _score_task_submission


class PracticalBankTest(unittest.TestCase):
    def test_every_bank_has_thirty_cases_and_random_selection_reaches_them(self):
        banks = load_practical_banks()['banks']
        self.assertEqual(len(banks), 5)
        for key, bank in banks.items():
            task = get_default_assessment(key)['task']
            ids = {case['metadata']['case_id'] for case in bank['cases']}
            self.assertEqual(len(ids), 30)
            selected = [select_practical_task(task, str(seed)) for seed in range(600)]
            self.assertEqual({case['metadata']['case_id'] for case in selected}, ids)
            self.assertTrue(all('case_bank' not in case['metadata'] for case in selected))

    def test_snapshot_keeps_case_and_scoring_key_after_template_changes(self):
        key = next(iter(load_practical_banks()['banks']))
        data = deepcopy(get_default_assessment(key)['task'])
        task = SimpleNamespace(id=1, assessment_id=2, type='tax_simulator', title=data['title'],
            description=data['description'], instructions=data['instructions'], marks=100,
            metadata_json=data['metadata'], expected_output_json=data['expected_output'], grading_config_json=data['grading_config'])
        issue = SimpleNamespace(id=3, access_key='test-secret', result_json={'_allowance_assessment_type': 'tax_simulator'})
        first = practical_task_for_issued_attempt(task, issue, create=True)
        task.metadata_json = {}
        task.expected_output_json = {'changed': True}
        resumed = practical_task_for_issued_attempt(task, issue, create=True)
        self.assertEqual(first.metadata_json, resumed.metadata_json)
        self.assertEqual(first.expected_output_json, resumed.expected_output_json)
        self.assertEqual(issue.result_json['_allowance_assessment_type'], 'tax_simulator')

    def test_spreadsheet_first_dataset_preserves_original_twenty_four_answers(self):
        original = next(row for row in DEFAULT_ASSESSMENTS if row['id'] == 'working-capital-model')['task']
        generated = load_practical_banks()['banks']['working-capital-model']['cases'][0]
        self.assertEqual(len(generated['grading_config']['checkpoints']), 24)
        for old, new in zip(original['grading_config']['checkpoints'], generated['grading_config']['checkpoints']):
            self.assertAlmostEqual(old['expected'], new['expected'], places=2, msg=old['id'])

    def test_mcq_pools_each_have_at_least_thirty_questions(self):
        pools = [row for row in list_default_assessments() if row['assessment_type'] == 'mcq']
        self.assertEqual(len(pools), 2)
        for pool in pools:
            self.assertGreaterEqual(len(pool['questions']), 30)

    def test_tax_table_and_computation_worksheet_known_values(self):
        self.assertEqual(ordinary_tax(0, 'Single'), 0)
        # 2025 single $110k: 1192.50 + 4386 + 12072.50 + 1596.
        self.assertEqual(ordinary_tax(110000, 'Single'), 19247)
        # Tax table interval 50,000–50,050 uses its midpoint.
        self.assertEqual(ordinary_tax(50000, 'Single'), 5920)

    def test_candidate_payload_hides_bank_and_grading_and_correct_work_still_needs_review(self):
        for key, bank in load_practical_banks()['banks'].items():
            for case in bank['cases']:
                task = SimpleNamespace(id=1, assessment_id=2, type=get_default_assessment(key)['assessment_type'],
                    title=case['title'], description=case['description'], instructions=case['instructions'], marks=100,
                    metadata_json=case['metadata'], expected_output_json=case['expected_output'], grading_config_json=case['grading_config'])
                public = _candidate_task_to_dict(task)
                self.assertNotIn('expected_output', public)
                self.assertNotIn('grading_config', public)
                self.assertNotIn('case_bank', public['metadata'])
                paper = case['metadata'].get('workpaper')
                if paper:
                    answer = {'entered_form_values':case['expected_output']['expected_form_values'],
                        'identified_red_flags':case['expected_output']['red_flags'], 'notes':'Reviewer evidence trace'}
                    score, status, detail = _score_task_submission(task, answer)
                    self.assertEqual(score, 100, paper['case_id'])
                    self.assertEqual(status, 'manual_review')
                    blank_score, _, _ = _score_task_submission(task, {})
                    self.assertEqual(blank_score, 0, paper['case_id'])

    def test_corporate_section382_drd_and_m1_reconcile_against_hand_calculation(self):
        facts = {'gross_receipts':100000,'returns_allowances':0,'cost_of_goods_sold':40000,
            'taxable_interest':0,'dividends':10000,'capital_gains':0,'capital_losses':1000,'other_income':0,
            'ordinary_deductions':10000,'actual_bad_debts':500,'business_meals':1000,'tax_depreciation':2000,
            'qualified_cash_charity':0,'nol_carryover':100000,'domestic_stock_ownership_percent':20,
            'section382_limit':20000,'federal_tax_provision':6000,'book_bad_debt_expense':1500,
            'penalties':200,'political_gifts':300,'tax_exempt_interest':200,'book_depreciation':1000,'estimated_payments':5000}
        result = corporation_return(facts)
        self.assertEqual(result['taxable_income_before_special_deductions'],57000)
        self.assertEqual(result['dividends_received_deduction'],6500)
        self.assertEqual(result['nol_deduction'],20000)
        self.assertEqual(result['taxable_income'],30500)
        self.assertEqual(result['income_tax'],6405)
        self.assertEqual(result['m1_additions'],9000)
        self.assertEqual(result['m1_deductions'],1200)
        self.assertEqual(result['book_net_income'],49200)
        facts.update(nol_carryover=0,qualified_cash_charity=10000)
        self.assertEqual(corporation_return(facts)['charitable_contribution_deduction'],5700)


if __name__ == '__main__':
    unittest.main()
