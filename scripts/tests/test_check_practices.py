import json
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'check-practices'

class Checks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Test')
    def tearDown(self):
        self.tmp.cleanup()
    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
    def run_check(self, *args):
        result = subprocess.run([str(SCRIPT), '--repo', str(self.root), *args], capture_output=True, text=True)
        self.assertIn(result.returncode, [0, 1], result.stderr)
        return json.loads(result.stdout)
    def test_rules_redaction_and_token_globs(self):
        token = 'gh' + 'p_' + 'x' * 36
        (self.root/'view.tsx').write_text('const label = "Hello' + chr(8212) + 'there";\nconst model = "gpt-' + '4o";\nconst key = "' + token + '";\nconst color = "#abcdef";\n')
        (self.root/'tokens.css').write_text(':root { --ink: #abcdef; }')
        self.git('add', '.')
        report = self.run_check()
        self.assertEqual({f['rule_id'] for f in report['findings']}, {'SEC-001'})
        self.assertNotIn(token, json.dumps(report))
        report = self.run_check('--token-glob', '*.tsx')
        self.assertNotIn('UI-002', report['candidate_summary'])
    def test_diff_only_new_lines_but_full_file_size(self):
        (self.root/'view.ts').write_text('const oldColor = "#abcdef";\n')
        self.git('add', '.'); self.git('commit', '-qm', 'base')
        (self.root/'view.ts').write_text('const oldColor = "#abcdef";\n' + '\n'*500)
        report = self.run_check('--mode', 'diff', '--base', 'HEAD')
        self.assertEqual([f['rule_id'] for f in report['findings']], ['ENG-002'])
    def test_no_private_reads_or_symlink_escape(self):
        (self.root/'secret.pem').write_text('not read')
        (self.root/'outside.ts').symlink_to('/etc/hosts')
        self.git('add', '.')
        report = self.run_check()
        self.assertEqual(report['findings'], [])
        self.assertEqual(len(report['skipped']), 2)
    def test_hook_requires_explicit_permission(self):
        hook = self.root/'check.py'
        hook.write_text('import json\nprint(json.dumps([]))\n')
        self.git('add', '.')
        report = self.run_check('--hook', 'python3', '--hook-arg', 'check.py', '--allow-hook')
        self.assertEqual(report['hook_status'], 'passed')

if __name__ == '__main__': unittest.main()

class ReviewRegressions(Checks):
    def test_all_text_and_shared_secret_formats(self):
        values=['wh'+'sec_'+'a'*32, 'xo'+'xb-'+'a'*24, 'AI'+'za'+'a'*35]
        for name in ['guide.md','config.toml','main.go','.env.example']:
            (self.root/name).write_text('\n'.join(values))
        self.git('add','.')
        report=self.run_check()
        self.assertEqual({f['file'] for f in report['findings'] if f['rule_id']=='SEC-001'}, {'guide.md','config.toml','main.go','.env.example'})
        self.assertNotIn(values[0],json.dumps(report))
    def test_code_lengths_config_and_generated_defaults(self):
        for name in ['readme.md','package-lock.json','api.generated.ts','main.go']:
            (self.root/name).write_text('hello\n'*501)
        (self.root/'extension.json').write_text(json.dumps({'version':1,'rules':[],'max_code_lines':600}))
        self.git('add','.')
        report=self.run_check()
        self.assertEqual([f['file'] for f in report['findings'] if f['rule_id']=='ENG-002'],['main.go'])
        self.assertFalse(any(f['rule_id']=='ENG-002' for f in self.run_check('--extension',str(self.root/'extension.json'))['findings']))
    def test_models_from_data_and_test_candidates(self):
        (self.root/'model.test.ts').write_text('const id = "gpt-'+'5.2";\n')
        (self.root/'extension.json').write_text(json.dumps({'version':1,'rules':[],'past_generation_model_patterns':['retired-provider-v1']}))
        (self.root/'model.go').write_text('var model = "retired-provider-v1"\n')
        self.git('add','.')
        report=self.run_check('--extension',str(self.root/'extension.json'),'--exclude','extension.json')
        self.assertEqual(report['candidate_summary']['ENG-001']['count'],2)
        self.assertTrue(any('model.test.ts' in item for item in report['candidate_summary']['ENG-001']['first']))
    def test_colours_only_ui_exact_hex_no_comments(self):
        (self.root/'plain.go').write_text('var color = "#abcdef"\n')
        (self.root/'screen.tsx').write_text('// color: #abcdef\n/* #fff */\nconst hash="#abcde";\nconst color="#abcd";\n')
        self.git('add','.')
        summary=self.run_check()['candidate_summary']['UI-002']
        self.assertEqual(summary['count'],3)
        self.assertTrue(any('screen.tsx:4 ' in item for item in summary['first']))
    def test_option_like_base_rejected(self):
        result=subprocess.run([str(SCRIPT),'--repo',str(self.root),'--mode','diff','--base=--output=/tmp/not-a-base'],capture_output=True)
        self.assertEqual(result.returncode,2)

