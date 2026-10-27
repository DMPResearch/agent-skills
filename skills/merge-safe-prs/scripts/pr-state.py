#!/usr/bin/env python3
"""pr-state.py: read a pull request's merge gate fresh from GitHub.

Usage: pr-state.py <pr-number-or-url> [--repo owner/name] [--json]

Prints the head sha, the required checks (from rulesets AND classic branch
protection, because `gh pr checks --required` only sees the latter), every
check on the head, unresolved review threads and mergeability, then one line:
  READY <head-sha>        exit 0
  NOT READY: <reasons>    exit 1
  ERROR: <what>           exit 2
Every failing or pending check blocks, required or not: a failed "advisory"
reviewer usually means no verdict, not approval. There is no override flag:
merging past a red check is the owner's call (merge-safe-prs asks), so READY
is only ever printed when nothing at all is red. A skipped required check
blocks. A PR into a non-default branch is
held to the union of its base's and the default branch's required checks,
since that is where a stack lands. GitHub's own BLOCKED/UNSTABLE merge states
block too. READY does NOT cover a reviewer's verdict: read that yourself.
On READY it also writes a token the merge hook (hooks/guard.py) checks.
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
from urllib.parse import quote


def gh(args, ok_missing=False):
    p = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        # Only "Branch not protected" means none: a 404 can also mean the token
        # cannot read protection, which must not read as "no required checks".
        if ok_missing and "Branch not protected" in p.stderr:
            return None
        raise RuntimeError(f"gh {' '.join(args[:3])}: {p.stderr.strip()[:300]}")
    return json.loads(p.stdout) if p.stdout.strip() else None


def required_contexts(repo, base):
    """Set of (context, app_id or None); a ruleset may pin the app that must report."""
    req = set()
    b = quote(base, safe="")
    # A branch with no rules answers []; a 404 here means a wrong branch or
    # repo, which must be an error rather than "no requirements".
    rules = gh(["api", f"repos/{repo}/rules/branches/{b}"]) or []
    for r in rules:
        if r.get("type") == "required_status_checks":
            for c in r.get("parameters", {}).get("required_status_checks", []):
                req.add((c["context"], c.get("integration_id")))
    prot = gh(["api", f"repos/{repo}/branches/{b}/protection/required_status_checks"], ok_missing=True)
    if prot:
        req.update((c, None) for c in prot.get("contexts") or [])
        # app_id -1 (or none) means any app may report the check
        req.update((c["context"], c.get("app_id") if (c.get("app_id") or -1) > 0 else None) for c in prot.get("checks") or [])
    return req


RANK = {"success": 0, "neutral": 0, "skipped": 1}  # anything else ranks 9


def worse(a, b):
    return a if RANK.get(a, 9) >= RANK.get(b, 9) else b


def head_checks(repo, sha, by_app=None):
    """Per name: the WORST of the latest check run per app and the latest commit
    status, so a green check run cannot hide a red status of the same name.
    by_app, if given, receives {(name, app_id): state} for app-pinned checks."""
    latest = {}
    pages = gh(["api", "--paginate", "--slurp", f"repos/{repo}/commits/{sha}/check-runs?per_page=100"]) or []
    runs = [r for p in pages for r in p.get("check_runs", [])]
    for r in sorted(runs, key=lambda r: r["id"]):  # ids grow; a queued rerun has no started_at
        state = r["conclusion"] if r["status"] == "completed" else r["status"]
        latest[(r["name"], (r.get("app") or {}).get("id"))] = (state or "pending").lower()
    if by_app is not None:
        by_app.update(latest)
    out = {}
    for (name, _), st in latest.items():
        out[name] = worse(out[name], st) if name in out else st
    pages = gh(["api", "--paginate", "--slurp", f"repos/{repo}/commits/{sha}/statuses?per_page=100"]) or []
    seen = set()
    for st in [s for p in pages for s in p]:  # newest first
        if st["context"] in seen:
            continue
        seen.add(st["context"])
        v = st["state"].lower()
        out[st["context"]] = worse(out[st["context"]], v) if st["context"] in out else v
    return out


def unresolved_threads(owner, name, number):
    q = """query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){
      reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor}
      nodes{isResolved isOutdated comments(first:1){nodes{author{login} path}}}}}}}"""
    out, cursor = [], None
    while True:
        args = ["api", "graphql", "-f", f"query={q}", "-F", f"o={owner}", "-F", f"r={name}", "-F", f"n={number}"]
        if cursor:
            args += ["-f", f"c={cursor}"]
        page = gh(args)["data"]["repository"]["pullRequest"]["reviewThreads"]
        for t in page["nodes"]:
            if t["isResolved"]:
                continue
            c = (t["comments"]["nodes"] or [{}])[0]
            who = (c.get("author") or {}).get("login", "?")
            # No comment text: a pasted credential must never reach the transcript.
            path = c.get("path") or "?"
            path = "(credential-like path)" if PATH_RE.search(path) else path
            out.append(f"{who} on {path}{' (outdated)' if t['isOutdated'] else ''}")
        if not page["pageInfo"]["hasNextPage"]:
            return out
        cursor = page["pageInfo"]["endCursor"]


def _scanner():
    spec = importlib.util.spec_from_file_location("scan_secrets", os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan-secrets.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SCANNER = _scanner()
PATH_RE = SCANNER.PATH_RE


def safe(text):
    """Untrusted GitHub text (titles, branches, check names) is withheld when
    it looks like it carries a credential or a key path."""
    text = text or ""
    return "[withheld: credential-like text]" if SCANNER.line_hits(text, paths=True) else text

GOOD = {"success", "neutral", "skipped"}


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    pr, repo, as_json = argv[0], None, "--json" in argv
    if "--repo" in argv:
        repo = argv[argv.index("--repo") + 1]
    fields = "number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,labels,author"
    view = gh(["pr", "view", pr, "--json", fields] + (["--repo", repo] if repo else []))
    if not repo:
        u = view["url"].split("/")
        repo = f"{u[3]}/{u[4]}"
    owner, name = repo.split("/")
    sha = view["headRefOid"]
    pinned = required_contexts(repo, view["baseRefName"])
    default = gh(["api", f"repos/{repo}", "--jq", "{d:.default_branch}"])["d"]
    if default != view["baseRefName"]:
        pinned |= required_contexts(repo, default)  # where the stack lands
    req = {c for c, _ in pinned}
    by_app = {}
    checks = head_checks(repo, sha, by_app)
    threads = unresolved_threads(owner, name, view["number"])

    reasons, attention = [], []
    if view["state"] != "OPEN":
        reasons.append(f"state {view['state']}")
    if view["isDraft"]:
        reasons.append("draft")
    if view["mergeable"] == "CONFLICTING" or view["mergeStateStatus"] == "DIRTY":
        reasons.append("merge conflict")
    elif view["mergeable"] == "UNKNOWN" or view["mergeStateStatus"] == "UNKNOWN":
        reasons.append("mergeability not computed yet (re-read in a minute)")
    if view["mergeStateStatus"] == "BEHIND":
        reasons.append("branch is behind its base")
    if view["mergeStateStatus"] == "BLOCKED":
        reasons.append("GitHub reports BLOCKED (a required review, signature, deployment or rule is unmet)")
    if view["reviewDecision"] == "CHANGES_REQUESTED":
        reasons.append("changes requested by a reviewer")
    if view["reviewDecision"] == "REVIEW_REQUIRED":
        reasons.append("a required human review is missing")
    if not req:
        attention.append("no required checks found on the base branch: judge every check yourself")
    for ctx in sorted(req):
        st = checks.get(ctx)
        if st is None:
            reasons.append(f"required check missing on head: {ctx}")
        elif st == "skipped":
            reasons.append(f"required check skipped (did it really not need to run?): {ctx}")
        elif st not in GOOD:
            reasons.append(f"required check {st}: {ctx}")
    for ctx, st in sorted(checks.items()):
        if ctx not in req and st not in GOOD:
            reasons.append(f"check {st}: {ctx}")
    if not checks:
        reasons.append("no checks on this head yet (CI may not have registered; re-read)")
    # GitHub may evaluate checks on the test-merge commit; read those too.
    merge_sha = (gh(["api", f"repos/{repo}/pulls/{view['number']}", "--jq", "{m:.merge_commit_sha}"]) or {}).get("m")
    if merge_sha and merge_sha != sha:
        merge_by_app = {}
        for ctx, st in sorted(head_checks(repo, merge_sha, merge_by_app).items()):
            if st not in GOOD or (ctx in req and st == "skipped"):
                reasons.append(f"test-merge commit check {st}: {ctx}")
        for ctx, app in pinned:
            if app is not None and any(n == ctx for n, _ in merge_by_app) and merge_by_app.get((ctx, app)) not in GOOD:
                reasons.append(f"test-merge commit: required check not green from its pinned app {app}: {ctx}")
    for ctx, app in sorted(pinned, key=lambda x: (x[0], x[1] or 0)):
        if app is not None and ctx in checks and by_app.get((ctx, app)) not in GOOD:
            reasons.append(f"required check not reported green by its pinned app {app}: {ctx}")
    if threads:
        reasons.append(f"{len(threads)} unresolved review thread(s)")
    if view["mergeStateStatus"] == "UNSTABLE":
        reasons.append("GitHub reports UNSTABLE (a non-required check is failing or pending)")
    if view["mergeStateStatus"] == "DRAFT" and "draft" not in reasons:
        reasons.append("draft")

    checks = {safe(k): v for k, v in checks.items()}
    req = {safe(k) for k in req}
    reasons = [safe(r) for r in reasons]
    result = {
        "repo": repo, "number": view["number"], "title": safe(view["title"]), "url": view["url"],
        "head": sha, "base": safe(view["baseRefName"]), "branch": safe(view["headRefName"]),
        "author": (view.get("author") or {}).get("login"),
        "labels": [l["name"] for l in view["labels"]],
        "mergeable": view["mergeable"], "mergeState": view["mergeStateStatus"],
        "reviewDecision": view["reviewDecision"], "required": sorted(req), "checks": checks,
        "threads": threads, "attention": attention, "reasons": reasons, "ready": not reasons,
    }
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print(f"#{result['number']} {result['title']}\n{result['url']}")
        print(f"head {sha}  base {result['base']}  branch {result['branch']}  author {result['author']}")
        print(f"labels: {', '.join(result['labels']) or '-'}")
        print(f"mergeable {result['mergeable']}  state {result['mergeState']}  review {result['reviewDecision'] or '-'}")
        print("checks on head:")
        for ctx, st in sorted(checks.items()):
            print(f"  {'[required] ' if ctx in req else ''}{st}: {ctx}")
        for t in threads:
            print(f"  thread: {t}")
        for a in attention:
            print(f"attention: {a}")
        print(f"READY {sha}" if not reasons else "NOT READY: " + "; ".join(reasons))
    ready_token(repo, view["number"], sha, ready=not reasons)
    return 0 if not reasons else 1


def ready_token(repo, number, sha, ready=True):
    """Record READY for the merge hook (hooks/guard.py), which accepts
    `gh pr merge --match-head-commit <sha>` only within ten minutes of it.
    A NOT READY read removes an earlier token for the same commit."""
    d = os.path.join(os.environ.get("AGENT_GUARD_STATE", os.path.expanduser("~/.agents/guard-state")), "ready")
    path = os.path.join(d, sha + ".json")
    try:
        if not ready:
            if os.path.exists(path):
                os.remove(path)
            return
        os.makedirs(d, exist_ok=True)
        with open(path, "w") as fh:
            json.dump({"repo": repo, "pr": str(number), "sha": sha, "time": time.time()}, fh)
    except OSError:
        pass


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:  # report, never pretend READY
        print(f"ERROR: {e}")
        sys.exit(2)
