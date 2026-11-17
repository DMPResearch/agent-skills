---
name: show-proof
description: Show the owner proof with every implementation you report, never a bare "done". Use whenever you hand back work the owner asked for (a feature, a fix, a screen, a flow, a backend change), before saying it is done, ready, deployed or fixed. Builds a scenario list from the request, runs each one on the real build, and reports a table of results with the screenshots, clip, test output and critic verdict behind each line.
---

# Show proof

The owner does not take "done" on trust, and should not have to ask for the
evidence. Every implementation you hand back comes with proof that it works
and looks right, in a form they can check in a minute: the scenarios you ran,
what happened in each, and the evidence beside it. A claim with no evidence
next to it is not part of the report.

This skill decides what the owner sees. How to capture it lives elsewhere:
`verify-live` (real browsers, devices, sizes, themes), `qa-browser` (break-it
QA), `cross-review` (the independent critic). The repo's AGENTS.md / CLAUDE.md
win wherever they say more.

## 1. Write the scenarios before you test

Turn the request into a short list of scenarios, each with the outcome you
expect, before running anything:

- **The owner's own words first.** Every example, message, bug report or
  tester case they gave becomes a scenario, typed verbatim.
- **The normal path** a real user takes, end to end.
- **The edges the change touches**: empty, long, wrong or repeated input,
  double submit, refresh mid-flow, back and reopen, signed out and signed in,
  another language, phone and desktop, light and dark. Pick the ones this
  change can break; skip the ones it cannot and say why in one line.
- **What must not change**: one or two neighbouring flows that share the code.

Write the list into the repo's PLAN.md (or the task notes) so the next agent
can rerun it.

## 2. Run every scenario on the real thing

- Run what the owner will use. For an app, that is the deployed staging or
  preview, or the production build served locally, not the dev server. For a
  library, CLI, script or job, it is the shipped command or interface, run
  the way a user or caller runs it.
- Live data, not a stand-in. Fixtures belong inside tests; a canned or mocked
  response never counts as proof that the product works. If a key, account or
  deploy is missing, ask for it through the repo's credential route; never
  fill the gap with fake data.
- Work that runs longer than the task (a nightly job, a sync, a migration):
  run it on a bounded input or watch it for a fixed window, and report what
  was observed in that window and what was not.
- Capture as you go:
  - **UI**: a screenshot of the result at each size and theme the change
    moves (verify-live's matrix), plus the state before it where that shows
    the difference.
  - **Flows** (anything with more than one step, or anything that streams or
    waits): a short clip, one per scenario or one with clear chapters. Trim
    waits but mark them; never cut inside an answer or a transition.
  - **Backend, data or CLI work**: the request and response, the log lines
    or the command output that show the behaviour, and the before/after of
    the original reproduction for a bug fix.
- Run the tests that cover the change and read the output yourself: the
  command, the pass and fail counts, and every failure named. A failure that
  also fails on the base branch is shown as such, with the base run as proof.
- Keep secrets, tokens, internal ids and personal data out of every capture.
  Captures go to the scratch or shared evidence folder, never into git unless
  the repo's rules ask for it.

## 3. Get an independent look

Self-review does not count. Before reporting:

- an independent screenshot or clip critic (another model or agent, per the
  repo's rules) checks every frame for broken layout, slop, wrong data, stale
  dates and leaked ids;
- code goes through `cross-review`.

A dispatched worker does not run these itself: it hands its scenario list,
captures and test output to the orchestrator, which runs the critics and owns
the verdict and the report to the owner.

Fix what they find and re-capture. Evidence from an older build is stale:
re-capture after the last change, or say the proof predates it.

## 4. Report it

Lead with the table, one row per scenario:

| Scenario | Expected | Result | Proof |
| --- | --- | --- | --- |
| "Export my March invoices" (owner's message) | one PDF with 3 invoices | pass | clip 0:42-1:10, shot export-390-dark.png |
| Export twice quickly | one file, no duplicate | pass | clip 1:15-1:30 |
| Refresh during export | export resumes | **fail** | clip 2:05; cause and next step below |
| iPhone Safari | layout holds | not run | no device today |

- **Result** is pass, fail or not run. Never round a fail or a not-run up to
  a pass, and never leave a row out because it failed.
- **Proof** points at something the owner can open: an absolute file path,
  an artifact or preview link, a clip timestamp. Show the key screenshots
  inline where the harness can render them, and link the clip.
- Under the table, in two or three lines: the test totals with their
  command, the critic's verdict, and what is still not proven and why.
- Keep the prose short. The table and the media carry the report.

A report with no table, or a row with no proof, is not finished. Go back and
capture it, or mark the row "not run" and say what is missing.
