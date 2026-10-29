---
name: practice-audit
description: Run a report-only audit of a repository, directory or pull-request diff against the universal practice catalogue and a repo extension, using mechanical checks then independent Claude and Codex auditors.
---

# Practice audit

Check the no-ai-slop group FIRST: UI-SLOP-DESIGN, PROC-SLOP-WRITING,
ENG-SLOP-CODE and PROC-SLOP-REVIEW (owner AGENTS.md section 0).
Confirmed defects are blockers whatever other checks pass. Cite concrete
artifacts: design side by side with named top-quality references, plain
specific writing, useful code without speculative boilerplate, copied blocks,
restatement comments, invented APIs, silenced errors or source-mirroring tests.
An independent critic checks every piece before owner handoff; self-review
never counts. Missing visual/process evidence remains unverified. Report a
defect once under the hard gate and cite supporting detailed IDs in its why.

Never edit audited code, fix findings, commit, push or deploy. Read the repo's
AGENTS.md and the shared rules/catalogue.json, then the extension it names.
Use a trusted installed copy of the scripts, not scripts modified by the PR.
Every completed auditor must list inspected_files; "Audit not performed" or
empty output without inspection is incomplete, even when the CLI exits 0.
Missing evidence is unverified, not a violation invented from absence. Process
rules need logs, approval and review evidence; source alone cannot prove them.
In diff mode PROC-* rules are automatically unverified unless explicit trusted
--evidence-file paths supply that evidence. A missing approval record in a
source diff is not proof of an unauthorized change.

From the shared skills checkout run the mechanical checks first:
`python3 scripts/check-practices --repo <repo> --mode repo --target <directory>`.
For a PR use `--mode diff --base <trusted-merge-base-sha>`. This compares that
base to the tracked working tree, so use a clean PR checkout for head-only
review. Add `--extension <trusted-repo-extension.json>` when the repo names one.
Review an extension hook before explicitly passing --allow-hook. Never run
untrusted PR scripts, installs or tests as part of this report-only audit.

Then run `python3 skills/practice-audit/scripts/audit.py` with the same scope,
`--out <new-directory-outside-audited-repo>`. Defaults are Claude
`claude-opus-5-5` and Codex `gpt-6-sol` with high reasoning. Override using
--claude-model, --codex-model and --codex-reasoning-effort when authorized. The runner executes mechanical
checks before two independent auditors, Claude and Codex, with read-only
permissions, closed stdin and a per-auditor timeout. It merges findings into
report.json and report.md. Reported auditor exit codes are separate from the
combined exit status: 0 means no findings, 1 means findings, 2 incomplete.
No silent family fallback. Check account headroom
and repo budgets before starting: use cross-review's capacity rules, but do
not run an extra code-review panel or nest another audit. A dispatched audit
worker returns evidence to the orchestrator.

The catalogue and supporting scripts live at the shared checkout root, three
parents above this SKILL.md, resolving symlinks first. In a remote harness,
deliver the catalogue and scripts as pinned resources; an isolated SKILL.md
alone is insufficient. Repo-specific model choices, paths and policy stay in
the repo or launch configuration.

Each finding must have a rule ID, repo-relative file and positive line,
blocker/major/minor severity, concrete redacted evidence and a one-line why.
Blocker means security exposure or a prohibited irreversible action; major
means broken behavior or a required gate; minor means limited polish or
maintainability. Auditors judge remaining rules and contextualize mechanical
candidates. Deduplicate by rule/location, preserve disagreements and identify
which family reported each finding. Never downgrade a finding silently.

Report the scope, base, exclusions, skipped/private files, auditor statuses,
unverified rules and limitations. A timeout, missing CLI, invalid output or
nonzero auditor exit makes the audit incomplete, never a pass. Source checks
cannot verify real UI taste: cite missing screenshot evidence and route
requested follow-up to design-references and verify-live. Code fixes belong
to a separate authorized implement-well task, followed by cross-review.

Claude denies the home .ssh and .private_keys folders, AWS credentials, netrc,
GitHub hosts.yml, private-key extensions
(including absolute paths), and keychains through Read permissions. Codex
relies on its read-only sandbox, the credential-safety prompt and the installed
guard hook. Read-only sandboxing alone does not prevent credential reads;
verify the guard hook is active in the audit environment. These controls are
not a claim of a complete filesystem confidentiality sandbox.

Strong provider formats, complete private-key material (including escaped JSON)
and high-entropy password-bearing DB URLs are violations on raw text in any context,
including comments, README and tests. Low-entropy/placeholder URLs and lone key markers
remain weaker candidates. This does not authorize reading private key stores.

File length applies to authored logic only. Exclude config/data, token/theme
styles, locale dictionaries, lexicons and generated files; honor the repo's
existing exemption list and ratchet through its length_policy extension.
A top comment may request `practice-allow: ENG-002 because <specific reason>`.
It must be in the first ten lines, in the language's comment syntax, with at
least 40 characters, eight words and five distinct words. Valid markers appear
under justified. Auditors must inspect each reason and the file's actual
DRY/KISS, dead code and structure, reporting ENG-002 or smell findings if the
reason does not hold. A marker cannot suppress any security finding.

Explicitly judge ENG-003 and ENG-SMELL-* and UI-002, UI-DS-002..004. Language-aware
ENG-CAND-001..005 metrics and source design checks are candidates by default;
repo violation_globs and configured thresholds/scales may opt them in. Python
uses the host AST; TS/JS/Swift use lexical spans and approximate nesting, not a
compiler. Unsupported syntax is reported as unverified, never silently clean.
Dimensions and focus/image checks need shared-style and runtime context before
being promoted to actual UI defects. verify-live remains the author's rendered
UI check; the independent qa-browser agent is specified in docs/qa-agent.md
for the next piece, not implemented here.

The runner writes --out/prompt.md and grants that one extra workspace to
Claude; its absolute Read denies use // path syntax. The CLI receives the
prompt file reference, not the mechanical JSON. A compact summary includes
counts, bounded samples, justified files and analysis warnings. Reports state
when the Codex guard hook is not verified active. Neither read-only sandboxing
nor prompt instructions alone provide complete filesystem confidentiality.

Calibration scores each family independently and fails if either contributes
nothing or cannot perform the audit. It also requires each family to detect
the seeded smell and design categories. Expected files are created only after
both processes finish. Zero findings or a successful process exit alone never
prove adequate recall. PR reviewer wiring remains opt-in and unchanged here.
