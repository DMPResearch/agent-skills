#!/usr/bin/env python3
"""guard.py <claude|codex|cursor>: one hook entry for all three agents.

Reads the hook payload on stdin and answers in the agent's own format.

Blocks (hard rules):
  keys    reading, listing or copying private keys (~/.private_keys, ~/.ssh,
          Keychains, *.p8 *.pem *.p12 *.pfx *.key *.jks, service-account JSON)
          through Read/Grep/Glob or a shell reader. An existence test
          (test -f, [ -f ]) and passing the path to the tool that uses it
          (ssh -i, --key-file) stay allowed.
  merge   gh pr merge with --admin or --auto, without --match-head-commit, or
          with no pr-state.py READY for that same commit in the last ten
          minutes (pr-state.py leaves a token; the hook makes no network call);
          gh api calls to /pulls/N/merge. AGENT_GUARD_OWNER_OK=<pr>@<sha> in the
          command (written only after the owner's explicit OK for that PR, e.g.
          to merge past a red check) skips the READY token, never the rest.
  push    git push of commits not on any remote that the secret scanner flags.
          Fixture tokens are allowed per repo in .secret-scan-allow
          (GLOB=REASON lines).
  output  a private key in a command's output stops the turn (PostToolUse):
          it cannot be unseen, so the agent must not repeat it and must tell
          the owner which command printed it.
Reminds (once, never on critic runs: AGENT_GUARD_ROLE=critic):
  ask     before AskUserQuestion, when decide-or-ask was not loaded this session.
  stop    at the end of a turn with changes made this session (the tree at
          SessionStart is the baseline), at most twice per session.
  pr      after gh pr create: use babysit-pr.

These are tripwires, not a sandbox: they read command text, so a script, a
heredoc or `python -c` gets past them. The credential rule still goes into
every brief. Never logs a payload (Cursor's beforeReadFile carries file
content). Fails open: an internal error prints a warning and allows, because a
broken hook must not stop every agent on the machine. AGENT_GUARD_OFF=1
switches every rule off (evals measure skills with hooks off, then on).

`guard.py status` reports where the hooks are installed (and whether Codex
lists them as trusted); a missing hook is not a pass.
"""
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.realpath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), "skills", "merge-safe-prs", "scripts")
STATE = os.environ.get("AGENT_GUARD_STATE", os.path.expanduser("~/.agents/guard-state"))

KEY_EXT = re.compile(r"\.(p8|pem|p12|pfx|key|jks|keystore)$", re.I)
SA_JSON = re.compile(r"(service[-_]?account|adminsdk|firebase-admin|gcp-key|credentials)[^/]*\.json$", re.I)
KEY_DIR = re.compile(r"(^|/)\.(private_keys|ssh)(/|$)|Library/Keychains|(^|/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$")
READERS = {
    "cat", "head", "tail", "less", "more", "bat", "nl", "grep", "egrep", "fgrep", "rg", "ag", "ack",
    "wc", "ls", "find", "fd", "tree", "stat", "file", "sed", "awk", "gawk", "cut", "sort", "uniq",
    "strings", "xxd", "od", "hexdump", "base64", "openssl", "ssh-keygen", "jq", "yq", "python",
    "python3", "node", "ruby", "perl", "php", "cp", "mv", "rsync", "tar", "zip", "diff", "cmp",
    "vim", "vi", "nano", "emacs", "code", "open", "pbcopy", "tee", "dd", "gpg", "du", "mdls",
}
EXIST = {"test", "["}
# Flags that hand a key file to the program that uses it, without printing it.
KEY_FLAGS_ALONE = {"-i", "--identity", "--key-file", "--keyfile", "--private-key", "--key", "--credentials",
                   "--credential-file", "--service-account-key", "--api-key-path", "--p8-file"}
KEY_FLAGS = tuple(f for f in KEY_FLAGS_ALONE if f.startswith("--"))
# Programs that consume a key file through those flags (cp -i is "interactive").
CONSUMERS = {"ssh", "scp", "sftp", "ssh-add", "git", "gcloud", "gsutil", "bq", "curl", "xcrun", "fastlane", "firebase",
             "eas", "terraform", "kubectl", "aws", "az", "codesign", "notarytool"}
UI_EXT = re.compile(r"\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html|liquid|swift|kt|xml|storyboard)$")
OPS = set(";&|()\n`")


