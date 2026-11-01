# Plan

1. Read the five existing skills, installer and engine extension points. Proof: source paths and lines in the integration plan.
2. Add two universal skills and a reference capture helper. Proof: frontmatter validation, helper behavioural checks and a real public-page capture where available.
3. Add Pi and OpenCode installation targets and a repo snippet. Proof: installer run and resolved links in all five target folders.
4. Write the integration proposal without modifying the engine. Proof: citations checked against the current engine checkout.
5. Commit locally and hand back for orchestrator cross-review. Proof: commit SHA and clean status. No push.

## Decisions

- Reuse cross-review and verify-live; workers do not nest reviews, per cross-review's worker rule.
- Keep product policy in repo instructions and integration data, outside the universal skills.
- Existing installer backups protect config; native skill directories need only links.

## Added scope

6. Catalogue the universal rules, with JSON authoritative and generated Markdown; repo policy uses an extension. Proof: generation is reproducible and IDs validate.
7. Add report-only practice-audit and dependency-free mechanical checks. Proof: public CLI tests fail before implementation, then pass for repo/diff selection, redaction, exclusions and hooks.
8. Install eight skills and document existing-reviewer integration without adding CI. Proof: all target links and Pi/OpenCode discovery.

## Verification and handoff

- Three new SKILL.md files pass skill-creator validation; all are product-neutral.
- capture.mjs: four behavioral tests pass. Live Dribbble HTTP 200 initially yielded blank images; added readiness guard and lazy-image scrolling. Latest desktop/phone captures contain real results, but cookie/menu overlays remain. These are functional capture evidence only, not approved design references; manual browser cleanup is required as the skill states. No screenshots enter this commit.
- Mechanical checks: intended behavioral red log at /Volumes/DevBox/tmp/practices-behaviour-red.log, then eight tooling/auditor tests pass at practices-final-tests.log. The initial absent-executable run was setup-only, not the intended red proof.
- Existing hook suite: 22 passed; cross-review runner self-tests: 38 passed; merge-safe-prs tests: 46 passed. Output saved under /Volumes/DevBox/tmp/agent-skills-*.log.
- install.sh ran successfully. Both new workflow skills and practice-audit resolve in all five native skill targets. Pi installed loader and OpenCode discovery both find all three. Existing hook configuration remained unchanged; Codex hook trust is still unconfigured and was not changed.
- Catalogue has 112 normalized rules. JSON is authoritative; Markdown is generated. Product-specific details are intentionally represented by extension format only.
- Real Claude/Codex audit runs, independent cross-review and architecture/design consultation are unrun by this dispatched worker; the parent orchestrator owns those gates. The simulated auditors test process wiring only and are not review approval. No product UI changed, so verify-live's product matrix is not applicable; its existing capture self-test is not rerun.
- The integration proposal is read-only. No engine code or other repo instructions changed. No push, CI dispatch or paid reviewer was started.

## Review correction round on 64db20e

- Reproduced the critic's scanner gaps and auditor API gaps with failing public CLI/API tests before editing scripts. Red transcript: /Volumes/DevBox/tmp/practices-review-red.log.
- The prior live audit's exit 1 was the combined finding status, not a Codex error: report.json records Codex complete with no findings and Claude's four findings. Add explicit per-auditor exit diagnostics and automatic unverified PROC rules for source-only diffs.
- First green attempt exposed Git's tab suffix on a spaced +++ path and the test's own extension model declaration being scanned. Fix path parsing; exclude the model-data fixture from that one scoped assertion rather than suppressing real config candidates globally.
- When a shared scanner already recognizes a credential format, import that one recognizer instead of maintaining a weaker duplicate.
- When auditing a source diff without process logs, mark process rules unverified rather than inferring an approval failure from missing evidence.

### Ten finding resolutions

1. Extracted the existing secret scanner recognizer into its sibling secret_patterns.py; both tools load that one module under python -I. All tracked UTF-8 text, including md/toml/go/.env.example, is considered; private files/symlinks remain unread.
2. Claude denies home key directories, absolute private-key extensions and keychains. Documented Codex's dependence on its sandbox, prompt and guard, including the confidentiality limit.
3. Code-only line limits, lock/generated defaults, extension max_code_lines (500 default).
4. Old-model regex data lives in the catalogue and extensions, covering GPT-5.x and earlier. Test hits have candidate/test_context metadata.
5. Source-only diff PROC rules are automatically unverified without --evidence-file. Missing evidence never becomes an unauthorized-action finding.
6. Colour checks are minor, UI types only, 3/4/6/8 hex digits and boundaries; comments stripped.
7. One safe validated diff (rev-parse --verify --end-of-options) is parsed by the checker and its map reused by the audit runner.
8. Both families use run_auditor with optional env; removed the Claude copy.
9. All 112 rules cite source sections/dated or identified undated lessons. Rewrote the five vague rules; moved three product-derived rules to namespaced extension examples. Added inability-to-reproduce, short tradeoff report and Opus design-skills rules. Generated Markdown includes citations.
10. README Install now names all five target directories and separates three-CLI hook installation.

