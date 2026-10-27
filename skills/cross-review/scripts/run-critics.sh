#!/usr/bin/env bash
# run-critics.sh: freeze the current change and have read-only critics from
# other model families review it in parallel. Prints one verdict per critic and
# writes summary.md beside the transcripts.
#
# Exit: 0 every critic approved, 1 at least one asked for changes (wins over 2),
#       2 a critic returned no verdict, 3 dry run (nothing reviewed),
#       64 usage/setup error.
#
# Load-bearing flags (the reason this is a script, not a retyped command):
#   codex  -c 'mcp_servers={}'  otherwise it blocks on unauthorised MCP servers
#          --sandbox read-only  a critic must not edit what it reviews
#   claude --strict-mcp-config + no Edit/Write tools, run on Claude B's account
#   cursor --mode ask           Cursor's read-only mode
# Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no wait -n.
set -uo pipefail

# Run from a private copy: bash reads a script as it goes, so an edit to this
# file during a long run would otherwise corrupt the run in progress.
if [ -z "${CR_SCRIPT_DIR:-}" ]; then
  CR_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; export CR_SCRIPT_DIR
  CR_COPY="$(mktemp "${TMPDIR:-/tmp}/run-critics.XXXXXX")"; cp "$0" "$CR_COPY"
  CR_COPY_FILE="$CR_COPY" exec bash "$CR_COPY" "$@"
fi

usage() {
  cat >&2 <<'EOF'
usage: run-critics.sh --implementer claude|codex|cursor [options]
  --critics LIST   comma list of codex,opus,grok (default: every family except
                   the implementer's: claude->codex,grok  codex->opus,grok
                   cursor->codex,opus)
  --base REF       diff base (default: merge-base with origin's default branch)
  --pr N           assert HEAD is PR N's current head; base = its base branch
  --brief FILE     author's brief: intent, claims, prior findings, rebuttals
  --out DIR        output folder (default: /Volumes/DevBox/tmp/cross-review/...
                   when DevBox is mounted, else $TMPDIR/cross-review/...)
  --timeout SEC    per-critic watchdog (default 2400)
  --dry-run        freeze the diff and print the panel, run no critic (exit 3)
  --scan-allow G=R pass "--allow G=R" to the credential scanner (repeatable):
                   only for fake or public ids in tests, reason required;
                   recorded in summary.md
  --force-opus     run opus although usage-guard.log shows Claude B above 60%
                   (only when its session resets within about 30 minutes)
Env overrides: CODEX_MODEL (gpt-6-sol), OPUS_MODEL (claude-opus-5-5),
  CURSOR_MODEL (grok-4.7-high), CLAUDE_B_DIR (~/.claude-b)
EOF
  exit 64
}

IMPL="" CRITICS="" BASE="" PR="" BRIEF="" OUT="" TIMEOUT=2400 DRY=0 FORCE_OPUS=0
TMPIDX=""
SCAN_ALLOW_FILE="$(mktemp "${TMPDIR:-/tmp}/cr-allow.XXXXXX")"
DIFFS_UNSCANNED=""
trap 'rm -f "$SCAN_ALLOW_FILE" ${TMPIDX:+"$TMPIDX"} ${CR_COPY_FILE:+"$CR_COPY_FILE"} $DIFFS_UNSCANNED' EXIT
while [ $# -gt 0 ]; do
  case "$1" in
    --implementer) IMPL="${2:-}"; shift 2 ;;
    --critics) CRITICS="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --pr) PR="${2:-}"; shift 2 ;;
    --brief) BRIEF="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --force-opus) FORCE_OPUS=1; shift ;;
    --scan-allow) printf '%s\n' "${2:-}" >> "$SCAN_ALLOW_FILE"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

case "$IMPL" in
  claude) DEFAULT="codex,grok" ;;
  codex) DEFAULT="opus,grok" ;;
  cursor) DEFAULT="codex,opus" ;;
  *) echo "--implementer must be claude, codex or cursor" >&2; usage ;;
