"""Behaviour tests for pr-state.py and scan-secrets.py.
Run: python3 -I -m unittest discover -s ~/.agents/skills/merge-safe-prs/scripts/tests
pr-state is driven through main() with a fake `gh`; scan-secrets runs as a
command against throwaway git repos, so both are tested through their public
interfaces (exit code and printed verdict)."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), os.path.join(SCRIPTS, name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


REQ = ["CI / tests", "Review / gate"]


def world(**over):
    """A PR that is fully green; tests break one thing at a time."""
    w = {
        "view": {"number": 7, "url": "https://github.com/o/r/pull/7", "title": "t", "state": "OPEN",
                 "isDraft": False, "baseRefName": "main", "headRefName": "f", "headRefOid": "a" * 40,
                 "mergeable": "MERGEABLE", "mergeStateStatus": "CLEAN", "reviewDecision": "",
                 "labels": [], "author": {"login": "x"}},
        "default": "main",
        "rules": {"main": [{"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": c} for c in REQ]}}]},
        "runs": [{"id": i, "name": c, "status": "completed", "conclusion": "success", "started_at": "2026-01-01", "app": {"id": 1}} for i, c in enumerate(REQ)],
        "statuses": [],
        "threads": [[]],
    }
    w.update(over)
    return w


def fake_gh(w):
    pages = iter(w["threads"])

    def gh(args, ok_missing=False):
        if args[:2] == ["pr", "view"]:
            return w["view"]
        path = next((a for a in args if a.startswith("repos/")), "")
        if args[:2] == ["api", "graphql"]:
            nodes = next(pages)
            more = True
            try:
                peek = w["threads"].index(nodes) < len(w["threads"]) - 1
                more = peek
            except ValueError:
                more = False
            return {"data": {"repository": {"pullRequest": {"reviewThreads": {
                "pageInfo": {"hasNextPage": more, "endCursor": "c"}, "nodes": nodes}}}}}
        if "/rules/branches/" in path:
            return w["rules"].get(path.rsplit("/", 1)[1], [])
        if "/protection/" in path:
            if w.get("protection_error"):
                raise RuntimeError("gh api: HTTP 404 Not Found")
            return w.get("protection")
        if path.endswith("/check-runs?per_page=100"):
            return [{"check_runs": w["merge_runs"] if "/commits/mmm" in path else w["runs"]}]
        if path.endswith("/statuses?per_page=100"):
            return [[] if "/commits/mmm" in path else w["statuses"]]
        if path == "repos/o/r":
            return {"d": w["default"]}
        if path == "repos/o/r/pulls/7":
            return {"m": w.get("merge_sha")}
        raise AssertionError(f"unexpected gh call {args}")
    return gh


class PrStateTest(unittest.TestCase):
    def run_gate(self, w, *extra):
        mod = load("pr-state.py")
        mod.gh = fake_gh(w)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = mod.main(["7", "--json", *extra])
        return rc, json.loads(out.getvalue())

    def test_green_pr_is_ready(self):
        rc, r = self.run_gate(world())
        self.assertEqual((rc, r["ready"]), (0, True))

    def test_missing_skipped_or_failed_required_check_blocks(self):
        for runs in ([], [dict(world()["runs"][0], conclusion="skipped"), world()["runs"][1]],
                     [dict(world()["runs"][0], conclusion="failure"), world()["runs"][1]],
                     [dict(world()["runs"][0], status="in_progress", conclusion=None), world()["runs"][1]]):
            rc, r = self.run_gate(world(runs=runs))
            self.assertEqual(rc, 1, runs)

    def test_red_status_beside_green_check_run_blocks(self):
        rc, r = self.run_gate(world(statuses=[{"context": "CI / tests", "state": "failure"}]))
        self.assertEqual(rc, 1)

    def test_failing_or_pending_non_required_check_blocks(self):
        for st in ("failure", "in_progress"):
            runs = world()["runs"] + [{"id": 9, "name": "Advisory reviewer", "status": "completed" if st == "failure" else st, "conclusion": "failure" if st == "failure" else None, "started_at": "x", "app": {"id": 1}}]
            self.assertEqual(self.run_gate(world(runs=runs))[0], 1, st)

    def test_unresolved_thread_on_a_later_page_blocks_without_printing_its_text(self):
        resolved = [{"isResolved": True, "isOutdated": False, "comments": {"nodes": []}}] * 3
        open_one = [{"isResolved": False, "isOutdated": False, "comments": {"nodes": [{"author": {"login": "r"}, "path": "a.py", "body": "rotate ghp_SECRETSECRET"}]}}]
        rc, r = self.run_gate(world(threads=[resolved, open_one]))
        self.assertEqual((rc, len(r["threads"])), (1, 1))
        self.assertNotIn("SECRET", json.dumps(r))

    def test_thread_on_a_key_path_does_not_print_the_path(self):
        open_one = [{"isResolved": False, "isOutdated": False, "comments": {"nodes": [{"author": {"login": "r"}, "path": ".private_keys/staging.pem"}]}}]
        rc, r = self.run_gate(world(threads=[open_one]))
        self.assertEqual(rc, 1)
        self.assertNotIn("staging", json.dumps(r))

    def test_required_check_pinned_to_an_app_needs_that_app(self):
        w = world()
        w["rules"]["main"] = [{"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": "CI / tests", "integration_id": 42}, {"context": "Review / gate"}]}}]
        self.assertEqual(self.run_gate(w)[0], 1)  # CI / tests came from app 1, not 42
        w["runs"] = [dict(w["runs"][0], app={"id": 42}), w["runs"][1]]
        self.assertEqual(self.run_gate(w)[0], 0)

    def test_pinned_app_is_checked_on_the_test_merge_commit_too(self):
        w = world(merge_sha="mmm")
        w["rules"]["main"] = [{"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": "CI / tests", "integration_id": 42}, {"context": "Review / gate"}]}}]
        w["runs"] = [dict(world()["runs"][0], app={"id": 42}), world()["runs"][1]]
        w["merge_runs"] = [dict(world()["runs"][0], app={"id": 99}), world()["runs"][1]]
        self.assertEqual(self.run_gate(w)[0], 1)

    def test_classic_protection_contexts_and_any_app(self):
        w = world(rules={"main": []}, protection={"contexts": ["CI / tests"], "checks": [{"context": "Review / gate", "app_id": -1}]})
        self.assertEqual(self.run_gate(w)[0], 0)  # both green, app -1 = any app
        w["runs"] = [world()["runs"][1]]           # CI / tests missing
        self.assertEqual(self.run_gate(w)[0], 1)

    def test_unreadable_protection_is_an_error_not_unprotected(self):
        mod = load("pr-state.py")
        mod.gh = fake_gh(world(protection_error=True))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            try:
                rc = mod.main(["7", "--json"])
            except RuntimeError:
                rc = 2
        self.assertNotEqual(rc, 0)

    def test_credential_in_a_title_or_check_name_is_withheld(self):
        tok = "ghp_" + "Z" * 36
        w = world(view=dict(world()["view"], title=f"rotate {tok}"))
        w["runs"] = w["runs"] + [{"id": 9, "name": f"deploy {tok}", "status": "completed", "conclusion": "success", "started_at": "x", "app": {"id": 1}}]
        rc, r = self.run_gate(w)
        self.assertNotIn(tok, json.dumps(r))

    def test_skipped_required_check_on_test_merge_commit_blocks(self):
        w = world(merge_sha="mmm")
        w["merge_runs"] = [dict(world()["runs"][0], conclusion="skipped"), world()["runs"][1]]
        self.assertEqual(self.run_gate(w)[0], 1)

    def test_github_merge_states_block(self):
        for state in ("BLOCKED", "BEHIND", "DIRTY", "UNKNOWN", "DRAFT"):
            rc, _ = self.run_gate(world(view=dict(world()["view"], mergeStateStatus=state)))
            self.assertEqual(rc, 1, state)
        rc, _ = self.run_gate(world(view=dict(world()["view"], mergeStateStatus="UNSTABLE")))
        self.assertEqual(rc, 1, "UNSTABLE with nothing red visible")

    def test_no_checks_at_all_is_not_ready(self):
        w = world(runs=[], rules={"main": []})
        self.assertEqual(self.run_gate(w)[0], 1)

    def test_failure_on_the_test_merge_commit_blocks(self):
        w = world(merge_sha="mmm")
        w["merge_runs"] = [dict(world()["runs"][0], conclusion="failure"), world()["runs"][1]]
        self.assertEqual(self.run_gate(w)[0], 1)
        w["merge_runs"] = world()["runs"]
        self.assertEqual(self.run_gate(w)[0], 0)

    def test_newer_queued_rerun_beats_older_success(self):
        w = world()
        w["runs"] = w["runs"] + [{"id": 99, "name": "CI / tests", "status": "queued", "conclusion": None, "started_at": None, "app": {"id": 1}}]
        self.assertEqual(self.run_gate(w)[0], 1)

    def test_stacked_pr_is_held_to_union_with_default_branch(self):
        w = world(view=dict(world()["view"], baseRefName="feature"))
        w["rules"]["feature"] = [{"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": "CI / tests"}]}}]
        w["runs"] = [world()["runs"][0]]  # main's "Review / gate" never ran
        rc, r = self.run_gate(w)
        self.assertEqual(rc, 1)
        self.assertIn("Review / gate", r["required"])


class ScanSecretsTest(unittest.TestCase):
    SCAN = os.path.join(SCRIPTS, "scan-secrets.py")

    def repo(self, files, message="change"):
        d = tempfile.mkdtemp()
        g = ["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run(["git", "init", "-q", d], check=True)
        subprocess.run(g + ["commit", "-q", "--allow-empty", "-m", "base"], check=True)
        for name, data in files.items():
            path = os.path.join(d, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(data if isinstance(data, bytes) else data.encode())
        subprocess.run(g + ["add", "-A"], check=True)
        subprocess.run(g + ["commit", "-q", "-m", message], check=True)
        return d

    def scan(self, d, *args):
        p = subprocess.run([sys.executable, "-I", self.SCAN, *args], cwd=d, capture_output=True, text=True)
        return p.returncode, p.stdout

    def test_flags_key_material_without_printing_it(self):
        token = "ghp_" + "Z" * 36
        d = self.repo({"src/config.ts": f'export const t = "{token}"\n'})
        rc, out = self.scan(d, "HEAD~1")
        self.assertEqual(rc, 1)
        self.assertNotIn(token, out)
        self.assertNotIn("config.ts", out)

    def test_flags_credential_files_by_name_including_binary(self):
        for name, data in ((".envrc", "export X=1\n"), ("keys/AuthKey.p12", b"\x00\x01\x02binary"),
                           (".private_keys/device", "x\n"), ("deploy/firebase-adminsdk-abc.json", "{}\n")):
            d = self.repo({name: data})
            self.assertEqual(self.scan(d, "HEAD~1")[0], 1, name)

    def test_flags_env_style_secret_and_secret_in_commit_message(self):
        d = self.repo({"app.env.txt": "AWS_SECRET_ACCESS_KEY=Qw8r7TzP1xY2vB3nM4kL5jH6\n"})
        self.assertEqual(self.scan(d, "HEAD~1")[0], 1)
        d = self.repo({"a.txt": "ok\n"}, message="rotate key sk_live_" + "A" * 24)
        self.assertEqual(self.scan(d, "HEAD~1")[0], 1)

    def test_ordinary_code_is_clean(self):
        d = self.repo({"src/a.ts": "const apiKey = process.env.API_KEY\nconst password = z.string().min(12)\n"
                                   "const TOKEN_STORAGE = 'auth_token'\nconst secretRef = props.secretRef\n"})
        rc, out = self.scan(d, "HEAD~1")
        self.assertEqual((rc, out.strip()), (0, "clean"))

    def test_regex_literals_are_not_secrets(self):
        d = self.repo({"src/t.ts": "const TOKEN = /^[A-Za-z0-9_:.~%+/=-]+$/;\n"})
        self.assertEqual(self.scan(d, "HEAD~1")[0], 0)

    def test_allow_needs_reason_and_exact_path_for_credential_files(self):
        d = self.repo({"tests/fixtures/a.json": '{"property_token": "ChZDSWb3x9QkLmN2pR7sT4vW8yZ1"}\n',
                       "apps/web/.env.development": "VITE_PUBLIC=1\n"})
        self.assertEqual(self.scan(d, "--allow", "tests/fixtures/*", "HEAD~1")[0], 2)
        self.assertEqual(self.scan(d, "--allow", "tests/fixtures/*=public provider ids", "HEAD~1")[0], 1)
        rc, out = self.scan(d, "--allow", "tests/fixtures/*=public provider ids", "--allow", "*/.env.development=public", "HEAD~1")
        self.assertEqual(rc, 1, "a wildcard must not allow a credential-named file")
        rc, out = self.scan(d, "--allow", "tests/fixtures/*=public provider ids", "--allow", "apps/web/.env.development=public VITE_ keys only", "HEAD~1")
        self.assertEqual(rc, 0)
        self.assertIn("allowed: tests/fixtures/* (public provider ids)", out)

    def diff_scan(self, text, *extra):
        d = tempfile.mkdtemp(); path = os.path.join(d, "x.diff")
        with open(path, "w") as fh:
            fh.write(text)
        return self.scan(d, *extra, "--diff", path)

    def test_diff_mode_scans_removed_and_context_lines(self):
        key = "sk_live_" + "Q7w" * 9
        for line in (f'-const STRIPE = "{key}"', f' const STRIPE = "{key}"'):
            rc, out = self.diff_scan(f"diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n{line}\n")
            self.assertEqual(rc, 1, line[:1])
            self.assertNotIn(key, out)

    def test_placeholder_elsewhere_on_the_line_does_not_hide_a_secret(self):
        for line in ('const h: Record<string, string> = { API_KEY: "Qw8r7TzP1xY2vB3nM4kL5jH6" }',
                     'API_SECRET = "Qw8r7TzP1xY2vB3nM4kL5jH6" // see process.env.FOO example'):
            rc, _ = self.diff_scan(f"diff --git a/a.ts b/a.ts\n+++ b/a.ts\n+{line}\n")
            self.assertEqual(rc, 1, line)

    def test_every_assignment_and_fallback_literal_on_a_line_is_checked(self):
        for line in ('example_token = "placeholder12345"; api_key = "Qw8r7TzP1xY2vB3nM4kL5jH6"',
                     'const apiKey = process.env.API_KEY || "Qw8r7TzP1xY2vB3nM4kL5jH6"'):
            rc, _ = self.diff_scan(f"diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+{line}\n")
            self.assertEqual(rc, 1, line)

    def test_quoted_values_and_placeholder_words_inside_a_value(self):
        for line in ('DB_PASSWORD="H0rse#BatteryStaple99;x"', 'DB_PASSWORD="H0rseBattery$taple99xx"',
                     'API_KEY="prod-example-key-9f3a2b1c8d7e"'):
            rc, _ = self.diff_scan(f"diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+{line}\n")
            self.assertEqual(rc, 1, line)
        for line in ('API_KEY="${API_KEY}"', 'token: "<your-token-here-123456>"', 'password: "At least 12 characters"',
                     'SECRET = "example-secret-value-1234"'):
            rc, _ = self.diff_scan(f"diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+{line}\n")
            self.assertEqual(rc, 0, line)

    def test_dummy_prefix_does_not_hide_a_high_entropy_value(self):
        rc, _ = self.diff_scan('diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+API_KEY = "test-9f3a2b1c8d7eQw8r7TzP1xY2"\n')
        self.assertEqual(rc, 1)

    def test_symlinks_are_never_followed_and_risky_ones_are_flagged(self):
        d = self.repo({"a.txt": "ok\n"})
        os.symlink("docs/a.txt", os.path.join(d, "inside.txt"))  # stays in the repo
        os.makedirs(os.path.join(d, ".claude/skills"))
        os.symlink("../../.agents/skills/x", os.path.join(d, ".claude/skills/x"))  # .. but still inside
        self.assertEqual(self.scan(d, "--worktree")[0], 0)
        target = os.path.join(tempfile.mkdtemp(), "notes.txt")
        with open(target, "w") as fh:
            fh.write("TOKEN=ghp_" + "Z" * 36 + "\n")
        os.symlink(target, os.path.join(d, "innocent.txt"))
        rc, out = self.scan(d, "--worktree")
        self.assertEqual(rc, 1)
        self.assertNotIn("ghp_", out)
        rc, _ = self.diff_scan("diff --git a/notes.txt b/notes.txt\nnew file mode 120000\n--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+../../.ssh/id_ed25519\n\\ No newline at end of file\n")
        self.assertEqual(rc, 1)

    def test_retargeted_tracked_symlink_is_checked(self):
        rc, _ = self.diff_scan("diff --git a/docs/shared b/docs/shared\nindex 1a2b3c4..5d6e7f8 120000\n--- a/docs/shared\n+++ b/docs/shared\n@@ -1 +1 @@\n-../README.md\n+/Users/x/.ssh/id_ed25519\n")
        self.assertEqual(rc, 1)

    def test_wildcard_allow_does_not_clear_a_risky_symlink(self):
        rc, _ = self.diff_scan("diff --git a/tests/fx/k b/tests/fx/k\nnew file mode 120000\n--- /dev/null\n+++ b/tests/fx/k\n@@ -0,0 +1 @@\n+/Users/x/keys/k\n", "--allow", "tests/*=fake ids")
        self.assertEqual(rc, 1)

    def test_fallbacks_are_judged_by_their_own_name(self):
        for line in ('token = "x"; apiKey = process.env.API_KEY || "CorrectHorseBatteryStaple"',
                     'const key = process.env.API_KEY || "Qw8r7TzP1xY2vB3nM4kL5jH6"',
                     'key = os.getenv("API_TOKEN", "Qw8r7TzP1xY2vB3nM4kL5jH6")'):
            rc, _ = self.diff_scan(f"diff --git a/a.py b/a.py\n@@ -0,0 +1 @@\n+{line}\n")
            self.assertEqual(rc, 1, line)

    def test_subscripted_assignments(self):
        for line in ('os.environ["AWS_SECRET_ACCESS_KEY"] = "Qw8r7TzP1xY2vB3nM4kL5jH6"', 'config["api_key"] = "CorrectHorseBatteryStaple"'):
            rc, _ = self.diff_scan(f"diff --git a/a.py b/a.py\n@@ -0,0 +1 @@\n+{line}\n")
            self.assertEqual(rc, 1, line)

    def test_removed_symlink_target_to_a_key_is_flagged_in_diff_mode(self):
        rc, _ = self.diff_scan("diff --git a/docs/shared b/docs/shared\nindex 1a2b3c4..5d6e7f8 120000\n--- a/docs/shared\n+++ b/docs/shared\n@@ -1 +1 @@\n-/Users/x/.ssh/id_ed25519\n+../README.md\n")
        self.assertEqual(rc, 1)

    def test_digit_free_fallback_literal_under_a_secret_name(self):
        rc, _ = self.diff_scan('diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+const apiKey = process.env.API_KEY || "CorrectHorseBatteryStaple"\n')
        self.assertEqual(rc, 1)

    def test_digit_free_secret_under_a_secret_name_but_not_a_token_constant(self):
        rc, _ = self.diff_scan('diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+API_KEY="CorrectHorseBatteryStaple"\n')
        self.assertEqual(rc, 1)
        rc, _ = self.diff_scan('diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+const tripActivityToken = "tripActivityTokenChannel"\n')
        self.assertEqual(rc, 0)
        for v in ("test-correcthorsebatterystaple99", "test_aBcDeFgHiJkLmNoPqRsT2024"):
            rc, _ = self.diff_scan(f'diff --git a/a.ts b/a.ts\n@@ -0,0 +1 @@\n+API_KEY="{v}"\n')
            self.assertEqual(rc, 1, v)

    def test_text_mode_flags_key_paths_and_allowances_hide_them(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "brief.md")
        with open(p, "w") as fh:
            fh.write("the key lives at ~/.private_keys/AuthKey_ABC.p8\n")
        rc, out = self.scan(d, "--text", p)
        self.assertEqual(rc, 1)
        self.assertNotIn("AuthKey", out)
        allow = os.path.join(d, "allow")
        with open(allow, "w") as fh:
            fh.write("keys/AuthKey.p8=reviewed\n")
        rc, out = self.scan(d, "--list-allow", allow)
        self.assertNotIn("AuthKey", out)

    def test_text_mode_for_briefs(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "brief.md")
        with open(p, "w") as fh:
            fh.write("please check the rotate of sk_live_" + "A" * 24 + "\n")
        self.assertEqual(self.scan(d, "--text", p)[0], 1)

    def test_removed_sql_comment_is_content_not_a_header(self):
        key = "sk_live_" + "Q7w" * 9
        rc, _ = self.diff_scan(f"diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1 +0,0 @@\n--- {key}\n")
        self.assertEqual(rc, 1)

    def test_a_top_folder_named_b_is_not_stripped(self):
        line = 'API_KEY = "Qw8r7TzP1xY2vB3nM4kL5jH6"'
        rc, _ = self.diff_scan(f"diff --git a/b/tests/real.ts b/b/tests/real.ts\n@@ -0,0 +1 @@\n+{line}\n", "--allow", "tests/*=fixtures")
        self.assertEqual(rc, 1)

    def test_explain_hides_every_key_file_name(self):
        for name in ("deploy/id_ed25519", "prod/credentials.json", "keys/AuthKey.p8"):
            rc, out = self.diff_scan(f"diff --git a/{name} b/{name}\n@@ -0,0 +1 @@\n+x\n", "--explain")
            self.assertEqual(rc, 1, name)
            self.assertNotIn(name.split("/")[-1], out)

    def test_worktree_mode_scans_staged_content_gone_from_disk(self):
        d = self.repo({"a.txt": "ok\n"})
        p = os.path.join(d, "config.sh")
        with open(p, "w") as fh:
            fh.write("TOKEN=ghp_" + "Z" * 36 + "\n")
        subprocess.run(["git", "-C", d, "add", "config.sh"], check=True)
        with open(p, "w") as fh:
            fh.write("TOKEN=\n")
        self.assertEqual(self.scan(d, "--worktree")[0], 1)

    def test_quoted_and_spaced_key_paths_are_caught_and_hidden_in_explain(self):
        for header in ('diff --git "a/Certs/caf\\303\\251.p12" "b/Certs/caf\\303\\251.p12"',
                       "diff --git a/Certificates/App Store.p12 b/Certificates/App Store.p12"):
            rc, out = self.diff_scan(f"{header}\nGIT binary patch\nliteral 3\nabc\n", "--explain")
            self.assertEqual(rc, 1, header)
            self.assertNotIn(".p12", out)
            self.assertIn("path hidden", out)

    def test_diff_mode_and_bad_ref_is_an_error_not_clean(self):
        d = self.repo({"a.txt": "ok\n"})
        self.assertEqual(self.scan(d, "no-such-ref")[0], 2)
        diff = os.path.join(d, "x.diff")
        with open(diff, "w") as fh:
            fh.write("diff --git a/.env b/.env\n+++ b/.env\n+A=1\n")
        self.assertEqual(self.scan(d, "--diff", diff)[0], 1)


if __name__ == "__main__":
    unittest.main()
