---
name: decide-or-ask
description: Decide non-critical questions yourself and keep working; ask the owner only about critical decisions. Use whenever you are about to ask the user a question, offer options, ask "should I proceed?", or stop to wait for input, and when choosing between approaches mid-task.
---

# Decide, or ask

The owner's attention is the scarcest resource on the team. Every question
you ask costs it and stalls your work. Most choices an agent faces are yours
to make: make them well, write them down, and keep going. Ask only when a
wrong call would be expensive or isn't yours to make.

## The test

Before asking, answer two questions:

1. **If I'm wrong, what does it cost?**
2. **How fast and how quietly can it be undone?**

If it can be undone in minutes, nobody outside notices, and no money,
security or product promise moves, then **decide**. Otherwise, check the list
below.

## Critical: ask

- **Irreversible or destructive**: deleting data, branches, worktrees or files
  you didn't create; force-pushing shared branches; rewriting pushed
  history; migrations or bulk changes on real data.
- **Outward-facing**: merging to a shared default branch (outside an existing
  `merge-safe-prs` authorization), any production deploy, app store
  submissions, emails or newsletters, public posts, comments that notify
  people, sending anything to an outside person or service for the first time.
- **Money**: new paid services or plans, spending past an agreed budget,
  prices, plan limits, live payments.
- **Security and access**: creating, rotating or sharing credentials,
  granting access or allowlists, weakening auth, exposing user data.
- **Product direction the owner reserved**: scope added or dropped, pricing,
  brand, design direction and approval gates, copy that promises something,
  and anything the repo's docs say the owner decides.
- **Contradiction**: two of the owner's rules conflict, a rule says "ask",
  or the request can be read two ways that lead to different products.
- **Blocked**: you need a key, account, device or permission you can't get
  yourself.

## Not critical: decide

Naming; file and folder layout that follows precedent; picking between
equivalent implementations; test structure; which agent or model does which
piece (the routing rules already say); retry and wait strategy; order of
steps; fixing an obvious bug you found in scope (no renames or refactors
nobody asked for: the owner's rules forbid them); UI details that follow the existing design system; which of
several green paths to take; how to split commits; wording of internal notes.

## How to decide well

Prefer, in this order:
1. The owner's written **rules** (AGENTS.md, CLAUDE.md, memory).
2. The **precedent** in the repo, its docs and history (look first: if the
   answer can be found, it is not a question). Precedent never overrides a
   written rule.
3. The **reversible** option over the irreversible one.
4. The **smaller** change over the larger one.
5. The option you can **verify** now.

Then write it down: one line in PLAN.md under "Decisions" (what, why). In the
report, a single line: "Decided: X over Y because Z." That's a record, not a
question.

## When you must ask

- **Batch** the questions: one message, a short numbered list, each with the
  options and **your recommendation** first. Use AskUserQuestion when the
  session is interactive.
- **Keep working** on everything the question doesn't block. Never park the
  whole task on one answer unless everything really depends on it.
- No "should I proceed?" or "is this OK?" after the owner already said go.
  No asking for facts the repo, docs or a command can answer.
- When unsure whether it's critical, ask, and frame it as "I recommend X".
  Carry on with the parts that don't depend on the answer, but leave the
  part it gates alone until the owner answers. Owner checkpoints (see below)
  always wait for an explicit yes, never for an "unless you say otherwise".

## What this skill does not do

- It doesn't override the owner's explicit checkpoints (for example
  "confirm what I'm after before a long task", or approval gates on designs),
  required reviews, or merge and deploy gates. Those still apply.
- It isn't a license to guess facts. Look them up, or say they're unknown.
- It doesn't hide decisions. Everything you decided is in PLAN.md and the
  report.
