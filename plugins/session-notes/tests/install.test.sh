#!/usr/bin/env bash
set -uo pipefail

plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
install_script="$plugin_root/install.sh"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
export SESSION_NOTES_CLI_URL="file://$plugin_root/bin/session-notes"
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

run_install() {
  local home_directory="$1" search_path="$2"
  HOME="$home_directory" PATH="$search_path" SHELL=/bin/zsh \
    bash "$install_script" > /dev/null 2>&1
}

system_path="/usr/bin:/bin:/usr/sbin:/sbin"
path_line_count() {
  if [ -f "$1/.zshrc" ]; then grep -c 'local/bin' "$1/.zshrc"; else echo 0; fi
}

fresh_home="$fixture_directory/fresh"
mkdir -p "$fresh_home"
run_install "$fresh_home" "$system_path"
expect_equal "installs an executable copy of the CLI" "yes" \
  "$([ -x "$fresh_home/.local/bin/session-notes" ] && [ ! -L "$fresh_home/.local/bin/session-notes" ] && echo yes)"
expect_equal "the copy matches the CLI" "same" \
  "$(cmp -s "$plugin_root/bin/session-notes" "$fresh_home/.local/bin/session-notes" && echo same)"
expect_equal "adds ~/.local/bin to .zshrc when it is not on PATH" "1" "$(path_line_count "$fresh_home")"

run_install "$fresh_home" "$system_path"
expect_equal "a second run does not add the PATH line again" "1" "$(path_line_count "$fresh_home")"

on_path_home="$fixture_directory/on-path"
mkdir -p "$on_path_home"
run_install "$on_path_home" "$on_path_home/.local/bin:$system_path"
expect_equal "leaves .zshrc alone when ~/.local/bin is already on PATH" "0" "$(path_line_count "$on_path_home")"

linked_home="$fixture_directory/linked"
link_target="$fixture_directory/plugin-copy"
printf 'plugin copy\n' > "$link_target"
mkdir -p "$linked_home/.local/bin"
ln -s "$link_target" "$linked_home/.local/bin/session-notes"
run_install "$linked_home" "$linked_home/.local/bin:$system_path"
expect_equal "replaces an existing link with a real file" "no" \
  "$([ -L "$linked_home/.local/bin/session-notes" ] && echo yes || echo no)"
expect_equal "does not write through the old link" "plugin copy" "$(cat "$link_target")"

failed_exit="yes"
SESSION_NOTES_CLI_URL="file://$fixture_directory/missing" run_install "$fixture_directory/failed" "$system_path" && failed_exit="no"
expect_equal "a failed download exits non-zero" "yes" "$failed_exit"
expect_equal "a failed download installs nothing" "no" \
  "$([ -e "$fixture_directory/failed/.local/bin/session-notes" ] && echo yes || echo no)"

exit "$failures"
