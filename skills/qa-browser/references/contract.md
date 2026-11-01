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
