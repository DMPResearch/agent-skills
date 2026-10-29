"""Negative controls for scenario graders, independent of a live model run."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('contracts', ROOT / 'evals/contracts.py')
contracts = importlib.util.module_from_spec(spec)


class Contracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec.loader.exec_module(contracts)

    def test_trigger_coverage_for_every_skill(self):
        for skill in (ROOT / 'skills').iterdir():
            if not (skill / 'SKILL.md').exists():
                continue
            cases = json.loads((ROOT / 'evals/triggers' / (skill.name + '.json')).read_text())
            self.assertEqual({c['should_trigger'] for c in cases}, {True, False})

    def test_reference_contract_rejects_late_uncredited_or_unreviewed_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ctx = {'repo': str(root), 'logs': str(root), 'agent': 'codex'}
            (root / 'mockup.html').write_text('<button>Save</button>')
            self.assertFalse(contracts.grade_references(ctx)[0])
            (root / 'reference-events.jsonl').write_text(json.dumps({'event': 'capture', 'mockup_exists': True,
                'url': 'https://example.com/reference', 'designer': 'Studio', 'licence': 'Reference only', 'file': 'ref.png'}) + '\n')
            self.assertFalse(contracts.grade_references(ctx)[0])
            (root / 'ref.png').write_bytes(b'fixture')
            (root / 'INDEX.md').write_text('Studio https://example.com/reference Reference only')
            (root / 'DIRECTION.md').write_text('Two directions: compact and spacious.')
            capture = {'event': 'capture', 'mockup_exists': False, 'url': 'https://example.com/reference',
                       'designer': 'Studio', 'licence': 'Reference only', 'file': 'ref.png'}
            review = {'family': 'claude', 'files': {'mockup.html': contracts.digest(root / 'mockup.html'),
                       'ref.png': contracts.digest(root / 'ref.png')}, 'prompt': 'Compare side by side at phone size'}
            (root / 'reference-events.jsonl').write_text(json.dumps(capture) + '\n')
            (root / 'critic-evidence.jsonl').write_text(json.dumps(review) + '\n')
            self.assertTrue(contracts.grade_references(ctx)[0])
            (root / 'mockup.html').write_text('<svg><path d="M0 0"/></svg>')
            self.assertFalse(contracts.grade_references(ctx)[0])

    def test_implementation_requires_other_family_and_resolved_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ctx = {'repo': str(root), 'logs': str(root), 'agent': 'codex'}
            good = 'def minutes_label(n):\n    return f"{n // 60}h {n % 60}m"\n'
            (root / 'utils.py').write_text(good)
            self.assertFalse(contracts.grade_implementation(ctx)[0])
            record = {'family': 'codex', 'files': {'utils.py': contracts.digest(root / 'utils.py')},
                      'prompt': 'Check DRY KISS YAGNI and code smells', 'findings': []}
            (root / 'critic-evidence.jsonl').write_text(json.dumps(record) + '\n')
            self.assertFalse(contracts.grade_implementation(ctx)[0])
            record['family'] = 'claude'
            (root / 'critic-evidence.jsonl').write_text(json.dumps(record) + '\n')
            self.assertTrue(contracts.grade_implementation(ctx)[0])
            (root / 'utils.py').write_text(good + '\nFORMATTERS = {}\n')
            self.assertFalse(contracts.grade_implementation(ctx)[0])


class FakeCritic(unittest.TestCase):
    def test_findings_and_current_artifact_hashes_change_after_fix(self):
        import os
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'utils.py'
            source.write_text('FORMATTERS = {}\ndef hours_part(n):\n    return n // 60\n')
            env = {**os.environ, 'FAKE_CRITIC_LOG': str(root / 'runs'),
                   'FAKE_CRITIC_EVIDENCE': str(root / 'evidence'), 'FAKE_CONTRACT': 'implementation'}
            command = [sys.executable, str(ROOT / 'evals/fakes/claude')]
            first = subprocess.run(command, cwd=root, env=env, input='Check DRY KISS YAGNI smells',
                                   text=True, capture_output=True, check=True)
            self.assertIn('VERDICT: needs-changes', first.stdout)
            self.assertIn('YAGNI', first.stdout)
            self.assertIn('DRY/KISS', first.stdout)
            source.write_text('def minutes_label(n):\n    return f"{n // 60}h {n % 60}m"\n')
            second = subprocess.run(command, cwd=root, env=env, input='Check DRY KISS YAGNI smells',
                                    text=True, capture_output=True, check=True)
            self.assertIn('VERDICT: approve', second.stdout)
            evidence = [json.loads(line) for line in (root / 'evidence').read_text().splitlines()]
            self.assertNotEqual(evidence[0]['files']['utils.py'], evidence[1]['files']['utils.py'])
            self.assertTrue(evidence[0]['findings'])
            self.assertFalse(evidence[1]['findings'])

    def test_svg_finding_is_not_approved(self):
        import os
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'mockup.html').write_text('<svg><path d="M0 0"/></svg>')
            result = subprocess.run([sys.executable, str(ROOT / 'evals/fakes/claude')], cwd=root,
                env={**os.environ, 'FAKE_CRITIC_LOG': str(root / 'runs'), 'FAKE_CONTRACT': 'references'},
                input='Compare side by side', text=True, capture_output=True, check=True)
            self.assertIn('hand-drawn SVG', result.stdout)
            self.assertIn('VERDICT: needs-changes', result.stdout)


if __name__ == '__main__':
    unittest.main()