### Validation and precision

- 25 tooling/regression cases pass (includes inherited fixture cases); intended red logs precede implementation. Shared scanner: 46 existing tests pass. Guard hooks: 22 tests pass. Frontmatter validator passes; diff whitespace and redacting secret scan clean.
- Whole platform repo at db8c650, no code edits: seven candidates, zero confirmed violations after inspecting each (observed precision 0/7, not a recall estimate). Intentional test identifiers are candidates as requested. Known false positives remain for a placeholder documentation URL, a private-key marker without material, an optional-chain reference and recorded prose. Full classification: /Volumes/DevBox/tmp/practices-review-precision.md.
- Exact live 4856e64 diff: both auditors exit 0, zero findings, so precision is undefined rather than 100%. Claude B weekly usage was 92%; used one bounded Sonnet run instead of Opus. This live audit is validation of the tool, not review approval of these skill changes. Final mechanical input equals that live audit input.
- Audited snapshot: /Volumes/DevBox/worktrees/practice-audit-4856e64, linked under ~/worktrees. It is retained for reproducibility. No audited code changed, no push or CI job started. Parent orchestrator retains independent review ownership.

## Recall and noise calibration round

1. Add failing regressions for optional chains, fixture transcript prose, test/doc candidates and default Opus plus Codex high settings. Prove red then green without weakening credential detection.
2. Add a rerunnable, blind-scored calibration repository generator under evals/practice-audit with mechanical and judgment defects plus clean controls. Keep expected answers outside the audited repo; supply process evidence explicitly. Prove scorer detects misses and false positives.
3. Run both real auditors, meet all mechanical seeds / at least seven judgment seeds / at most two false positives, and scan the whole platform repo for zero false violations with candidates distinct.
4. Record scores, tests and remaining limitations; one local commit, no push. Parent orchestrator retains change-review ownership.

### Recall and noise results

- Real panel defaults are Opus claude-opus-5-5 and Codex gpt-6-sol high, configurable on the CLI. Per-owner request, used Opus despite the selected account's 92% weekly usage; kept the runs bounded and did not substitute another model.
- Added blind fixture/scorer in evals/practice-audit: 13 seeds (4 mechanical, 9 judgment) and clean controls. Expected labels stay outside audit scope. The scorer requires mechanical hits from the checker itself, not from a model that happened to find them.
- Initial calibration was incomplete due to unusable auditor output; never counted it as a pass. Added failing structured-output/diagnostic tests, enforced the shared result schema, then retried once with the exact same answer key. Both auditors exit 0. Final score: 4/4 mechanical, 9/9 judgment, 0 misses, 1 unmatched finding (PROC-044 is a valid secondary interpretation of TEST-001 but conservatively counts against the frozen key). Target passed.
- The original 4856e64 audit under Opus/high recovered the prose glitch at docs/sandbox.md:208 via the new general documentation-consistency rule. It still missed the earlier real TEST-002 at login-shell.test.ts:37. Record this as a real-world recall limit, not cleared by success on the seeded TEST-002.
- Whole gretly-platform at db8c650: 0 violations, 4 labeled candidates, no fixture-transcript prose or optional-chain false violations. No platform code or exclusions changed. Full evidence paths and interpretation in evals/practice-audit/RESULTS.md.
- Scanner flagged three new fixture-source expressions: two documented URL placeholders and one concatenated seed expression. Stopped handoff, used the redacted explanation, rewrote them as runtime assembly without an allowance, and reran clean. Byte comparison proves every generated tracked file and expected answer is identical to the passed run.
- When measuring recall, do not treat a zero-finding run as success; use frozen blind labels and require separate mechanical recall, judgment recall and false-positive counts.
- When generating calibration fixtures, assemble placeholder URLs and credential assignments from runtime pieces so the committed generator contains neither complete credential-shaped values nor scanner-triggering literals.
- Final local checks: 40 tooling/scorer cases, 46 scanner cases, 22 guard-hook cases and 38 review-runner cases pass. Final redacting worktree scan and whitespace checks are clean. No product UI was changed; the live-browser product matrix is not applicable. These local validations and calibration runs are not a cross-family review of this diff; the parent orchestrator retains that gate.

## Re-plan after two failed critic rounds

The broad pattern-by-pattern detector failed review twice: plausible text matches were treated as policy violations, the candidate payload could flood reports, and calibration metadata/control names cued the auditors. Stop extending that approach.

