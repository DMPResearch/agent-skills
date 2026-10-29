# Practice-audit acceptance, 2026-10-29

## Corrections

Earlier reports overstated Claude completion and Ereno precision. A Claude
process that did not read its prompt was not an audit. The old 15 Ereno length
findings ignored its exemptions/ratchet; the later two URL blockers were weak
word passwords in credential-rejection tests, not high-entropy secrets. These
measurements replace those claims. No audited repo was edited.

The shared pre-push recognizer retains main's broad credential coverage.
Five individually tested cases still flag: a fallback after load(), a header
setter, an auth argument, a token setter argument and an unquoted assignment.
Only actual optional/dotted references, generic type annotations and Read
permission path strings are excluded. The source checker uses a stricter
high-entropy password rule for default URL violations; weak URLs remain
candidates. No allowance was added.

## Final calibration, including the hard slop gate

| Family | Mechanical | Judgment | Smells | Design | Files inspected |
| --- | --- | --- | --- | --- | --- |
| Claude claude-opus-5-5 | 2/2 | 14/14 | 3/3 | 2/2 | 24 |
| Codex gpt-6-sol high | 2/2 | 14/14 | 3/3 | 2/2 | 24 |

Checker recall: 2/2. Final score passed, zero misses and zero unmatched.
ENG-002 is scored at file level, not a preferred report line. UI-DS-001 and
ENG-SMELL-004 were merged into UI-002 and ENG-003. The four no-ai-slop
blockers are checked first; relevant seed IDs accept the corresponding hard
gate verdict rather than requiring duplicate detailed findings.

An earlier fresh run after the scanner repairs passed with zero unmatched.
After adding section 0, the first slop-first run exposed undeclared inputs and
generic copy in two purported controls. Both were repaired before a new run;
a behavioral import/call test failed first for the input example. The hierarchy
seed also accepted the new design hard-gate ID. No completed report was edited
or rescored into the final pass. The last fresh run above is recorded at:
/Volumes/DevBox/tmp/practices-critic-slop-calibration-r2/{score.json,audit/report.json}.
Expected answers were written only after both auditors finished. The answer key
was absent from their repo and prompt workspace. This small seeded benchmark
measures recall on these cases, not exhaustive reliability in arbitrary repos.
Codex ran without a verified active guard hook; its read-only sandbox and
prompt are not a complete credential-read sandbox.

## Read-only real repositories

Ereno 259ca8aaa5fc56d112a464846f78323415c39045: zero violations, 16,481
candidates; readable/pretty-JSON candidate summaries 157/199 lines.
Gretly Platform db8c65033ab297e8f0a83b21aa7831ff9a61da99: zero violations,
1,147 candidates; summary sections 94/120 lines. With no positive violations,
precision is undefined; this is not a claim that every repository is clean.
The two formerly flagged rejection-test URLs are candidates. Provider formats
and real key material still fail in raw docs, comments, tests and JSON.

Ereno imports its own scripts/check-file-size.mjs exemptions and
scripts/file-size-legacy.json budgets through extensions/ereno.json, as inert
data. Lexicon logic is exempt by that explicit repo policy, not its filename.
Config-named modules with functions/references are not literal-only data.
Existing seven ratcheted files remain within their budgets; no new exemption
was installed in Ereno. Its two host-AST syntax warnings remain unverified for
smells: apps/api/contract/artifact_js.py and apps/api/tests/test_pdf_filename.py.
Secret and length checks still ran. Platform has no parser warnings.
Raw reports: /Volumes/DevBox/tmp/practices-critic-{ereno,platform}-final.json.

## Local verification and scope

93 tooling/scorer/policy tests, 46 scanner tests, 22 hook tests, 38 review-runner
tests and four reference-capture Node tests pass. verify-live's real-browser
capture suite also passes with PW_DIR=/Volumes/DevBox/worktrees/gb-continue-assembly/node_modules/playwright.
Full logs are under /Volumes/DevBox/tmp/practices-critic-*. Slop policy and
severity tests were observed failing before their implementation. All three
touched skills validate, catalogue output is generated from JSON, and whitespace
checks pass. No product UI, dependency, CI job or reviewer wiring was changed.

The QA spec is next-piece work: local before push, automatic UI PR trigger,
Chromium/WebKit CI, 48 cells for directly affected screens and 16-cell samples
for every main screen on global changes. It budgets from 34 recent org PRs,
not only the builder repo. Pinning and actual timing/spend remain enablement
decisions. Independent review of this worker diff belongs to the parent
orchestrator; calibration is not an implementation review.
