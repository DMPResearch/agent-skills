# qa-browser: independent browser QA, next piece

Specification only. This commit does not implement the skill, run browser QA,
add dependencies or wire CI. After this piece is pushed, implement qa-browser
as the independent report-only QA agent. verify-live remains the author's own
production-build and browser verification; passing it does not replace QA.

## Trigger and scope

Agents run qa-browser locally before pushing. Run it again in the existing CI
on every PR that touches UI; reuse verified local artifacts where the CI
contract supports their build/head identity. Use Depot only for checks that
cannot run on the Mac, not as the first test of a change. The automatic PR
trigger remains required; no manual or scheduled workflow is introduced. Use
the current PR head and merge-base, never stale screenshots. Test what the PR
affects using the matrix tiers below; do not run unrelated flows merely
because they exist.
No code edits, commits, merges, deployments or production writes by QA.

Each repo provides a versioned flows file. Every route/flow declares its id,
URL, entry components, main-screen status, supported auth/data states, steps,
visible-control destinations/effects and assertions, safe reset/cleanup, and
any relevant service dependencies. It also identifies global design tokens,
global styles and the approved visual references. A declared destructive
control is exercised only against isolated test data and real sandbox services.

Build a reverse import graph using the repo's existing compiler/bundler graph,
including aliases, re-exports, lazy imports and stylesheet imports. Walk from
each changed file through importers to the entry components in the flows file.
The resulting routes and flows form the test scope. Renames/deletions use the
union of base and head graphs. Record the import path that selected each flow.
A dependency change affecting UI counts; do not filter only by .tsx filenames.

Global tokens or global styles touch every main screen. Sample one declared
representative state of every main screen at exactly four sizes: 390x660,
430x932, 820x1180 and 1440x900, in both themes and both CI engines. Walk deeper
flows and use all 12 sizes only where their own entry/component files changed.
The sampled main-screen set is not limited to four screens; all main screens
are represented. When direct and shared scopes overlap, use the full tier
once. When graph resolution, dynamic loading
or route ownership is uncertain, fall back to the declared main flows and say
why. Missing mappings are not permission to skip coverage. If a repo has no
flows file, report incomplete with the missing contract; do not invent flows.

## Runtime and matrix

