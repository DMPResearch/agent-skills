"""Exercise the installed Git hook with real local pushes, never a network remote."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PracticePush(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.box = Path(self.tmp.name)
        self.repo = self.box / 'repo'
        self.repo.mkdir()
        self.env = {**os.environ, 'HOME': str(self.box), 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1',
                    'GIT_AUTHOR_NAME': 'Test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
                    'GIT_COMMITTER_NAME': 'Test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid'}
        self.git('init', '-q', '-b', 'main')
        self.write('app.py', 'def value():\n    return 1\n')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').stdout.strip()
        subprocess.run(['git', 'init', '-q', '--bare', str(self.box / 'remote.git')], check=True, env=self.env)
        self.git('remote', 'add', 'origin', str(self.box / 'remote.git'))
        self.git('push', '-q', 'origin', 'main')
        self.extension = self.box / 'extension.json'
        self.extension.write_text(json.dumps({'version': 1, 'max_code_lines': 5}))

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args, check=True):
        return subprocess.run(['git', *args], cwd=self.repo, env=self.env, text=True,
                              capture_output=True, check=check)

    def write(self, name, text):
        p = self.repo / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'change')

    def install(self):
        return subprocess.run([sys.executable, '-I', str(ROOT / 'hooks/install_hooks.py'),
                               '--practice-repo', str(self.repo), '--extension', str(self.extension)],
                              env=self.env, text=True, capture_output=True)

    def large(self):
        self.write('app.py', 'def value():\n' + ''.join(f'    x{i} = {i}\n' for i in range(8)) + '    return x7\n')
        self.commit()

    def test_blocks_violation_and_preserves_dirty_checkout(self):
        self.assertEqual(self.install().returncode, 0)
        self.large()
        self.write('app.py', 'def value():\n    return 2\n')
        before = self.git('status', '--porcelain').stdout
        result = self.git('push', 'origin', 'main', check=False)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn('ENG-002', result.stderr)
        self.assertEqual(self.git('status', '--porcelain').stdout, before)
        self.assertEqual((self.repo / 'app.py').read_text(), 'def value():\n    return 2\n')

    def test_candidates_do_not_block(self):
        self.assertEqual(self.install().returncode, 0)
        self.write('view.css', 'button { color: #abcdef; }\n')
        self.commit()
        self.assertEqual(self.git('push', 'origin', 'main', check=False).returncode, 0)

    def test_other_branch_is_checked_instead_of_head(self):
        self.assertEqual(self.install().returncode, 0)
        self.git('checkout', '-qb', 'topic')
        self.large()
        self.git('checkout', '-q', 'main')
        self.assertNotEqual(self.git('push', 'origin', 'topic', check=False).returncode, 0)

    def test_tags_and_deletes_are_skipped(self):
        self.assertEqual(self.install().returncode, 0)
        self.large()
        self.git('tag', '-a', 'v1', '-m', 'release')
        self.assertEqual(self.git('push', 'origin', 'v1', check=False).returncode, 0)
        self.assertEqual(self.git('push', 'origin', ':refs/tags/v1', check=False).returncode, 0)

    def test_existing_hook_keeps_stdin_and_is_backed_up(self):
        hook = self.repo / '.git/hooks/pre-push'
        hook.write_text('#!/bin/sh\ncat > received-refs\nexit 0\n')
        hook.chmod(0o755)
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.install().returncode, 0)
        self.write('readme.md', 'changed\n')
        self.commit()
        self.git('push', 'origin', 'main')
        self.assertIn('refs/heads/main', (self.repo / 'received-refs').read_text())
        self.assertTrue((hook.parent / 'pre-push.agent-skills-original').exists())

    def test_incomplete_is_visible_but_does_not_block(self):
        self.assertEqual(self.install().returncode, 0)
        self.extension.write_text('{invalid')
        self.write('readme.md', 'changed\n')
        self.commit()
        result = self.git('push', 'origin', 'main', check=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn('incomplete', result.stderr)

    def test_private_policy_is_rejected_without_reading(self):
        self.extension = self.box / '.ssh/extension.json'
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('private', result.stderr.lower())

    def test_branch_delete_skips_and_existing_hook_failure_is_preserved(self):
        self.git('push', 'origin', 'main:temporary')
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.git('push', 'origin', ':temporary', check=False).returncode, 0)
        original = self.repo / '.git/hooks/pre-push.agent-skills-original'
        original.write_text('#!/bin/sh\nexit 1\n')
        original.chmod(0o755)
        # Reinstall adds the deliberately failing original to the chain.
        self.assertEqual(self.install().returncode, 0)
        self.write('readme.md', 'change\n')
        self.commit()
        self.assertNotEqual(self.git('push', 'origin', 'main', check=False).returncode, 0)

    def test_orphan_and_multi_ref_push(self):
        self.assertEqual(self.install().returncode, 0)
        self.git('checkout', '--orphan', 'orphan')
        self.large()
        self.git('checkout', '-q', 'main')
        result = self.git('push', 'origin', 'main', 'orphan', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ENG-002', result.stderr)

    def test_secret_is_blocked_without_printing_value(self):
        self.assertEqual(self.install().returncode, 0)
        token = ''.join(['gh', 'p_', 'Q' * 36])
        self.write('readme.md', token + '\n')
        self.commit()
        result = self.git('push', 'origin', 'main', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SEC-001', result.stderr)
        self.assertNotIn(token, result.stdout + result.stderr)

    def test_extension_commands_are_never_executed(self):
        self.extension.write_text(json.dumps({'version': 1, 'hook': {'command': 'touch', 'args': [str(self.box / 'executed')]}}))
        self.assertEqual(self.install().returncode, 0)
        self.write('readme.md', 'change\n')
        self.commit()
        self.assertEqual(self.git('push', 'origin', 'main', check=False).returncode, 0)
        self.assertFalse((self.box / 'executed').exists())

    def test_nonexecutable_existing_hook_remains_ignored(self):
        hook = self.repo / '.git/hooks/pre-push'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o644)
        self.assertEqual(self.install().returncode, 0)
        self.write('readme.md', 'change\n')
        self.commit()
        self.assertEqual(self.git('push', 'origin', 'main', check=False).returncode, 0)

    def test_malformed_policy_shape_is_incomplete_not_a_violation(self):
        self.assertEqual(self.install().returncode, 0)
        self.extension.write_text('[]')
        self.write('readme.md', 'change\n')
        self.commit()
        result = self.git('push', 'origin', 'main', check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('incomplete', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_new_branch_uses_remote_default_instead_of_assuming_main(self):
        self.git('branch', '-m', 'main', 'master')
        self.large()
        self.git('push', 'origin', 'master')
        self.git('push', 'origin', ':main')
        self.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master')
        self.assertEqual(self.install().returncode, 0)
        self.git('checkout', '-qb', 'topic')
        self.write('readme.md', 'change\n')
        self.commit()
        result = self.git('push', 'origin', 'topic', check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
