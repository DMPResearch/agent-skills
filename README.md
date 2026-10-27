# Agent skills

Five skills shared by Claude Code, Codex and Cursor across all of our
projects. Each one is a folder with a `SKILL.md` in the
[Agent Skills](https://agentskills.io) format, plus the scripts it runs.

| Skill | Use it when |
| --- | --- |
| [`decide-or-ask`](skills/decide-or-ask/SKILL.md) | you are about to ask the owner something or stop for input |
| [`cross-review`](skills/cross-review/SKILL.md) | a piece of work is finished, before reporting it done, committing or pushing |
| [`verify-live`](skills/verify-live/SKILL.md) | any UI, flow, link or native change, before calling it done |
| [`babysit-pr`](skills/babysit-pr/SKILL.md) | a PR is open and has to get green |
| [`merge-safe-prs`](skills/merge-safe-prs/SKILL.md) | the owner asked for a merge, or babysit-pr reports a PR ready |

The repo's own AGENTS.md wins wherever a skill says otherwise.

## Install

```sh
git clone https://github.com/DMPResearch/agent-skills ~/Projects/agent-skills
~/Projects/agent-skills/install.sh
```

`install.sh` links every skill into `~/.agents/skills` (Codex),
`~/.claude/skills` (Claude Code) and `~/.cursor/skills` (Cursor), links
`hooks/` as `~/.agents/hooks`, and registers the guard hook with all three
(other hooks in those configs stay; each config is backed up first). Pull and
run it again to pick up changes. The skills call their scripts through
`~/.agents/skills/<name>/`, so keep that link in place.

Codex runs a new hook only after you trust it once: open `codex`, run
`/hooks` and trust the guard entries. `python3 ~/.agents/hooks/guard.py status`
shows what is installed and trusted.

## Hooks

`hooks/guard.py` is one hook for Claude Code, Codex and Cursor. It blocks:

- reading, listing or copying private keys (`~/.private_keys`, `~/.ssh`,
  Keychains, `*.p8`, `*.pem`, `*.p12`, `*.key`, service-account JSON). An
  existence test (`test -f`) and handing the path to the tool that uses it
  (`ssh -i`) still work. A private key showing up in command output stops the
  turn.
- `gh pr merge` with `--admin` or `--auto`, without `--match-head-commit`,
  or without a fresh `READY` from `pr-state.py` for that commit.
- `git push` of never-pushed commits that the secret scanner flags. Made-up
  fixture tokens are allowed per repo in `.secret-scan-allow`.

It reminds, once: load `decide-or-ask` before asking the owner (Claude Code),
run `cross-review` (and `verify-live` for UI files) before finishing changes
made in this session, and use `babysit-pr` after `gh pr create`. Critic runs
(`AGENT_GUARD_ROLE=critic`) get the blocks but never the reminders.

The hooks are tripwires, not a sandbox: they read command text, so a script,
`python -c`, an alias or a heredoc fed to an interpreter gets past them, and
they assume an honest agent making mistakes. Keep the rules in your briefs
anyway. Known gaps: plain `ssh` still sees your keys; Cursor is covered only
where its CLI sends hook events; Codex needs the one-time trust above.

## Evals

```sh
python3 evals/run_evals.py triggers     # does each skill load when it should
python3 evals/run_evals.py scenarios    # does the agent behave right, hooks off then on
```

Trigger prompts live in `evals/triggers/<skill>.json` (skill-creator's
format). Scenarios (`evals/scenarios.py`) run real agents in throwaway repos
with a fake `gh`, fake critics and a local remote, and grade from what
happened: merges called, commits, pushes, a deploy script that logs, a canary
key that must never appear. They cost real model time, so run them when a
skill or hook changes, not in CI. Claude runs on the second account only with
usage headroom (`--force` overrides). Scenario boxes have no GitHub login, no
token variables, no SSH agent and no git credential helper, but the network is
open and the agents run with full access inside the box. Latest numbers:
[`evals/RESULTS.md`](evals/RESULTS.md).

## What they expect

- `git`, `gh` (signed in), `python3`, `bash`.
- `cross-review` runs the critics through the `codex`, `claude` and
  `cursor-agent` CLIs. The Opus critic runs on a second Claude account
  (`CLAUDE_B_DIR`, default `~/.claude-b`) and refuses to start without a fresh
  usage log showing headroom (`USAGE_GUARD_LOG`).
- `verify-live` needs Playwright where the project resolves it, plus Xcode
  simulators, the Android emulator and Maestro for native checks. Project
  details (URLs, devices, stack commands) go in private notes at
  `~/.agents/project-notes/<repo>.md`, never in this repo.
- `cross-review` quotes your credential rule to every critic word for word and
  refuses to run without it. It looks for a line starting
  `- When an agent looks for a credential` in `~/.claude/AGENTS.md`, the repo's
  `AGENTS.md`, `~/.codex/AGENTS.md` or `~/.agents/AGENTS.md`. Write that rule
  yourself: it should say how agents may check that a credential exists without
  ever reading or printing it.
- The scripts write to `/Volumes/DevBox/tmp/...` when that disk is mounted,
  otherwise to the system temp folder. The simulator and emulator commands in
  `verify-live` name that folder directly; change the path on other machines.

## Tests

```sh
python3 -I -m unittest discover -s hooks/tests
bash skills/cross-review/scripts/tests/test-run-critics.sh
python3 -I -m unittest discover -s skills/merge-safe-prs/scripts/tests
PW_DIR=<folder where Playwright resolves> bash skills/verify-live/scripts/tests/test-capture.sh
```

The test files contain made-up tokens on purpose, to prove the secret
scanner catches them. None of them is a real credential.
