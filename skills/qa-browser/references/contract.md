# Version 1 repository contract

Commit `qa-browser.json` and its flows file in the target repo. Paths resolve
relative to the config. Executable adapters and commands are trusted repo code:
review them before running QA on an untrusted PR. Never use PR-controlled
commands with privileged CI credentials.

```json
{
  "version": 1,
  "baseURL": "http://127.0.0.1:3000",
  "healthPath": "/",
  "playwrightPath": "package.json",
  "flows": "qa-flows.json",
  "themeInit": "localStorage.setItem('theme', THEME)",
  "designRules": ["AGENTS.md", "DESIGN.md"],
  "references": ["design/approved-home.png"],
  "globals": ["src/styles/tokens.css"],
  "graph": "qa-import-graph.json",
  "buildManifest": "qa-build.json",
  "redactSelectors": ["[data-account-name]", "[data-account-email]"],
  "slowRequestMs": 5000
}
```

Use either `baseURL` for an already served app or
`"start":{"command":["npm","run","preview"],"url":"http://127.0.0.1:3000"}`.
Only a process the runner starts is stopped. Build production before starting;
the runner does not invent a build command or restart existing servers.

`qa-build.json`: `{"id":"build identity","head":"build commit SHA","assets":{"/":"sha256 of served
HTML","/assets/app.js":"sha256","/assets/app.css":"sha256"}}`. Include every
referenced JS/CSS/font asset. The runner compares the served bytes. For CSP
nonces or authenticated HTML use the trusted adapter's `buildIdentity` to verify
consistent HTML/JS/CSS and return the identity. Returning a label alone is not
verification. Missing identity is incomplete. Record the head producing the build.

Flows file is a nonempty array. Each flow declares:

- `id`, `url`, `entry` (repo-relative component), `main` (boolean).
- `states`: auth/data states, each string id or `{id,setup:[steps]}`. Declare
  signed-out and signed-in, loading/empty/error/expired where supported.
  Adapter authentication chooses the actual account/session per state.
- `steps`: entry-to-state actions AND expected outcomes. Readiness is an assertion,
  not an arbitrary sleep. A flow can be a route, menu, drawer, sheet or state. `frame` optionally selects
  the app iframe for controls and step locators; captures/checks include all
  rendered frames. Hidden service iframes are excluded.
- `controls`: `{selector,safe,steps,destructive?,isolated?}`. Steps include the
  action and its expected visible outcome. Use role/label steps where possible.
  Only declared safe controls are clicked. Destructive controls additionally
  require `isolated:true` and actual sandbox reset/cleanup in the adapter.
- `breaks`: `{kind,target,safe,steps}`. Kinds: `empty`, `invalid`, `double-submit`,
  `refresh`, `back-forward`, `signed-out`, `signed-in`. Include per-form AND
  per-input `target` selectors (`#id` preferred). For elements lacking ids, input
  targets use the observed accessible/name text; form targets use
  `form:nth-of-type(N)`. Use stable ids in the app when possible. Every break
  needs an explicit expected assertion. Each declared active control also needs
  targeted double-submit, refresh and back-forward outcomes. Additional kinds cover long/RTL input,
  offline/slow/error states, keyboard focus, Escape and focus restoration.
  `notApplicable:true,reason` is accepted for empty/invalid/double-submit only
  when no forms or inputs were reached; double-submit additionally requires
  that no active controls were reached. Coverage is not inferred from a kind name:
  the repo authors the actual steps and expected service outcomes.

Steps: `{action,selector,role?,label?,value?,env?}`. `role` uses getByRole with
`selector` as exact accessible name; `label:true` uses getByLabel. Otherwise
`selector` is CSS. Actions: click, double-click, fill, press, select, check, reload, back,
forward; assertions: visible, hidden, text (contains), url (contains), count,
value. `env` fetches a value from an already supplied environment only at use,
never writes it to the ledger. No inline JavaScript assertions or fake network
responses. Use `double-click` in the double-submit break (two awaited clicks can wait for
  the first submission to finish, hiding the race), and reload/back/forward