1. Replace the decision layer with a conservative policy: only strong credential material and non-contextual code length fail by default. Everything else is a counted, capped candidate; explicit rule/glob opt-ins are repo-owned. Prove defaults, contextual downgrades, opt-ins and bounded output with failing tests first.
2. Keep one shared SEC recognizer; add the requested URL/reference regressions. Audit prompts become file-backed, compact summaries; add deny paths and explicit Codex guard status. Prove launch arguments and report behavior with simulated CLIs, not paid retries.
3. Rebuild calibration without the answer file before auditing, diagnostic folder labels or rule-worded instructions. Freeze the generated benchmark before real execution; score afterward. Require all high-confidence mechanical seeds and at least seven judgment seeds.
4. Read-only acceptance scans of both requested repos; manually classify every default violation and list each with the counts and summaries under 200 lines. No reviewer wiring, no push; one local commit after local checks.

Decided: bounded candidates are triage hints, not failures. Repo opt-in must name a rule and its own path globs; it cannot happen implicitly through a shared skill or reviewer.

### Conservative design acceptance

- Replaced the broad default with two high-confidence classes: strong credential formats/material and non-contextual code-file length. Model IDs, colours, punctuation and weaker/contextual secrets are capped per-rule candidates. Explicit registered rule/path globs are required for promotions, including trusted hook results.
- Added URL and closing-parenthesis reference regressions in the shared recognizer. The URL case was reproduced against the prior recognizer (flagged) and the new one (clean). Python quoted comments remain candidates; complete multiline key material still fails. *.fixtures.* is contextual. Generated Convex source is excluded from length, as required by the existing generated-file policy.
- Prompts are file-backed under --out with compact mechanical counts and first examples. Added all three requested deny paths. Real calibration report records no verified active Codex guard hook; no hook/config was changed or trusted by this worker.
- UI-001 moved out of the universal catalogue into the repo extension example. Optional punctuation cannot be promoted unless the repo actually registers that rule. README and snippet describe explicit adoption, not reviewer wiring.
- New calibration: generic AGENTS.md, ordinary paths, event-based evidence and no answer file before/during auditing. Both configured families completed: mechanical 2/2, judgment 9/9, missed 0, unmatched 0. The final mechanical input exactly equals the live-run input; expected.json's timestamp follows the audit report. No answer labels were revised after the run.
- Ereno 259ca8aa: all 15 default findings were manually checked as real code-file length violations, and each source file equals HEAD byte for byte. No SEC violations. Candidate text 105 lines, JSON section 127. Gretly Platform db8c650: 0 violations; candidate text 6 lines, JSON section 16. Each finding and its classification is listed in evals/practice-audit/RESULTS.md. No repo code or reviewer configuration changed.
- Tests: 64 tooling cases, 46 shared scanner cases, 22 guard-hook cases, 38 review-runner cases passed. Frontmatter validation, redacting scan and whitespace checks passed. No product UI changed. This worker did not run the parent orchestrator's next independent review of this diff.
- When mechanical heuristics have not established a violation, report a bounded candidate and require explicit repo policy to promote it; do not keep patching false positives into a default failure rule.
- When calibrating an auditor, write answer files only after the auditor processes finish and remove wording or folder labels that disclose the expected verdicts.

## Final-critic repair and owner additions

1. Prove Claude can read exactly the prompt workspace, reject not-performed/empty-without-inspection output, and make calibration score each family independently. Correct the prior both-family claim after a real rerun.
2. Restore shared pre-push URL detection; raw strong secrets fail regardless of docs/comments/tests. Add baseline regressions before fixes.
3. Restrict length to authored logic, import repo-owned exemptions/ratchets as inert data via an explicit extension, and add top-of-file ENG-002 justifications with substantive reasons. Auditors still judge their truth and code cleanliness.
4. Add explicit code-smell judgment rules and dependency-free language-aware candidates, plus design-system candidates/rules. Seed three smells and two design defects; require category recall from each family.
5. Write only the future qa-browser spec, including PR-impact mapping and bounded full-matrix CI. Re-run calibration and both read-only scans; one local commit, no push or CI wiring.

### Final repair decisions and verification

