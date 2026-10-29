import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('calibration',ROOT/'evals/practice-audit/calibrate.py')
calibration=importlib.util.module_from_spec(spec);spec.loader.exec_module(calibration)

class Calibration(unittest.TestCase):
    def test_scores_misses_false_positives_and_ignores_candidates(self):
        expected=[dict(id='secret',kind='mechanical',rules=['SEC-001'],files=['config.ts']),dict(id='test',kind='judgment',rules=['TEST-002'],files=['server.test.ts'])]
        report={'status':'complete','findings':[dict(rule_id='SEC-001',file='config.ts',line=1),dict(rule_id='UI-001',file='clean.ts',line=2),dict(rule_id='ENG-001',file='fixture.ts',line=1,candidate=True)]}
        report['mechanical']={'findings':[report['findings'][0]]}
        result=calibration.score(report,expected)
        self.assertEqual(result['found'],['secret'])
        self.assertEqual(result['missed'],['test'])
        self.assertEqual(len(result['false']),1)
        self.assertFalse(result['passed'])
    def test_incomplete_audit_cannot_pass_even_with_all_answers(self):
        expected=[dict(id=str(i),kind='judgment',rules=['ENG-003'],files=[str(i)+'.ts']) for i in range(7)]
        report={'status':'incomplete','findings':[dict(rule_id='ENG-003',file=str(i)+'.ts',line=1) for i in range(7)]}
        self.assertFalse(calibration.score(report,expected)['passed'])
    def test_thresholds_require_all_mechanical_and_seven_judgment(self):
        expected=[dict(id='m',kind='mechanical',rules=['SEC-001'],files=['m.ts'])]+[dict(id=str(i),kind='judgment',rules=['ENG-003'],files=[str(i)+'.ts']) for i in range(8)]
        findings=[dict(rule_id='SEC-001',file='m.ts',line=1)]+[dict(rule_id='ENG-003',file=str(i)+'.ts',line=1) for i in range(7)]
        report={'status':'complete','findings':findings,'mechanical':{'findings':[findings[0]]}}
        report['auditors']=[{'family':family,'status':'complete','findings':findings} for family in ['claude','codex']]
        self.assertTrue(calibration.score(report,expected)['passed'])
        self.assertFalse(calibration.score({**report,'findings':findings[1:],'mechanical':{'findings':[]}},expected)['passed'])
        extra=[dict(rule_id='UI-001',file='clean.ts',line=i) for i in range(3)]
        self.assertFalse(calibration.score({**report,'findings':findings+extra},expected)['passed'])
    def test_model_detection_cannot_hide_a_mechanical_checker_miss(self):
        expected=[dict(id='m',kind='mechanical',rules=['SEC-001'],files=['m.ts'])]
        report={'status':'complete','mechanical':{'findings':[]},'findings':[dict(rule_id='SEC-001',file='m.ts',line=1)]}
        self.assertEqual(calibration.score(report,expected)['mechanical_found'],0)
    def test_preparation_does_not_write_answers_or_label_controls(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            run=pathlib.Path(directory)/'run'
            repo=calibration.prepare(run)
            self.assertFalse((run/'expected.json').exists())
            self.assertFalse((repo/'clean').exists())
            self.assertNotIn('DRY',(repo/'AGENTS.md').read_text())
    def test_one_silent_family_cannot_pass(self):
        expected=[dict(id=str(i),kind='judgment',rules=['ENG-003'],files=[str(i)+'.ts']) for i in range(7)]
        found=[dict(rule_id='ENG-003',file=str(i)+'.ts',line=1) for i in range(7)]
        report={'status':'complete','findings':found,'auditors':[{'family':'claude','status':'complete','findings':[]},{'family':'codex','status':'complete','findings':found}]}
        result=calibration.score(report,expected)
        self.assertFalse(result['passed'])
        self.assertEqual(result['families']['claude']['judgment_found'],0)
    def test_lookup_control_has_real_declared_inputs(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            repo=calibration.prepare(pathlib.Path(directory)/'run')
            url=(repo/'settings/lookup.ts').as_uri()
            code='import assert from "node:assert/strict"; import { keyEnvironment } from '+repr(url)+'; assert.equal(keyEnvironment({provider:{envKey:"MODEL_ID"}},"FALLBACK"),"MODEL_ID"); assert.equal(keyEnvironment({},"FALLBACK"),"FALLBACK");'
            result=calibration.subprocess.run(['node','--input-type=module','--eval',code],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
