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
  actions always use CSS targets. When the observed input has no id, declare
  `coverageTarget` with its observed accessible/name text as an alias; it counts
  only if the target binds that very input before traversal mutates the DOM.
  Accessible names participate in graph identity. Breaks replay the reached
  graph path before binding the target and alias again; they do not reset every
  check to the initial entry. A `state` restricts a break to that auth/data
  state. A different state cannot borrow its coverage, and a declared scope
  with no executed check is reported unrun. Form targets use
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
- `verifySession({context,state,config,flow?,engine})`: verify the active real
  service session and return `{id:"verified subject id"}`. This is mandatory for
  signed-in cells. Use an authenticated provider/service check, not the mere
  presence of a cookie. The subject is compared with the shared entry in memory;
  missing, dead or different identities leave the cell without a verdict.
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
lists the remainder as incomplete. Accessible names distinguish real graph
states and bind aliases. If the entry inventory changes on each reset, replay
stops with a gap naming dynamic accessible names/control structure rather than
inventing fresh graph states until the cap. Supply a stable entry contract;
product controls are not normalized away.


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

`review:{framesPerBatch:28,framesPerSheet:8,attempts:2}`, `criticTimeoutMs:600000`, and
`reviewTimeoutMs:7200000` configure sequential review. Sheet groups never mix
engine or theme. Every batch stays within one screen and contains at most 28 real
frames plus one tool-generated overlapping-control calibration frame, split
across at most four default contact sheets. The bound follows a six-call
production-capture pilot at 7, 14 and 28 frames; see [the measurements](batching.md).
It does not claim a latency or reliability guarantee. The ledger measures each
call. `framesPerBatch` may be 1..28; `framesPerSheet` 1..8. The legacy
`screensPerBatch` setting remains accepted but cannot increase this bound.
Every distinct screen, declared auth/data state, engine and theme requires
full-size reads at its shortest phone (width at most 600, smallest height) and
widest desktop (width at least 1024, largest width). All captures from those
boundary cells are mandatory, including reached control and break states.
These calls run before sheets. Missing either boundary is a coverage gap;
clean partial review cannot approve that group. Only the remaining sizes use
sheets. No cell or frame is deduplicated or removed from the matrix.

Every frame has a caption and an opaque critic-visible alias. The private
ledger retains exact original capture paths. Suspected defects and illegible
details use `inspect`. A failure, inspection request, nonempty rule list or
observation from either pass forces full-size review of the remaining sizes
of that same screen/state/engine/theme. Already completed mandatory full reads
are not repeated. Full-size calls must resolve `pass` or `fail`. A rule counts
even when the critic returns pass without prose. One retry is allowed
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

A control whose declared outcome is no change (for example a non-navigating
current-page item) can use `{action:"no-effect",selector:"#current"}` as its
final control step, with the exact same CSS selector as the declared control
(no role/label override). It clicks normally and polls through a three-second
cap, requiring network idle and 750 ms of stable state; it verifies URL, title, document/body attributes,
DOM, open shadow roots, fields, cookies, local/session storage, page count and
navigation signals, with no mutation requests. Unavailable state or a page
that never settles produces a gap. Changes later than the cap are not detected,
and injected style, scroll, focus and canvas changes are acceptable misses.
A changed result fails. This is not a waiver for an undeclared dead control.
Entry captures are identified by `entryFrame` in cells and `isEntry` in critic
manifests and sheet captions. Standing providers cannot supply no-effect
proof because the importer cannot bind it to a declared flow control; such
evidence is refused even when its provider claims it was observed.

## Shared service entry and terminal checks

An adapter may export `prepareEngine({context,engine,config,pace})`. The runner
calls it once per selected signed-in engine, before matrix cells. Establish a
real session and await a real protected-screen assertion there. Cookies and
local storage are copied in memory into signed-in contexts, never written to
artifacts. `authenticate` still installs per-context service support; with this
hook it must reuse the session, never sign in again. `verifySession` checks the
actual active subject during shared entry and for every signed-in cell and
terminal phase before navigation; only the verified id is retained in memory.
Its adapter can use the context’s authenticated request client. Failure blocks that
engine's signed-in cells. The 60-second entry cap is separate from cell work
and remains inside the 30-minute capture budget.

