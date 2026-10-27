#!/usr/bin/env bash
# End-to-end tests for run-critics.sh with fake codex / claude / cursor-agent on
# PATH, so verdict parsing, exit codes, the credential guard and the panel rules
# are tested through the script's public interface. Run: bash test-run-critics.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$HERE/../run-critics.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
FAILS=0 PASSES=0
ok() { PASSES=$((PASSES + 1)); }
bad() { FAILS=$((FAILS + 1)); echo "FAIL: $*"; }

# Fake critics print whatever $T/reply-<name> holds (codex writes its -o file too).
mkdir -p "$T/bin"
cat > "$T/bin/codex" <<EOF
#!/usr/bin/env bash
out=""; while [ \$# -gt 0 ]; do [ "\$1" = "-o" ] && out="\$2"; shift; done
cat "$T/reply-codex"; [ -n "\$out" ] && cat "$T/reply-codex" > "\$out"
exit \$(cat "$T/rc-codex" 2>/dev/null || echo 0)
EOF
cat > "$T/bin/cursor-agent" <<EOF
#!/usr/bin/env bash
cat "$T/reply-grok"
EOF
cat > "$T/bin/claude" <<EOF
#!/usr/bin/env bash
cat > "$T/opus-stdin"; cat "$T/reply-opus"
EOF
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"

repo() {
  rm -rf "$T/repo"; mkdir "$T/repo"; cd "$T/repo" || exit 1
  git init -q; echo base > a.txt; git add a.txt; git -c user.name=t -c user.email=t@t commit -qm base
  echo change >> a.txt; echo new > untracked.txt
}
expect() { # expected-exit description args...
  want=$1; what=$2; shift 2
  "$RUN" "$@" --base HEAD --out "$T/out" >"$T/log" 2>&1; got=$?
  if [ "$got" = "$want" ]; then ok; else bad "$what: exit $got, want $want"; sed 's/^/    /' "$T/log"; fi
}
say() { printf '%s\n' "$2" > "$T/reply-$1"; }

repo
say codex $'1. [P3] a.txt:1 - nit - x - y\nVERDICT: approve'
say grok $'No findings.\n\nVERDICT: approve\n'
expect 0 "all approve passes" --implementer claude
grep -q "untracked.txt" "$T/out/review.diff" && ok || bad "untracked file missing from the frozen diff"
git status --short | grep -q '^??' && ok || bad "real index was touched"

say grok $'- [P1] a.txt:1 - real bug - x - y\nVERDICT: approve'
expect 1 "approve with a bulleted P1 is needs-changes" --implementer claude

say grok $'VERDICT: approve\nVERDICT: approve when there is no P0'
expect 2 "verdict must be the exact last line" --implementer claude

say grok $'**VERDICT: approve**'
expect 0 "markdown-wrapped verdict is accepted" --implementer claude

say grok $'VERDICT: approved'
expect 2 "approved is not approve" --implementer claude

say grok 'VERDICT: approve'; echo 1 > "$T/rc-codex"
expect 2 "a critic that exits non-zero gives no verdict" --implementer claude
rm -f "$T/rc-codex"

say codex $'[P0] x - y - z\nVERDICT: needs-changes'; say grok 'garbage'
expect 1 "needs-changes wins over no-verdict" --implementer claude

say codex 'VERDICT: approve'; say grok 'VERDICT: approve'; say opus 'VERDICT: approve'
expect 3 "dry run exits 3" --implementer claude --dry-run
expect 64 "same-family-only panel refused" --implementer claude --critics opus
expect 0 "codex author gets opus+grok (forced past the usage guard)" --implementer codex --force-opus
grep -q "adversarial code reviewer" "$T/opus-stdin" && ok || bad "opus prompt not passed on stdin"

repo; rm -rf "$T/out"; mkdir -p .private_keys; echo x > .private_keys/device
BEFORE="$(git count-objects -v | awk '/^count:/{print $2}')"
expect 64 "credential folder refused" --implementer claude
[ "$(git count-objects -v | awk '/^count:/{print $2}')" = "$BEFORE" ] && ok || bad "key file content was staged into the object store before refusal"
[ -e "$T/out/full.diff" ] && bad "full.diff written for a credential-named file" || ok
grep -q "device" "$T/log" && bad "refusal printed the file name" || ok
repo; printf 'k = "%s"\n' "ghp_$(printf 'Z%.0s' $(seq 36))" > src.ts
expect 64 "token in ordinary file refused" --implementer claude
[ -e "$T/out/full.diff" ] && bad "full.diff kept after a credential refusal" || ok

repo; mkdir -p tests; printf 'k = {"property_token": "%s"}\n' "ChZDSWb3x9QkLmN2pR7sT4vW8yZ1" > tests/fx.json
say codex 'VERDICT: approve'; say grok 'VERDICT: approve'
expect 64 "fake id in a test is refused by default" --implementer claude
expect 0 "and passes with a reasoned --scan-allow" --implementer claude --scan-allow "tests/*=fake ids in fixtures"
grep -q "tests/\*=fake ids in fixtures" "$T/out/summary.md" && ok || bad "allowance not recorded in summary.md"

# Usage guard (Claude B headroom), through a test log.
repo; say codex 'VERDICT: approve'; say grok 'VERDICT: approve'; say opus 'VERDICT: approve'
export USAGE_GUARD_LOG="$T/usage.log"
rm -f "$USAGE_GUARD_LOG"
expect 64 "opus refused without a usage log" --implementer codex
echo "09:10 A=5% B=5%" > "$USAGE_GUARD_LOG"; touch -t 202001010000 "$USAGE_GUARD_LOG"
expect 64 "opus refused on a stale log even if the clock time matches" --implementer codex
echo "09:10 A=5% B=?%" > "$USAGE_GUARD_LOG"
expect 64 "opus refused when B is unreadable" --implementer codex
echo "09:10 A=5% B=72%" > "$USAGE_GUARD_LOG"
expect 64 "opus refused above 60%" --implementer codex
echo "09:10 A=5% B=12%" > "$USAGE_GUARD_LOG"
expect 0 "opus runs on a fresh log with headroom" --implementer codex
unset USAGE_GUARD_LOG

# --pr must match HEAD (fake gh answers a different head).
cat > "$T/bin/gh" <<'EOG'
#!/usr/bin/env bash
echo 0000000000000000000000000000000000000000
EOG
chmod +x "$T/bin/gh"
"$RUN" --implementer claude --pr 5 --out "$T/out" >"$T/log" 2>&1; rc=$?
[ $rc = 64 ] && grep -q "is not PR #5's head" "$T/log" && ok || bad "--pr did not refuse a foreign head (exit $rc)"

# --pr with a matching head but a dirty tree is refused.
repo; git add -A; git -c user.name=t -c user.email=t@t commit -qm wip; echo dirty >> a.txt
H="$(git rev-parse HEAD)"; printf '#!/usr/bin/env bash\necho %s\n' "$H" > "$T/bin/gh"; chmod +x "$T/bin/gh"
git remote add origin "$T/repo" 2>/dev/null; git fetch -q origin 2>/dev/null
printf '#!/usr/bin/env bash\ncase "$*" in *baseRefName*) echo master;; *) echo %s;; esac\n' "$H" > "$T/bin/gh"; chmod +x "$T/bin/gh"
"$RUN" --implementer claude --pr 5 --out "$T/out" >"$T/log" 2>&1; rc=$?
[ $rc = 64 ] && grep -q "commit or set aside local changes" "$T/log" && ok || { bad "--pr did not refuse a dirty tree (exit $rc)"; sed 's/^/    /' "$T/log"; }

# A secret only in the index (deleted from disk, not unstaged) is still caught.
repo; printf 'TOKEN=ghp_%s\n' "$(printf 'Z%.0s' $(seq 36))" > c.sh; git add c.sh; echo 'TOKEN=' > c.sh
expect 64 "index-only secret refused" --implementer claude

# A token in a commit message on the branch is refused (critics can git log).
repo; git add -A; git -c user.name=t -c user.email=t@t commit -qm "rotate ghp_$(printf 'Z%.0s' $(seq 36))"; echo more >> a.txt
"$RUN" --implementer claude --base HEAD~1 --out "$T/out" >"$T/log" 2>&1; [ $? = 64 ] && ok || bad "token in a commit message was not refused"

# Brief with a credential is refused; --pr with --base is refused.
repo; printf 'see sk_live_%s\n' "$(printf 'A%.0s' $(seq 24))" > "$T/brief.md"
expect 64 "credential in the brief refused" --implementer claude --brief "$T/brief.md"
"$RUN" --implementer claude --pr 5 --base HEAD --out "$T/out" >"$T/log" 2>&1; [ $? = 64 ] && ok || bad "--pr with --base not refused"

# An old verdict file in a reused --out folder is not counted.
repo; mkdir -p "$T/out"; echo "VERDICT: approve" > "$T/out/codex.final.txt"
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/codex"; chmod +x "$T/bin/codex"; say grok 'VERDICT: approve'
expect 2 "stale codex.final.txt ignored" --implementer claude

# No verbatim credential rule anywhere = refuse (sandboxed HOME, repo without it).
repo; say codex 'VERDICT: approve'; say grok 'VERDICT: approve'
printf '#!/usr/bin/env bash\nout=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; echo "VERDICT: approve"; [ -n "$out" ] && echo "VERDICT: approve" > "$out"; exit 0\n' > "$T/bin/codex"; chmod +x "$T/bin/codex"
mkdir -p "$T/home"
HOME="$T/home" "$RUN" --implementer claude --base HEAD --out "$T/out" >"$T/log" 2>&1; rc=$?
[ $rc = 64 ] && grep -q "credential rule was not found" "$T/log" && ok || bad "missing credential rule not refused (exit $rc)"
mkdir -p "$T/home/.claude"; grep -m1 '^- When an agent looks for a credential' "$HOME/.claude/AGENTS.md" > "$T/home/.claude/AGENTS.md"
HOME="$T/home" "$RUN" --implementer claude --base HEAD --out "$T/out" >"$T/log" 2>&1; rc=$?
[ $rc = 0 ] && grep -qF "$(cut -c3-80 "$T/home/.claude/AGENTS.md")" "$T/out/prompt.txt" && ok || bad "rule not quoted verbatim from a sandboxed HOME (exit $rc)"

# The runner executes from a private copy: editing the original mid-run is harmless.
grep -q 'exec bash "$CR_COPY"' "$RUN" && ok || bad "private-copy re-exec missing"

# A key on a removed line must not reach critics.
repo; printf 'const S = "%s"\n' "sk_live_$(printf 'Q7w%.0s' $(seq 9))" > k.ts; git add k.ts; git -c user.name=t -c user.email=t@t commit -qm add; git rm -q k.ts
expect 64 "secret on a removed line refused" --implementer claude

echo "run-critics tests: $PASSES passed, $FAILS failed"
[ "$FAILS" = 0 ]
