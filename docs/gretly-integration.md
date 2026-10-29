# Delivering shared skills to Gretly Builder agents

Proposal only. The engine checkout was read, not changed. Paths and lines
below refer to `~/Projects/gretly-platform` as inspected on 2026-10-29.

## Existing seams and gaps

The engine must remain product-neutral. Product knowledge arrives through
runtime packs and adapters, never imports from apps (AGENTS.md:28-35).
`engine/stages/adapter.ts:32-51` already defines a versioned ProductAdapter
with design hooks and stage passes. `engine/sdk/gretly.ts:233-236` registers
packs before start. Neither is currently a skill bundle registry.

`engine/flowops/families/coordination.ts:44-49` describes toolkit IDs as the
tools, skills, services and secrets a project registers. This field is an
allowlist vocabulary, not evidence that skill content is resolved or loaded.
`engine/stages/adapter.ts:21-24` exposes stage policy toolkit IDs. Add actual
resolution and delivery instead of assuming that mentioning a skill loads it.

`engine/runner/orders.ts:1-6,24-28,94-99` provides product-supplied orders and
appends adapter notes and human instructions. Use this extension point for
policy that says when skills apply. Do not put these skill names, Dribbble
research policy or product design language into DEFAULT_ORDERS.

## Register and pin data through the SDK

1. The Builder product supplies a trusted, versioned skill bundle through its
   runtime adapter to @gretly/sdk. Bundle design-references, implement-well
   and the cross-review and verify-live dependencies from one reviewed commit
   of agent-skills. Include scripts and relative paths, not just SKILL.md.
   Publish a manifest with stable ID, source commit, content SHA-256, entrypoint,
   supporting files, dependency IDs and required capabilities. Product brand,
   reference category and design-system paths remain project context.
2. Add a generic shared schema and resolver for these artifacts in engine
   contracts/SDK and harness-kit. Validate IDs, paths, digests, dependency
   closure, size limits and duplicate versions before launch. Refuse traversal,
   symlink escapes, missing content and unknown toolkit IDs. Trusted host
   registration determines permissions; a skill cannot grant browser, shell,
   secrets or network access merely by asking for them.
3. Pin the selected bundle and digests into a durable project/board decision
   and each task's delivered context before claim. Replaying or resuming uses
   the recorded version, not today's mutable user symlink or remote branch.
   Record a load receipt with task revision, harness, bundle digest and file
   digests. Fail with an actionable blocker if the pinned artifact is missing.
   Keep reference screenshots, source credits, direction and mockup version
   links as project artifacts, not engine defaults.

These are proposed generic capabilities, not existing APIs. Pack registration
alone must not claim skill enforcement. The project's installed CLI skills
are useful for human sessions but insufficient for sandboxed engine agents.

## Stage and task policy supplied by the product

- Before the first design mockup pass: a research pass invokes
  design-references and produces INDEX.md, captures and two directions. Ask
  for the owner's direction where required before expanding the matrix.
- Every design revision: compare the new version to its references using an
  independent critic. `engine/stages/design.ts:21-31` already collects artifacts,
  calls pack.design.review and blocks owner approval on a failed critic.
  Pass reference manifests and independent visual evidence into that hook.
- Preserve versioned iteration and restoration (`design.ts:19-25,34-39`).
  The approved design system comes next (`design.ts:40-53`); its tasks must
  finish and merge before progression. Skill delivery must not skip these gates.
- Planning and all implementation tasks: implement-well in planner/worker
  context, plus the approved system artifact for UI work. Set toolkit IDs on
  tasks, with dependencies on completed design-system work where appropriate.
- Review tasks: implement-well's checklist and cross-review independence.
  Have the board orchestrate review across trusted distinct model families;
  workers do not launch nested critic CLIs. UI verification tasks invoke
  verify-live with real services and captures. A failed or unrun critique
  blocks completion, not merely a warning in a final message.

`engine/stages/idea/runner.ts:1-6` describes a host runner allowing Skill,
but `:8-35` only defines the runner port, not a permission implementation.
Idea research can use design-references when it actually starts UI direction
work, after provisioning browser capture capability. WebSearch/WebFetch alone
cannot execute the required screenshot helper. Pure idea intake need not load
implementation or visual skills.

## Delivery per harness

| Harness | Current evidence | Proposed delivery |
| --- | --- | --- |
| Claude | `engine/harness-claude/permissions.ts:28-33,54-68` exposes extraAllowedTools; `args.ts:70-76` appends orders and permission rules | Materialize only approved bundles in the sandbox skill directory, advertise entrypoints, explicitly allow the selected Skill invocations via adapter permissions, and verify a load receipt. The idea runner's comment is not proof all Claude tasks allow Skill. |
| Pi | `engine/harness-pi/args.ts:50-60` appends orders but uses --no-skills | Keep ambient discovery disabled. Deliver selected SKILL.md bodies through launch instructions and supporting files at explicit read-only paths. Translate skill tool instructions to read entrypoints. Alternatively add explicit selected skill paths only after validating the installed Pi CLI supports them alongside --no-skills. Test this rather than removing the isolation flag globally. |
| Codex | `engine/harness-codex/env.ts:31-43` isolates home without operator skills; `args.ts:72-80` ignores user config by default and supplies developer_instructions | Deliver selected entrypoint contents and absolute sandbox resource paths in launch instructions, with supporting files mounted read-only. Do not link the operator's whole skills/config tree. Verify on fresh and resumed turns. |

All harnesses receive the same pinned content and product context, with
adapter-specific invocation syntax only. Grant browser/capture and test tools
explicitly under the task guard. A native Skill tool is optional; delivery and
evidence are mandatory. Existing cross-review and verify-live scripts assume
local CLIs and machine paths. For engine sandboxes, the product supplies
review and capture tasks backed by the board's registered harnesses and
services, with equivalent evidence and gates; it must not silently run those
host scripts or claim they passed. Until that bridge exists, raise a blocker.

## Tests that would prove integration

- Resolver contract tests reject missing bundles, duplicate IDs, digest drift,
  dependency gaps, path traversal and symlink escapes; changing a toolkit ID
  never grants unrelated tools or secrets.
- SDK bootstrap with a neutral test pack registers a pinned bundle, launches
  a real task through each supported harness and observes a load receipt and
  correct resource reads. Host ambient skills remain unavailable. Include
  missing capability failures, unknown IDs and resume after the host checkout
  changes; the recorded version must remain authoritative.
- Design journey tests prove research artifacts precede mockups, a failed
  comparison prevents approval, revisions retain their reference version,
  restoration is deterministic and unfinished system tasks prevent build.
- Behavioural implementation tests exercise a schema boundary with malformed
  data, an intended red then green test, and review rejection followed by a
  corrected diff. Test trusted family separation, unavailable critics and
  stale evidence; none may produce approval.
- UI acceptance through the real product proves an approved system is used,
  real-browser verification runs in both themes at phone and desktop sizes,
  and intentional wrong tint, overflow and loading-state flash defects are
  rejected. Follow verify-live's complete matrix for delivery, not just this
  minimal negative-control test.
- Run root npm test and npm run typecheck plus existing layer/content guards
  after implementation. No engine source or expectation contains product
  names or category-specific reference prompts. These tests are proposed,
  not run as part of this documentation-only integration plan.