steps at the real mid-flow point. Signed-in/out breaks must use real states;
use the adapter for switching sessions, never fabricated product responses.

Trusted optional `adapter` module exports:

- `setup({config,root})`: provision isolated real test data in memory.
- `authenticate({context,state,config,flow})`: install an in-memory real session,
  or leave signed-out context empty. Never save storageState to disk.
- `reset({page,flow,state,config})`: reset this cell's isolated real data before
  replaying an entry. Never delete another run's data.
- `enter({page,flow,state})`: reach a state through a repo-supported route
  controller when URL navigation alone cannot reach it.
- `buildIdentity({config,root})`: verify matching served production asset hashes.
- `cleanup({config,root})`: remove only this run's isolated data, always called.

Adapters may read the one credential needed by an API immediately before use,
only after an existence check. Never read/list private-key directories, print
secrets or catch authentication errors and continue as signed in. Missing
accounts or services must throw, leaving incomplete coverage. Never commit
login storage, test-account artifacts or personal data in frames.

An existing standing crawl can be run before the generic matrix:
`"standingCrawl":{"command":["node","/external/crawl.mjs","repo-input"],
"env":{"OUTPUT_VARIABLE":"/evidence/standing"},"report":"/evidence/standing/report.json"}`.
It owns its traversal and real session cleanup. Keep product-specific adapters
and path overrides in the target repo or private project notes, never this skill.

For PR mode export `qa-import-graph.json` from the existing compiler/bundler:
`{"head":"current SHA","base":"merge-base SHA","complete":true,
"headImports":{"src/page.tsx":["src/button.tsx"]},"baseImports":{...}}`.
Keys and dependencies are normalized repo-relative resolved paths. Export all
aliases, re-exports, dynamic/lazy imports and imported styles. The runner builds
the reverse graph, walks changed files through importers and records the path
selecting each flow. Base/head union preserves renamed/deleted edges. Global
files sample EVERY declared main screen. Direct ownership wins over global
sampling; unresolved ownership falls back to main flows at the full PR matrix.
A false `complete:true` declaration cannot be repaired by browser automation:
test graph exports with known alias/lazy/CSS/deletion cases in the target repo.

No flows file: incomplete, no invented flows. Unmapped visible controls or links:
incomplete, with observed inventory for the repo owner to extend. The crawler
replays each safe edge from entry until no new DOM states remain. A state cap
(default 100), cell timeout (60 s) or run timeout (30 min) preserves evidence and
lists the remainder as incomplete. Cyclic, time-dependent states may need stable
entry contracts to avoid repeatedly discovering changing content.


## Reusing an authenticated standing crawl

Set `standingCrawl.useResults:true` to use the standing harness as the capture
provider instead of creating a second authentication implementation. Its own
process provisions and deletes real isolated users and keeps sessions in memory.
The configured command writes `standingCrawl.report`. The importer validates
EVERY expected screen/engine/theme/size key, rejects duplicate keys and frame
paths, verifies PNG viewport dimensions, and imports actual control outcomes.
A missing cell names its exact key and blocks review. This source format requires
one declared state per screen key; expose additional states as distinct flow
entries rather than silently dropping them. A crawl's nonzero exit
can contain real product findings; preserve them instead of discarding captures.

Source report: `results[]` contains `screen,engine,theme,size,path,failures`;
`edges[]` contains `screen,engine,theme,width,height,controls,checks?`;
`interactions[]` contains the same identity plus `index,label,kind,destination,
changed,error?`. `checks[]` contains `kind,pass`. Missing functional evidence or
failed/dead controls gives a failed functional result, never an assumed pass.
The source must supply the actual viewport height; width alone is ambiguous.
Optional drawer captures use the standing harness's `-control-INDEX.png` suffix
and are included in visual review. No credentials or session storage belong in
any report.