class PrecisionRegressions(Checks):
    def test_type_annotations_and_unrelated_json_values_are_not_credentials(self):
        (self.root/'types.ts').write_text('availableSecretRefs: Readonly'+'Set<string>;\n')
        (self.root/'record.jsonl').write_text(json.dumps({'message':'Never read API_KEY', 'id':'86beb9ce-42c2-4523-8f56-f09f4464d5f1'})+'\n')
        self.git('add','.')
        self.assertFalse(any(f['rule_id']=='SEC-001' for f in self.run_check()['findings']))

class NoiseRecallRegressions(Checks):
    def test_optional_chain_and_recorded_prose_are_clean(self):
        (self.root/'config.ts').write_text('const apiKeyEnv = options.'+'provider?.envKey ?? API_KEY_ENV;\n')
        (self.root/'fixtures').mkdir()
        (self.root/'fixtures/record.jsonl').write_text(json.dumps({'text':'Done'+chr(8212)+'thanks'})+'\n')
        self.git('add','.')
        self.assertEqual(self.run_check()['findings'],[])
    def test_test_markers_and_documented_placeholder_are_candidates(self):
        (self.root/'guard.test.ts').write_text('const forbidden = "'+'-----BEGIN '+'PRIVATE KEY-----'+'";\n')
        (self.root/'guide.md').write_text('Connect using '+''.join(['postgres://','user:','<replace-password>','@localhost/db\n']))
        self.git('add','.')
        result=self.run_check()
        self.assertEqual(result['candidate_summary']['SEC-001']['count'],2)
        self.assertEqual(result['findings'],[])
        self.assertEqual(result['violation_count'],0)
    def test_real_secret_and_old_model_in_product_still_fail(self):
        value='gh'+'p_'+'a'*36
        (self.root/'config.ts').write_text('const apiKey = "'+value+'";\nconst model="gpt-'+'5.2";\n')
        self.git('add','.')
        result=self.run_check()
        self.assertEqual(result['violation_count'],1)
        self.assertEqual(result['candidate_summary']['ENG-001']['count'],1)

class SharedRecognizerRegression(unittest.TestCase):
    def test_guard_scanner_ignores_optional_reference_but_keeps_literal_fallback(self):
        scanner=SCRIPT.parents[1]/'skills/merge-safe-prs/scripts/scan-secrets.py'
        with tempfile.TemporaryDirectory() as directory:
            file=pathlib.Path(directory)/'config.ts'
            file.write_text('const apiKeyEnv = options.'+'provider?.envKey ?? API_KEY_ENV;\n')
            clean=subprocess.run(['python3','-I',str(scanner),'--text',str(file)],capture_output=True,text=True)
            self.assertEqual(clean.returncode,0,clean.stdout+clean.stderr)
            value='gh'+'p_'+'Ab9'*12
            file.write_text('const apiKey = options.'+'provider?.apiKey ?? "'+value+'";\n')
            unsafe=subprocess.run(['python3','-I',str(scanner),'--text',str(file)],capture_output=True,text=True)
            self.assertEqual(unsafe.returncode,1)
            self.assertNotIn(value,unsafe.stdout+unsafe.stderr)

