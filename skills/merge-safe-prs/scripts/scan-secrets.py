#!/usr/bin/env python3
"""scan-secrets.py: look for credentials before code merges, leaves the machine
or goes to a reviewer, WITHOUT printing them.

Usage: scan-secrets.py [options] <base-ref> [<head-ref>]   commits base..head
                                       (default HEAD), their messages included
       scan-secrets.py [options] --worktree    uncommitted + untracked changes
       scan-secrets.py [options] --diff FILE   a unified diff (git diff --binary)
       scan-secrets.py [options] --text FILE   any text file, every line (a brief)
       scan-secrets.py [options] --outgoing REF...  commits REF... has that no
                                       remote-tracking branch has (what a push
                                       would publish), their messages included
Options:
  --explain            per hit: file path, rule and the assigned key name and
                       value LENGTH, never the value. Paths of key files and
                       key folders stay hidden. Use it to judge false
                       positives (test ids, public provider ids).
  --allow GLOB=REASON  ignore hits in files matching GLOB (repeatable); every
                       allowance is printed with its reason. A credential-named
                       file (.env.development, say) is allowed only by its
                       exact path, after checking its keys are public. Never allow a key
                       file, a real provider secret or a recorded response
                       that carries one.

Flags three things: credential-like FILE NAMES (key folders, .env*, key and
keystore extensions, service-account JSON), binary files under such names, and
credential-like CONTENT on added lines (private keys, provider token formats,
URLs with passwords, SECRET/TOKEN/PASSWORD assignments with literal values).
In --diff mode every line of the diff is scanned (added, removed and context),
because the whole file is what a reviewer receives; commit mode scans added
lines and messages. Prints only where (commit SHA, "working tree" or "diff")
and counts: never a matching line or any fragment (the owner's credential
rule). Exit 0 clean, 1 found, 2 error. On a hit: stop, tell the owner the
commit, and rewrite history before anything is pushed, merged or reviewed.
This is a pattern scan, not a guarantee. Assignment literals are flagged when
they are token-like: letters with digits and at least 20 characters, or (only
under secret/password/key names) mixed case and at least 16. Shorter values,
prose with spaces, symlink chains through other links, and formats with no
pattern are missed. It does not run gitleaks. For wider
coverage run `gitleaks git --redact` yourself when it is installed.
"""
import fnmatch
import math
import os
import re
import subprocess
import sys

PATH_RE = re.compile(r"""(?ix)
    (^|/)(\.ssh|\.?private_keys|\.gnupg|keychains?)/
  | (^|/)\.env(rc|\.(?!example$|sample$|template$|dist$)[^/]*)?$
  | (^|/)id_(rsa|ed25519|ecdsa|dsa)[^/]*$
  | \.(pem|p8|p12|pfx|key|keystore|jks|mobileprovision|kdbx|der|bks|ppk|asc|gpg)$
  | (service[-_]?account|adminsdk|credentials?|secrets?)[^/]*\.(json|ya?ml|txt|plist)$
""")