- Corrected the prior claim: Claude had returned Audit not performed because the external prompt was not readable. It now gets --add-dir for that prompt workspace, absolute denies use // syntax, incomplete inspection fails validation, and each family must independently contribute calibration recall.
- Corrected the prior 15/15 length claim: Ereno's existing exemptions/ratchet must be applied, and lexicons/locales are data. The extension reads policy as inert data; no audited repo code or config was changed. Strong password URLs in test source still fail the raw-material security rule; no live-key claim is made.
- Tests were written red first for the launch, raw strong secret contexts, baseline URL recognition, authored-only length, markers across six syntaxes, scorer family contribution, smells, design candidates and parser warnings. Two performance regressions were reproduced with timeouts before replacing the problematic regex scans. Shared scanner still matches main on secret-named webhook URLs and password-bearing DB URLs.
- Real expanded calibration rerun: Opus claude-opus-5-5 and Codex gpt-6-sol high each inspected 24 files, found 14/14 judgment seeds, 3/3 smells and 2/2 design seeds. Checker found 2/2 mechanical. Two unmatched findings retained; no missed seeds. Equivalent new taxonomy IDs were frozen before the final fresh run; no key was tuned afterward. Expected answers were absent until model completion. Codex guard hook was not active/verified.
- qa-browser is a spec only in docs/qa-agent.md: UI PR scope from a reverse import graph, full size/theme/browser matrix for affected flows, global-style main-screen sampling, uncertainty fallback, 30-minute cap and explicitly hypothetical cost assumptions. No skill, CI wiring, browser run or dependency is added now.
- When an auditor reports no work or cannot read its prompt, mark it incomplete and prove inspection before citing its result. When file limits run, import the repo policy and distinguish authored logic from data; valid length reasons remain subject to independent clean-code judgment.

- Final checks: 84 tooling, 46 scanner, 22 guard and 38 review-runner tests pass. Both touched skills validate; redacting worktree scan and git diff --check are clean. Final checker findings, candidates, justifications and exemptions exactly match the real calibration input, and expected.json timestamp follows auditor completion.
- Final read-only ereno 259ca8aaa5fc56d112a464846f78323415c39045: 2 violations, 16474 candidates, text/JSON candidate summaries 153/199 lines. Full classifications and corrections are in evals/practice-audit/RESULTS.md.
- Final read-only gretly-platform db8c65033ab297e8f0a83b21aa7831ff9a61da99: 0 violations, 419 candidates, text/JSON candidate summaries 76/102 lines. Full classifications and corrections are in evals/practice-audit/RESULTS.md.
- No push, reviewer/CI wiring, visual QA run or dependency change. Parent orchestrator must perform the next independent review; this dispatched worker did not run nested critics.

## Repair after f108ce4 review

1. Add red regressions for main scanner coverage, URL entropy, logic in config-named files, markup/Go/Rust markers and file-level calibration length scoring; then fix causes and rerun.
2. Consolidate duplicate catalogue IDs and update the bounded QA spec, with local-before-push and measured PR-rate cost assumptions. Verify generated catalogue and documentation consistency.
3. Run calibration per family, all tooling/scanner/verify-live checks, and real repo scans. Preserve logs and classify remaining positives.
4. Back up local branch history, squash the net change onto main, and prove main's unchanged scanner plus the new scanner accept both net diff and outgoing history without allowances. Never push.
When preserving scanner coverage, remove only demonstrated false positives and regression-test every case main detects. When scoring file-length findings, anchor by file rather than a preferred line number.

- Owner addition: read ~/.claude/AGENTS.md section 0. Put four no-ai-slop blocker rules first in the catalogue; all three relevant skills and the audit prompt check them first, and the repo snippet starts with the hard rule. Confirmed findings cannot be downgraded. Added failing policy/severity tests before implementation. Existing duplicate IDs are merged into UI-002 and ENG-003, not retained as parallel rules.
- When a hard owner rule is added, carry it into the catalogue, agent inputs and independent critique contract together; a self-review never supplies the independent verdict.

- The new hard gate revealed invalid calibration controls: an undeclared optional-chain input and generic banner copy. A behavioral import/call test failed first, then the control received declared typed inputs; the copy now names the completed action. The hierarchy seed accepts its consolidated UI-SLOP-DESIGN verdict. These corrections precede the final fresh run; no completed report is rewritten into a pass.
- QA budgeting now uses all 34 recent org PRs, not just the builder's 13. At 75 PRs/month and three heads each, a 2-vCPU, two-worker lane costs at most $40.50 compute plus the $20 plan, leaving only $9.50 of the $70 cap for other workloads. Actual spend, subscription, CI pinning and benchmark timing remain enablement checks; no CI job is wired here.

### Final f108ce4 repair acceptance