class ConservativePolicy(Checks):
    def test_soft_rules_default_to_bounded_candidates_and_repo_can_opt_in(self):
        (self.root/'view.tsx').write_text(('const c="#abcdef"; const m="gpt-'+ '5.2"; const s="A'+chr(8212)+'B";\n')*80)
        self.git('add','.')
        result=self.run_check()
        self.assertEqual(result['violation_count'],0)
        self.assertEqual(result['candidate_summary']['UI-002']['count'],80)
        self.assertEqual(len(result['candidate_summary']['UI-002']['first']),20)
        self.assertLess(len(result['candidate_text'].splitlines()),200)
        extension=self.root/'policy.json';extension.write_text(json.dumps({'version':1,'rules':[],'violation_globs':{'UI-002':['*.tsx']}}))
        result=self.run_check('--extension',str(extension))
        self.assertEqual(result['violation_count'],80)
    def test_docs_tests_fixtures_comments_and_changesets_do_not_fail(self):
        value='gh'+'p_'+'a'*36
        for name in ['note.md','items.fixtures.ts','thing.test.ts','.changeset/x.md']:
            file=self.root/name;file.parent.mkdir(exist_ok=True);file.write_text('const x="'+value+'";\n'+'\n'*501)
        (self.root/'regular.ts').write_text('// '+value+'\n')
        self.git('add','.')
        result=self.run_check()
        self.assertEqual(result['violation_count'],5)
        self.assertTrue(all(f['rule_id']=='SEC-001' for f in result['findings']))
    def test_strong_secrets_and_source_length_remain_default_failures(self):
        value='gh'+'p_'+'b'*36
        (self.root/'config.ts').write_text('const x="'+value+'";\n')
        (self.root/'large.go').write_text('var x = 1\n'*501)
        self.git('add','.')
        result=self.run_check()
        self.assertEqual({f['rule_id'] for f in result['findings']},{'SEC-001','ENG-002'})
        self.assertEqual(result['violation_count'],2)

class SharedFalsePositiveRegressions(unittest.TestCase):
    def test_urls_and_parenthesized_dotted_references_are_not_secrets(self):
        import runpy
        patterns=runpy.run_path(str(SCRIPT.parents[1]/'skills/merge-safe-prs/scripts/secret_patterns.py'))
        for line in ['const resourceUrl = "https://api.example.invalid/v1/AbC123?version=4";', 'const apiKey = options.'+'provider.envKey);']:
            self.assertEqual(patterns['line_hits'](line),[])

class GeneratedCodeContext(Checks):
    def test_automatically_generated_code_is_not_a_length_failure(self):
        (self.root/'_generated').mkdir()
        (self.root/'_generated/api.d.ts').write_text('/* eslint-disable */\n/**\n * Utility.\n *\n * THIS CODE IS AUTOMATICALLY GENERATED.\n */\n'+'export type T = string;\n'*501)
        self.git('add','.')
        self.assertEqual(self.run_check()['violation_count'],0)

class StrongSecretContext(Checks):
    def test_python_comment_and_multiline_key_material(self):
        value='gh'+'p_'+'c'*36
        (self.root/'comment.py').write_text('# key = "'+value+'"\n')
        header='-----BEGIN '+'PRIVATE KEY-----'
        footer='-----END '+'PRIVATE KEY-----'
        (self.root/'config.ts').write_text('const blob = `'+header+'\n'+('AA//' * 16)+'\n'+footer+'`;\n')
        self.git('add','.')
        result=self.run_check()
        self.assertEqual({(f['file'],f['rule_id']) for f in result['findings']},{('comment.py','SEC-001'),('config.ts','SEC-001')})