Mark an irreversible session-ending control or break `terminal:true`. It runs
once per distinct route, engine, declared state and identical target/action/
assertion/safety recipe, after every normal matrix cell. Flow ids and descriptive
metadata do not duplicate a check on the same route; distinct routes always
receive independent terminal runs, even with identical recipes. HTTP, request,
console and page errors remain observed during this phase.
The ledger names the route/engine scope and dependent cells; it does not
claim the action was repeated at every viewport. Its actual resulting capture
belongs to the first dependent cell. Missing terminal evidence leaves those
cells incomplete. Different terminal recipes are distinct checks: an adapter
must not silently reauthenticate after one revokes the shared session. Use explicit isolated terminal sessions for conflicting recipes; they cannot
borrow another recipe or route’s result. Without the isolated hook, leave
unsupported mutually exclusive terminal scenarios unrun. If the first route revokes shared
auth, a later route must verify the session and remain unrun when it is dead.
It cannot borrow the first route's result or sign in again silently.

`serviceIntervals:{"code-entry":30000}` declares the minimum admission interval
in milliseconds for service work. A step may name `service:"code-entry"` before
its action; adapters receive the same `await pace("code-entry")` for service
entry work outside steps. Reservations are shared across both workers and
engines. Choose intervals from the service's actual development limits. Place
pacing immediately before the service operation, not arbitrary assertions.
Cancelled cells abort their queued step waits and release unused reservations.
Only actual admissions advance the minimum interval; cancelling a queued wait
never shortens the interval between real operations. Pacing does not extend cell or
capture caps; coverage that cannot finish within them stays incomplete. Use a
standing provider when a pending service state must be reused across many
cells without restarting the real operation.

## Bounded diagnostics and review resume

Native page-error diagnostics retain the redacted message and stack, flow,
state, engine and viewport. Served body reads race a committed tool navigation
and a 2,000 ms diagnostic bound, within the existing action and cell budgets.
A navigation cancellation records `body read cancelled by navigation` and its
URL rather than an asset defect. Only a real document commit supplies this
correlation; pushState/replaceState URL changes do not. Popup and worker
responses can be read without a frame association. An unfinished read without
replacement is an unverified gap, never a passing or failing asset result.
For declared assets the cell attempts one fresh authenticated GET, bounded
to another 2,000 ms, and checks those bytes against the manifest. The original
uncertainty remains a gap even if this retry matches; a mismatched hash still
fails. Transport errors and HTTP errors remain failures. Underlying errors
and URLs remain in diagnostics, with named short passwords, OTPs, tokens and
cookies scrubbed from both message and stack. Any diagnostic key containing
password, passwd, otp, token, secret, session or auth has its value scrubbed,
including compound and underscored names. No URL is whitelisted.

Native control, break and terminal phases drain in-flight requests before
replay and verdict teardown. Each drain is bounded at 2,000 ms inside existing
cell/action caps: delayed 300/1,500 ms responses are observed, while a stalled
request cannot hold the runner indefinitely. An unresolved request records a
gap with its method and URL. It never becomes an assumed success when the
context closes. Terminal entry work is drained before the terminal action too.

`--capture-only` runs the unchanged capture matrix, functional checks, shared
entry and terminal phases, and cleanup, without launching the review browser
or calling a critic. Its report records `captureOnly:true` and the gap
`visual review not run`. Status is `fail` (exit 1) if functional failures were
found, otherwise `incomplete` (exit 2), including a non-UI PR selection. It
cannot pass. Do not combine this flag with either resume flag.