- Final slop-first calibration rerun: Opus claude-opus-5-5 and Codex gpt-6-sol high each inspected 24 files and found 2/2 mechanical, 14/14 judgment, 3/3 smells and 2/2 design seeds. Checker 2/2, no misses, zero unmatched. Report: /Volumes/DevBox/tmp/practices-critic-slop-calibration-r2. Expected answers were absent until both auditors finished.
- Final read-only scans: Ereno 259ca8aa and Platform db8c650 each have zero default violations. Candidate summaries are 157/199 and 94/120 text/JSON lines. Ereno has two explicit host-AST syntax warnings; all positives/classification corrections are in RESULTS.md. Repo policy exemptions and ratchets remain untouched.
- Final checks: 93 tooling, 46 shared scanner, 22 guard, 38 review runner and four Node tests pass; verify-live capture suite passes with the requested Playwright installation. Three skill validations and whitespace checks pass. Parent retains independent review; no nested critic or self-approval was substituted.
- Both unchanged-main and new scanners accept the complete proposed net diff without allowances. Preserve an external local bundle and staged patch, then squash to one child of main and verify commit history, outgoing history and diff again with both scanners before handoff. No push.

## Hooks and evals worker, 2026-10-29

1. Add trigger cases for all eight skills and behavioural scenarios for reference ordering and implementation critique/finding resolution. Prove graders reject missing, late and self-authored evidence with local tests; preserve the practice calibration.
2. Test a shared opt-in Git pre-push practice gate against real local remotes before implementation. Reuse the repo-side snapshot/range logic, trusted installed checker and extension; prove tags, deletes, dirty checkout and other-branch pushes.
3. Document why UI completion cannot reliably be blocked from Stop events. Keep existing reminders, no new heuristic blocker.
4. Run every local suite with full output in the requested DevBox log, plus redacting secret scan; record exact results and unrun live agent evals. Commit locally for the parent Claude critic, never push or nest reviewers.

The user supplied this implementation brief directly; no further plan approval is needed. Worker handoff does not pass the independent review gate.

Hook green attempts stopped after two setup failures: generated installer shell quoting was invalid, then installation still failed. Re-plan: inspect one installer result directly before any suite rerun; fix setup independently, then resume behavioural verification. These are not additional behavioural red proofs.

### Hook/eval verification notes

- Intended hook red: five behavioural failures in `/Volumes/DevBox/tmp/agent-skills-hooks-red.txt`; the pushes passed unchecked and no hook backup/incomplete notice existed. Initial green setup failures were repaired before the seven-case pass; expanded fourteen-case suite also passes.
- Live Codex: all six new behaviour runs pass, hooks off/on, including seeded critic findings followed by a current independent approval. Captures and critics are test fixtures, not a visual-quality verdict.
- Full suite exposed an existing baseline regression test that copied main's scanner without its now-required sibling recognizer. Preserve both files from main in that temporary fixture; the six focused tests pass. No scanner detection was weakened.
- UI completion blocker rejected because portable Stop/SessionEnd payloads cannot establish build-bound verification; rationale in docs/hooks-considered.md. Existing bounded reminder remains.

### Worker handoff

- Added five missing trigger sets; the runner now discovers all eight by default. Live Codex: all new sets pass; two pre-existing decide-or-ask prompts miss. All twenty behaviour runs pass (ten scenarios, hooks off/on), including the unchanged seven original scenarios. Reports and raw results are in evals/RESULTS.md and its named DevBox directories.
- Final local checks: 36 hook tests, five eval/fixture tests, 93 tooling/calibration tests, 38 review-runner tests, 46 merge/scanner tests, four reference-capture tests and the real Chromium capture self-test pass. Full output is `/Volumes/DevBox/tmp/agent-skills-hooks-evals-tests.txt`. The earlier failed full output is preserved as `agent-skills-hooks-evals-tests-first.txt`.
- Installation is opt-in per repo. Git's own ref stream covers every provider without a shell parser or agent-event dependence. Existing executable hooks are backed up/chained; non-executable hooks stay ignored, demonstrated by a failing regression before the fix. Incomplete checks warn and allow; only violations block. No remote fetch, model call, repo command or CI run is part of the gate.
- No new Stop/SessionEnd blocker, dependency, product UI change, push or deployment. No Fable, Claude/Cursor live eval rerun or real-model practice calibration rerun. As an implementation worker, I leave independent critique to the parent Claude critic; this local commit is a review handoff, not review approval.

- Final robustness regressions: malformed policy shapes must warn/allow rather than crash/block; new branches use the remote's recorded default (tested on master) instead of assuming main. Each failed before its fix. The final root hook run includes all fourteen new cases alongside the existing twenty-two.

## Delegated-choice trigger correction, 2026-10-29

1. Clarify delegated choices in the description only; prove both recorded misses load and negative cases stay out with live trigger evals.
2. Run all local suites and secret scan; record full output and unavailable model runs.
3. Commit locally, sync three fresh SSD worktrees using their scripts, run drift/practice/secret checks, and commit without pushing. Parent owns independent Claude critique.

Decision: describe delegation of an unspecified choice explicitly, rather than trigger on ordinary implementation requests.

