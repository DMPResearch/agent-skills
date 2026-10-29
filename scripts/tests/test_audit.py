import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('audit',ROOT/'skills/practice-audit/scripts/audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class Audit(unittest.TestCase):
    def test_dedup_preserves_disagreement(self):
        base=dict(rule_id='ENG-002',file='x.ts',line=501,severity='minor',evidence='size',why='split')
        result=audit.merge_findings([('claude',[base]),('codex',[{**base,'severity':'major','evidence':'large'}])])
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['severity'],'major')
        self.assertEqual(len(result[0]['observations']),2)
    def test_invalid_json_locations_and_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            value={'findings':[dict(rule_id='ENG-002',file='../escape',line=1,severity='major',evidence='proof',why='reason')],'unverified':[]}
            with self.assertRaises(ValueError):audit.parse_result(json.dumps(value),{'ENG-002'},root)
            value['findings'][0]['file']='x.ts'
            token='gh'+'p_'+'x'*36
            value['findings'][0]['evidence']=token
            self.assertNotIn(token,json.dumps(audit.parse_result(json.dumps(value),{'ENG-002'},root)))
    def test_closed_stdin_and_timeout_and_invalid_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            command=[sys.executable,'-c','import sys,json; assert sys.stdin.read()==""; print(json.dumps({"findings":[],"unverified":["UI requires captures"],"inspected_files":["unit.ts"]}))']
            result=audit.run_auditor('codex',command,root,2,set())
            self.assertEqual(result['status'],'complete')
            for command in [[sys.executable,'-c','import time;time.sleep(2)'],[sys.executable,'-c','print("not JSON")']]:
                self.assertEqual(audit.run_auditor('codex',command,root,0.1,set())['status'],'incomplete')

if __name__=='__main__':unittest.main()