def key_path(tok):
    if re.search(r"\s", tok.strip()) and not re.match(r"^['\"]?(/|~|\$HOME|\./|\.private_keys|\.ssh)", tok.strip()):
        return False  # prose (a commit message, an echo), not a path
    t = tok.strip("'\"").replace("$HOME", "~")
    t = os.path.expanduser(t)
    base = t.rstrip("/").split("/")[-1]
    return bool(KEY_DIR.search(t) or KEY_EXT.search(base) or SA_JSON.search(base))


def heredoc_delims(line):
    """Delimiters of real heredocs on this line: `<<` outside quotes and comments."""
    try:
        lex = shlex.shlex(line, posix=True, punctuation_chars="<>;&|()")
        lex.whitespace_split = True
        toks = list(lex)
    except ValueError:
        return []
    return [toks[i + 1].lstrip("-") for i, t in enumerate(toks[:-1]) if t in ("<<", "<<-")]


def strip_heredocs(cmd):
    """Drop heredoc bodies: they are data for a command, not commands."""
    out, lines, i = [], cmd.split("\n"), 0
    while i < len(lines):
        out.append(lines[i])
        for delim in heredoc_delims(lines[i]):
            i += 1
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
        i += 1
    return "\n".join(out)


def parse(cmd):
    """Simple commands as (words, redirects), split on shell operators outside
    quotes, so text inside a quoted string is never read as a command.
    Redirections (`2>&1`, `> f`, `< f`) are taken out of the words."""
    lex = shlex.shlex(strip_heredocs(cmd), posix=True, punctuation_chars=";&|()<>\n`")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    segs, cur, redirs, op = [], [], [], None
    try:
        for tok in lex:
            if tok and set(tok) <= OPS:
                if cur or redirs:
                    segs.append((cur, redirs))
                cur, redirs, op = [], [], None
            elif tok and set(tok) <= set("<>&"):
                if cur and cur[-1].isdigit():
                    cur.pop()  # the fd number of 2>&1
                op = tok
            elif op:
                redirs.append((op, tok))
                op = None
            else:
                cur.append(tok)
    except ValueError:  # unbalanced quotes: fall back to plain words
        return [(cmd.split(), [])]
    if cur or redirs:
        segs.append((cur, redirs))
    return segs


def token_segments(cmd):
    return [ws for ws, _ in parse(cmd)]


def env_of(ws):
    """NAME=value assignments that prefix the command."""
    env = {}
    for w in ws:
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", w)
        if not m:
            break
        env[m.group(1)] = m.group(2)
    return env


def verb_of(ws):
    """First real command word: skip env assignments and wrappers."""
    i = 0
    while i < len(ws):
        w = ws[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w) or w in ("sudo", "command", "env", "nice", "time", "nohup", "exec"):
            i += 1
            continue
        if w == "xargs":
            i += 1
            while i < len(ws) and ws[i].startswith("-"):
                i += 1
            continue
        return os.path.basename(w), ws[i + 1:]
    return "", []


# ---------- rules ----------

