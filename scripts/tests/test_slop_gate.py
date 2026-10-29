import importlib.util
import json
import pathlib
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('audit_slop',ROOT/'skills/practice-audit/scripts/audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
IDS=['UI-SLOP-DESIGN','PROC-SLOP-WRITING','ENG-SLOP-CODE','PROC-SLOP-REVIEW']

class SlopGate(unittest.TestCase):
    def test_catalogue_first_group_is_four_hard_blockers(self):
        rules=json.loads((ROOT/'rules/catalogue.json').read_text())['rules']
        self.assertEqual([r['id'] for r in rules[:4]],IDS)
        for r in rules[:4]:
            self.assertEqual(r['severity'],'blocker')
            self.assertEqual(r['group'],'no-ai-slop')
            self.assertIn('owner AGENTS.md section 0',r['sources'])
    def test_confirmed_slop_cannot_be_downgraded(self):
        with tempfile.TemporaryDirectory() as directory:
            f=dict(rule_id=IDS[2],file='code.ts',line=1,severity='minor',evidence='The catch discards a failed write and returns success.',why='A failed operation is silenced.')
            result=audit.parse_result(json.dumps({'findings':[f],'unverified':[],'inspected_files':['code.ts']}),set(IDS),pathlib.Path(directory))
            self.assertEqual(result['findings'][0]['severity'],'blocker')
