#!/usr/bin/env bash
# Links each skill into ~/.agents/skills (Codex), ~/.claude/skills (Claude Code)
# and ~/.cursor/skills (Cursor). Re-run after pulling to pick up new skills.
# An existing real folder of the same name is moved to ~/.agents/skills-backup,
# never deleted (a copy left inside a skills folder would load twice).
set -eu
SRC="$(cd "$(dirname "$0")/skills" && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"
for name in $(ls "$SRC"); do
  for dir in "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.cursor/skills"; do
    mkdir -p "$dir"
    dest="$dir/$name"
    if [ -L "$dest" ]; then rm "$dest"
    elif [ -e "$dest" ]; then
      tool="$(basename "$(dirname "$dir")")"; bak="$HOME/.agents/skills-backup/$STAMP/${tool#.}-$name"
      mkdir -p "$(dirname "$bak")"; mv "$dest" "$bak"; echo "moved aside: $bak"
    fi
    ln -s "$SRC/$name" "$dest"
  done
  echo "linked $name"
done