def expand(tok, keyvars):
    """Substitute variables that hold a key path ($K, ${K})."""
    return re.sub(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?", lambda m: keyvars.get(m.group(1), m.group(0)), tok)


def keys_shell(cmd):
    keyvars = {}
    for ws, redirs in parse(cmd):
        for name, val in env_of(ws).items():
            if key_path(val):
                keyvars[name] = val
        ws = [expand(w, keyvars) for w in ws]
        if any("<" in op and key_path(expand(t, keyvars)) for op, t in redirs):
            return "reads a private key through a redirect"
        if "xargs" in ws:
            xa = ws[ws.index("xargs") + 1:]
            if any(key_path(v) for v in [flag_value(xa, "-a"), flag_value(xa, "--arg-file")] if v):
                return "`xargs` reading a private-key file"
        verb, args = verb_of(ws)
        if verb == "security" and ("dump-keychain" in args or "-g" in args or (args[:1] and args[0].startswith("export"))):
            return "dumps or exports keychain contents"
        if verb == "security" and "-w" in args and not re.search(r"\$\(\s*security\b", cmd):
            return "`security ... -w` prints a secret; capture it with $( ) into the command that uses it"
        if verb in SEARCHERS and not any(a in ("-e", "-f", "--regexp", "--file", "--files") for a in args):
            pats = positionals(args, {"-m", "-A", "-B", "-C", "--max-count", "-g", "--glob", "-t", "--type"})[:1]
            args = [a for a in args if a not in pats]  # the search pattern is text, not a path
        if verb in EXIST and [a for a in args if a != "]"][:1] == ["-f"] and len([a for a in args if a != "]"]) == 2:
            continue  # the owner's rule allows exactly `test -f <named file>`
        for i, a in enumerate(args):
            val = a.split("=", 1)[1] if a.startswith("-") and "=" in a else a
            if not key_path(val):
                continue
            prev = args[i - 1] if i else ""
            flagged = (a.startswith(KEY_FLAGS) and "=" in a) or prev in KEY_FLAGS_ALONE
            if flagged and verb in CONSUMERS:
                continue  # handed to the tool that uses it (ssh -i, gcloud --key-file=)
            return f"`{verb or args[0]}` with a private-key path (allowed: `test -f <named file>`, or the path as a key flag's value)"
    return None


def keys_path(*paths):
    return next(("a private-key path" for p in paths if p and key_path(str(p))), None)


def flag_value(args, name):
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return None


MERGE_VALUE_FLAGS = {"--match-head-commit", "--repo", "-R", "--subject", "-t", "--body", "-b",
                     "--body-file", "-F", "--author-email", "-A"}
SEARCHERS = {"grep", "egrep", "fgrep", "rg", "ag", "ack"}


def positionals(args, value_flags):
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
        elif a in value_flags:
            skip = True
        elif not a.startswith("-"):
            out.append(a)
    return out


def run(args, cwd, timeout=90):
    return subprocess.run(args, cwd=cwd or None, capture_output=True, text=True, timeout=timeout)


def merge_shell(cmd, cwd):
    for ws in token_segments(cmd):
        verb, args = verb_of(ws)
        cwd = follow_cd(cwd, verb, args)
        if verb != "gh":
            continue
        args, grepo = gh_args(args)
        if args[:1] == ["api"] and any(re.search(r"pulls/\d+/merge\b", a) for a in args):
            return "merging through `gh api` skips the gate; use merge-safe-prs and `gh pr merge`"
        if args[:2] != ["pr", "merge"]:
            continue
        rest = args[2:]
        if bool_flag(rest, "--admin"):
            return "`--admin` bypasses branch protection; merge-safe-prs never uses it"
        sha = flag_value(rest, "--match-head-commit")
        if not sha:
            return "merge without `--match-head-commit <sha>`; take the sha from pr-state.py READY (merge-safe-prs)"
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            return "`--match-head-commit` needs the full 40-character sha from the READY line"
        if bool_flag(rest, "--auto"):
            return "`--auto` merges later, after the gate was read; merge when pr-state.py says READY instead"
        repo = flag_value(rest, "--repo") or flag_value(rest, "-R") or grepo
        pr = positionals(rest, MERGE_VALUE_FLAGS)[:1]
        pr = pr[0] if pr else None
        if pr and "/pull/" in pr:
            m = re.search(r"github\.com/([^/]+/[^/]+)/pull/(\d+)", pr)
            repo, pr = (m.group(1), m.group(2)) if m else (repo, pr)
        if not pr or not pr.isdigit():
            return "name the PR by number or URL in `gh pr merge`, so the hook can match it to its READY"
        repo = repo or origin_repo(cwd)
        ok = re.fullmatch(r"(\d+)@([0-9a-f]{40})", env_of(ws).get("AGENT_GUARD_OWNER_OK", ""))
        if ok and ok.group(1) == pr and ok.group(2) == sha:
            continue
        token = ready_token(sha)
        if not token:
            return (f"no pr-state.py READY for {sha[:12]} in the last ten minutes: run "
                    f"`python3 -I ~/.agents/skills/merge-safe-prs/scripts/pr-state.py {pr}` and merge only on READY")
        if token.get("pr") != pr or (repo and token.get("repo", "").lower() != repo.lower()):
            return f"the READY for {sha[:12]} was for {token.get('repo')} PR {token.get('pr')}, not {repo or 'this repo'} PR {pr}"
    return None


def gh_args(args):
    """gh's words with inherited flags (-R/--repo, --hostname) taken out, so
    `gh -R o/r pr merge` and `gh pr -R o/r merge` read as `gh pr merge`."""
    out, repo, i = [], None, 0
    while i < len(args):
        a = args[i]
        if a in ("-R", "--repo", "--hostname") and i + 1 < len(args) and len(out) < 2:
            repo = args[i + 1] if a != "--hostname" else repo
            i += 2
            continue
        if (a.startswith("--repo=") or a.startswith("--hostname=")) and len(out) < 2:
            repo = a.split("=", 1)[1] if a.startswith("--repo=") else repo
            i += 1
            continue
        out.append(a)
        i += 1
    return out, repo


def bool_flag(args, name):
    return any(a == name or (a.startswith(name + "=") and a.split("=", 1)[1].lower() not in ("false", "0", "f"))
               for a in args)


def origin_repo(cwd):
    url = run(["git", "remote", "get-url", "origin"], cwd, 10).stdout.strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", url)
    return m.group(1) if m else None


def ready_token(sha):
    d = os.path.join(STATE, "ready")
    try:
        names = [n for n in os.listdir(d) if n == sha + ".json"]
        for n in names:
            with open(os.path.join(d, n)) as fh:
                t = json.load(fh)
            if time.time() - t.get("time", 0) < 600:
                return t
    except (OSError, ValueError):
        pass
    return None


def push_refs(args):
    """Local refs a push would send, or None when it sends nothing new."""
    opts = {a for a in args if a.startswith("-")}
    if opts & {"--delete", "-d", "--dry-run", "-n"}:
        return None
    pos = [a for a in args if not a.startswith("-")]
    for name in ("--repo", "--receive-pack", "--exec", "-o", "--push-option"):
        v = flag_value(args, name)
        if v in pos:
            pos.remove(v)
    if "--all" in opts or "--branches" in opts or "--mirror" in opts:
        return ["--branches"] + (["--tags"] if "--mirror" in opts else [])
    refs = []
    given_repo = flag_value(args, "--repo")
    for spec in (pos if given_repo else pos[1:]):
        src = spec.lstrip("+").split(":", 1)[0]
        if src:
            refs.append(src)
    if "--tags" in opts:
        refs.append("--tags")
    return refs or ["HEAD"]


def command_file(cmd):
    fd, path = tempfile.mkstemp(prefix="guard-cmd-", text=True)
    with os.fdopen(fd, "w") as fh:  # as added lines: diff mode reads only +/-/context lines
        fh.write("".join("+" + line + "\n" for line in cmd.split("\n")))
    return path


def commits_first(cmd):
    """The same command also records new commits before it pushes."""
    for ws in token_segments(cmd):
        verb, args = verb_of(ws)
        while verb == "git" and args[:1] and args[0] in ("-C", "-c"):
            args = args[2:]
        if verb == "git" and args[:1] and args[0] in ("commit", "add", "am", "cherry-pick", "merge", "rebase", "revert"):
            return True
    return False


def follow_cd(cwd, verb, args):
    """The directory after `cd X` / `pushd X` (so `cd project && git push` scans project)."""
    if verb in ("cd", "pushd") and args and not args[0].startswith("-"):
        return os.path.join(cwd or os.getcwd(), os.path.expanduser(args[0]))
    return cwd


def push_shell(cmd, cwd):
    for ws in token_segments(cmd):
        verb, args = verb_of(ws)
        cwd = follow_cd(cwd, verb, args)
        if verb != "git":
            continue
        where = cwd
        while args and args[0] in ("-C", "-c"):
            if args[0] == "-C" and len(args) > 1:
                where = os.path.join(cwd or ".", os.path.expanduser(args[1]))
            args = args[2:]
        if args[:1] != ["push"]:
            continue
        refs = push_refs(args[1:])
        if refs is None:
            continue
        top = run(["git", "rev-parse", "--show-toplevel"], where, 20).stdout.strip()
        allow = []
        try:
            with open(os.path.join(top, ".secret-scan-allow")) as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        allow += ["--allow", line]
        except OSError:
            pass
        # A ref made earlier in the same command (`git commit ... && git push`)
        # does not exist yet: scan what that command can commit instead.
        known = [x for x in refs if x.startswith("--") or
                 run(["git", "rev-parse", "--verify", "--quiet", x + "^{commit}"], where, 20).returncode == 0]
        scans = [["--outgoing"] + (known or ["HEAD"])]
        if len(known) < len(refs) or commits_first(cmd):
            scans.append(["--worktree"])
            scans.append(["--diff", command_file(cmd)])  # bytes and messages the command itself writes
        try:
            for mode in scans:
                r = run(["python3", "-I", os.path.join(SCRIPTS, "scan-secrets.py")] + allow + mode, where, 120)
                if r.returncode == 1:
                    return "the secret scan flagged what this push would send:\n" + r.stdout.strip()[-800:]
                if r.returncode != 0:
                    why = ((r.stdout + r.stderr).strip().splitlines() or ["no output"])[-1][:200]
                    return f"the secret scan could not run ({why}); scan by hand before pushing"
        finally:
            for mode in scans:
                if mode[0] == "--diff":
                    os.remove(mode[1])
    return None


def session_state(session):
    os.makedirs(STATE, exist_ok=True)
    path = os.path.join(STATE, re.sub(r"[^A-Za-z0-9_.-]", "_", session or "none") + ".json")
    try:
        with open(path) as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    return path, data


def save_state(path, data):
    with open(path, "w") as fh:
        json.dump(data, fh)
    cutoff = time.time() - 7 * 86400
    for d in (STATE, os.path.join(STATE, "ready")):
        for f in os.listdir(d) if os.path.isdir(d) else []:
            p = os.path.join(d, f)
            if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                os.remove(p)


def skill_loaded(transcript, name):
    try:
        with open(transcript, errors="replace") as fh:
            text = fh.read()
    except (OSError, TypeError):
        return False
    return bool(re.search(r'"skill"\s*:\s*"' + name + r'"|"(command|file_path|cmd)"\s*:\s*"[^"]*' + name + r'/SKILL\.md', text))


def executes(cmd, name, depth=0):
    """Does this shell command run a program called `name` (not echo it)?"""
    for ws in token_segments(cmd):
        verb, args = verb_of(ws)
        if verb == name or (verb in ("bash", "sh", "zsh") and args and not args[0].startswith("-")
                            and os.path.basename(args[0]) == name):
            return True
        if verb in ("bash", "sh", "zsh") and depth < 2:
            inner = next((args[i + 1] for i, a in enumerate(args[:-1]) if re.fullmatch(r"-[a-z]*c", a)), None)
            if inner and executes(inner, name, depth + 1):
                return True
    return False


def ran(transcript, word):
    """A tool call executed `word` (a mention, an echo or a read does not count)."""
    try:
        with open(transcript, errors="replace") as fh:
            text = fh.read()
    except (OSError, TypeError):
        return False
    for m in re.finditer(r'"(?:command|cmd)"\s*:\s*("(?:[^"\\]|\\.)*")', text):
        try:
            if executes(json.loads(m.group(1)), word):
                return True
        except ValueError:
            continue
    return False


def ask_reminder(ev):
    if skill_loaded(ev.get("transcript"), "decide-or-ask"):
        return None
    path, st = session_state(ev.get("session"))
    if st.get("asked"):
        return None
    st["asked"] = True
    save_state(path, st)
    return ("Load the decide-or-ask skill before asking the owner. Decide anything cheap and quick to undo "
            "yourself and record it. Critical decisions (production deploys, money, security, deletions, anything "
            "public or irreversible, product direction) are still asked: if this is one, ask again.")


def tree_digest(top, names):
    diff = run(["git", "--no-optional-locks", "diff", "HEAD", "--binary"], top, 30).stdout
    untracked = run(["git", "ls-files", "--others", "--exclude-standard"], top, 20).stdout.split("\n")[:500]
    blobs = subprocess.run(["git", "hash-object", "--stdin-paths"], cwd=top, input="\n".join(u for u in untracked if u),
                           capture_output=True, text=True, timeout=30).stdout if any(untracked) else ""
    return hashlib.sha256((diff + blobs + "\0".join(sorted(names))).encode("utf-8", "replace")).hexdigest()[:16]


def head_of(top):
    return run(["git", "rev-parse", "HEAD"], top, 10).stdout.strip()


def dirty(cwd):
    top = run(["git", "rev-parse", "--show-toplevel"], cwd, 10)
    if top.returncode != 0:
        return None, []
    top = top.stdout.strip()
    status = run(["git", "--no-optional-locks", "status", "--porcelain", "-z"], top, 20).stdout
    return top, [e[3:] for e in status.split("\0") if re.match(r"^[ MADRCUT?!]{2} ", e)]


def baseline(ev):
    """SessionStart: remember the tree the session found, so a worktree that
    was already dirty does not earn a reminder for changes nobody made yet."""
    top, names = dirty(ev.get("cwd") or os.getcwd())
    if top:
        path, st = session_state(ev.get("session"))
        st.setdefault("baseline", {})[top] = tree_digest(top, names) + head_of(top)[:12] if names else ""
        st.setdefault("start_head", {})[top] = head_of(top)
        save_state(path, st)


def stop_reminder(ev):
    top, names = dirty(ev.get("cwd") or os.getcwd())
    if not top:
        return None
    path, st = session_state(ev.get("session"))
    start = st.get("start_head", {}).get(top)
    commits = run(["git", "rev-list", "--count", f"{start}..HEAD"], top, 10).stdout.strip() if start else "0"
    if not names and commits in ("", "0"):
        return None
    if ran(ev.get("transcript"), "run-critics.sh"):
        return None
    digest = tree_digest(top, names) + head_of(top)[:12]
    seen = st.setdefault("stops", [])
    if digest in seen or digest == st.get("baseline", {}).get(top) or len(seen) >= 2:
        return None
    seen.append(digest)
    save_state(path, st)
    committed = run(["git", "diff", "--name-only", f"{start}..HEAD"], top, 20).stdout.split("\n") if start else []
    ui = [n for n in names + committed if n and UI_EXT.search(n) and not key_path(n)]
    what = f"{len(names)} uncommitted files" if names else ""
    if commits not in ("", "0"):
        what += (" and " if what else "") + f"{commits} commits made this session"
    msg = (f"{os.path.basename(top)} has {what}. If this piece is finished, "
           "run the cross-review skill before reporting it done")
    if ui:
        msg += ", and verify-live because UI files changed (" + ", ".join(ui[:3]) + ")"
    return msg + ". If it is not finished, or a check cannot run, say so in your reply; an unrun check is not a pass."


# ---------- payloads and answers ----------

def normalise(tool, d):
    ev = {"session": d.get("session_id") or d.get("conversation_id"), "cwd": d.get("cwd") or "",
          "transcript": d.get("transcript_path"), "message": d.get("last_assistant_message") or ""}
    if not ev["cwd"] and d.get("workspace_roots"):
        ev["cwd"] = d["workspace_roots"][0]
    name = d.get("hook_event_name", "")
    t, inp = d.get("tool_name", ""), d.get("tool_input") or {}
    if name in ("PreToolUse", "preToolUse", "PostToolUse", "postToolUse"):
        post = name.lower().startswith("post")
        if t in ("Bash", "Shell", "shell", "exec_command"):
            ev.update(kind="post_shell" if post else "shell", command=inp.get("command") or inp.get("cmd") or "")
            wd = inp.get("workdir") or inp.get("cwd")
            if wd:
                ev["cwd"] = wd if os.path.isabs(wd) else os.path.join(ev["cwd"] or os.getcwd(), wd)
            if post:
                r = d.get("tool_response", d.get("tool_output", ""))
                ev["output"] = r if isinstance(r, str) else json.dumps(r)
        elif post:
            ev["kind"] = "other"
        elif t == "AskUserQuestion":
            ev["kind"] = "ask"
        else:
            keys = ("file_path", "path", "glob", "glob_pattern", "target_directory") + (() if t == "Grep" else ("pattern",))
            ev.update(kind="path", paths=[inp.get(k) for k in keys])
    elif name == "beforeShellExecution":
        ev.update(kind="shell", command=d.get("command", ""))
    elif name == "beforeReadFile":
        ev.update(kind="path", paths=[d.get("file_path")])
    elif name in ("SessionStart", "sessionStart"):
        ev["kind"] = "start"
    elif name in ("Stop", "stop"):
        ev.update(kind="stop", active=bool(d.get("stop_hook_active")) or bool(d.get("loop_count")))
    else:
        ev["kind"] = "other"
    ev["event"] = name
    return ev


def answer(tool, ev, kind, text):
    """kind: deny | context | stop. Returns (stdout, exit code)."""
    if tool == "cursor":
        if kind == "deny":
            return json.dumps({"permission": "deny", "user_message": text, "agent_message": text}), 0
        if kind == "stop":
            return json.dumps({"followup_message": text}), 0
        return json.dumps({"additional_context": text}), 0
    if kind == "deny":
        sys.stderr.write("Blocked by the agent-skills guard: " + text + "\n")
        return "", 2
    if kind == "stop":
        return json.dumps({"decision": "block", "reason": text}), 0
    return json.dumps({"hookSpecificOutput": {"hookEventName": ev["event"], "additionalContext": text}}), 0


def pr_created(cmd):
    return any(verb_of(ws)[0] == "gh" and verb_of(ws)[1][:2] == ["pr", "create"] for ws in token_segments(cmd))


PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")


def decide(tool, d):
    ev = normalise(tool, d)
    if os.environ.get("AGENT_GUARD_OFF") == "1":
        return ev, None, None
    critic = os.environ.get("AGENT_GUARD_ROLE") == "critic"
    k = ev["kind"]
    if k == "post_shell" and PRIVATE_KEY.search(ev.get("output") or ""):
        return ev, "stop", ("A private key appeared in that command's output. Do not repeat, quote or summarise any part "
                            "of it. Tell the owner which command printed it so the key can be rotated.")
    if k == "start":
        if not critic:
            baseline(ev)
        return ev, None, None
    if k == "shell":
        cmd = ev["command"]
        why = keys_shell(cmd) or merge_shell(cmd, ev["cwd"]) or push_shell(cmd, ev["cwd"])
        if why:
            return ev, "deny", why
    elif k == "path":
        why = keys_path(*ev.get("paths", []))
        if why:
            return ev, "deny", why + ": the credential rule allows only existence checks (test -f)"
    elif k == "ask" and not critic:
        why = ask_reminder(ev)
        if why:
            return ev, "deny", why
    elif k == "stop" and not critic and not ev.get("active"):
        why = stop_reminder(ev)
        if why:
            return ev, "stop", why
    elif k == "post_shell" and not critic and pr_created(ev.get("command", "")):
        return ev, "context", "A PR was opened: load the babysit-pr skill to drive it to READY (it never merges)."
    return ev, None, None


EVENTS = {
    "claude": ("~/.claude/settings.json", ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]),
    "codex": ("~/.codex/hooks.json", ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]),
    "cursor": ("~/.cursor/hooks.json", ["sessionStart", "preToolUse", "beforeShellExecution", "beforeReadFile",
                                        "postToolUse", "stop"]),
}


