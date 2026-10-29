#!/usr/bin/env bash
# Links each skill into ~/.agents/skills (Codex), ~/.claude/skills (Claude Code)
# ~/.cursor/skills (Cursor), ~/.pi/agent/skills (Pi) and the XDG OpenCode
# skills folder. Links hooks/ as ~/.agents/hooks and registers
# the guard hook with all three (hooks/install_hooks.py). Re-run after pulling.
# An existing real folder of the same name is moved to ~/.agents/skills-backup,
# never deleted (a copy left inside a skills folder would load twice).
set -eu
SRC="$(cd "$(dirname "$0")/skills" && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"
for name in $(ls "$SRC"); do
  for dir in "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.cursor/skills" "$HOME/.pi/agent/skills" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills"; do
    mkdir -p "$dir"
    dest="$dir/$name"
    if [ -L "$dest" ]; then rm "$dest"
    elif [ -e "$dest" ]; then
      tool="$(printf '%s' "${dir#"$HOME"/}" | tr / _)"; bak="$HOME/.agents/skills-backup/$STAMP/${tool#.}-$name"
      mkdir -p "$(dirname "$bak")"; mv "$dest" "$bak"; echo "moved aside: $bak"
    fi
    ln -s "$SRC/$name" "$dest"
  done
  echo "linked $name"
done
HOOKS="$(cd "$(dirname "$0")/hooks" && pwd)"
if [ -L "$HOME/.agents/hooks" ]; then rm "$HOME/.agents/hooks"
elif [ -e "$HOME/.agents/hooks" ]; then
  mkdir -p "$HOME/.agents/skills-backup/$STAMP"; mv "$HOME/.agents/hooks" "$HOME/.agents/skills-backup/$STAMP/agents-hooks"
fi
ln -s "$HOOKS" "$HOME/.agents/hooks"
python3 -I "$HOOKS/install_hooks.py" "$STAMP"
python3 -I "$HOOKS/guard.py" status || true