# A literal value, not a reference to one: skip env lookups and placeholders.
PLACEHOLDER = re.compile(r"""(?ix)^(
     \$\{?[A-Z_][A-Z0-9_]*\}?            # $VAR, ${VAR}
   | (process\.env|os\.environ|import\.meta\.env)\b.*
   | (os\.)?getenv\b.* | env\(.*
   | <[^>]*>                           # <your-key>
   | (?-i:(your|example|sample|changeme|dummy|placeholder|redacted|test|fake)([-_.][a-z]{1,12}){0,3}([-_.]?\d{1,4})?)  # lowercase words, short number
   | x{4,} | \*{3,}
)$""")
CONTENT = [re.compile(p) for p in (
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"\bAKIA[0-9A-Z]{16}\b",                                # AWS access key id
    r"\b(sk|rk)_(live|test)_[0-9A-Za-z]{16,}",               # Stripe secret/restricted
    r"\bwhsec_[0-9A-Za-z]{20,}",                            # Stripe webhook secret
    r"\bgh[pousr]_[0-9A-Za-z]{30,}|\bgithub_pat_[0-9A-Za-z_]{40,}",
    r"\bxox[abprs]-[0-9A-Za-z-]{10,}",                      # Slack
    r"\bAIza[0-9A-Za-z_-]{35}",                             # Google API key
    r"\bsk-(ant-|or-|proj-)?[0-9A-Za-z_-]{32,}",            # Anthropic/OpenRouter/OpenAI
    r"\"private_key\"\s*:\s*\"",                            # service-account JSON
    r"\beyJ[0-9A-Za-z_-]{20,}\.eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}",  # JWT
    r"\b[a-z][a-z0-9+.-]*://[^\s:/@'\"]+:[^\s@/'\"]{6,}@",  # URL with a password
)]
ASSIGN = re.compile(r"""(?i)\b[A-Z0-9_.-]*(secret|token|passw(or)?d|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Z0-9_.-]*['"]?\]?\s*[:=]\s*(?:"([^"\n]{12,})"|'([^'\n]{12,})'|([^\s'"#,;]{12,}))""")


def git(*args):
    p = subprocess.run(["git", *args], capture_output=True, text=True, errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed")
    return p.stdout


SENSITIVE_NAME = re.compile(r"(?i)\b[A-Z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Z0-9_.-]*")
STRICT_KEY = re.compile(r"(?i)(secret|passw(or)?d|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)")


def looks_like_token(v, quoted=False, strict_key=False):
    """A literal secret, not code: no calls or dotted references, not a plain
    word or CONSTANT, and token-like (letters with digits, or long mixed case)."""
    if " " in v:  # prose ("At least 12 characters"), not a credential
        return False
    if not quoted and ("(" in v or v.startswith("/") or re.search(r"[\[\]^\\]", v)):
        return False
    if re.fullmatch(r"[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+", v):
        return False
    if re.fullmatch(r"[a-z_-]+|[A-Z_-]+", v):
        return False
    # Digit-free values count only for explicit secret/password/key names: under
    # "token" names they are camelCase constants ("tripActivityToken") and would
    # bury real hits.
    digitfree = strict_key and len(v) >= 16 and re.search(r"[a-z]", v) and re.search(r"[A-Z]", v)
    if not digitfree and (len(v) < 20 or not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v))):
        return False
    counts = {c: v.count(c) for c in set(v)}
    entropy = -sum(n / len(v) * math.log2(n / len(v)) for n in counts.values())
    return entropy >= (3.2 if digitfree else 3.5)


KEY_PATH_TOKEN = re.compile(r"[\w.~/-]*(?:/|\.)[\w.~/-]+")


def line_hits(line, paths=False):
    """(rule, key name, value length) per hit; never the value itself.
    paths=True also flags credential-like file paths named in the text."""
    out = [(f"pattern {i}", "", 0) for i, r in enumerate(CONTENT) if r.search(line)]
    if paths and any(PATH_RE.search(t) for t in KEY_PATH_TOKEN.findall(line)):
        out.append(("credential-like path in text", "", 0))
    for m in ASSIGN.finditer(line):  # every assignment, not only the first
        v = m.group(3) or m.group(4) or m.group(5)
        quoted = m.group(5) is None
        if not PLACEHOLDER.match(v) and looks_like_token(v, quoted, bool(STRICT_KEY.search(m.group(0).split("=")[0].split(":")[0]))):
            key = re.split(r"\s*[:=]", m.group(0))[0].strip(" '\"")[-40:]
            out.append(("assignment", key, len(v)))
    # A literal fallback (process.env.API_KEY || "x", os.getenv("TOKEN", "x")):
    # judged by the nearest sensitive name before it, which owns the fallback.
    for m in re.finditer(r"""(?:\|\||\?\?|\bor\b|,)\s*['"]([^'"\s]{12,})['"]""", line):
        names = SENSITIVE_NAME.findall(line[:m.start()])
        if not names:
            continue
        strict = bool(STRICT_KEY.search(names[-1]))
        if looks_like_token(m.group(1), True, strict) and not PLACEHOLDER.match(m.group(1)):
            out.append(("fallback literal", names[-1][-40:], len(m.group(1))))
    return out


