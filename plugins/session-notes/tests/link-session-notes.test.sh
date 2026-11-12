#!/usr/bin/env bash
set -uo pipefail

plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
link_script="$plugin_root/hooks/link-session-notes.sh"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
export SESSION_NOTES_LINK_DIR="$fixture_directory/bin"
link_path="$SESSION_NOTES_LINK_DIR/session-notes"
export ZDOTDIR="$fixture_directory/zdotdir"
mkdir -p "$ZDOTDIR"
failures=0

expect_equal() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$description" "$expected" "$actual"
    failures=$((failures + 1))
  else
    printf 'pass %s\n' "$description"
  fi
}

bash "$link_script"
expect_equal "links the CLI into a new link directory" \
  "$plugin_root/bin/session-notes" "$(readlink "$link_path")"

ln -sfn "/old/cache/session-notes/0.4.0/bin/session-notes" "$link_path"
bash "$link_script"
expect_equal "repoints a link left by an older plugin version" \
  "$plugin_root/bin/session-notes" "$(readlink "$link_path")"

make_plugin_copy() {
  local copy_root="$fixture_directory/$1"
  mkdir -p "$copy_root/bin" "$copy_root/.claude-plugin"
  printf '#!/bin/sh\n' > "$copy_root/bin/session-notes"
  printf '{\n  "name": "session-notes",\n  "version": "%s"\n}\n' "$1" > "$copy_root/.claude-plugin/plugin.json"
  printf '%s\n' "$copy_root/bin/session-notes"
}

newer_cli="$(make_plugin_copy 99.0.0)"
ln -sfn "$newer_cli" "$link_path"
bash "$link_script"
expect_equal "leaves a link to a newer plugin version alone" "$newer_cli" "$(readlink "$link_path")"

ln -sfn "$(make_plugin_copy 0.8.0)" "$link_path"
bash "$link_script"
expect_equal "repoints a link to an older plugin copy" \
  "$plugin_root/bin/session-notes" "$(readlink "$link_path")"

ln -sfn "$(make_plugin_copy 0.10.0)" "$link_path"
bash "$link_script"
expect_equal "compares versions by number, not as text" \
  "$plugin_root/bin/session-notes" "$(readlink "$link_path")"

printf '%s\n' 'export EDITOR=vim' '(( $+commands[session-notes] )) && eval "$(session-notes completion zsh)"' 'alias ll="ls -l"' \
  > "$ZDOTDIR/.zshrc"
bash "$link_script"
expect_equal "quiets the completion line an older installer added" \
  'export EDITOR=vim
(( $+commands[session-notes] )) && eval "$(session-notes completion zsh 2>/dev/null)"
alias ll="ls -l"' "$(cat "$ZDOTDIR/.zshrc")"

printf '#!/bin/sh\necho "Usage: session-notes" >&2\nexit 2\n' > "$fixture_directory/old-cli"
chmod +x "$fixture_directory/old-cli"
mkdir -p "$fixture_directory/old-path"
ln -sfn "$fixture_directory/old-cli" "$fixture_directory/old-path/session-notes"
expect_equal "the completion line prints nothing when the command fails" "" \
  "$(PATH="$fixture_directory/old-path:$PATH" zsh -f -c "source '$ZDOTDIR/.zshrc'" 2>&1)"

ln -sfn "/somewhere/else/notes-tool" "$link_path"
bash "$link_script"
expect_equal "leaves a link to another program alone" \
  "/somewhere/else/notes-tool" "$(readlink "$link_path")"

rm -f "$link_path"
printf 'my own script\n' > "$link_path"
bash "$link_script"
expect_equal "leaves a real file alone" "my own script" "$(cat "$link_path")"

exit "$failures"
