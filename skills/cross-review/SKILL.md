---
name: cross-review
description: Independent cross-family code review between Claude, Codex and Cursor models. Use when a piece of implementation is finished (before reporting it done, committing for a PR, or pushing), when a PR needs a different-model-family review, or when a reviewer must check a worker's claims. Freezes the diff, runs read-only critics in parallel, and passes only when every critic approves.
---

# Cross-review

A piece of work is not done until critics from a model family other than the
author's have read the frozen diff and approved it. You review with the other
families. You never mark your own homework.

The repo's AGENTS.md / CLAUDE.md win over this skill wherever they say more,
for example a required Opus critic on every review, a Greptile run, or a
recorded digest format.

## 1. Pick the panel

| Author of the code | Default critics |
| --- | --- |
| Claude (any Claude model) | Codex + Grok (Cursor) |
| Codex | Opus on Claude B + Grok (Cursor) |
| Cursor model | Codex + Opus on Claude B |

- At least one critic must be from another family. The script refuses a panel
  without one.
- If the owner's or the repo's rules ask for more critics (for example an
  Opus critic on every code review), add them: `--critics codex,grok,opus`.
  A same-family extra never counts as the different-family review.
- Some projects add a separate paid review (a Greptile CLI run, say). Run it
  where the repo's AGENTS.md says to, never as a substitute for this panel.
- **Account headroom before any Claude critic.** The script reads
  `/Volumes/DevBox/tmp/usage-guard.log` and refuses `opus` while Claude B is
  above 60%, or when the log is missing, unreadable or more than 20 minutes
  old (restart it: `nohup /Volumes/DevBox/tmp/usage-guard-log.sh &`).
  A fresh log under 60% is only the session check. Before any batch with a
  Claude critic, also read B's weekly limits
  (`CLAUDE_CONFIG_DIR=~/.claude-b claude -p "/usage"`) and leave Opus out
  when the weekly or Fable-weekly allowance is nearly used. If B resets within about 30 minutes, pass `--force-opus`.
  Otherwise drop `opus` and record that it was skipped and why. Never retry a
  rate-limited account before its reset. If Codex is unavailable, Grok plus
  Opus on B is the panel.
- **If you are a worker** that an orchestrator launched (a Codex or Claude
  worker with a brief), do not run this skill. Finish, run your checks and
  report back. The orchestrator runs the review, so reviews never nest and
  never land on the wrong account.

## 2. Freeze and run

Run from the checkout that holds the change (worktree root):

```sh
~/.agents/skills/cross-review/scripts/run-critics.sh \
  --implementer claude \
  --brief /path/to/brief.md        # optional but strongly recommended
# PR head instead of local work:  --pr 1234   (HEAD = PR head, clean tree)
# Preview the panel and digest:   --dry-run   (exits 3: nothing reviewed)
```

- The diff is base...working tree, committed and uncommitted, including new
  untracked files. It goes through a throwaway index, so your real index is
  untouched. Lockfile changes are reviewed from their own `lockfiles.diff`.
  Before any critic sees the change, it runs the redacting scanner
  (`merge-safe-prs/scripts/scan-secrets.py`, so keep both skills installed)
  and refuses on credential-like files or content, without saying which.
- The brief is the **severity contract**. It says what the change is meant
  to do, its scope, the claims that matter, the threat model and known
  limits (what it deliberately does not cover), the tests you ran, and from
  round 2 on every prior finding with your fix or rebuttal. Critics grade
  against it. P0/P1 means a defect inside the stated scope and claims: a
  false pass, a crash, a leak, or a broken owner rule. Anything outside the
  contract is P2 unless the critic shows a realistic path to real harm.
  Critics verify claims instead of trusting them, so state the claims
  plainly.
- Critics run in parallel with a 40-minute watchdog each (`--timeout`).
  Run it in the background (`run_in_background`) and wait for it to finish.
  Don't poll it.
- Output goes to `/Volumes/DevBox/tmp/cross-review/<repo>-<sha>-<time>/`:
  `summary.md`, one transcript per critic, `review.diff`, `full.diff`,
  `prompt.txt`. Exit 0 = PASS, 1 = needs changes (fix first, even if
  another critic gave no verdict), 2 = a critic gave no verdict (not a pass:
  rerun or swap that critic), 3 = dry run. A verdict counts only as the exact
  last line of a critic that exited cleanly (Markdown emphasis around it,
  such as `**VERDICT: approve**`, is ignored). An "approve" that still lists a
  P0/P1 counts as needs-changes.

Self-test after editing the runner (fake critics, no cost):
`bash ~/.agents/skills/cross-review/scripts/tests/test-run-critics.sh`

## 3. Rounds

1. Read each critic's findings yourself. Don't skim the verdict line.
   **Check the key claim of every P0/P1** (reproduce it or read the cited
   line) before acting on it.
2. Fix every real P0/P1. For a finding you believe is wrong, write the
   rebuttal with evidence (test output, file:line) in the next brief. Don't
   quietly ignore it.
3. Rerun the full panel on the new frozen diff. The digest changes, and a
   pass on an old digest does not cover the new one.
4. **Convergence.** The piece passes when every critic approves, or when
   every P0/P1 inside the contract is fixed and what remains is documented.
   A stream of new, ever-narrower findings outside the contract does not keep
   the loop open. Stop, document them as known limits, and say so in the
   record.
   - Two failed rounds on the same finding: stop, write what failed in
     PLAN.md and re-plan.
   - A severity dispute (the critic calls it P1, you call it out of scope)
     is the author's `decide-or-ask` decision, recorded with its reason. It
     is not another round. Technical disputes get settled with a test;
     owner-level ones go to the owner.
5. P2/P3 findings: fix the cheap ones in scope, list the rest in the report.

## 4. Record it

Paste this into the PR body (or the report, for work with no PR). It is
review provenance, not an authorship credit, so add no co-author lines:

```
Cross-review: PASS
Implementation family: <claude|codex|cursor>; critics: <codex gpt-6-sol, grok-4.7-high, ...>
Base <sha>, reviewed head <sha>, frozen diff sha256:<digest>, mode: <--pr N | local tree>
Findings: <n> (P1: <short> -> fixed in <sha> | rebutted: <why>) ...
Tests: <commands run, pass/fail>
```

Before pushing, check that the commit you push has the same diff
(`git -c core.quotePath=false -c color.ui=never diff --no-color --no-ext-diff --binary <base> <pushed-sha> | shasum -a 256` matches the digest
when nothing changed since). If it does not match, run the review again.

## Screenshots and design

This skill reviews code. For UI work, the screenshot critique (an Opus critic
plus a Cursor critic reading the real captures) lives in `verify-live`. Both
must pass for a UI piece.