class ExplicitPolicyRegistration(Checks):
    def test_optional_punctuation_cannot_be_promoted_without_a_repo_rule(self):
        (self.root/'view.tsx').write_text('const text="A'+chr(8212)+'B";\n')
        policy=self.root/'policy.json';policy.write_text(json.dumps({'version':1,'rules':[],'violation_globs':{'UI-001':['*.tsx']}}))
        self.git('add','.')
        result=subprocess.run([str(SCRIPT),'--repo',str(self.root),'--extension',str(policy)],capture_output=True)
        self.assertEqual(result.returncode,2)

class FinalSecurityContract(Checks):
    def test_strong_tokens_fail_in_docs_comments_tests_and_json(self):
        value='gh'+'p_'+'q'*36
        for name in ['README.md','module.test.ts','notes.fixtures.ts','data.json','comment.py']:
            (self.root/name).write_text(('# ' if name.endswith('.py') else '')+json.dumps({'value':value})+'\n')
        self.git('add','.')
        result=self.run_check()
        self.assertEqual(result['violation_count'],5)
    def test_shared_guard_keeps_secret_urls_from_main(self):
        import runpy
        patterns=runpy.run_path(str(SCRIPT.parents[1]/'skills/merge-safe-prs/scripts/secret_patterns.py'))
        url=''.join(['https://','hooks.example.invalid/','Qw8r7TzP1xY2vB3nM4kL5jH6'])
        self.assertTrue(patterns['line_hits']('WEBHOOK_SECRET="'+url+'"'))
    def test_authored_logic_only_and_legacy_policy(self):
        for name in ['settings.config.ts','lexicon.py','theme.css','en.ts']:
            (self.root/name).write_text('const value = 1;\n'*501 if not name.endswith('.config.ts') else 'export const values = {\n'+''.join(f'k{n}: {n},\n' for n in range(501))+'};\n')
        (self.root/'lexicon.py').write_text('VALUES = {\n'+''.join(f'{n}: {n},\n' for n in range(501))+'}\n')
        (self.root/'en.ts').write_text('export const copy = {\n'+''.join(f'key{n}: "Label",\n' for n in range(501))+'};\n')
        (self.root/'logic.ts').write_text('export function run(x) { return x + 1; }\n'*501)
        (self.root/'legacy.json').write_text(json.dumps({'logic.ts':501}))
        (self.root/'policy.json').write_text(json.dumps({'version':1,'rules':[],'length_policy':{'legacy':'legacy.json'}}))
        self.git('add','.')
        self.assertEqual(self.run_check('--extension',str(self.root/'policy.json'))['violation_count'],0)
    def test_top_comment_justifications_in_each_syntax(self):
        reason='The parser shares one cursor across recovery branches to preserve precise error offsets'
        for ext,prefix,suffix in [('ts','//',''),('js','//',''),('py','#',''),('sh','#',''),('swift','//',''),('css','/*',' */')]:
            body='body { display: block; }\n' if ext=='css' else 'run(value)\n'
            (self.root/('worker.'+ext)).write_text(prefix+' practice-allow: ENG-002 because '+reason+suffix+'\n'+body*501)
        self.git('add','.')
        result=self.run_check()
        self.assertEqual(result['violation_count'],0)
        self.assertEqual(len(result['justified']),6)
    def test_empty_wrong_rule_and_string_markers_do_not_justify(self):
        for name,comment in [('empty.ts','// practice-allow: ENG-002 because'),('wrong.ts','// practice-allow: SEC-001 because long explanations cannot waive secret detection at any time'),('unknown.ts','// practice-allow: NOPE-9 because this is not a real file length rule identifier'),('string.ts','const text="practice-allow: ENG-002 because one big parser keeps its recovery state consistent across branches";')]:
            (self.root/name).write_text(comment+'\n'+'run(value);\n'*501)
        self.git('add','.')
        self.assertEqual(self.run_check()['violation_count'],4)
