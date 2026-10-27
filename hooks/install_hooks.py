#!/usr/bin/env python3
"""install_hooks.py: register hooks/guard.py with Claude Code, Codex and Cursor.

Called by install.sh. Removes any earlier guard entry, adds the current ones and
leaves every other hook (termic, project hooks) as it was. A config that would
change is copied to ~/.agents/skills-backup/<stamp>/ first; an unchanged one is
not rewritten. Symlinked configs (Claude B shares ~/.claude/settings.json) are
written through the link.
"""
import json
import os
import shlex
import shutil
import sys
import time

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


def main():
    stamp = sys.argv[1] if len(sys.argv) > 1 else time.strftime("%Y%m%d%H%M%S")
    for path, plan in PLANS.items():
        merge(path, plan, stamp)
    print("Codex runs a new hook only after you trust it: open codex, run /hooks and trust the guard entries.")


if __name__ == "__main__":
    main()
