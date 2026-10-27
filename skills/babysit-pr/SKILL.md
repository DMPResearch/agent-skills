---
name: babysit-pr
description: Watch a pull request and drive it to mergeable. Fixes failing checks, answers review findings, resolves conflicts, re-runs reviews, and stops when it is ready, blocked on a human, or out of tries. Use when asked to babysit, shepherd, watch, monitor or "get this PR green", or after opening a PR.
---

# Babysit a PR

Goal: get the PR to `READY` (every check green on the current head, a review
verdict on that head, no conflicts, no open threads). Then hand it to
`merge-safe-prs` if the owner authorized merging, or report that it's ready.
This skill never merges by itself.

The repo's AGENTS.md / CLAUDE.md are the contract. Read them first: CI
lanes, reviewer fallbacks, push and budget rules.

## 0. Set up once

- Work in the PR's own worktree. Find it with `git worktree list | grep <branch>`.
  If there is none, create one where the owner's rules say (on this machine
  `/Volumes/DevBox/worktrees/<name>`, linked as `~/worktrees/<name>`, mount
  checked first). Never work on someone else's checkout or on `main`.
- In T3: `link_pull_request` with the PR URL.
- Read the PR body, the linked issue and PLAN.md if there is one, so you know
  what "done" means for this change.

## 1. Read the state

```sh
python3 -I ~/.agents/skills/merge-safe-prs/scripts/pr-state.py <pr>
```

Done means `READY <sha>` **and** an approving reviewer verdict on that same
head. Read the reviewer's comment, because `READY` does not cover it. Then go
to step 5. Otherwise each reason is a blocker. Handle them in this order:

| Blocker | What to do |
| --- | --- |
| Checks pending | Wait (step 2). Don't touch the branch while CI runs. |
| Required or other check failed | Open the failing job's log (`gh pr checks <pr>` gives the details URL; for GitHub runs, `gh run view <id> --log-failed`; Depot logs come from the check's details URL or the `depot` CLI). Reproduce locally with the same command, fix the cause, and run that same command again until it passes. |
| Infra flake (runner setup, network, cancelled by a newer run) | One re-run, with the evidence that it was infrastructure. A second failure gets treated as real. Never re-run to launder a real failure. |
| Reviewer: needs changes | Check each finding's key claim. Fix the real ones. Rebut wrong ones in a reply with evidence. Replies on this PR's own review threads are part of the job, no need to ask. Resolve a thread only when the fix is pushed or the thread's author agreed. |
| Reviewer: no verdict | Use the fallback the repo's AGENTS.md names (re-running the reviewer job, a local review script). If it names none, run `cross-review --pr <n>` on the head and record it in the PR. A missing review is never approval. |
| Behind base / conflict | Update from base the repo's way (merge base in, or rebase plus `--force-with-lease` on your own branch only). Resolve conflicts by understanding both sides, then re-run the full local checks. |
| Draft | Leave it alone unless the owner asked you to mark it ready. |
| Waiting on a human (approval, product question) | Report and stop watching. Nothing to fix. |

## 2. Wait without polling

- **In T3:** call `watch_pull_request` and end your turn. T3 wakes you when
  checks finish, someone comments, or the branch conflicts.
- **Elsewhere:** `/loop` with a delay that fits the CI (about 10 minutes for a
  typical run), or a Monitor until-loop on `pr-state.py`. Never a tight loop.

## 3. Push in batches

- Collect every fix for the current round, then run the real local checks
  for what you touched (the repo's verify or "done" command if it has one).
  Write long test output to a file under `/Volumes/DevBox/tmp/` and grep the
  file.
- Material code change? Run `cross-review` on the new frozen diff before the
  push and update the PR body's review record.
- Scan the new commits for credentials before they leave the machine:
  `python3 -I ~/.agents/skills/merge-safe-prs/scripts/scan-secrets.py origin/<branch>`,
  or `origin/<base>` if the branch was never pushed, plus `--worktree` for
  anything uncommitted. It prints SHAs only, never the content, and exit 2
  (error) is not clean. Triage a hit the way `merge-safe-prs` step 2.4 says
  (`--explain`, then `--allow` only for fake or public ids in tests).
- **One push per round**, and only if it keeps within the repo's CI and review
  budget rules (some repos allow one paid review per finished piece, not per
  round). No commit-by-commit pushes, no `--no-verify`, no skipped hooks, no
  disabled tests or checks, no edits to CI-owned labels or required checks,
  and no comments that summon a paid review bot unless the repo says that is
  how it is requested.

## 4. Stop rules

Stop and report when any of these is true:

- `READY <sha>` and an approving reviewer verdict on that same sha. That's
  success. `READY` alone is not.
- **Two failed fix rounds on the same blocker.** Write in PLAN.md what you
  tried and what failed, then re-plan or ask.
- The fix needs a critical decision (scope, product behaviour, money, security,
  anything `decide-or-ask` says to ask). Ask once, then keep working on the
  other blockers in the meantime.
- The fix would leave the PR's scope. Open a note for a follow-up instead.
- CI or review budget rules would be broken by another run.

## 5. Hand off

- If the owner authorized merging this PR, run `merge-safe-prs` now. It does
  its own fresh gate read.
- Otherwise, in T3 call `unwatch_pull_request` so the thread returns to the
  owner's inbox.
- Report in 2-3 lines: state (`READY <sha>` / blocked on X), what you fixed and
  pushed (commit SHAs), and any decision you need, as a numbered item with
  your recommendation.
