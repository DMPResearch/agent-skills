import json
import pathlib
import runpy
import subprocess
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
P=runpy.run_path(str(ROOT/'skills/merge-safe-prs/scripts/secret_patterns.py'))
L=runpy.run_path(str(ROOT/'scripts/practice_length.py'))
C=runpy.run_path(str(ROOT/'scripts/practice_candidates.py'))
CAL=runpy.run_path(str(ROOT/'evals/practice-audit/calibrate.py'))

class CriticRepairs(unittest.TestCase):
    def test_five_main_detections_survive(self):
        source=subprocess.check_output(['git','show','main:skills/merge-safe-prs/scripts/scan-secrets.py'],cwd=ROOT,text=True)
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'baseline.py';path.write_text(source)
            main=runpy.run_path(str(path))
        value=''.join(['Ab9cDe7FgHi3JkLm5NoPq8RsTu2VwXyZ'])
        quoted=json.dumps(value)
        probes=['const '+ 'apiKey = load() || '+quoted,
                'headers.set('+json.dumps('X-Api-'+'Token')+','+quoted+')',
                'auth('+json.dumps('api_'+'key')+','+quoted+')',
                'set'+'Token(u,'+quoted+')',
                'API_'+'KEY='+value+'>']
        for number,line in enumerate(probes):
            with self.subTest(case=number):
                self.assertTrue(main['line_hits'](line))
                self.assertTrue(P['line_hits'](line))
    def test_actual_reference_and_deny_list_false_positives(self):
        for line in ['const api'+'Key = options.provider?.envKey;',"['Read(~/.private_"+"keys/**)', 'Read(//**/*.pem)']"]:
            self.assertFalse(P['line_hits'](line))
    def test_password_url_needs_entropy_for_default_violation(self):
        for password in ['password','secret','hunter']:
            url=''.join(['https://','user:',password,'@host.invalid/'])
            self.assertTrue(P['line_hits'](url))
            self.assertFalse(P['strong_secret_lines'](url))
        url=''.join(['postgres://','u:','A9c4E7f2H6j8K1m3N5p0','@localhost/db'])
        self.assertTrue(P['strong_secret_lines'](url))
    def test_config_name_does_not_waive_authored_logic(self):
        for name,text in [('lexicon.py','def lookup():\n    return fetch()\n'),('billing_config.py','def bill():\n    return charge()\n'),('app.config.ts','export function run() { return work(); }')]:
            self.assertFalse(L['data_module'](name,text,{},C['lexical'](text)[0]))
        reference='export const settings = { handler: execute };'
        self.assertFalse(L['data_module']('app.config.ts',reference,{},C['lexical'](reference)[0]))
        self.assertTrue(L['data_module']('app.config.ts','export const settings = { retries: 3 };',{},C['lexical']('export const settings = { retries: 3 };')[0]))
    def test_additional_marker_syntaxes(self):
        reason='One parser cursor is shared by recovery branches to retain exact diagnostic locations'
        for suffix,start,end in [('go','//',''),('rs','//',''),('html','<!--',' -->'),('vue','<!--',' -->'),('svelte','<!--',' -->')]:
            with self.subTest(suffix=suffix):
                allowed,error=L['justification']('file.'+suffix,start+' practice-allow: ENG-002 because '+reason+end)
                self.assertIsNone(error);self.assertIsNotNone(allowed)
    def test_length_score_uses_file_not_reporter_line(self):
        expected=[dict(id='length',kind='mechanical',rules=['ENG-002'],files=['runner.ts'],first=501,last=505)]
        finding=dict(rule_id='ENG-002',file='runner.ts',line=1)
        r=CAL['score']({'status':'complete','findings':[finding],'mechanical':{'findings':[finding]}},expected)
        self.assertEqual(r['mechanical_found'],1)
        self.assertEqual(r['false'],[])
