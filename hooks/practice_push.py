"""Check pushed branch contents without changing the checkout or its index."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile


def git(repo, *args, env=None, data=None):
    return subprocess.run(["git", "-C", str(repo), *args], input=data,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, env=env).stdout


def incomplete(reason):
    print("Practice check incomplete: " + reason + "; push is not blocked.", file=sys.stderr)


@contextmanager
def snapshot(repo, head, base, extension, shared):
    with tempfile.TemporaryDirectory(prefix="practice-push-") as directory:
        root = Path(directory)
        env = os.environ.copy()
        env.update(GIT_DIR=git(repo, "rev-parse", "--absolute-git-dir").decode().strip(),
                   GIT_WORK_TREE=str(root), GIT_INDEX_FILE=str(root / ".practice-index"))
        git(repo, "read-tree", head, env=env)
        names = git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
                    "--name-only", "--diff-filter=ACMR", "-z", base, head).split(b"\0")
        private = runpy.run_path(str(shared / "skills/merge-safe-prs/scripts/secret_patterns.py"))["PATH_RE"]
        names = [name for name in names if name and not private.search(os.fsdecode(name))]
        if names:
            git(root, "checkout-index", "--force", "-z", "--stdin", env=env, data=b"\0".join(names) + b"\0")
        config = load_policy(extension)
        # This fast gate never executes repo-provided commands.
        config.pop("hook", None)
        policy = root / ".practice-policy"
        policy.mkdir()
        # Keep trusted policy support data separate from the pushed source files.
        for key, value in config.get("length_policy", {}).items():
            if key not in {"legacy", "exemptions_source"}:
                continue
            source = repo / value
            safe_policy(source)
            if not source.resolve().is_relative_to(repo.resolve()):
                raise ValueError("unsafe policy source")
            destination = policy / (key + "-" + source.name)
            shutil.copyfile(source, destination)
            config["length_policy"][key] = str(destination.relative_to(root))
        adopted = policy / "extension.json"
        adopted.write_text(json.dumps(config))
        yield root, env, adopted


def check_range(repo, base, head, shared, extension):
    with snapshot(repo, head, base, extension, shared) as (root, env, adopted):
        result = subprocess.run(["python3", str(shared / "scripts/check-practices"),
            "--repo", str(root), "--mode", "diff", "--base", base, "--extension", str(adopted)],
            env=env, text=True, capture_output=True)
        if result.returncode not in {0, 1}:
            incomplete("shared checker could not complete")
            return 0
        report = json.loads(result.stdout)
        known_rules = {rule["id"] for rule in json.loads((shared / "rules/catalogue.json").read_text())["rules"]}
        for finding in report["findings"]:
            # Do not relay source or repo-controlled evidence strings.
            rule = finding["rule_id"]
            if rule in known_rules:
                print("Practice violation: " + rule, file=sys.stderr)
            else:
                print("Practice violation: repo extension rule (details withheld)", file=sys.stderr)
        return 1 if report["violation_count"] else 0


def safe_policy(path):
    """Reject private paths and symlinked files before any policy read."""
    key_path = runpy.run_path(str(Path(__file__).with_name("guard.py")))["key_path"]
    absolute = Path(os.path.abspath(path))
    if key_path(str(absolute)) or key_path(str(absolute.resolve())) or absolute.is_symlink():
        raise ValueError("private or symlinked policy path")


def load_policy(path):
    safe_policy(path)
    config = json.loads(path.read_text())
    if not isinstance(config, dict) or config.get("version") != 1:
        raise ValueError("Invalid extension")
    length = config.get("length_policy", {})
    if not isinstance(length, dict) or any(not isinstance(length[k], str) for k in ("legacy", "exemptions_source") if k in length):
        raise ValueError("Invalid length policy")
    return config


def main():
    safe_policy(Path.cwd())
    repo = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").decode().strip())
    shared = Path(__file__).resolve().parents[1]
    extension = Path(git(repo, "config", "--get", "agentSkills.practiceExtension").decode().strip())
    remote = sys.argv[1] if len(sys.argv) > 1 else "origin"
    default = f"refs/remotes/{remote}/HEAD"
    try:
        git(repo, "rev-parse", "--verify", "--end-of-options", default + "^{commit}")
    except subprocess.CalledProcessError:
        default = f"refs/remotes/{remote}/main"
    failed = 0
    for line in sys.stdin:
        fields = line.split()
        if len(fields) != 4:
            incomplete("malformed ref input")
            continue
        local_ref, head, remote_ref, base = fields
        if set(head) == {"0"} or local_ref.startswith("refs/tags/") or not remote_ref.startswith("refs/heads/"):
            continue
        if not (shared / "scripts/check-practices").is_file():
            incomplete("installed shared checker unavailable")
            continue
        try:
            head = git(repo, "rev-parse", "--verify", "--end-of-options", head + "^{commit}").decode().strip()
            if set(base) == {"0"}:
                try:
                    base = git(repo, "merge-base", default, head).decode().strip()
                except subprocess.CalledProcessError:
                    # An orphan has no common base. These unreferenced objects
                    # represent an empty baseline and never change a branch HEAD.
                    tree = git(repo, "hash-object", "-t", "tree", "-w", "--stdin", data=b"").decode().strip()
                    identity = "Practice check <practice@example.invalid> 0 +0000"
                    commit = f"tree {tree}\nauthor {identity}\ncommitter {identity}\n\nEmpty practice baseline.\n"
                    base = git(repo, "hash-object", "-t", "commit", "-w", "--stdin", data=commit.encode()).decode().strip()
            else:
                try:
                    git(repo, "cat-file", "-e", base + "^{commit}")
                except subprocess.CalledProcessError:
                    if len(sys.argv) < 2:
                        raise ValueError("remote object unavailable")
                    raise ValueError("remote base object unavailable; fetch it before checking")
            failed |= check_range(repo, base, head, shared, extension)
        except (OSError, ValueError, subprocess.SubprocessError, KeyError):
            incomplete("ref, base or policy could not be resolved")
    return failed


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError):
        incomplete("repository or policy unavailable")