esac
CRITICS="${CRITICS:-$DEFAULT}"
CRITICS="$(echo "$CRITICS" | tr ',' ' ')"
for c in $CRITICS; do
  case "$c" in codex|opus|grok) ;; *) echo "unknown critic: $c" >&2; exit 64 ;; esac
  # A critic from the implementer's own family is allowed only as an extra
  # (some repos ask for it); the panel must still hold another family.
done
OTHER=0
for c in $CRITICS; do
  case "$IMPL:$c" in claude:opus|codex:codex|cursor:grok) ;; *) OTHER=1 ;; esac
done
[ "$OTHER" = 1 ] || { echo "panel has no critic from another family than $IMPL" >&2; exit 64; }

# Claude B headroom: the owner's rule routes away from an account above 60%.
# Fail closed: a missing or unreadable log, or one not written in the last 20
# minutes (file mtime, so yesterday's line cannot pass), refuses opus. The log
# carries session use only: weekly limits are the agent's to check before
# --force-opus.
GUARD="${USAGE_GUARD_LOG:-/Volumes/DevBox/tmp/usage-guard.log}"
case " $CRITICS " in *" opus "*)
  if [ "$FORCE_OPUS" = 0 ]; then
    B="$(tail -1 "$GUARD" 2>/dev/null | sed -n 's/.*B=\([0-9][0-9]*\)%.*/\1/p')"
    MTIME="$(stat -f %m "$GUARD" 2>/dev/null || stat -c %Y "$GUARD" 2>/dev/null || echo 0)"
    AGE=$(( $(date +%s) - MTIME ))
    if [ -z "$B" ] || [ "$AGE" -gt 1200 ]; then
      echo "cannot confirm Claude B headroom ($GUARD missing, older than 20 min or unreadable); restart the logger, drop opus, or check /usage (session and weekly) and pass --force-opus" >&2
      exit 64
    fi
    if [ "$B" -gt 60 ]; then
      echo "Claude B is at ${B}% (usage-guard.log): drop opus, or pass --force-opus if it resets within ~30 min" >&2
      exit 64
    fi
  fi ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not in a git checkout" >&2; exit 64; }
cd "$ROOT" || exit 64
REPO="$(basename "$ROOT")"
HEAD_SHA="$(git rev-parse HEAD)"

if [ -n "$PR" ]; then
  [ -z "$BASE" ] || { echo "--pr uses the PR's own merge-base; do not combine it with --base" >&2; exit 64; }
  PR_HEAD="$(gh pr view "$PR" --json headRefOid -q .headRefOid)" || exit 64
  [ "$PR_HEAD" = "$HEAD_SHA" ] || { echo "HEAD $HEAD_SHA is not PR #$PR's head $PR_HEAD; check out the PR head first" >&2; exit 64; }
  [ -z "$(git --no-optional-locks status --porcelain)" ] || { echo "--pr reviews the PR head exactly: commit or set aside local changes first (the record would name a head that lacks them)" >&2; exit 64; }
  PR_BASE="$(gh pr view "$PR" --json baseRefName -q .baseRefName)"
  git fetch origin "$PR_BASE" --quiet || { echo "could not fetch origin/$PR_BASE; refusing to guess the PR base" >&2; exit 64; }
  BASE="$(git merge-base "origin/$PR_BASE" HEAD)" || exit 64
fi
if [ -z "$BASE" ]; then
  DEF="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  DEF="${DEF:-main}"
  git fetch origin "$DEF" --quiet
  BASE="$(git merge-base "origin/$DEF" HEAD)"
fi
BASE="$(git rev-parse "$BASE")" || exit 64

STAMP="$(date +%Y%m%d-%H%M%S)"
if [ -z "$OUT" ]; then
  if [ -d /Volumes/DevBox/tmp ]; then OUT="/Volumes/DevBox/tmp/cross-review/$REPO-${HEAD_SHA:0:8}-$STAMP"
  else OUT="${TMPDIR:-/tmp}/cross-review/$REPO-${HEAD_SHA:0:8}-$STAMP"; fi
fi
mkdir -p "$OUT" || exit 64

