#!/usr/bin/env python3
"""install_hooks.py: register hooks/guard.py with Claude Code, Codex and Cursor.

Called by install.sh. Removes any earlier guard entry, adds the current ones and
leaves every other hook (termic, project hooks) as it was. A config that would
change is copied to ~/.agents/skills-backup/<stamp>/ first; an unchanged one is
not rewritten. Symlinked configs (Claude B shares ~/.claude/settings.json) are
written through the link.
"""
import argparse
import json
import os
import shlex
import shutil
import sys
import time
import subprocess
from pathlib import Path

HOME = os.path.expanduser("~")
CMD = "python3 -I " + shlex.quote(f"{HOME}/.agents/hooks/guard.py")
MARK = "agents/hooks/guard.py"


def claude_like(tool, matchers):
    out = {}
    for event, (matcher, timeout) in matchers.items():
        group = {"hooks": [{"type": "command", "command": f"{CMD} {tool}", "timeout": timeout}]}
        if matcher:
            group = {"matcher": matcher, **group}
        out[event] = [group]
    return out


PLANS = {
    "~/.claude/settings.json": claude_like("claude", {
        "SessionStart": (None, 15),
        "PreToolUse": ("Bash|Read|Grep|Glob|AskUserQuestion", 150),
        "PostToolUse": ("Bash", 15),
        "Stop": (None, 45),
    }),
    # Codex reads no matcher here: the guard ignores tools it has no rule for.
    "~/.codex/hooks.json": claude_like("codex", {
        "SessionStart": (None, 15), "PreToolUse": (None, 150), "PostToolUse": (None, 15), "Stop": (None, 45),
    }),
    "~/.cursor/hooks.json": {
        "sessionStart": [{"command": f"{CMD} cursor"}],
        "preToolUse": [{"command": f"{CMD} cursor"}],
        "beforeShellExecution": [{"command": f"{CMD} cursor"}],
        "beforeReadFile": [{"command": f"{CMD} cursor"}],
        "postToolUse": [{"command": f"{CMD} cursor"}],
        "stop": [{"command": f"{CMD} cursor"}],
    },
}


def ours(entry):
    cmds = [entry.get("command", "")] + [h.get("command", "") for h in entry.get("hooks", [])]
    return any(MARK in c for c in cmds)


def merge(path, plan, stamp):
    p = os.path.expanduser(path)
    try:
        with open(p) as fh:
            data = json.load(fh)
    except FileNotFoundError:
        data = {"version": 1} if "cursor" in path else {}
    before = json.dumps(data, sort_keys=True)
    hooks = data.setdefault("hooks", {})
    for event in list(hooks):
        kept = []
        for e in hooks[event]:
            if MARK in e.get("command", ""):
                continue  # a Cursor-style entry that is the guard itself
            if "hooks" in e:  # a Claude/Codex group: drop only the guard's commands, keep siblings
                e = {**e, "hooks": [h for h in e["hooks"] if MARK not in h.get("command", "")]}
                if not e["hooks"]:
                    continue
            kept.append(e)
        hooks[event] = kept
        if not hooks[event]:
            del hooks[event]
    for event, entries in plan.items():
        hooks.setdefault(event, []).extend(entries)
    if json.dumps(data, sort_keys=True) == before:
        print(f"hooks unchanged: {path}")
        return
    if os.path.exists(p):
        bak = os.path.join(HOME, ".agents", "skills-backup", stamp, path.replace("~/", "").lstrip(".").replace("/", "-"))
        os.makedirs(os.path.dirname(bak), exist_ok=True)
        shutil.copyfile(p, bak)
        print(f"backed up: {bak}")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    print(f"hooks installed: {path}")


def install_practice(repo, extension):
    # Opt-in is local to this repository, independent of agent hook support.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import practice_push
    practice_push.safe_policy(repo)
    repo = Path(repo).resolve()
    extension = Path(os.path.abspath(extension))
    practice_push.load_policy(extension)
    hook_path = subprocess.run(["git", "rev-parse", "--git-path", "hooks/pre-push"],
                               cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
    hook = Path(hook_path) if os.path.isabs(hook_path) else repo / hook_path
    practice_push.safe_policy(hook)
    hook.parent.mkdir(parents=True, exist_ok=True)
    marker = "# agent-skills practice pre-push"
    original = hook.with_name("pre-push.agent-skills-original")
    if hook.exists() and marker not in hook.read_text():
        if original.exists():
            raise ValueError("Original hook backup already exists; inspect it before installing")
        shutil.copy2(hook, original)
    runner = Path(__file__).resolve().with_name("practice_push.py")
    # Both hooks receive the complete original ref stream. Preserve old failures.
    body = "#!/bin/sh\n" + marker + "\n"
    body += """refs=$(mktemp) || exit 1
trap 'rm -f "$refs"' EXIT HUP INT TERM
cat > "$refs"
"""
    if original.exists() and os.access(original, os.X_OK):
        body += shlex.quote(str(original)) + ' "$@" < "$refs" || exit $?\n'
    body += 'exec_status=0\n' + shlex.quote(sys.executable) + ' -I ' + shlex.quote(str(runner)) + ' "$@" < "$refs" || exec_status=$?\nexit "$exec_status"\n'
    hook.write_text(body)
    hook.chmod(0o755)
    subprocess.run(["git", "config", "--local", "agentSkills.practiceExtension", str(extension)], cwd=repo, check=True)
    print("Practice pre-push installed (opt-in); existing hook backed up and chained.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stamp", nargs="?")
    parser.add_argument("--practice-repo")
    parser.add_argument("--extension")
    args = parser.parse_args()
    if args.practice_repo or args.extension:
        if not (args.practice_repo and args.extension):
            parser.error("--practice-repo and --extension are required together")
        try:
            install_practice(args.practice_repo, args.extension)
        except (OSError, ValueError, subprocess.SubprocessError):
            # Paths and config content may be sensitive. Never echo them.
            print("Practice hook installation refused: private/unsafe path, invalid policy or Git failure.", file=sys.stderr)
            return 1
        return 0
    stamp = args.stamp or time.strftime("%Y%m%d%H%M%S")
    for path, plan in PLANS.items():
        merge(path, plan, stamp)
    print("Codex runs a new hook only after you trust it: open codex, run /hooks and trust the guard entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
