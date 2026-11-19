#!/usr/bin/env bash
# Links each skill (ours and the pinned pstack) into ~/.agents/skills (Codex), ~/.claude/skills (Claude Code)
# ~/.cursor/skills (Cursor), ~/.pi/agent/skills (Pi) and the XDG OpenCode
# skills folder. Links hooks/ as ~/.agents/hooks and registers
# the guard hook with all three (hooks/install_hooks.py). Re-run after pulling.
# An existing real folder of the same name is moved to ~/.agents/skills-backup,
# never deleted (a copy left inside a skills folder would load twice).
set -eu
shopt -s nullglob
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"
# Our skills, then the pinned pstack (vendor/pstack/PIN). Our AGENTS.md and
# skills win where pstack disagrees.
for path in "$ROOT"/skills/* "$ROOT"/vendor/pstack/skills/*; do
  name="$(basename "$path")"; SRC="$(dirname "$path")"
  if [ "$SRC" != "$ROOT/skills" ] && [ -e "$ROOT/skills/$name" ]; then echo "skipped pstack $name: ours wins"; continue; fi
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
# pstack's subagents use Cursor model ids and paths, so they go to Cursor only.
mkdir -p "$HOME/.cursor/agents"
for agent in "$ROOT"/vendor/pstack/agents/*.md; do
  dest="$HOME/.cursor/agents/$(basename "$agent")"
  if [ -L "$dest" ]; then rm "$dest"
  elif [ -e "$dest" ]; then
    mkdir -p "$HOME/.agents/skills-backup/$STAMP"; mv "$dest" "$HOME/.agents/skills-backup/$STAMP/cursor-agent-$(basename "$agent")"
  fi
  ln -s "$agent" "$dest"
done
# Remove links this install made whose source was retired (a later pin or a
# deleted skill). Only links pointing into this checkout are touched.
for dir in "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.cursor/skills" "$HOME/.pi/agent/skills" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills" "$HOME/.cursor/agents"; do
  for link in "$dir"/*; do
    [ -L "$link" ] || continue
    target="$(readlink "$link")"
    case "$target" in */../*|*/..) continue ;; esac
    case "$target" in
      "$ROOT"/skills/*|"$ROOT"/vendor/pstack/*) [ -e "$link" ] || { rm "$link"; echo "removed retired link $link"; } ;;
    esac
  done
done
HOOKS="$ROOT/hooks"
mkdir -p "$HOME/.agents"
if [ -L "$HOME/.agents/hooks" ]; then rm "$HOME/.agents/hooks"
elif [ -e "$HOME/.agents/hooks" ]; then
  mkdir -p "$HOME/.agents/skills-backup/$STAMP"; mv "$HOME/.agents/hooks" "$HOME/.agents/skills-backup/$STAMP/agents-hooks"
fi
ln -s "$HOOKS" "$HOME/.agents/hooks"
python3 -I "$HOOKS/install_hooks.py" "$STAMP"
python3 -I "$HOOKS/guard.py" status || true