def ours(entry):
    cmds = [entry.get("command", "")] + [h.get("command", "") for h in entry.get("hooks", [])]
    return any("agents/hooks/guard.py" in c for c in cmds)


def status():
    """Which agents have the hooks, so a missing hook never reads as a pass."""
    good = True
    for tool, (path, events) in EVENTS.items():
        p = os.path.expanduser(path)
        try:
            with open(p) as fh:
                hooks = json.load(fh).get("hooks", {})
        except (OSError, ValueError):
            hooks = {}
        missing = [e for e in events if not any(ours(x) for x in hooks.get(e, []))]
        line = f"{tool}: " + ("installed" if not missing else "MISSING " + ", ".join(missing))
        if tool == "codex" and not missing:
            try:
                with open(os.path.expanduser("~/.codex/config.toml")) as fh:
                    cfg = fh.read()
            except OSError:
                cfg = ""
            untrusted = []
            for e in events:
                snake = re.sub(r"(?<!^)([A-Z])", r"_\1", e).lower()
                for i, grp in enumerate(hooks.get(e, [])):
                    for j, h in enumerate(grp.get("hooks", [])):
                        if "agents/hooks/guard.py" in h.get("command", "") and f'{p}:{snake}:{i}:{j}"]' not in cfg:
                            untrusted.append(e)
            if untrusted:
                line += "; NOT TRUSTED " + ", ".join(sorted(set(untrusted))) + " (open codex, run /hooks, trust them)"
                missing = untrusted
        good = good and not missing
        print(line)
    return 0 if good else 1


def main():
    tool = sys.argv[1] if len(sys.argv) > 1 else "claude"
    if tool == "status":
        return status()
    try:
        d = json.loads(sys.stdin.read() or "{}")
        ev, kind, text = decide(tool, d)
        if not kind:
            if tool == "cursor" and ev["kind"] in ("shell", "path"):
                print(json.dumps({"permission": "allow"}))
            return 0
        out, code = answer(tool, ev, kind, text)
        if out:
            print(out)
        return code
    except Exception as e:  # fail open, loudly
        sys.stderr.write(f"agent-skills guard error (allowed): {type(e).__name__}: {e}\n")
        return 0


if __name__ == "__main__":
    sys.exit(main())