Build the actual production app once and verify consistent HTML/JS/CSS hashes.
Use real test services/data; no demo mode or stub success paths. Reuse
verify-live's capture, asset, image, viewport and theme checks where available,
adding the independent issue/report contract here. Pinning Playwright
and its matching browser binaries in CI is an open implementation decision,
not a dependency change authorized by this document. Playwright
supports Chromium, WebKit and Firefox plus device emulation; the native iOS
Safari simulator check is a separate lane, not renamed WebKit evidence.
[Browser support](https://playwright.dev/docs/browsers).

For directly touched screens/flows, use light and dark at:

| Family | Visible viewport sizes |
| --- | --- |
| Short phones | 360x640, 390x660, 412x620, 412x660 |
| Tall phones | 390x844, 430x932 |
| Foldables | 344x880 outer, 755x1000 inner |
| Portrait tablets | 744x1133, 820x1180 |
| Wide tablet / desktop | 1024x768, 1440x900 |

CI runs Chromium and WebKit only: 48 cells per directly touched screen/state,
or 16 cells per shared/global main-screen sample. Firefox and real iPhone/iPad
Safari simulators run locally where available or on explicit request, including
short phone and portrait tablet checks in both themes. They are not mandatory
CI lanes or paid macOS runner requirements. Record actual device/viewport;
unavailable Safari is explicitly unrun, not a WebKit pass. Check cross-site
phone entry from another app where the flow depends on login/navigation.

## Browser QA

Walk each selected main flow and enumerate every visible interactive control
in every reached state. Use role/label locators. Compare observed navigation,
sheet, download or state changes with the flows contract; a click without the
expected effect fails as a dead control. Scroll every section, including sheets
and dialogs. Capture a control coverage ledger, not only the first fold.
Never activate an undeclared destructive control; report blocked coverage.

Collect console errors and warnings, uncaught exceptions, failed requests,
HTTP failures, and slow requests using repo-specific thresholds. Record timings,
status, initiating action and redacted URL. Compare assets to the production
build; catch mixed builds, missing JS/CSS/fonts and cache/service-worker races.
Do not blanket-ignore warnings or third-party failures; classify them with
explicit evidence and any repo-owned allowlist.

Check overflow, edge clipping, text contrast, fixed bars hiding content,
background/context behind overlays, sharp images, broken loads, intrinsic
aspect ratios and distortion. Check keyboard focus order, visible focus,
Escape, focus containment/restoration, labels, roles, target size and reduced
motion/transparency. Test reload, back, forward, an existing stale tab and a
fresh navigation. Exercise empty/long/RTL input, loading/empty/error/expired
session states, offline/slow network and double submit. Use actual service
error states or declared safe test controls, not fabricated product responses.

Map these findings to existing UI/TEST rules, including UI-DS-002..004,
TEST-006..018 and repo extensions. A new issue without an existing rule gets a
stable proposed repo rule, not an invented universal severity shortcut.

## Independent screenshot critique

Open every required capture at its intended viewing size first. Give Opus as the primary
screenshot critic and Codex as the second critic the same latest captures,
reference screens, changed-flow intent and coverage ledger. Both must actually
read the images. They judge UI-008 through UI-025, theme leaks, wrong tints,
contrast, colour flashes, state glitches, hierarchy and polish. They report
specific defects, not a score. Reuse verify-live's evidence/matrix mechanics
and cross-review's independence/capacity conventions; this phase is QA's
independent critique, not a rerun of the author's self-check. No silent fallback.
A missing critic or unreadable screenshot makes that part incomplete.

## Output and CI disposition

Emit one report (JSON plus a readable view) containing PR head, build identity,
selected screens/flows and the dependency path/reason for selection, all cells
run, controls tested, fallback decisions, exclusions and unrun checks.
Each issue includes rule id, severity, browser/version, visible size, theme,
state, numbered reproduction steps, expected/actual result, screenshot and
trace/network evidence where useful. Redact credentials, personal data and
account artifacts before sharing. Duplicate issues may group cells but must
retain every affected browser/size/theme. A confirmed issue is distinct from
an unverified suspicion. QA never fixes code or declares skipped cells passed.

Use the existing CI/reviewer lane; no new paid service or GitHub-hosted jobs.
A blocker/major defect fails QA. Minor findings remain visible. Incomplete
coverage or an unavailable mandatory critic is a no-verdict status, not green.
The owner can decide disposition outside this report; the agent cannot waive
its own findings. Cancel superseded heads and keep artifacts scoped to the PR.

## Time and cost envelope

Initial hard wall-clock cap: 30 minutes per PR, including build and critics;
per-cell timeout 60 seconds and per-flow action timeout 10 seconds unless the
repo declares a measured slower contract. Start with two browser workers in
one existing 2-vCPU Linux CI sandbox; workers share that sandbox, not separately
billed jobs. Optional native Safari stays on the existing local Mac. Cancel
superseded heads. Never shrink required cells or omit main screens to meet the
cap. On timeout save evidence and list the remainder as incomplete; no green
verdict. Large direct-screen changes need measured optimization or an explicit
higher-cap decision, not an automatic retry.

Planning workload: two direct screens give 96 cells. A shared-style change
across 15 additional main screens gives 240 sampled cells rather than 720.
At an assumed five-second smoke/capture cell and two workers, 336 cells need
14 browser minutes; allow five build minutes, five critic minutes and five
minutes for deeper directly affected flows: 29 minutes total. These timings
are assumptions to benchmark, not a coverage guarantee. Cost scales with actual
state/flow duration and repeat heads, not only screen count.

Recent org rate measured read-only on 2026-10-29: GitHub search found 34 PRs
created since 2026-10-15 across DMPResearch (13 gretly-builder, 16 ereno,
two flowstarter and three dmpresearch-landing). At 14 days this is roughly
73 PRs per 30 days. Budget for 75 UI PRs/month and three CI heads per PR:
225 runs, conservatively treating every PR as UI. Source command:
`gh search prs --owner DMPResearch --created '>=2026-10-15' --limit 1000 --json createdAt,repository`.
Recompute the rate and actual UI share before enablement; cancel superseded
heads and reuse same-head verified local evidence wherever the CI contract
supports it. The estimate does not assume savings from canceled runs.

Depot CI lists $0.00005/vCPU-second. A single 2-vCPU sandbox therefore costs
$0.006/minute at marginal rates. At 29 minutes, estimate $0.174/run; at the
30-minute cap, $0.18/run. For 225 runs: $39.15 typical or $40.50 capped monthly
compute. Adding the $20 Developer plan gives $59.15 or $60.50 against the
owner's $70 all-Depot monthly cap, leaving $10.85 or $9.50 for other usage.
These gross estimates deduct no included minutes and exclude other workloads,
cache overages and taxes. Verify the actual subscription and month-to-date
spend before enablement; existing workloads may consume all headroom, and a
$200 plan cannot fit this cap. Benchmark the 2-vCPU lane rather than silently
switching to a larger, more costly runner.
[Depot pricing](https://depot.dev/pricing).

Screenshot critics consume existing Opus/Codex subscription quota locally by
default; do not assume those subscriptions include unattended CI authentication.
CI must invoke the already authorized reviewer lane or record an incomplete
critic stage. If API billing is needed, seek approval and configure actual
model/image rates and a separate per-run ceiling first. No paid model API or
new runner service is authorized here. Report compute and model charges
separately. Admission requires current spend plus forecast all-Depot costs
below $70; otherwise queue/report a budget blocker, without silent extra spend.

## Repo inputs and open decisions

Required: production build/start command, base URL/health readiness contract,
flows/import-graph configuration, supported themes and theme switch hook,
network timing thresholds, approved design references, real test services and
safe per-run data reset. Supply a test account through existing secret handling
and trusted CI secret references; never commit login state or ask for keys in
chat. Missing accounts, services or credentials make coverage blocked.

Open accessibility tooling decision: use the repo's existing axe integration
if present, or approve @axe-core/playwright/axe-core in the next piece. Native
Playwright role assertions, ARIA snapshots and keyboard interaction can test
labels, semantics and focus behavior, but are not a complete automated WCAG
engine. Playwright's documented broad accessibility scans use axe and still
require manual assessment. [Accessibility testing](https://playwright.dev/docs/accessibility-testing).
Open CI decision: pin the installed Playwright package and matching Chromium/
WebKit binaries using the existing dependency/cache mechanism; agree the
version-update policy before CI wiring. No browser or accessibility dependency
is added in this commit. The next piece must also
measure timings/costs, define issue-to-CI severity policy and validate graph
coverage with intentional missed-route, dead-control and visual-defect cases.
