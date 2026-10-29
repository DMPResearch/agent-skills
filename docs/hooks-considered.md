# Hook decisions

## Practice checks before push

Opt in per repository through `hooks/install_hooks.py --practice-repo REPO
--extension POLICY`. Installing global agent hooks alone never adopts a policy.
The Git hook runs for Claude Code, Codex, Cursor and a human shell, without
trying to infer ref updates from shell command text. The existing guard keeps
its credential and merge protection.

The implementation reuses the repo-side `pre-push-practices.py` range/snapshot
logic used by the skills rollout. Git supplies the exact local and remote
object IDs. Updates are checked against the remote base; a new branch uses
its merge base with the recorded remote HEAD (or remote/main when HEAD is
not recorded), falling back to an empty baseline when there is no common base. Tags and deletions do not introduce branch source and are skipped.
A temporary index and changed-file snapshot preserve the checkout and index,
including when pushing another branch. No temporary worktree is created.

Only the trusted installed checker executes. The selected extension and its
length-policy support files come from the current trusted checkout, not the
pushed branch. Extension commands are removed; this gate never runs them.
Private paths and symlinked policy files are rejected before reading; private
source paths are excluded with the existing shared recognizer. Output contains
catalogue rule IDs, never source, config content or arbitrary checker output.
Existing pre-push hooks are backed up and chained with the full ref stream.
Their failures remain failures. Review an existing hook before adopting it.

Confirmed violations block. Candidates do not. Missing remote base objects,
invalid configuration and checker failures print an explicit incomplete notice
and allow the push, matching the requested violations-only policy. Fetch the
missing base before retrying a full check. This is not a security sandbox or a
replacement for the secret scan. It checks the branch's resulting diff, not
all intermediate historical versions. The existing secret guard scans outgoing
history separately. It makes no network request and starts no model or CI run.

## UI completion at Stop or SessionEnd

No new blocker is installed. These payloads do not provide a portable,
authenticated record of browser actions, screenshots, build identity, viewport
coverage or independent visual review across all three harnesses. A command
mention or a loaded verify-live skill does not prove that verification ran,
let alone passed. Filename suffixes also misclassify nonvisual TSX helpers and
miss UI generated from other file types; a pre-existing dirty tree can belong
to someone else. “Done” language cannot distinguish a completed subtask from
a claim that the UI is ready. SessionEnd cannot reliably obtain another turn.

A blocker built on these signals would either reject honest partial handoffs
or accept invented evidence. The existing bounded Stop reminder remains. Real
verification and independent critique stay required by the skills. A future
blocker needs a shared evidence producer bound to the actual build and scope,
plus supported consumption in each harness. Adding that protocol is outside
this hook change.