# Freeze the change: committed + staged + unstaged + untracked (not ignored),
# through a throwaway index so the real index is never touched.
TMPIDX="$(mktemp "${TMPDIR:-/tmp}/cr-index.XXXXXX")"
cp "$(git rev-parse --git-path index)" "$TMPIDX" 2>/dev/null || true
# Credential-named paths are refused before anything is staged or diffed, so
# their contents never enter the object store or an output file.
SCAN="$CR_SCRIPT_DIR/../../merge-safe-prs/scripts/scan-secrets.py"
[ -f "$SCAN" ] || { echo "credential scanner missing at $SCAN; refusing to send the diff out" >&2; exit 64; }
if ! { git ls-files -z --others --exclude-standard; git diff -z --name-only "$BASE"; git diff -z --cached --name-only "$BASE"; } \
     | python3 -I -c 'import importlib.util,sys; s=importlib.util.spec_from_file_location("s",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); names=sys.stdin.buffer.read().decode("utf-8","replace").split("\0"); sys.exit(1 if any(m.PATH_RE.search(n) for n in names if n) else 0)' "$SCAN"; then
  echo "refusing: the change includes credential-named files; take them out of the change (or the working tree) first" >&2
  exit 64
fi
GIT_INDEX_FILE="$TMPIDX" git add -A . || exit 64

DIFFS_UNSCANNED="$OUT/full.diff $OUT/.index.diff"  # removed on any exit until the scan passes
GIT_INDEX_FILE="$TMPIDX" git -c core.quotePath=false -c color.ui=never diff --no-color --no-ext-diff --cached --binary "$BASE" > "$OUT/full.diff"
[ -s "$OUT/full.diff" ] || { echo "empty diff against $BASE; nothing to review" >&2; exit 64; }
# Credential guard, before any critic (or a vendor's cloud) sees the change.
# The scanner prints counts only, never file names or content.
set --
while IFS= read -r a; do [ -n "$a" ] && set -- "$@" --allow "$a"; done < "$SCAN_ALLOW_FILE"
# The real index can hold content the working tree no longer has, and a commit
# records the index: scan it too (it is not sent to critics).
git -c core.quotePath=false -c color.ui=never diff --no-color --no-ext-diff --cached --binary "$BASE" > "$OUT/.index.diff"
python3 -I "$SCAN" "$@" --diff "$OUT/.index.diff" >/dev/null; IDX_RC=$?
rm -f "$OUT/.index.diff"
# Commits in BASE..HEAD (messages included) are readable by critics through git.
python3 -I "$SCAN" "$@" "$BASE" HEAD >/dev/null; LOG_RC=$?
if [ "$IDX_RC" -ne 0 ] || [ "$LOG_RC" -ne 0 ] || ! python3 -I "$SCAN" "$@" --diff "$OUT/full.diff" >/dev/null; then
  rm -f "$OUT/full.diff"
  echo "refusing: the change contains credential-like files or content; remove it from the change (and the working tree) first" >&2
  exit 64
fi
DIFFS_UNSCANNED=""
DIGEST="$(shasum -a 256 "$OUT/full.diff" | cut -d' ' -f1)"
{
  echo "# base $BASE  head $HEAD_SHA  digest sha256:$DIGEST"
  GIT_INDEX_FILE="$TMPIDX" git -c color.ui=never diff --no-color --cached --stat "$BASE"
  echo
  GIT_INDEX_FILE="$TMPIDX" git -c color.ui=never diff --no-color --no-ext-diff --cached "$BASE" -- . \
    ':!*.png' ':!*.jpg' ':!*.jpeg' ':!*.webp' ':!*.gif' ':!*.mp4' \
    ':!pnpm-lock.yaml' ':!package-lock.json' ':!yarn.lock' ':!*.lock'
} > "$OUT/review.diff"
# Lockfiles are reviewed too (a resolution swap is a supply-chain change), in
# their own file so a huge lock diff does not bury the code.
GIT_INDEX_FILE="$TMPIDX" git -c color.ui=never diff --no-color --no-ext-diff --cached "$BASE" -- \
  'pnpm-lock.yaml' 'package-lock.json' 'yarn.lock' '*.lock' '**/pnpm-lock.yaml' \
  '**/package-lock.json' '**/yarn.lock' '**/*.lock' > "$OUT/lockfiles.diff"
