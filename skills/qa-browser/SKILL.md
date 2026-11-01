---
name: qa-browser
description: Run independent, report-only browser QA on a served web app, including reachable screens, real functional flows, break cases and per-screen no-slop screenshot critique. Use before pushing UI changes or for a PR-scoped QA report; does not replace the author's verify-live checks or fix product code.
---

# Independent browser QA

Read the target repo's AGENTS.md, design rules and `~/.claude/AGENTS.md`
section 0. Read `~/.claude/lessons/ui-verification.md` when available. Use
[verify-live](../verify-live/SKILL.md) for the author's production-build,
asset, native-device and visual evidence obligations. This skill reuses its
image/viewport checks; WebKit results never claim native Safari coverage.

Run against the served real app and real services. No mock responses, invented
flows, product fixes, commits, merges, deployments or production writes. Test
writes require isolated real sandbox data and declared reset/cleanup. Never
activate an undeclared destructive control. Never restart or signal an existing
server. A configured start command owns only the process it starts.

1. Read [the repo contract](references/contract.md). Load `qa-browser.json`
   from the target repo. Missing flows, accounts, design references or build
   identity make the run incomplete. Obtain secrets through the repo's existing
   trusted adapter; check only their existence, never print them or save session
   storage. Do not inspect private-key folders or credential files. An adapter
   reads a needed value into memory only immediately before use.
2. Run `node <skill>/scripts/run.mjs --config /repo/qa-browser.json --out /evidence`.
   Playwright resolves from the target repo or its explicit `playwrightPath`;
   nothing is installed. For PR scope append `--pr-base <base-ref>`. Export the
   repo compiler/bundler's complete base/head graphs first as described in the
   contract. Aliases, re-exports, lazy imports and CSS belong in that graph.
   Missing ownership falls back to all main flows, with the reason recorded.
3. Full runs cover 390x660, 412x620, 390x844, 820x1180 and 1440x900 in light/dark
   and Chromium/WebKit. Direct PR screens and uncertain ownership use all 12
   verify-live sizes; global-only main-screen samples use the spec's four sizes.
   Two workers, 60-second cells, 10-second actions, 30-minute capture cap. Unrun
   cells stay incomplete; never shrink the matrix to make a deadline.
4. Traverse declared controls and reachable states, checking every actual effect
   against the flows contract. Undeclared controls/routes are coverage gaps,
   never successful clicks. Break expectations must cover each reached form and
   input. Capture entry, control, overlay and break states; inspect every frame.
   Existing standing crawls run through the optional external command contract,
   including their real auth and cleanup. Do not copy their product logic into
   this public skill. Their nonzero exit is a failed/incomplete check.
5. Check Claude B capacity using cross-review's rules. Review runs separately
   from the capture cap: sequential Opus calls, ten minutes each, one retry.
   Sheets contain at most eight frames, one engine/theme per sheet, grouped by
   at most eight screens per call. Every suspected defect or unreadable detail
   flags that screen for a full-size second pass in chunks of eight frames.
   Each batch records its exact frame/screen coverage and attempts in
   `review-ledger.json`; incomplete or duplicate coverage never passes. No
   silent model fallback or paid API use. An unavailable batch after its retry
   remains incomplete. `reviewTimeoutMs` bounds the complete review separately
   (default two hours); never reduce required coverage to fit it.
6. Read `report.json` and `report.md`: per-screen disposition, reproduction steps,
   frame paths, control ledger, matrix, selection reasons and exclusions. Contact
   sheets cover the first pass; flagged screens require full-size follow-up. A screen passes
   only with complete functional checks and passing critique. Exit 0 is pass,
   1 confirmed failure, 2 incomplete/no verdict. Keep evidence private and mask
   account artifacts before sharing. Report defects; do not waive or fix them.

CI integration uses the repo's existing PR/reviewer lane on the current head.
No new workflow, service, dependency or unattended model billing is authorized.
Reuse local artifacts only when head and production asset identity match;
otherwise run again. The target lane owns superseded-head cancellation and
Depot's all-workload budget admission. Missing lane authentication or budget
admission stays incomplete. See [the specification](../../docs/qa-agent.md).

Tool self-tests: `node --test <skill>/scripts/*.test.mjs`. The browser regression
suite additionally needs `QA_PW_PATH=/absolute/path/to/package.json` pointing to
an existing Playwright install with Chromium and WebKit. Fixtures live only in
the tests. No real service is substituted in product QA.
