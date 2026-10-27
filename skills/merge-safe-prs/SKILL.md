---
name: merge-safe-prs
description: Merge pull requests only when every safety gate holds on the current head, and only PRs the owner authorized. Use when asked to merge PRs, land a stack, "merge what is ready", or after babysit-pr reports a PR ready. Never bypasses checks, never deploys to production.
---

# Merge safe PRs

Merging is outward-facing: it changes the shared default branch for everyone.
This skill merges only what the owner authorized and only when the gates are
green on the exact head you merge. When in doubt, skip the PR and report why.
A skipped PR costs a minute. A bad merge costs a revert and trust.

The repo's AGENTS.md / CLAUDE.md come first, so read them before the first
merge in a session. They define what is "big", which reviews a merge needs,
and whether merging deploys anything.

## 1. Authorization (before anything else)

- **Merge only PRs the owner named in this conversation** (by number, URL, a
  named stack, or an explicit "all PRs that pass the gates"). Authorization
  for one PR or one session does not carry over to the next.
- **Small PRs** (localized, low-risk, per the repo's definition) merge on that
  authorization once every gate passes.
- **Big PRs** (architecture, auth, billing, security, data or migrations,
  dependencies, deployment, shared business logic, user-facing flows, or
  CI's `review:big` label) need a per-PR OK at merge time: one numbered
  question listing the PRs, each with its gate summary and your recommendation.
  Skip this only if the owner explicitly pre-cleared that exact PR as big.
  If you can't tell whether a PR is small or big, treat it as big.
- **Never** merge into a production or release branch, trigger a production
  deploy, or merge where the repo says merging deploys to production, without
  a separate explicit OK. Never use `--admin`, never bypass a ruleset, and
  never edit required checks or CI-owned labels to get a PR through.

## 2. Gates (fresh reads, at merge time, per PR)

Read the gate fresh right before merging. A read from ten minutes ago is stale:

```sh
python3 -I ~/.agents/skills/merge-safe-prs/scripts/pr-state.py <pr> [--json]
```

It must print `READY <sha>`. It blocks on: closed or draft, conflicts, behind
base, GitHub's BLOCKED/UNSTABLE states, missing/pending/failed/skipped required
checks (read from rulesets **and** branch protection; a PR into a non-default
branch is held to the union with the default branch's set), **any failing
check even if not required** (the worst of check runs and statuses of the same
name), changes requested, and unresolved review threads (all pages).
`READY` says nothing about a reviewer's verdict. That is step 1 below.

There is no override flag. A failed automatic reviewer means "no verdict",
not "approved". If the only blockers are non-required checks that failed
(such as an advisory reviewer with no verdict) and the repo names a fallback
that approved this same head, the PR still does not merge on its own. Put it
in the per-PR question to the owner with the evidence, and merge only on
their explicit OK for that PR (still with `--match-head-commit`). Keep each
question to one compact line, so it is a real decision and not a rubber
stamp: `#PR title | red: <check> (<why>) | fallback: <what ran, verdict, sha>
| small/big | recommend: merge/hold`.

Then check what the script can't:

1. **Review verdict on this head.** The repo's automatic reviewer (if any)
   approved this exact head SHA. Read the comment itself; a green check
   proves only that the job ran. Material findings are fixed or answered.
2. **Cross-review record** (`cross-review` skill) in the PR body: PASS, from a
   family other than the implementer's, and the recorded digest equals
   `git -c core.quotePath=false -c color.ui=never diff --no-color --no-ext-diff --binary $(git merge-base origin/<base> <head>) <head> | shasum -a 256` (a
   matching head SHA alone is not enough, unless the run used `--pr`, which
   refuses uncommitted changes). The head moved after the review? Then it is not
   reviewed.
3. **Any extra review the repo requires** (its AGENTS.md names it, for
   example a Greptile CLI verdict for stability-relevant changes), recorded
   in the PR for this head.
4. **No secrets** in commits not yet on the base. Never read them with
   `git log -p`, which prints whatever key is there. Use the redacting scanner:
   `python3 -I ~/.agents/skills/merge-safe-prs/scripts/scan-secrets.py origin/<base> <sha>`.
   The scanner is a floor, not the protection: the real defence is that
   secrets never sit in a tracked worktree, so a clean scan is not proof.
   It prints only commit SHAs. On a hit, rerun with `--explain`: it lists
   file, rule, key name and value length, never the value. Hits only in test
   files or fixtures with fake or public ids may be passed with
   `--allow "<glob>=<reason>"`. Credential-named files need their exact path,
   and the reasons go in the PR. Anything else stops the merge. Tell the owner
   the commit, never the content; the history needs rewriting first.
5. **Scope**: the diff matches the PR's title and body, with no stray files.
   Dependency bumps (bots included) count as big.

## 3. Merge

```sh
gh pr merge <pr> --squash --match-head-commit <sha-from-READY-line>
```

- Use the repo's merge method: check recent `main` history and the repo
  settings. If neither settles it, squash.
- `--match-head-commit` is mandatory: if someone pushed since your read,
  GitHub refuses and you start over at step 2.
- Do not delete the branch unless the repo's convention does it. Agents'
  worktrees may still sit on it.
- **Stacks**: merge bottom-up. After each merge, the next PR's base changes.
  Retarget it if GitHub did not, wait for its checks on the new base, and run
  step 2 again from scratch.
- One merge at a time; don't run merges in parallel.

Self-tests (run after editing the scripts):
`python3 -I -m unittest discover -s ~/.agents/skills/merge-safe-prs/scripts/tests`

## 4. After

- Confirm: `gh pr view <pr> --json state,mergedAt,mergeCommit` shows MERGED.
- If the base branch runs CI on push, check the first run on the merge commit.
  Red on main is yours to report right away (and fix through a new PR).
- In T3: `unwatch_pull_request` for PRs you were watching.
- Report a short table: `#PR | merged <sha> / skipped: <reason> / waiting
  for your OK`. Lead with any OK you need (numbered, with a recommendation).