Verification re-plan: the capture self-test failed first because the selected worktree had no Playwright, then because the installed Playwright required an absent Chromium binary. Diagnosis confirmed the missing executable. Install that exact browser and rerun; do not change capture code or weaken assertions. Claude B is at 100% weekly; no more model retries.

Final worker evidence: Codex triggers 18/18 positives, 0/12 negatives. All six non-browser suites pass; real Chromium capture self-test is incomplete because browser provisioning did not finish. Secret and whitespace scans pass. Claude B weekly limit prevents live measurement; Cursor skipped at owner's reported weekly limit. No independent review claimed. Product worktrees use their sync scripts; drift/practice/secret checks pass in all three, logs at /Volumes/DevBox/tmp/skills-bump-<repo>.txt. No dependencies were needed for those Python checks.


# qa-browser implementation

Authorized worker brief: build report-only browser QA tooling, no product edits or server signals. Branch skills/qa-browser; no push. Independent code critique belongs to the orchestrator per cross-review's worker rule.

1. Define versioned repo configuration, flows and graph input. Prove missing/ambiguous ownership cannot yield green with public-interface tests.
2. Reuse verify-live checks and standing crawl through explicit adapters. Crawl safe declared controls and same-origin links, capture the full matrix, execute real flows and break cases. Prove intentional tool fixtures fail first, then pass.
3. Require per-frame Opus critique and produce one JSON/Markdown report with contact sheets, ledger and reproduction steps. Prove missing critic/frame cannot pass.
4. Run both live prototype URLs without starting/restarting/signalling servers. Preserve all reports under /Volumes/DevBox/tmp/qa-browser-proof. Missing real-flow contracts remain incomplete, never invented.
5. Run repository checks and hand frozen diff/evidence to orchestrator for Claude review before push. Local commit only; note unrun checks.

Risks: unknown destructive controls are blocked rather than clicked; dynamically loaded routes need repo graph ownership; authenticated states require a trusted in-memory adapter. DOM contrast cannot resolve gradients/background images, so those require the screenshot critic. WebKit is not native Safari.

Live proof re-plan: the first external auth adapter attempt lacked service-required profile fields (422); those were added. The first matrix attempt then exposed a hidden, zero-height service iframe in the runner's scroll loop. Preserve those attempt directories as invalid evidence. Skip nonrendered frames, add a hidden-frame regression, and rerun into new directories. Only the QA processes owned by this task may be cancelled; prototype servers must not be signalled. Real isolated test users from cancelled attempts require bounded, unambiguous cleanup before rerunning.

Proof tightening: the corrected traversal progresses through all inventories. Keep console warnings and cancelled navigation requests as unresolved coverage rather than confirmed layout/runtime errors; record browser versions and assert exact control identity. Freeze this version for final proof. Cancel only owned r2 QA runners gracefully, preserve their partial reports, then run the frozen tool in final/ directories. No prototype server action is permitted.

Prototype adapter correction: serial cells outlast the seed session's short-lived cookie. A cookie captured once is not proof of a later authenticated cell. Renew the real sign-in ticket inside each isolated authenticated context, retaining one real user per product and cleanup in finally. This is private proof-adapter work, not product or public skill code. Preserve/cancel prior attempts and rerun; do not relabel their failed navigation as covered.

Auth proof re-plan after two incomplete matrix attempts: fresh tickets inside WebKit still do not establish the same session as the standing crawl. Stop changing public tool behavior for this. Reuse the standing crawl's Chromium-seeded in-memory session transfer, renew that seed for serial cells, and smoke-test one later route in each engine before another full attempt. Existing matrix attempts remain failed/incomplete, not readiness evidence.

Service admission: larger live runs began failing real authentication after successful smoke checks. Do not keep issuing tickets on every remaining cell. Public runner now blocks the failed auth state after its first adapter error, preserves completed signed-out/other-state evidence, and records later cells as unrun/incomplete. No fallback or fabricated login. Prototype-level functional contracts and production build identity remain missing; no product pass is claimed.

## Worker handoff (qa-browser)