def unquote(p):
    """Undo git's C-style path quoting ("a/caf\\303\\251.p12")."""
    if not (p.startswith('"') and p.endswith('"')):
        return p
    raw, out, i = p[1:-1], bytearray(), 0
    esc = {"n": 10, "t": 9, '"': 34, "\\": 92, "a": 7, "b": 8, "f": 12, "r": 13, "v": 11}
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw):
            if raw[i + 1] in "01234567":
                out.append(int(raw[i + 1:i + 4], 8)); i += 4; continue
            out.append(esc.get(raw[i + 1], ord(raw[i + 1]))); i += 2; continue
        out += c.encode(); i += 1
    return out.decode("utf-8", "replace")


def strip1(p, prefix):
    return p[len(prefix):] if p.startswith(prefix) else p


def header_paths(rest):
    """Both paths of a 'diff --git' header, quoted or not, spaces allowed;
    exactly one a/ or b/ prefix removed (a real top folder named b stays)."""
    if rest.startswith('"'):
        m = re.match(r'("(?:[^"\\]|\\.)*")\s+(.*)$', rest)
        if m:
            return [strip1(unquote(m.group(1)), "a/"), strip1(unquote(m.group(2)), "b/")]
    if " b/" in rest:
        a, b = rest.split(" b/", 1)
        return [strip1(unquote(a), "a/"), unquote(b) if b.startswith('"') else b]
    return [strip1(unquote(rest), "a/")]


def hidden(path):
    """Every credential-like name except .env files stays hidden in --explain."""
    return bool(PATH_RE.search(path)) and not re.search(r"(?i)(^|/)\.env(rc|\.[^/]*)?$", path)


def risky_link(target, link_path):
    """A symlink that leaves the repo or names a key path: reviewers would follow it.
    Relative targets are resolved from the link's own folder inside the repo."""
    t = target.strip()
    if t.startswith(("/", "~")) or PATH_RE.search(t):
        return True
    resolved = os.path.normpath(os.path.join(os.path.dirname(link_path), t))
    return resolved == ".." or resolved.startswith("../") or bool(PATH_RE.search(resolved))


