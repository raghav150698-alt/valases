"""Select a versioned practical case and freeze it with its scoring key."""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import random
from types import SimpleNamespace

BANK_PATH = Path(__file__).resolve().parents[1] / 'content/practical_assessment_banks.json'
SNAPSHOT_KEY = '_practical_task_snapshot'


@lru_cache(maxsize=1)
def load_practical_banks():
    data = json.loads(BANK_PATH.read_text(encoding='utf-8'))
    ids = set()
    for bank in data['banks'].values():
        if len(bank['cases']) != 30:
            raise ValueError('Every practical bank requires 30 cases')
        for case in bank['cases']:
            case_id = case['metadata']['case_id']
            if case_id in ids:
                raise ValueError('Duplicate practical case ID')
            ids.add(case_id)
            checks = case['grading_config'].get('checkpoints', [])
            if checks and abs(sum(check['weight'] for check in checks) - 100) > .00001:
                raise ValueError('Case checkpoint weights must total 100')
            paper = case['metadata'].get('workpaper')
            if paper:
                if set(field['id'] for field in paper['fields']) != set(case['expected_output']['expected_form_values']):
                    raise ValueError('Workpaper fields and scoring key differ')
                if not set(case['expected_output']['red_flags']).issubset(paper['diagnostic_options']):
                    raise ValueError('Diagnostic key must match candidate options')
                doc_ids = {document['id'] for document in paper['documents']}
                if any(not set(message['attachmentIds']).issubset(doc_ids) for message in paper['messages']):
                    raise ValueError('Broken evidence attachment')
    return data


def attach_practical_bank(definition):
    bank = load_practical_banks()['banks'].get(definition['id'])
    if not bank:
        return definition
    output = deepcopy(definition)
    output['task'] = deepcopy(bank['cases'][0])
    output['task']['metadata']['case_bank'] = {**deepcopy(bank), 'version': load_practical_banks()['version']}
    output['summary'] += ' One of 30 advanced cases is randomly selected for each attempt.'
    return output


def select_practical_task(task, seed, previous_ids=()):
    bank = task.get('metadata', {}).get('case_bank')
    if not bank:
        return deepcopy(task)
    fresh = [case for case in bank['cases'] if case['metadata']['case_id'] not in previous_ids]
    selected = deepcopy(random.Random(seed).choice(fresh or bank['cases']))
    selected.update({key: task[key] for key in ('id', 'assessment_id', 'type') if key in task})
    selected['metadata']['case_selection'] = {'case_id': selected['metadata']['case_id'], 'bank_version': bank['version'], 'case_count': len(bank['cases'])}
    return selected


def practical_task_for_issued_attempt(task, issue, *, create=False):
    if task is None:
        return task
    result = dict(issue.result_json or {})
    snapshot = result.get(SNAPSHOT_KEY)
    if snapshot is None and create and (task.metadata_json or {}).get('case_bank'):
        snapshot = select_practical_task({
            'id': task.id, 'assessment_id': task.assessment_id, 'type': task.type,
            'title': task.title, 'description': task.description, 'instructions': task.instructions,
            'marks': task.marks, 'metadata': task.metadata_json,
            'expected_output': task.expected_output_json, 'grading_config': task.grading_config_json,
        }, f'{issue.access_key}:{issue.id}')
        issue.result_json = {**result, SNAPSHOT_KEY: snapshot}
    if snapshot is None:
        return task
    return SimpleNamespace(**{**{key: snapshot[key] for key in ('id','assessment_id','type','title','description','instructions','marks')},
                             'metadata_json':deepcopy(snapshot['metadata']), 'expected_output_json':deepcopy(snapshot['expected_output']), 'grading_config_json':deepcopy(snapshot['grading_config'])})