- Implemented the versioned config/flows contract, graph-based PR selection (base/head union and fallback), core/full/global matrices, safe state replay, form/control break coverage, real double-click submission, auth failure admission, reports, frames, sheets and bounded per-frame Opus review. No dependency added. verify-live's existing page-check body was extracted unchanged; the standing crawl remains external.
- Tests: 12 Node tool tests passed, including rendered bad/good fixtures in Chromium/WebKit, dead controls/runtime failures, blocked auth, missing critique and reviewer timeout/stdin. Intended red observed: unit-red.log (five missing-behavior assertions). Root Python suites passed: scripts 93, hooks 36, evals 5. Existing verify-live capture regression and skill validation passed. No root package/typecheck command exists in this repo. Secret scan and diff whitespace check passed.
- Live proof: standing crawls completed 152 and 104 cases (first has two unattributed runtime errors). Final generic runs enumerate 380/260 required cells but capture only 86 each; real authentication blocks the remainder. Both five-minute Opus stages timed out. These are failed/incomplete reports, never product readiness. Combined evidence: /Volumes/DevBox/tmp/qa-browser-proof/report.json and report.md. Real users were deleted in cleanup; no prototype server was restarted or signalled.
- No repo-owned functional flows, approved visual references or production build/head identity were provided for the prototypes. Manifest-derived capture entries do not substitute for those contracts. Native devices, CI and a completed screenshot verdict are unrun. Prior interrupted attempts remain explicitly invalid evidence.
- Implementation critique is pending with the orchestrator. cross-review's worker instruction says: "If you are a worker ... do not run this skill. Finish, run your checks and report back. The orchestrator runs the review" (skills/cross-review/SKILL.md). No nested implementation reviewer was started. Local commit only; Claude review is required before push.

## qa-browser correction, 2026-11-01

Owner rejected incomplete proof. Authorized correction:
1. Reuse the standing crawl's real auth/user lifecycle, extend its input matrix without changing product files, and import complete per-cell functional evidence. Prove all expected screen/engine/theme/size keys and frame files exist on both live prototypes. No server signals.
2. Replace monolithic critique with engine/theme-specific 6-8-frame sheets grouped by screens. Sequential Opus batches, ten-minute call limit, one retry, explicit coverage ledger; full-size second pass for every flagged screen. Tests reject missing/duplicate coverage and ensure flags cannot bypass follow-up.
3. Run both prototypes to full capture and per-screen functional/slop disposition; preserve deliberate broken-fixture failure and corrected pass. Local checks and local commit, no push; parent owns implementation review.
The first proof remains rejected evidence. This revision must not claim readiness with missing cells or unfinished critics. Review budget is separate from browser capture's 30-minute cap, as the owner explicitly requested sequential realistic batches.

Capture re-plan: unbounded per-size contexts overload the live prototypes and make timing tests noisy. Keep the standing auth/user factory, but reuse one authenticated page per engine/theme across the five viewport sizes; capture signed-out entries after the authenticated inventory. This preserves every required cell with four live contexts instead of forty. Old in-flight matrix attempts must be cancelled only after uniquely identifying and cleaning their own temporary users. No product server is touched.

### Current proof progress

- Capture is complete: 380/380 Gretly Builder cells and 260/260 Flowstarter cells, all five core sizes, both engines/themes. PNG identities/dimensions validated, including signed-in cells (300 + 180). Original standing user factory/entry/cleanup is reused; both complete=true and temporary users deleted. Evidence: /Volumes/DevBox/tmp/qa-browser-proof/r2/capture-coverage.json. Full capture includes 906 frames (266 additional menu/sheet/control states).
- Supplemental shared verify-live page/image checks and qa-browser structure/contrast checks ran on all 640 core cells through CRAWL_QA_MODULE. Raw guard reports: r2/shared-guards/<product>/report.json. Findings stay visible; these are product failures, not permission to omit a cell.
- Real fixture evidence: r2/fixture-review/report.json shows deliberately broken fixture functional FAIL + slop FAIL, corrected fixture functional PASS + slop PASS, Chromium and WebKit. Opus finished the sheet/full-size passes. No simulated reviewer used for this proof.
- 15 current tool tests pass (including batching, exact coverage, one retry, sequential execution and full-size follow-up); 93 tooling + 36 hook + 5 eval tests pass. Earlier closed-stdin test hit its one-second process-start limit during overloaded capture; it now allows ten seconds for a real process to start, without weakening the EOF assertion. Skill/secret/whitespace checks pass.
- Long visual review is running sequentially: /Volumes/DevBox/tmp/qa-browser-proof/r2/review-product.mjs flowstarter (tool session 29929). A chain process (session 45445) waits for its complete review, then runs Gretly Builder. Ledgers: r2/review/<product>/review-ledger.json. Each sheet has <=8 frames, one engine/theme; all flagged screen frames get full-size second pass in chunks of eight. Ten-minute calls, one retry, two-hour review budget per product. No missing judgments are accepted. Do not end the task while either product has incomplete slop coverage.
- Final steps: await both review processes, merge supplemental guard findings into one latest report at the proof root (back up v1 first), assert 640 captured cells and every screen functional/slop disposition plus fixture failure, record exact final checks, commit locally on skills/qa-browser, do not push. Parent owns independent implementation review. Final response must be four lines.

### Follow-up while visual batches run

