#!/usr/bin/env bash
# Real-browser test for capture.mjs: a local page with a broken token-named
# image, a token in a console error, and a button clipped by a viewport-sized
# overflow:hidden root. Asserts the issues are found and no token reaches the
# report. Needs a folder where Playwright resolves:
#   PW_DIR=~/Projects/ereno/e2e bash test-capture.sh
# Without PW_DIR it prints SKIPPED and exits 3: a skipped test is not a pass.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "${PW_DIR:-}" ] || { echo "SKIPPED: set PW_DIR to a folder where Playwright resolves"; exit 3; }
T="$(mktemp -d)"; echo "workdir $T" >&2; trap '{ kill $SRV; wait $SRV; } 2>/dev/null; [ -n "${KEEP:-}" ] || rm -rf "$T"' EXIT
TOKEN_IMG="Abcd1234efgh5678ijkl"
TOKEN_LOG="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY9"
cat > "$T/index.html" <<EOF
<!doctype html><html><head><meta name="viewport" content="width=device-width"></head>
<body style="margin:0">
<div id="app" style="overflow-x:hidden;width:100vw">
  <img src="/img/$TOKEN_IMG.png" width="100" height="50">
  <button style="position:relative;left:340px;width:120px">Save</button>
</div>
<script>console.error("login said token=CorrectHorseBatteryStaple")</script>
<script>console.error("sent Authorization: Bearer qwertyuiopasdfgh and access_key=abcdefghijklmnopq from ~/.private_keys/stage.p8")</script>
<img src="/blog/how-to-plan-a-trip-2026.png" width="10" height="10">
<script>console.error("auth failed after a long and entirely ordinary explanation of what the page was doing when the request went wrong for $TOKEN_LOG")</script>
</body></html>
EOF
PORT=$(( 20000 + RANDOM % 20000 ))
( cd "$T" && exec python3 -I -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) & SRV=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.3; done

cd "$PW_DIR" || exit 2
mkdir -p "$T/auth/reset-password-8f3a2b1c9d7e"; cp "$T/index.html" "$T/auth/reset-password-8f3a2b1c9d7e/index.html"
node "$HERE/../capture.mjs" --url "http://127.0.0.1:$PORT/auth/reset-password-8f3a2b1c9d7e/?session=$TOKEN_IMG" \
  --sizes 390x660 --engines chromium --themes light --no-full --out "$T/out" >/dev/null 2>&1
rc=$?
F=0
[ "$rc" = 1 ] || { echo "FAIL: exit $rc, want 1 (issues found)"; F=1; }
grep -q "broken image" "$T/out/report.md" || { echo "FAIL: broken image not reported"; F=1; }
grep -q "cross the viewport edge" "$T/out/report.md" || { echo "FAIL: clipped button not reported"; F=1; }
grep -q "console error" "$T/out/report.md" || { echo "FAIL: console error not reported"; F=1; }
if grep -rqE "$TOKEN_IMG|wJalrXUtnFEMI|K7MDENG|session=|8f3a2b1c9d7e|CorrectHorseBatteryStaple|qwertyuiopasdfgh|abcdefghijklmnopq|stage\.p8|private_keys" "$T/out" || ls "$T/out" | grep -q 8f3a2b; then echo "FAIL: a token reached the evidence folder"; F=1; fi
grep -q "how-to-plan-a-trip-2026" "$T/out/report.md" || { echo "FAIL: a readable slug was masked"; F=1; }
[ "$F" = 0 ] && echo "capture test: passed" || { sed 's/^/    /' "$T/out/report.md"; exit 1; }
