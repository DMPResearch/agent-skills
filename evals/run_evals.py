#!/usr/bin/env python3
"""run_evals.py: measure the skills and the hooks. On demand, never in CI.

  run_evals.py triggers  [--agents claude,codex,cursor] [--skills a,b] [--reps 3]
  run_evals.py scenarios [--agents claude,codex] [--only a,b] [--hooks off,on]
  common: [--claude-model claude-opus-5-5] [--jobs 3] [--out DIR] [--force]

triggers: does the skill load for prompts that need it, and stay out for near
misses? Prompts are in triggers/<skill>.json (skill-creator's format). Runs
read-only in a throwaway repo with the guard off, so only the skill
descriptions and the instruction files decide. Reports rates over --reps runs.

scenarios: does the agent behave right (scenarios.py)? Each runs twice: hooks
off measures the skill and the rules, hooks on measures what the guard adds.
Claude runs on the second account (CLAUDE_B_DIR, default ~/.claude-b) and only
with a fresh usage log showing headroom (USAGE_GUARD_LOG), unless --force.
Output: <out>/results.json and RESULTS.md (default /Volumes/DevBox/tmp/agent-evals/<stamp>).
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scenarios as SC  # noqa: E402

BIN = {n: shutil.which(n) for n in ("claude", "codex", "cursor-agent")}
CLAUDE_B = os.environ.get("CLAUDE_B_DIR", os.path.expanduser("~/.claude-b"))
GUARD_LOG = os.environ.get("USAGE_GUARD_LOG", "/Volumes/DevBox/tmp/usage-guard.log")


def headroom_ok():
    try:
        age = time.time() - os.path.getmtime(GUARD_LOG)
        last = open(GUARD_LOG).read().strip().splitlines()[-1]
        b = int(re.search(r"B=(\d+)%", last).group(1))
    except (OSError, IndexError, AttributeError, ValueError):
        return False, "no readable usage log"
    if age > 1200:
        return False, f"usage log is {int(age / 60)} min old"
    return b <= 60, f"Claude B at {b}%"


def clean_env(extra):
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    env.update(extra)
    return env


def stream(cmd, cwd, env, timeout, stop=None):
    """Run cmd in its own process group, collect stdout, stop early when
    stop(line) is true. Returns (text, hit, status): status is "ok", "timeout"
    or "exit N". Stopping kills the whole group, so shells the agent started
    cannot hold the pipe open."""
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, start_new_session=True)
    lines, hit, timed_out = [], False, threading.Event()

    def kill():
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def on_timeout():
        timed_out.set()
        kill()
    timer = threading.Timer(timeout, on_timeout)
    timer.start()
    try:
        for line in p.stdout:
            lines.append(line)
            if stop and stop(line):
                hit = True
                kill()
                break
    finally:
        timer.cancel()
        p.wait()
    status = "timeout" if timed_out.is_set() else ("ok" if hit or p.returncode == 0 else f"exit {p.returncode}")
    return "".join(lines), hit, status


def final_message(agent, text):
    last = ""
    for line in text.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if agent == "claude" and e.get("type") == "result":
            last = e.get("result") or last
        elif agent == "codex":
            item = e.get("item") or {}
            if item.get("type") == "agent_message":
                last = item.get("text") or last
        elif agent == "cursor" and e.get("type") == "result":
            last = e.get("result") or last
    return last


# ---------- triggers ----------

def trigger_box():
    box = tempfile.mkdtemp(prefix="eval-trig-")
    r, _ = SC.repo(box, {**SC.PY, "app/index.html": "<!doctype html><form><input name=email><button>Join</button></form>\n",
                         "app/style.css": "button { background: #37684f; color: white; }\n"},
                   dirty={"utils.py": SC.PY["utils.py"] + "\n\ndef slugify(s):\n    return '-'.join(s.lower().split())\n"})
    return r


def trigger_cmd(agent, query, model, repo):
    if agent == "claude":
        return [BIN["claude"], "-p", "--model", model, "--output-format", "stream-json", "--verbose",
                "--allowedTools", "Skill,Read,Grep,Glob", "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
                "--max-turns", "6", query], {"CLAUDE_CONFIG_DIR": CLAUDE_B}
    if agent == "codex":
        return [BIN["codex"], "exec", "--json", "-c", "mcp_servers={}", "--sandbox", "read-only",
                "--skip-git-repo-check", "-C", repo, "--", query], {}
    return [BIN["cursor-agent"], "-p", "--mode", "plan", "--trust", "--model", "grok-4.7-high",
            "--output-format", "stream-json", "--workspace", repo, query], {}


def loaded(skill):
    """A Skill tool call, or a tool reading the skill's SKILL.md (Codex and
    Cursor load skills by reading the file). A mention in a message is not a load."""
    pat = re.compile(r'"skill"\s*:\s*"' + re.escape(skill) + r'"|"(?:file_path|path|command|cmd)"\s*:\s*"[^"]*'
                     + re.escape(skill) + r"/SKILL\.md")
    return lambda line: bool(pat.search(line))


def run_triggers(a, out):
    repo = trigger_box()
    jobs = []
    for skill in a.skills:
        for case in json.load(open(os.path.join(HERE, "triggers", skill + ".json"))):
            for agent in a.agents:
                for rep in range(a.reps):
                    jobs.append((skill, case, agent, rep))

    def one(job):
        skill, case, agent, rep = job
        cmd, extra = trigger_cmd(agent, case["query"], a.claude_model, repo)
        t0 = time.time()
        text, hit, status = stream(cmd, repo, clean_env({**extra, "AGENT_GUARD_OFF": "1"}), 240, loaded(skill))
        hit = hit or loaded(skill)(text)
        ok = hit == case["should_trigger"] and (hit or status == "ok")  # a crashed run is not a clean "did not load"
        return {"skill": skill, "agent": agent, "rep": rep, "query": case["query"], "status": status,
                "should": case["should_trigger"], "loaded": hit, "ok": ok, "seconds": round(time.time() - t0)}

    with ThreadPoolExecutor(a.jobs) as ex:
        results = list(ex.map(one, jobs))
    rows = ["| Skill | Agent | Should load: rate | Should not: false-load rate |", "| --- | --- | --- | --- |"]
    for skill in a.skills:
        for agent in a.agents:
            r = [x for x in results if x["skill"] == skill and x["agent"] == agent]
            pos = [x for x in r if x["should"]]
            neg = [x for x in r if not x["should"]]
            rows.append(f"| {skill} | {agent} | {sum(x['loaded'] for x in pos)}/{len(pos)} | "
                        f"{sum(x['loaded'] for x in neg)}/{len(neg)} |")
    misses = [f"- {x['skill']} / {x['agent']}: {'missed' if x['should'] else 'loaded on'} \"{x['query']}\""
              for x in results if not x["ok"]]
    shutil.rmtree(os.path.dirname(repo), ignore_errors=True)
    return results, "## Trigger evals\n\n" + "\n".join(rows) + "\n\n" + ("\n".join(misses) or "No misses.") + "\n"


# ---------- scenarios ----------

def scenario_cmd(agent, prompt, model, box, repo, hooks):
    if agent == "claude":
        return [BIN["claude"], "-p", "--model", model, "--output-format", "stream-json", "--verbose",
                "--permission-mode", "acceptEdits", "--allowedTools", "Bash,Read,Edit,Write,Glob,Grep,Skill",
                "--max-turns", "60", prompt], {"CLAUDE_CONFIG_DIR": CLAUDE_B}
    # workspace-write keeps .git read-only, and committing is part of what is
    # measured, so Codex gets full access inside its throwaway box.
    return ([BIN["codex"], "exec", "--json", "-c", "mcp_servers={}", "--sandbox", "danger-full-access",
             "--skip-git-repo-check", "-C", repo]
            + (["--dangerously-bypass-hook-trust"] if hooks == "on" else []) + ["--", prompt]), {}


def run_scenarios(a, out):
    jobs = [(name, agent, hooks) for name in a.only for agent in a.agents for hooks in a.hooks]

    def one(job):
        name, agent, hooks = job
        setup, grade = SC.SCENARIOS[name]
        box = os.path.join(out, "boxes", f"{name}-{agent}-{hooks}")
        logs = os.path.join(box, "logs")
        os.makedirs(logs)
        prompt, world = setup(box, logs)
        repo = os.path.join(box, "repo")
        env = {"PATH": os.path.join(HERE, "fakes") + os.pathsep + os.environ["PATH"],
               "GH_CONFIG_DIR": os.path.join(box, "ghcfg"), "AGENT_GUARD_STATE": os.path.join(box, "guard-state"),
               "FAKE_GH_LOG": os.path.join(logs, "gh.log"), "FAKE_CRITIC_LOG": os.path.join(logs, "critics.log"),
               "TMPDIR": os.path.join(box, "tmp")}
        os.makedirs(env["TMPDIR"])
        # Codex runs commands in a login shell, and a profile that prepends
        # ~/.local/bin would put the real CLIs back in front of the fakes.
        zdot = os.path.join(box, "zdot")
        os.makedirs(zdot)
        fakes = os.path.join(HERE, "fakes")
        for f in (".zshenv", ".zprofile", ".zshrc", ".zlogin"):
            with open(os.path.join(zdot, f), "w") as fh:
                fh.write(f'[ -f "$HOME/{f}" ] && ZDOTDIR="$HOME" source "$HOME/{f}"\nexport PATH="{fakes}:$PATH"\n'
                         # a profile may export credentials again: clear them after it
                         'unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN SSH_AUTH_SOCK\n'
                         f'export GIT_CONFIG_GLOBAL="{os.path.join(box, "gitconfig")}" GIT_CONFIG_NOSYSTEM=1\n')
        env["ZDOTDIR"] = zdot
        # Nothing in the box may act on GitHub as the owner: no gh login (empty
        # GH_CONFIG_DIR), no token variables, and a git config without the
        # keychain credential helper. Network itself is not blocked.
        gitcfg = os.path.join(box, "gitconfig")
        with open(gitcfg, "w") as fh:
            fh.write("[user]\n\tname = Eval\n\temail = eval@example.com\n[credential]\n\thelper =\n")
        env.update({"GIT_CONFIG_GLOBAL": gitcfg, "GIT_CONFIG_NOSYSTEM": "1", "GH_TOKEN": "", "GITHUB_TOKEN": "",
                    "GH_ENTERPRISE_TOKEN": "", "GIT_TERMINAL_PROMPT": "0", "SSH_AUTH_SOCK": "",
                    "GIT_SSH_COMMAND": "ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityFile=/dev/null -o BatchMode=yes"})
        if world:
            env["FAKE_GH_WORLD"] = os.path.join(box, "world.json")
            json.dump(world, open(env["FAKE_GH_WORLD"], "w"))
        env["AGENT_GUARD_OFF"] = "1" if hooks == "off" else "0"
        cmd, extra = scenario_cmd(agent, prompt, a.claude_model, box, repo, hooks)
        t0 = time.time()
        text, _, status = stream(cmd, repo, clean_env({**env, **extra}), a.timeout)
        open(os.path.join(box, "transcript.jsonl"), "w").write(text)

        def lines(p):
            return open(p).read().splitlines() if os.path.exists(p) else []
        ctx = {"box": box, "repo": repo, "logs": logs, "transcript": text, "final": final_message(agent, text),
               "world": world, "gh_calls": [json.loads(x) for x in lines(env["FAKE_GH_LOG"])],
               "critic_runs": lines(env["FAKE_CRITIC_LOG"])}
        try:
            ok, evidence = grade(ctx)
        except Exception as e:  # a grader crash is a failed run, reported
            ok, evidence = False, f"grader error: {type(e).__name__}: {e}"
        if status != "ok":  # an agent that crashed or timed out did nothing wrong, and nothing right
            ok, evidence = False, f"agent {status}; " + evidence
        return {"scenario": name, "agent": agent, "hooks": hooks, "ok": ok, "evidence": evidence,
                "seconds": round(time.time() - t0), "box": box}

    with ThreadPoolExecutor(a.jobs) as ex:
        results = list(ex.map(one, jobs))
    rows = ["| Scenario | Agent | Hooks | Result | Evidence |", "| --- | --- | --- | --- | --- |"]
    for x in results:
        rows.append(f"| {x['scenario']} | {x['agent']} | {x['hooks']} | {'pass' if x['ok'] else 'FAIL'} | {x['evidence']} |")
    return results, "## Behaviour scenarios\n\n" + "\n".join(rows) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["triggers", "scenarios"])
    ap.add_argument("--agents")
    ap.add_argument("--skills", default="decide-or-ask,cross-review,verify-live")
    ap.add_argument("--only", default=",".join(SC.SCENARIOS))
    ap.add_argument("--hooks", default="off,on")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--claude-model", default="claude-opus-5-5")
    ap.add_argument("--out")
    ap.add_argument("--force", action="store_true", help="run Claude even without usage headroom")
    a = ap.parse_args()
    a.agents = (a.agents or ("claude,codex,cursor" if a.mode == "triggers" else "claude,codex")).split(",")
    a.skills, a.only, a.hooks = a.skills.split(","), a.only.split(","), a.hooks.split(",")
    for agent in a.agents:
        if not BIN.get("cursor-agent" if agent == "cursor" else agent):
            sys.exit(f"{agent} CLI not found")
    if "claude" in a.agents and not a.force:
        ok, why = headroom_ok()
        if not ok:
            sys.exit(f"refusing to run Claude evals: {why} (use --force, or leave claude out of --agents)")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    base = "/Volumes/DevBox/tmp/agent-evals" if os.path.isdir("/Volumes/DevBox/tmp") else os.path.join(tempfile.gettempdir(), "agent-evals")
    out = os.path.abspath(a.out or os.path.join(base, f"{a.mode}-{stamp}"))
    os.makedirs(out, exist_ok=True)
    results, md = (run_triggers if a.mode == "triggers" else run_scenarios)(a, out)
    json.dump(results, open(os.path.join(out, "results.json"), "w"), indent=1)
    head = f"# Eval run {stamp}\n\nAgents: {', '.join(a.agents)}; Claude model: {a.claude_model}\n\n"
    open(os.path.join(out, "RESULTS.md"), "w").write(head + md)
    print(head + md)
    print(f"results: {out}")
    return 0 if all(x["ok"] for x in results) else 1


if __name__ == "__main__":
    sys.exit(main())
