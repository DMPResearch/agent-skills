## No AI slop (hard rule)

Nothing that looks, reads or behaves like generic AI output is shown, committed
or shipped. A failure blocks completion even when other checks pass.

- Design: no template layouts, clip-art, hand-drawn SVG doodles, generated
  filler images, stock geometry, flat washes/glows, gimmick type, fake device
  chrome, equal-weight card stacks or skeletons standing in for content. Match
  named top-quality real references side by side.
- Writing: no filler, hype, hedging, empty summaries, stock praise, rhythmic
  lists of three, em dashes or emojis in user-visible text. Be specific and plain.
- Code: no unneeded boilerplate, speculative abstractions, copied blocks,
  comments restating code, invented APIs, silenced errors or source-mirroring tests.
- Every piece needs an independent critic who checks slop first before owner
  handoff. Self-review never counts. Catalogue IDs: UI-SLOP-DESIGN,
  PROC-SLOP-WRITING, ENG-SLOP-CODE and PROC-SLOP-REVIEW, all blockers.

## Shared agent skills

Agents on this repo use the shared skills from
[DMPResearch/agent-skills](https://github.com/DMPResearch/agent-skills).
Install with that repo's `install.sh`; load the skill by name, or read its
`SKILL.md` if the harness has no skill tool.

- `practice-audit`: report-only repository, directory or PR diff audit against the shared catalogue and this repo extension.
- `decide-or-ask`: before asking the owner, stopping for input, or an unnamed deploy or release.
- `design-references`: before mocking or prototyping any UI.
- `implement-well`: any implementation, from the smallest plan to the final independent critique.
- `cross-review`: finished implementation, before reporting done, committing or pushing; dispatched workers hand review to the orchestrator.
- `verify-live`: any UI, flow, link or native change, before calling it done or sharing it.
- `babysit-pr`: after opening a PR, or when asked to monitor one or get it green.
- `merge-safe-prs`: when asked to merge, or when babysit-pr reports ready; merge only what the owner authorized.

This repo's AGENTS.md wins wherever a skill says otherwise. Where skills are
not installed (CI, cloud reviewers), this file alone applies. A check a skill
would have run and could not is unrun, never a pass: say so.

Practice checks are opt-in. Name this repo's adopted extension in AGENTS.md
(see the shared rules/EXTENSIONS.md format). Rule promotions require explicit
violation_globs owned by this repo. No reviewer or CI integration is installed
by this snippet. After owner approval, the repo may configure its existing
automatic reviewer to invoke a trusted checker and judge its bounded summary.
Do not add paid CI or execute untrusted PR hooks. A requested full
practice-audit uses two families locally and records incomplete checks plainly.

The source checker also triages code smells and design-system usage. Adopt
repo-owned token paths/scales and thresholds through the extension. ENG-002
counts authored logic only, honors existing exemptions/ratchets, and permits a
top comment `practice-allow: ENG-002 because <specific reason>` for an
independent clean-code review. Strong secret material fails even in test/docs
source; other heuristics remain candidates unless explicitly promoted.
