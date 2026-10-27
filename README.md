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
`~/.claude/skills` (Claude Code) and `~/.cursor/skills` (Cursor). Pull and run
it again to pick up changes. The skills call their scripts through
`~/.agents/skills/<name>/`, so keep that link in place.

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
bash skills/cross-review/scripts/tests/test-run-critics.sh
python3 -I -m unittest discover -s skills/merge-safe-prs/scripts/tests
PW_DIR=<folder where Playwright resolves> bash skills/verify-live/scripts/tests/test-capture.sh
```

The test files contain made-up tokens on purpose, to prove the secret
scanner catches them. None of them is a real credential.