class AuditCLI(unittest.TestCase):
    def test_both_families_run_and_repo_stays_unchanged(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);repo=root/'repo';repo.mkdir();bin=root/'bin';bin.mkdir()
            subprocess.run(['git','init','-q',str(repo)],check=True)
            (repo/'main.ts').write_text('export const ready = true;\n')
            subprocess.run(['git','-C',str(repo),'add','.'],check=True)
            fake='''#!/usr/bin/env python3
import json,sys,pathlib
assert sys.stdin.read()==''
assert not any('Mechanical evidence:' in arg for arg in sys.argv)
prompt_arg=next(arg for arg in sys.argv if arg.startswith('AUDIT_PROMPT_FILE='))
prompt_path=pathlib.Path(prompt_arg.split('=',1)[1].splitlines()[0])
assert prompt_path.name=='prompt.md' and prompt_path.is_file()
assert 'Mechanical evidence:' in prompt_path.read_text()
value=json.dumps({'findings':[],'unverified':['UI-003 needs screenshots'],'inspected_files':['main.ts']})
if '--output-last-message' in sys.argv:
 pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text(value)
else:
 assert '--tools' in sys.argv and '--permission-mode' in sys.argv
 denied=sys.argv[sys.argv.index('--disallowedTools')+1]
 for expected in ['Read(~/.ssh/**)','Read(~/.private_keys/**)',
'Read(//**/','.p12)','.key)','Keychains','Read(~/.aws/credentials)','Read(~/.netrc)','Read(~/.config/gh/hosts.yml)']:
  assert expected in denied
 print(json.dumps({'result':value}))
'''
            for name in ['claude','codex']:
                (bin/name).write_text(fake);(bin/name).chmod(0o755)
            before=subprocess.run(['git','-C',str(repo),'status','--porcelain'],capture_output=True,check=True).stdout
            result=subprocess.run([sys.executable,str(ROOT/'skills/practice-audit/scripts/audit.py'),'--repo',str(repo),'--claude-model','test-model-a','--codex-model','test-model-b','--out',str(root/'report')],env={**os.environ,'PATH':str(bin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            report=json.loads((root/'report/report.json').read_text())
            self.assertEqual({r['family'] for r in report['auditors']},{'claude','codex'})
            self.assertTrue(all(r['unverified'] for r in report['auditors']))
            self.assertEqual(before,subprocess.run(['git','-C',str(repo),'status','--porcelain'],capture_output=True,check=True).stdout)

class ReviewRegressions(unittest.TestCase):
    def test_one_runner_passes_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            result=audit.run_auditor('claude',[sys.executable,'-c','import os,json;assert os.environ["AUDIT_TEST"]=="yes";print(json.dumps({"findings":[],"unverified":[],"inspected_files":["unit.ts"]}))'],pathlib.Path(directory),3,set(),env={'AUDIT_TEST':'yes'})
            self.assertEqual(result['status'],'complete')
    def test_diff_process_findings_require_evidence(self):
        findings=[dict(rule_id='PROC-001',file='AGENTS.md',line=1,severity='major',evidence='No approval in diff',why='Required')]
        result=audit.enforce_process_scope({'findings':findings,'unverified':[]},'diff',False,{'PROC-001'})
        self.assertEqual(result['findings'],[])
        self.assertTrue(result['unverified'])
    def test_single_diff_and_safe_base(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            subprocess.run(['git','init','-q',str(root)],check=True)
            subprocess.run(['git','-C',str(root),'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','base'],check=True)
            (root/'space name.go').write_text('var x = 1\n')
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            changed=audit.checks.diff_scope(root,'HEAD','.')
            self.assertEqual(changed['space name.go'],[{'first':1,'count':1}])

class ConfigDefaults(unittest.TestCase):
    def test_current_models_and_high_effort_default_in_actual_launch(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);repo=root/'repo';repo.mkdir();bin=root/'bin';bin.mkdir()
            subprocess.run(['git','init','-q',str(repo)],check=True)
            (repo/'main.ts').write_text('export const ok=true;\n')
            subprocess.run(['git','-C',str(repo),'add','.'],check=True)
            fake='''#!/usr/bin/env python3
import json,sys,pathlib
value=json.dumps({'findings':[],'unverified':[],'inspected_files':['main.ts']})
if '--output-last-message' in sys.argv:
 assert sys.argv[sys.argv.index('--model')+1]=='gpt-6-sol'
 assert 'model_reasoning_effort="high"' in sys.argv
 pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text(value)
else:
 assert sys.argv[sys.argv.index('--model')+1]=='claude-opus-5-5'
 print(json.dumps({'result':value}))
'''
            for name in ['claude','codex']:
                (bin/name).write_text(fake);(bin/name).chmod(0o755)
            result=subprocess.run([sys.executable,str(ROOT/'skills/practice-audit/scripts/audit.py'),'--repo',str(repo),'--out',str(root/'report')],env={**os.environ,'PATH':str(bin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

class StructuredOutput(unittest.TestCase):
    def test_claude_structured_output_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            parsed=audit.parse_result(json.dumps({'type':'result','subtype':'success','structured_output':{'findings':[],'unverified':['TEST-002 lacks execution evidence'],'inspected_files':['unit.ts']}}),set(),pathlib.Path(directory))
            self.assertEqual(parsed['findings'],[])
    def test_invalid_output_records_exit_zero_and_specific_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            result=audit.run_auditor('claude',[sys.executable,'-c','print("not json")'],pathlib.Path(directory),2,set())
            self.assertEqual(result['status'],'incomplete')
            self.assertEqual(result['exit_code'],0)
            self.assertIn('JSON',result['reason'])

class PerformedAudit(unittest.TestCase):
    def test_not_performed_and_uninspected_empty_output_are_incomplete(self):
        with tempfile.TemporaryDirectory() as directory:
            for data in [{'findings':[],'unverified':['Audit not performed: permission denied'],'inspected_files':[]},{'findings':[],'unverified':[],'inspected_files':[]}]:
                with self.assertRaises(ValueError): audit.parse_result(json.dumps(data),set(),pathlib.Path(directory))

class PromptPermission(unittest.TestCase):
    def test_prompt_directory_is_explicitly_granted(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);repo=root/'repo';repo.mkdir();bin=root/'bin';bin.mkdir()
            subprocess.run(['git','init','-q',str(repo)],check=True)
            (repo/'unit.ts').write_text('export function run(x) { return x; }\n')
            subprocess.run(['git','-C',str(repo),'add','.'],check=True)
            fake='''#!/usr/bin/env python3
import sys,json,pathlib
prompt=pathlib.Path(next(a for a in sys.argv if a.startswith('AUDIT_PROMPT_FILE=')).split('=',1)[1].splitlines()[0])
value=json.dumps({'findings':[],'unverified':[],'inspected_files':['unit.ts']})
if '--output-last-message' in sys.argv:
 pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text(value)
else:
 assert '--add-dir' in sys.argv
 assert pathlib.Path(sys.argv[sys.argv.index('--add-dir')+1])==prompt.parent
 assert 'Read(//**/*.pem)' in sys.argv[sys.argv.index('--disallowedTools')+1]
 print(json.dumps({'structured_output':json.loads(value)}))
'''
            for name in ['claude','codex']:
                (bin/name).write_text(fake);(bin/name).chmod(0o755)
            result=subprocess.run([sys.executable,str(ROOT/'skills/practice-audit/scripts/audit.py'),'--repo',str(repo),'--out',str(root/'out')],env={**os.environ,'PATH':str(bin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