`--resume` (also `--resume-review`) reads the prior report and any review ledger from the same output
directory, verifies source/config/build identity and current served bytes, then
reviews the existing captures without provision, login, capture or cleanup
replay. The deferred `visual review not run` gap from capture-only is removed
after identity validation; all functional failures and other gaps remain.
A `buildIdentity` adapter is imported only for its read-only byte
verification during resume; its service setup and cleanup are not repeated. Successful critic batches require the same rules, references, tool
implementation and exact frame hashes; failed batches rerun alone. A changed
identity requires a fresh capture run. A missing calibration judgment or a
critic that does not identify the generated overlap cannot approve its batch.
Calibration status stays in the private ledger, outside screen findings.
Both `fail` and `inspect` with the matching structured overlap rule count as
caught; a prose substring is not evidence of matching the expected verdict.

Critic-visible images use uniformly opaque path aliases, ordinary screen/size/
entry labels and shuffled order, including the generated calibration frame.
The calibration answer path exists only in the runner's memory; it is never
written to a file the critic can Read. The ledger records caught/missed status
and expected rule, without identifying the planted image. Each batch needs its
own successful calibration, including split children.

When a batch repeatedly times out, use `--resume-review --split-timed-out`.
Only previously timed-out batches split in half, preserving all exact frame
coverage and completed sibling receipts. Each child receives its own
calibration. Further explicit resumes can split timed-out children larger than
seven frames; seven or fewer remain incomplete when they time out. The flag
does not change the source/build/config identity or raise a deadline. Completed
calls survive quota stops and the two-hour cap.
Each judgment has `path`, `status`, `rules` and `failures`. Use rule id
`overlapping-controls` when independent rendered controls overlap,
`reference-mismatch` for differences from an approved screen,
`unreadable-detail` for details too small to judge, and `other` for other defects.
A calibration judgment counts as caught only with `fail` or `inspect` and the
matching `overlapping-controls` rule. Unrelated prose does not match the
expected verdict. Calibration observations never become screen findings.
Product-frame full-size judgments must resolve `pass` or `fail`.

The ledger retains completed receipts across quota and review-cap stops,
including later batches not reached again before a stop. Resume validates
every receipt against current identities and exact image bytes before using
it. Unfinished work keeps no verdict. `review.attempts` may be 1 or 2 (default
2); a bounded experiment may explicitly disable retries. Capacity failures
stop without retry or model substitution.

### Declared external observations

An external class must stay outside the app’s registrable domain, determined
with the bundled Public Suffix List including private suffixes. Same-site
siblings and narrower suffixes are not external by default. Unknown suffixes
also require the exact-host exception; no implicit one-label suffix is assumed. An exact origin may
opt in with `sameSiteException:{hostname,reason}` naming that exact host and
explaining its separate ownership. Suffix classes cannot use this exception.
Same-origin exclusions always hold, even with an exception. The same boundary
covers exact development warnings and runtime matching; exception receipts stay
visible. See [the observation contract](observations.md) for fields, examples,
IP/localhost rules and snapshot provenance.

### Runtime error provenance

Read-only error and rejection listeners are installed before theme or adapter
work. Diagnostics retain scrubbed message and stack, lifecycle phase, flow, state,
engine, viewport, emitting document URL/origin/id, frame id and committed
navigation generation. Native events without an attributable frame remain
explicitly unknown; the initial blank document is identified only before any
navigation. Caught adapter, entry, control and break exceptions keep their cause
and the current lifecycle context. No observer prevents an exception or changes
storage, authentication or product state.

Cancelled subresources use the same committed-document evidence as body reads.
A request must still be active when a tool action commits its replacement
document before it can receive a network-cancellation receipt. Already aborted
or completed subresources never acquire that proof from later replay. A request
which the browser aborts before commit remains unclassified. Receipts retain request URL,
underlying cancellation error, original navigation generation and replacement
URL in diagnostics. Same-document history changes, explicit aborts without a
replacement, failed navigations and unowned navigation remain gaps. Browser
requests without a cancellation event do not receive a cancellation receipt.
First-party HTTP, transport and asset-integrity failures are never exempted.
Native, terminal and standing capture use one runtime cancellation audit. It
retains every observed page, including closed standing pages, and makes
unclassified cancellations gaps before accepting results. Pending body-read
diagnostics use separate evidence and cannot grant request cancellation coverage.