LOCKNOTE="No lockfile changed."
[ -s "$OUT/lockfiles.diff" ] && LOCKNOTE="Lockfiles changed: $OUT/lockfiles.diff. Check every changed resolution, tarball URL, registry and integrity hash; flag anything not explained by a manifest change in the diff."

BRIEF_TEXT="(no brief given: infer intent from the diff and say what you assumed)"
if [ -n "$BRIEF" ]; then
  [ -f "$BRIEF" ] || { echo "brief not found: $BRIEF" >&2; exit 64; }
  python3 -I "$SCAN" --text "$BRIEF" >/dev/null || { echo "refusing: the brief contains credential-like content" >&2; exit 64; }
  cp "$BRIEF" "$OUT/brief.md"; BRIEF_TEXT="$(cat "$BRIEF")"
fi
# The owner's credential rule goes to every critic word for word when it exists.
# Fail closed: no verbatim rule found, no critic run.
CRED_RULE=""
for f in "$HOME/.claude/AGENTS.md" "$ROOT/AGENTS.md" "$HOME/.codex/AGENTS.md" "$HOME/.agents/AGENTS.md"; do
  CRED_RULE="$(grep -m1 '^- When an agent looks for a credential' "$f" 2>/dev/null | sed 's/^- //')"
  [ -n "$CRED_RULE" ] && break
done
[ -n "$CRED_RULE" ] || { echo "the owner's credential rule was not found in any AGENTS.md; it must be quoted verbatim to critics" >&2; exit 64; }

PROMPT="You are an independent, adversarial code reviewer from a different model family than the author. You review only: never edit files, commit, push, install, or run anything that writes.

Repository root: $ROOT
Read its AGENTS.md and CLAUDE.md first (whichever exist); they are the contract this change is judged against.
Frozen diff to review: $OUT/review.diff (base $BASE, head $HEAD_SHA, digest sha256:$DIGEST; images and lockfiles are listed in the stat but omitted from the text). Read it whole, then read the touched files with full surrounding context. Uncommitted and new files are in the diff; the working tree matches it.
$LOCKNOTE

Author's brief = the severity contract (scope, claims, threat model, known limits; verify the claims, do not trust them):
$BRIEF_TEXT

Priorities, in order:
1. Correctness and security defects, each with a concrete failing scenario (inputs or state -> wrong result).
2. Claims in the brief, PR body, comments or docs that the code does not keep.
3. Tests that pass vacuously, mirror the implementation or miss the edge that matters; name the mutation that would slip through.
4. Violations of the repo's own rules (AGENTS.md / CLAUDE.md), DRY/KISS/YAGNI breaks, untyped boundaries.
Report only real problems; skip style nits no repo rule asks for. If a prior finding in the brief was rebutted, judge the rebuttal on its evidence.
Credential rule (verbatim from the owner): $CRED_RULE

Output: numbered findings, each as
[P0|P1|P2|P3] path:line - defect - failing scenario - fix direction
P0/P1 block the change and mean a defect INSIDE the brief's scope and claims (false pass, crash, leak, broken repo rule). Outside the stated scope or a documented limit, grade P2 unless you show a realistic path to real harm. P2/P3 do not block. Use the bracketed tags only for findings
that are still open; mention earlier or fixed findings without brackets. Then
end with exactly one final line:
VERDICT: approve
(when there is no P0 or P1 finding) or
VERDICT: needs-changes"

printf '%s\n' "$PROMPT" > "$OUT/prompt.txt"

model_of() {
  case "$1" in
    codex) echo "${CODEX_MODEL:-gpt-6-sol}" ;;
    opus) echo "${OPUS_MODEL:-claude-opus-5-5}" ;;
    grok) echo "${CURSOR_MODEL:-grok-4.7-high}" ;;
  esac
}

echo "cross-review: $REPO base ${BASE:0:8} head ${HEAD_SHA:0:8} digest ${DIGEST:0:16}"
echo "cross-review: implementer $IMPL, critics: $CRITICS"
echo "cross-review: output $OUT"
if [ "$DRY" = 1 ]; then
  for c in $CRITICS; do echo "  would run $c ($(model_of "$c"))"; done
  echo "cross-review: DRY RUN, nothing reviewed"
  exit 3
fi

