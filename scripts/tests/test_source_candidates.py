import json
import pathlib
import subprocess
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
CHECK=ROOT/'scripts/check-practices'

class SourceCandidates(unittest.TestCase):
    def check(self, files, policy=None):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            subprocess.run(['git','init','-q',str(root)],check=True)
            for name,text in files.items():
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
            if policy: (root/'policy.json').write_text(json.dumps(policy))
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            args=[str(CHECK),'--repo',str(root)]
            if policy:args+=['--extension',str(root/'policy.json')]
            run=subprocess.run(args,capture_output=True,text=True)
            self.assertIn(run.returncode,[0,1],run.stderr)
            return json.loads(run.stdout)
    def test_smells_ts_js_python_swift_are_only_candidates(self):
        files={
          'app.ts':'function f(x) {\n'+(' x += 1;\n'*65)+'try { send(); } catch (e) {}\n}\n// TODO\n// const old = 1;\n// return old;\n',
          'app.js':'function f() { if(a) { if(b) { if(c) { if(d) { if(e) { run(); } } } } } }\n',
          'app.py':'def run():\n    try:\n        save()\n    except Exception:\n        pass\n# FIXME\n',
          'app.swift':'func run() {\n'+(' work()\n'*65)+'do { try save() } catch {}\n}\n'}
        r=self.check(files)
        self.assertEqual(r['violation_count'],0)
        for id in ['ENG-CAND-001','ENG-CAND-002','ENG-CAND-003','ENG-CAND-004','ENG-CAND-005']:
            self.assertIn(id,r['candidate_summary'])
    def test_strings_are_not_catch_blocks_or_commented_code(self):
        r=self.check({'a.ts':'const label="catch (e) {} // TODO";\n','a.py':'text = "except: pass # FIXME"\n','a.swift':'let message = "catch {} // TODO"\n'})
        self.assertFalse(any(id.startswith('ENG-CAND') for id in r['candidate_summary']))
    def test_configured_threshold_can_opt_in(self):
        r=self.check({'a.py':'def f():\n    work()\n    work()\n'}, {'version':1,'rules':[],'smell_thresholds':{'function_lines':2},'violation_globs':{'ENG-CAND-001':['*.py']}})
        self.assertEqual([f['rule_id'] for f in r['findings']],['ENG-CAND-001'])
    def test_design_candidates_and_token_exemptions(self):
        r=self.check({'Card.tsx':'export const Card=()=> <><button style={{fontSize:13,padding:3,borderRadius:7,zIndex:999}}>Buy</button><img src="a.png" /></>;\n','theme-tokens.css':':root { --surface: #fff; }\n','button.css':'button { width:32px; height:32px; }\nimg { object-fit:fill; }\n'}, {'version':1,'rules':[],'token_globs':['*-tokens.css']})
        self.assertEqual(r['violation_count'],0)
        for id in ['UI-002','UI-002','UI-DS-002','UI-DS-003','UI-DS-004']:self.assertIn(id,r['candidate_summary'])
    def test_large_non_focus_markup_finishes_without_quadratic_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            subprocess.run(['git','init','-q',str(root)],check=True)
            (root/'screen.html').write_text('<p>content</p>\n'*12000)
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            result=subprocess.run([str(CHECK),'--repo',str(root)],capture_output=True,text=True,timeout=3)
            self.assertIn(result.returncode,[0,1])
    def test_data_classification_handles_escaped_regex_literals_in_linear_time(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);subprocess.run(['git','init','-q',str(root)],check=True)
            (root/'logic.ts').write_text("const pattern = /'"+('\\'*2000)+"/;\nexport function run(x) { return pattern.test(x); }\n")
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            result=subprocess.run([str(CHECK),'--repo',str(root)],capture_output=True,text=True,timeout=3)
            self.assertIn(result.returncode,[0,1])
    def test_password_urls_and_escaped_private_material_fail_in_json(self):
        header='-----BEGIN '+'PRIVATE KEY-----';footer='-----END '+'PRIVATE KEY-----'
        key=header+'\n'+('Ab0/'*20)+'\n'+footer
        url=''.join(['postgres://','user:', 'R9x7Ab2cD4eF6gH8','@localhost/database'])
        r=self.check({'record.json':json.dumps({'private_key':key,'connection':url})+'\n'})
        self.assertEqual(r['violation_count'],1)
        self.assertEqual(r['findings'][0]['rule_id'],'SEC-001')
    def test_unsupported_python_syntax_is_reported_as_unverified(self):
        r=self.check({'broken.py':'def run(:\n    pass\n'})
        self.assertTrue(any(w['file']=='broken.py' for w in r['analysis_warnings']))