Use the target's existing matrix input (for example `CRAWL_SIZES`) for all five
core sizes. It must use both width and height in filenames. A harness may reuse
one live authenticated page per engine/theme across sizes, avoiding session
expiry and a burst of anonymous clients. Keep its original real auth entry and
cleanup; never invent a local bypass to make a protected screen render.

## Review budget and coverage

`review:{screensPerBatch:8,framesPerSheet:8}`, `criticTimeoutMs:600000`, and
`reviewTimeoutMs:7200000` configure sequential review. Sheet groups never mix
engine or theme. A batch may contain multiple sheets; every frame has a caption
and an exact original path. Suspected defects and illegible details use
`inspect`, forcing a full-size second pass for that screen's frames in the same
engine/theme. Full-size calls must resolve `pass` or `fail`. One retry is allowed
for a process timeout or malformed/missing verdicts. The ledger records every
attempt and covered frame. Capture's 30-minute cap does not truncate a review
already admitted under this separate budget. No API billing or new CI lane is
introduced.

The capture provider must write a fresh report during this invocation; stale
reports are rejected even when every frame exists. Exit 1 may mean completed
capture with real product findings, so the importer preserves those findings
instead of calling completed coverage missing. Other process failures/timeouts
never reuse a previous report. Guard hooks can re-export the skill's
`scripts/checks.mjs` functions into the standing harness, keeping image, clipping,
structure and contrast checks shared with verify-live.


Missing approved visual references do not stop diagnostic screenshot review,
but they block a positive product verdict. Concrete failures remain failures;
no reference comparison is inferred from an otherwise clean contact sheet.

## Evidence requirements

Imported `edges[].checks` must contain a passing `empty`, `invalid`,
`double-submit`, `refresh`, `back-forward`, `signed-out` and `signed-in` check
for every cell. A missing kind is a functional failure. Also supply passing
checks with exact `target` for every `forms[]`/`inputs[]` selector (empty, invalid,
double-submit, refresh) and enabled control selector (double-submit, refresh,
back-forward). A check name is not inferred from a successful click. Every
control needs a stable selector/path; unidentified targets fail coverage.
Native break steps bind every mutating action to their target or its descendants.
Use a form target when its submit button also needs to be exercised. Navigation
steps operate on the current page, with the declared target present at reset.

Native `file-chooser` waits for the real Playwright filechooser event before
passing. `empty-guard` requires an empty declared `input`, then verifies unchanged
DOM/input state/URL and no mutation requests after clicking its `selector`. It
is an explicit repository expectation, never inferred from the word Send.
Imported interactions may carry `effects:[{type:"file-chooser",observed:true}]`
or `{type:"empty-guard",input:"#composer",empty:true,unchanged:true,noMutationRequests:true}`.
Otherwise an unchanged enabled control fails. Disabled inventory is not clicked.

`prototypeChrome` entries require selector and reason and are recorded in the
run report and critic prompt. They hide declared harness regions for capture
and mechanical inspection. Keep product content outside those selectors.
Providers receive `QA_BROWSER_PROTOTYPE_CHROME` and `QA_BROWSER_CONTROLS` JSON
and must apply the same contract before capturing.

Source provenance belongs to the actual run. `repoRoot` sets the directory
where HEAD/dirty state are observed. A non-git source is recorded as unversioned,
never assigned the tooling repository's SHA. `buildProbe:["/entry/","/app.js"]`
hashes live first-party responses. Native capture records documents/scripts/styles
as `servedBuild`; standing providers may use the shared `observeBuild` helper
and write `summary.provenance:{head,sourceRoot,build}` before exiting. These are
served-content identities, not production claims. Unreadable assets stay visible
in the fingerprint. Every fresh review uses the actual cell frame paths in its
batch ledger; hash-only aliases cannot replace a new run's review coverage.

The visual lane intentionally uses only Opus. The specification's independent
Codex code critique runs through the orchestrator's cross-review with the actual
product diff and contracts. It remains explicitly unrun by this CLI; visual
approval does not imply source approval.