# A reused --out folder must not hand an old verdict to this run.
for c in $CRITICS; do rm -f "$OUT/$c.txt" "$OUT/$c.final.txt"; done
PIDS="" WDS=""
for c in $CRITICS; do
  log="$OUT/$c.txt"
  case "$c" in
    codex)
      codex exec -m "$(model_of codex)" -c 'mcp_servers={}' -c model_reasoning_effort=high \
        --sandbox read-only --cd "$ROOT" -o "$OUT/$c.final.txt" -- "$PROMPT" </dev/null >"$log" 2>&1 & ;;
    opus)
      CLAUDE_CONFIG_DIR="${CLAUDE_B_DIR:-$HOME/.claude-b}" claude -p --model "$(model_of opus)" \
        --strict-mcp-config --disallowedTools "Edit,Write,NotebookEdit,Bash" \
        --allowedTools "Read,Grep,Glob" \
        <"$OUT/prompt.txt" >"$log" 2>&1 & ;;  # prompt on stdin: the tool lists are variadic
    grok)
      cursor-agent -p --mode ask --trust --model "$(model_of grok)" --workspace "$ROOT" \
        --output-format text "$PROMPT" </dev/null >"$log" 2>&1 & ;;
  esac
  pid=$!
  ( sleep "$TIMEOUT"; kill "$pid" 2>/dev/null && echo "WATCHDOG: killed after ${TIMEOUT}s" >>"$log" ) &
  PIDS="$PIDS $pid" WDS="$WDS $!"
  echo "  started $c ($(model_of "$c")) pid $pid"
done

set -- $WDS
NEEDS=0 MISSING=0 ROWS=""
for c in $CRITICS; do
  pid="$(echo $PIDS | cut -d' ' -f1)"; PIDS="$(echo $PIDS | cut -d' ' -f2-)"
  wd="$1"; shift
  wait "$pid"; rc=$?
  { pkill -P "$wd"; kill "$wd"; wait "$wd"; } 2>/dev/null
  # The verdict is the LAST non-empty line of the critic's final message, exact.
  final="$OUT/$c.final.txt"; [ -s "$final" ] || final="$OUT/$c.txt"
  last="$(grep -v '^[[:space:]]*$' "$final" | tail -1 | tr -d '*_`' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  case "$last" in
    "VERDICT: approve") v=approve ;;
    "VERDICT: needs-changes") v=needs-changes ;;
    *) v="" ;;
  esac
  [ "$rc" -ne 0 ] && v=""
  # An approval that still lists a blocking finding is not an approval.
  if [ "$v" = approve ] && grep -Eq '\[P[01]\]' "$final"; then v=needs-changes; fi
  case "$v" in
    approve) ;;
    needs-changes) NEEDS=1 ;;
    *) v="no-verdict (exit $rc)"; MISSING=1 ;;
  esac
  echo "  $c: $v"
  ROWS="$ROWS| $c | $(model_of "$c") | $v | $OUT/$c.txt |
"
done
RESULT=0
[ "$MISSING" = 1 ] && RESULT=2
[ "$NEEDS" = 1 ] && RESULT=1
case "$RESULT" in 0) OVERALL="PASS" ;; 1) OVERALL="NEEDS CHANGES" ;; *) OVERALL="INCOMPLETE (a critic gave no verdict)" ;; esac
cat > "$OUT/summary.md" <<EOF
# Cross-review: $OVERALL

- Repo: $REPO
- Base: $BASE
- Head: $HEAD_SHA
- Frozen diff digest: sha256:$DIGEST
- Implementer family: $IMPL
- Mode: $(if [ -n "$PR" ]; then echo "--pr $PR (clean tree: head SHA identifies the reviewed code)"; else echo "local tree (match by digest)"; fi)
- Credential-scan allowances: $(if [ -s "$SCAN_ALLOW_FILE" ]; then python3 -I "$SCAN" --list-allow "$SCAN_ALLOW_FILE"; else echo none; fi)
- Date: $(date -u +%Y-%m-%dT%H:%MZ)

| Critic | Model | Verdict | Transcript |
| --- | --- | --- | --- |
$ROWS
EOF
echo "cross-review: $OVERALL -> $OUT/summary.md"
exit "$RESULT"
