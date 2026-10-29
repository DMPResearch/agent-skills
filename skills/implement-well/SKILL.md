---
name: implement-well
description: Use for any implementation, from the smallest verifiable plan through engineering checks and an independent final critique, including UI work.
---

# Implement well

Read the repo's AGENTS.md and existing contracts and patterns. Preserve its
approval gates and required checks. Choose the smallest change that meets the
observable acceptance criteria. Record the plan, risks and proof for each step
in PLAN.md; do not add unrelated refactors, dependencies or speculative scope.
For a defect, reproduce the user's steps first and rerun them after the fix.

## First gate: no AI slop

Check UI-SLOP-DESIGN, PROC-SLOP-WRITING, ENG-SLOP-CODE and
PROC-SLOP-REVIEW from the catalogue before every other critique check.
These are blockers from owner AGENTS.md section 0. Nothing generic in design,
writing or code is ready to show, commit or ship, regardless of other passes.
An independent critic must inspect the actual artifacts; self-review never
counts. Compare design side by side with named top-quality references, read
copy for filler/hype/hedging and inspect code for unnecessary boilerplate,
speculative abstractions, copied logic, restatement comments, invented APIs,
silenced errors and source-mirroring tests. Fix defects before handoff.

## Choose simplicity deliberately

- DRY: share a rule that must stay consistent. Two handlers copying the same
  price calculation will drift; put that calculation behind one tested
  function. Similar-looking layouts with different semantics do not yet
  justify a universal component with ten boolean switches.
- KISS: prefer a direct, readable control flow. A plugin registry and factories
  for one fixed formatter add indirection without removing complexity. Keep
  a plain function until real variation requires more.
- YAGNI: build today's accepted behaviour. An unused cache, generic workflow
  framework or configuration for imagined providers costs maintenance and
  tests without serving the request. Leave it out.

A pattern earns its place by removing complexity that exists now. Name that
complexity and compare the simpler alternative before introducing it:

| Pattern | Earns its place | Does not earn it |
| --- | --- | --- |
| Strategy | Several real interchangeable algorithms under one contract | One algorithm with hypothetical alternatives |
| Adapter | An external API or harness differs from the internal contract | A wrapper that only renames the same arguments |
| State machine | Async transitions have invalid paths, retries and cancellation | A local open/closed toggle |
| Repository | Existing persistence variants need one domain access contract | Pass-through CRUD with no isolation benefit |
| Observer | Independent consumers need lifecycle-managed events | A direct caller can call one function |

## Keep one typed contract

Define shared schemas once, infer types for frontend and backend from them,
and validate untrusted input and responses at their boundaries. Import that
contract on both sides. Hand-copied request interfaces, unchecked casts and
`any` across the boundary hide disagreement. Adapt provider formats at the
edge. Use the repo's existing schema tools, not a new validation dependency.
In other languages use the equivalent shared generated or schema-derived
contract and runtime validation.

## Prove behaviour while building

Write a test against a public interface for the changed behaviour, run it
first and confirm it fails for the intended missing behaviour, then implement
and make it pass. Include meaningful error and edge cases. A syntax error or
broken fixture is not the intended red result. Do not assert source lines,
private call order, constants against themselves or mocks that merely repeat
the implementation. Fixtures belong in tests, never in a product success path.
Run the repo's required root tests and typecheck plus relevant integration
checks, save full output and read it. Record unrun checks plainly.

Apply the file limit to authored logic, not config/data, generated files or
repo-exempt files. Read the repo's existing ratchet/exemption policy through
its extension. If one cohesive code file genuinely needs more than 500 lines,
put a real file comment within its first ten lines:
`practice-allow: ENG-002 because <specific reason>`.
Use the file's own comment syntax. The reason needs at least 40 characters,
eight words and five distinct words as a minimum substance check. Empty,
wrong-rule and string-literal markers do not waive the length rule. A valid
marker is listed as justified, never an approval of code quality; the critic
must verify the reason holds and that the file remains clean.

For UI, load design-references before new mockups or prototypes. Follow the
repo's approved mockup and design-system gates. Build only from the product's
approved tokens and components; extend the system intentionally when a state
is missing rather than applying ad-hoc colours, spacing or widgets per screen.
Test observable interactions and failure states, not just a screenshot.

## Mandatory final critique

A critic who did not author the implementation and belongs to a different
model family must inspect the finished diff and evidence. Use cross-review
for panel selection, frozen diff, execution, verdict and finding-resolution
mechanics. Dispatched workers hand the evidence to their orchestrator, which
runs the critique; they do not spawn nested reviewers. A worker handoff is
not a claim that the review gate passed.

Give the critic this explicit checklist with the task's acceptance criteria:

- Smallest in-scope change; DRY, KISS and YAGNI applied without premature
  abstraction; each pattern removes real complexity and earns its cost.
- One strongly typed shared contract, validated at boundaries, with no
  hand-copied frontend/backend types or unchecked cross-boundary values.
- Observable behaviour covered by meaningful tests, with an intended failing
  test observed first and required checks actually run.
- UI uses the approved design system and has good taste when compared with
  its approved mockups and named quality references. One clear primary action,
  intentional hierarchy and depth, no generic filler or equal-weight stacks.
- Code smells ENG-003 and ENG-SMELL-*: long or multi-purpose functions, deep
  nesting, god modules, structural duplication, consequential magic values,
  feature envy, primitive boundary types, shotgun surgery, unclear names,
  dead/commented-out code, leaky abstractions/tight coupling, swallowed errors,
  and boolean flags that switch behavior. Verify actual consequences and
  context; a metric alone is a candidate, not a defect.
- Design-system rules UI-002 and UI-DS-002..004: raw design values and inline
  styles, theme-dependent tokens, visible focus and computable touch targets,
  image geometry, distortion and alt text. Source checks cannot approve the
  rendered screen; hand UI work to verify-live.
- No UI bugs or colour glitches: contrast in both themes, theme leaks, wrong
  tints, flashes of guest/empty or wrong theme before state resolves, broken
  hover/focus/pressed/disabled states, overflow or clipping at phone sizes.

For UI changes, hand off to verify-live for production-build checks in real
browsers, the full size/theme/state matrix, break-it interactions and
independent screenshot critics. Code review alone cannot approve visuals.
Fix findings before reporting done, rerun affected checks and critique the
latest diff and images. Preserve the review record and state any unrun check;
missing evidence or an unavailable reviewer is never a pass.