def scan_diff(text, where, found, all_lines=False):
    cur, in_header, link = "?", False, False
    for line in text.splitlines():
        if line.startswith("diff --git "):
            paths = header_paths(line[len("diff --git "):])
            cur, in_header, link = paths[-1], True, False
            if any(PATH_RE.search(p) for p in paths):
                found.append((where, cur, "credential-like file name", "", 0))
        elif in_header and line.startswith(("+++ ", "--- ", "rename to ", "rename from ", "copy to ", "copy from ")):
            # Header lines only between 'diff --git' and the first hunk: a removed
            # SQL comment '-- x' shows as '--- x' inside a hunk and is content.
            raw = line.split(" ", 2)[-1] if line.startswith(("rename", "copy")) else line[4:]
            p = unquote(raw.strip())
            p = strip1(strip1(p, "a/"), "b/") if line.startswith(("+++", "---")) else p
            if p != "/dev/null" and PATH_RE.search(p) and p != cur:
                found.append((where, p, "credential-like file name", "", 0))
        elif in_header and (line.startswith(("new file mode 120000", "new mode 120000",
                                             "deleted file mode 120000", "old mode 120000"))
                            or (line.startswith("index ") and line.rstrip().endswith(" 120000"))):
            link = True  # new, deleted, mode-changed or retargeted symlink
        elif line.startswith("@@"):
            in_header = False
        elif link and (line[:1] == "+" or (all_lines and line[:1] == "-")) and risky_link(line[1:], cur):
            found.append((where, cur, "symlink out of the repo or to a key path", "", 0))
        elif line[:1] == "+" or (all_lines and line[:1] in ("-", " ")):
            found += [(where, cur, *h) for h in line_hits(line[1:])]


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "--list-allow":  # print allowances safely (summary.md)
        with open(argv[1]) as fh:
            items = [l.strip().partition("=") for l in fh if l.strip()]
        print("; ".join(f"{'(credential-named path)' if hidden(g) else g}={why}" for g, _, why in items))
        return 0
    explain, allow, rest, i = False, {}, [], 0
    while i < len(argv):
        if argv[i] == "--explain":
            explain = True
        elif argv[i] == "--allow":
            glob, _, why = argv[i + 1].partition("=")
            if not why.strip():
                raise RuntimeError("--allow needs GLOB=REASON")
            allow[glob] = why.strip()
            i += 1
        else:
            rest.append(argv[i])
        i += 1
    found = []
    if rest[0] == "--text":
        with open(rest[1], errors="replace") as fh:
            for l in fh.read().splitlines():
                found += [("text", "(text)", *h) for h in line_hits(l, paths=True)]
    elif rest[0] == "--diff":
        with open(rest[1], errors="replace") as fh:
            scan_diff(fh.read(), "diff", found, all_lines=True)
    elif rest[0] == "--worktree":
        scan_diff(git("-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--binary", "HEAD"), "working tree", found)
        # Staged content can differ from the files on disk, and it is what a commit records.
        scan_diff(git("-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--cached", "--binary", "HEAD"), "index", found)
        top = git("rev-parse", "--show-toplevel").strip()
        for rel in git("-C", top, "ls-files", "--others", "--exclude-standard", "-z").split("\0"):
            if not rel:
                continue
            f = f"{top}/{rel}"
            if os.path.islink(f):  # never follow a link: it may point into a key folder
                if PATH_RE.search(rel) or risky_link(os.readlink(f), rel):
                    found.append(("working tree", rel, "symlink out of the repo or to a key path", "", 0))
                continue
            if PATH_RE.search(rel):
                found.append(("working tree", rel, "credential-like file name", "", 0))
                continue
            try:
                with open(f, errors="replace") as fh:
                    for l in fh.read().splitlines():
                        found += [("working tree", rel, *h) for h in line_hits(l)]
            except OSError:
                pass
    else:
        if rest[0] == "--outgoing":
            shas = git("rev-list", *(rest[1:] or ["HEAD"]), "--not", "--remotes").split()
        else:
            base, head = rest[0], (rest[1] if len(rest) > 1 else "HEAD")
            shas = git("rev-list", f"{base}..{head}").split()
        for sha in shas:
            scan_diff(git("-c", "core.quotePath=false", "show", "--binary", "--format=", "--no-color", "--no-ext-diff", "--diff-merges=first-parent", sha), sha, found)
            for l in git("log", "-1", "--format=%B", sha).splitlines():
                found += [(sha, "(commit message)", *h) for h in line_hits(l)]
    kept = []
    for hit in found:
        glob = next((g for g in allow if fnmatch.fnmatch(hit[1], g)), None)
        # Only content hits can be allowed by a wildcard; credential-named files
        # and risky symlinks need their exact path.
        content = hit[2].startswith(("pattern", "assignment", "fallback"))
        if glob and (content or glob == hit[1]):
            continue
        kept.append(hit)
    for g, why in allow.items():
        shown = "(credential-named path)" if hidden(g) else g
        print(f"allowed: {shown} ({why})")
    by_where = {}
    for where, path, rule, key, length in kept:
        by_where.setdefault(where, []).append((path, rule, key, length))
    for where, hits in by_where.items():
        print(f"credential-like content: {where} ({len(hits)} match{'es' if len(hits) > 1 else ''})")
        if explain:
            for path, rule, key, length in hits:
                shown = "(key file or key folder, path hidden)" if hidden(path) else path
                print(f"    {shown}: {rule}" + (f" key={key} value_length={length}" if key else ""))
    print("clean" if not kept else "STOP: do not push, merge or send for review; tell the owner where, never the content")
    return 1 if kept else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(2)
