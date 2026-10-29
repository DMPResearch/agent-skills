---
name: design-references
description: Collect and critique real design references before any UI mockup or prototype, for any product or repository.
---

# Design references

Read the repo's AGENTS.md and existing design system first. Product rules,
brand choices and approval gates come from that repo. Research precedes any
mockup or prototype, including screens that another agent will build.

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

## Collect before drawing

Search Dribbble in a real browser for the product's category and main user
job. Inspect top relevant shots, not only thumbnails or search rankings.
Choose references for composition and craft, not popularity alone. Add named
real products of comparable quality and inspect the relevant live screens.
Save search results and selected shots with source URL, designer or credited
team, capture date and licence note. If authorship or reuse terms cannot be
verified, say unknown; reference capture is not permission to reuse assets.
Never copy another business's content or publish their assets without rights.

Use `scripts/capture.mjs` from this skill's directory with a JSON manifest:

```json
[
  {"kind":"search","url":"https://dribbble.com/search/finance-dashboard","designer":"Multiple, inspect selected shots","licence":"Reference only; individual rights unverified"},
  {"kind":"shot","url":"https://dribbble.com/shots/SELECTED-ID","designer":"Replace with verified credit","licence":"Replace with verified terms or unknown"}
]
```

Replace example shot values with real inspected references. Run with an
existing Playwright installation, without adding a product dependency:
`PW_DIR=<package directory resolving playwright> node <skill>/scripts/capture.mjs manifest.json output-folder`.
It saves desktop and phone screenshots and credits in INDEX.md. Inspect every
capture: login walls, blank shots and cookie overlays are not references.
If blocked, use the available browser to capture manually and preserve the
same credits. Never bypass access controls or call an uncaptured shot proof.

## Extract a direction

Write a short DIRECTION.md beside INDEX.md. For each selected reference record
specific cues: type scale and weight contrast, spacing rhythm, colour roles,
light and shadow, glass and layered depth, imagery and how it joins the UI,
icon style, and micro details such as borders, radii and focus treatment.
Record what multiple references share and what would not suit this product.

Offer two distinct directions, each tied to named references and concrete
cues, with a reason it serves the primary job. Show these with the references
before expanding the mockup matrix; follow the repo's owner approval gate.
Keep the product's own identity. Preserve an approved design system, or use
this research to propose its tokens and components for approval before screen
implementation. Reference research does not authorize a redesign or deploy.

## Independent comparison before handoff

After mockups exist, give a critic who did not design them every mockup and
its named references side by side at phone size. Include all required sizes,
themes and states from the repo, and keep the version being judged explicit.
The critic must open the images and report concrete defects, not a score.
Check polish, hierarchy, spacing, imagery, depth and colour glitches against
the actual references, plus this slop checklist:

- One primary action per screen, quieter secondary actions and text tertiary
  actions; no stacks of equally loud buttons or equal-weight cards.
- No clip-art, hand-drawn SVG illustrations or generated filler. Use crafted
  imagery in the product's approved style with verified reuse rights.
- No flat colour washes or glows; depth comes from intentional light,
  layering, imagery and material, subject to the repo's approved language.
- No gimmick or decorative monospace typography, fake device status bars,
  or skeleton bars standing in for designed content.
- No wrong tints, theme leaks, poor contrast, clipped content or broken states.

Use cross-review's panel selection, independence and finding-resolution rules;
its code review does not replace this visual comparison. Use verify-live for
prototype browser verification, screenshot critics and its full size/theme
matrix rather than duplicating those mechanics here. A static mockup is not
proof of interactive behaviour. Fix findings and repeat the comparison on the
latest artifacts before reporting ready. An unavailable critic is an unrun
check, never approval. Hand approved artifacts to implement-well.