### Persistent standing entry inside the run

Set a flow’s `capture:"standing"` and export
`captureStanding({context,config,flow,state,engine,matrix,out,pace,beginCell})`
from the trusted adapter. This hook runs once per selected flow/state/engine
after ordinary cells and before all terminal checks. Its live context and pending
service entry survive the whole supplied theme/viewport matrix. Prepare the real
state once, never fake it or restart preparation per cell. The provider owns its
existing traversal and real state transitions; the tool does not add another
crawler. It returns the existing standing-crawl `summary/results/edges/interactions`
shape with exact `state` on each result and unique PNG paths.

Await `beginCell({theme,size})` before each supplied matrix cell. The tool validates
exact coverage, enforces the existing 60-second preparation/cell and 30-minute run bounds
(including session verification, and honoring a lower `cellTimeoutMs`),
and verifies signed-in identity for every cell. Missing, duplicate or unexpected
keys refuse the provider result. The provider applies the declared theme,
viewport, masking and flow assertions and supplies real control/break outcomes.
Runtime observations and read-only error provenance remain active on its context.
Pacing shares the same queue as normal entry and terminal work. Sessions and
pending entry objects stay in memory. A timeout closes only that owned context.

A terminal interaction uses `selector,deferred:true` instead of a claimed
effect; a terminal break check uses `kind,target,deferred:true` without `pass`.
Only exact declared terminal recipes can defer. They remain pending gaps until
the tool runs the actual terminal phase; imported deferred evidence alone can
never pass. Missing terminal markers remain incomplete.

For mutually exclusive terminal recipes, export both
`prepareTerminal({context,config,flow,state,engine,recipe,kind,pace})` and
`cleanupTerminal` with the same arguments. Every distinct route/engine/recipe
receives a fresh empty context and explicit isolated real session preparation.
Signed-in identity is verified there; the session is never silently borrowed
or recreated after failure. Cleanup always runs, including setup/action failure;
cleanup failure leaves no verdict. The ledger records `isolation:"adapter-session"`.
The adapter paces actual preparation immediately before the service operation
and removes only its own session/data. This costs one explicitly isolated real
entry per conflicting terminal recipe, not one per matrix cell. Without these
hooks, existing shared-session semantics and unavailable checks remain visible.

### Binding critic judgments to image reads

The subscription CLI streams read-only tool receipts. The critic opens one
review image, receives its image result and emits `FRAME {judgment}` before
opening the next. Every frame in a sheet is bound to that sheet’s exact captions
before another sheet. The final JSON repeats those identical judgments. The tool
refuses missing image deliveries, swapped paths, missing/duplicate bindings or
changed final judgments, even when the final answer claims a calibration catch.
Canary validation still requires the matching structured overlap verdict.

This is one subscription CLI invocation per existing batch. A full batch of
28 real frames plus calibration needs 29 sequential image-read rounds; a default
sheet batch needs four. These increase underlying model turns, latency and quota
use even though CLI invocation count is unchanged. Real fit under the existing
ten-minute call cap must be measured; no matrix is reduced.
Ledger judgments, structured results and binding receipts are scrubbed before JSON
serialization, including nested result JSON. Calibration counts as caught only
after image delivery and binding validation. Exact artifact identities survive;
short credentials, compound sensitive keys and headers do not.

Standing `results[].frames` lists additional reached/control/break captures.
They are all reviewed alongside the entry; declared missing paths, reused paths
or images narrower/shorter than the cell viewport refuse coverage. Full-page
heights may exceed the viewport. Deferred terminal checks retain readable frames
for diagnostic critique while their functional verdict remains incomplete.

All capture phases await the shared runtime asset-manifest audit before accepting
results. First-party scripts, stylesheets and fonts are checked against
`assetHashes` at capture time, even when the initial production manifest probe
matched. Changed bytes fail; an undeclared asset or unavailable body remains a
gap. Native, standing and terminal paths use the same response enforcement and
the existing bounded read/retry policy.