- Added meaningful red/green regressions for selection enabling another control, declared custom controls, disabled-control classification, invalid batch sizes, stale capture reports and completed captures exiting 1 with real findings. Public crawler now includes declared selectors and button/ARIA state in traversal identity, retains disabled selectors, and rejects unexpected scope rows. The CLI sends QA_BROWSER_SCOPE to external providers. NODE_PATH-unset tool suite now has 18 tests; rerun once after final edits.
- Do not confuse a valid base capture with a complete interaction traversal: 23 Gretly rows had post-capture iframe-detachment inspection races (none was an error-frame capture). The standing harness now waits for route readiness, records one frame-transition inspection recovery without re-clicking, and resets after failed controls as well. A corrected full Gretly run is in flight: tool session 87699, log r2/settled-gretly.log, output r2/settled-capture/gretly-builder/. This run also applies the shared image/structure checks to interaction states.
- IMPORTANT: Gretly review is gated on r2/settled-ready.json, currently not created. After session 87699 exits, verify summary.complete, exactly 380 valid base cells, no -error.png captures and no remaining FrameDetached crawl errors. Validate all PNG dimensions and record recovered transition reads. Then create settled-ready.json. The chain reviewer will pick r2/settled-capture/gretly-builder/report.json after Flowstarter finishes. Do not create the marker before validation.
- The latest report combiner is /Volumes/DevBox/tmp/qa-browser-proof/r2/finalize.mjs. It asserts both completed reviews, merges shared guard findings, preserves v1 report backups, and writes the single latest root report plus fixture proof. Update frame counts from the corrected Gretly run rather than assuming 906. Build/head identity for these standalone prototypes is explicitly unverified, never a fabricated SHA.

Auth-entry capture re-plan: the original standing loop only waited 300 ms after each new auth document. Our new history checks also navigated again before the final screenshot. Wait for auth-ready plus finite entrance completion after every navigation and before reading canonical URLs; test history against a second known-valid auth entry, not an invented query flag. Recapture the 160 auth cells only. Reuse prior visual judgments only for exact PNG SHA-256 identity; otherwise review the changed captures before creating Gretly's ready marker. This avoids presenting loading/transitional frames as final screens.

### Validated final captures and current review

- Auth entry recaptures completed and both standing factory cleanups succeeded. Current merged evidence is 380 + 260 core cells, 480 signed-in cells, 920 frames. All primary PNG dimensions are validated; missing cells: zero. Gretly's corrected traversal has zero iframe-detachment errors or error-frame captures.
- Flowstarter review completed all 13 screen verdicts. Latest auth captures reused 77 exact SHA-256-identical frame verdicts with an explicit alias ledger; the three changed frames received new real Opus review. All refreshed coverage is complete. Gretly ready gate was released only afterward; its sequential review is active on the current 660 frames.
- Current regression suite: 19 passing tests with NODE_PATH unset. Runtime errors are scoped to recognized declared routes; unassigned errors remain explicit run failures instead of being copied to unrelated screens. Shared guards are taken from current captures when available, falling back to the guard sweep only for unchanged Flowstarter protected entries.
- Current toolchain is Playwright 1.62.1, Chromium 151.0.7922.34, WebKit 26.5; recorded directly in r2/toolchain.json. Production build/head identity and native hardware lanes remain unverified, explicitly disclosed.

### Completed correction proof

- Latest combined evidence: /Volumes/DevBox/tmp/qa-browser-proof/report.json and report.md. Every assertion passed: 640/640 cells, 480 authenticated cells, 920 valid PNG frames, zero missing cells, 32/32 screens with functional and slop dispositions. Both prototypes FAIL with concrete findings; this is complete QA evidence, not product approval.
- Actual Opus reviews finished: Gretly 100 batches, Flowstarter 46 including changed auth captures. No retries or timeouts. Every current frame maps to a final verdict; 77 Flowstarter aliases preserve exact SHA-256 identity. Every Gretly frame received full-size follow-up. The combined report retains batch coverage and aliases.
- Deliberate real-browser fixture: broken functional FAIL/slop FAIL; corrected functional PASS/slop PASS. Fixture evidence: r2/fixture-review/report.json. Final tool suite 19/19; existing root tooling/hook/eval suites 93/36/5 pass. Skill validator, whitespace and secret scan pass. No dependencies added.
- No existing server restarted or signalled; original standing auth factory created and deleted its own test users. Changes to the external standing harness are preserved privately at r2/crawl.patch, not duplicated in the public skill.
- Production build/head identity, native hardware lanes and full external OAuth account login remain explicitly unrun in the report. Independent implementation critique belongs to the parent under implement-well's dispatched-worker rule. This handoff does not claim that gate passed. Local commit only, no push.
