#!/usr/bin/env bash
set -euo pipefail

cli_path="$(cd "$(dirname "$0")/../bin" && pwd)/session-notes"
link_directory="${SESSION_NOTES_LINK_DIR:-$HOME/.local/bin}"
link_path="$link_directory/session-notes"

zshrc_path="${ZDOTDIR:-$HOME}/.zshrc"
# shellcheck disable=SC2016
loud_completion_line='(( $+commands[session-notes] )) && eval "$(session-notes completion zsh)"'
# shellcheck disable=SC2016
quiet_completion_line='(( $+commands[session-notes] )) && eval "$(session-notes completion zsh 2>/dev/null)"'

quiet_completion_in_zshrc() {
  grep -qxF "$loud_completion_line" "$zshrc_path" 2> /dev/null || return 0
  local rewritten_zshrc
  rewritten_zshrc="$(mktemp)"
  awk -v loud="$loud_completion_line" -v quiet="$quiet_completion_line" \
    '{ print ($0 == loud ? quiet : $0) }' "$zshrc_path" > "$rewritten_zshrc"
  cat "$rewritten_zshrc" > "$zshrc_path"
  rm -f "$rewritten_zshrc"
}

plugin_version_of() {
  sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$(dirname "$1")/../.claude-plugin/plugin.json" 2> /dev/null | head -n 1
}

is_linked_to_newer_version() {
  local own_version linked_version
  own_version="$(plugin_version_of "$cli_path")"
  linked_version="$(plugin_version_of "$(readlink "$link_path")")"
  [ -n "$linked_version" ] && [ "$linked_version" != "$own_version" ] &&
    [ "$(printf '%s\n%s\n' "$own_version" "$linked_version" | sort -V | tail -n 1)" = "$linked_version" ]
}

refuse_foreign_file() {
  printf '%s is not a session-notes link; move it and run the installer again.\n' "$link_path" >&2
  exit 1
}

quiet_completion_in_zshrc

if [ -L "$link_path" ]; then
  case "$(readlink "$link_path")" in
    */bin/session-notes) ;;
    *) refuse_foreign_file ;;
  esac
  ! is_linked_to_newer_version || exit 0
elif [ -e "$link_path" ]; then
  refuse_foreign_file
fi

mkdir -p "$link_directory"
ln -sfn "$cli_path" "$link_path"
