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
