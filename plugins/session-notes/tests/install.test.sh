#!/usr/bin/env bash
set -uo pipefail

plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
install_script="$plugin_root/install.sh"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
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
    bash "$install_script" 2>&1
}

system_path="/usr/bin:/bin:/usr/sbin:/sbin"
path_line_count() {
  if [ -f "$1/.zshrc" ]; then grep -c 'local/bin' "$1/.zshrc"; else echo 0; fi
}

fresh_home="$fixture_directory/fresh"
mkdir -p "$fresh_home"
run_install "$fresh_home" "$system_path" > /dev/null
expect_equal "links the CLI shipped next to the installer" \
  "$plugin_root/bin/session-notes" "$(readlink "$fresh_home/.local/bin/session-notes")"
expect_equal "adds ~/.local/bin to .zshrc when it is not on PATH" "1" "$(path_line_count "$fresh_home")"

run_install "$fresh_home" "$system_path" > /dev/null
expect_equal "a second run does not add the PATH line again" "1" "$(path_line_count "$fresh_home")"

on_path_home="$fixture_directory/on-path"
mkdir -p "$on_path_home"
run_install "$on_path_home" "$on_path_home/.local/bin:$system_path" > /dev/null
expect_equal "leaves the PATH alone when ~/.local/bin is already on PATH" "0" "$(path_line_count "$on_path_home")"

completion_line_count() {
  if [ -f "$1/.zshrc" ]; then grep -c 'session-notes completion zsh' "$1/.zshrc"; else echo 0; fi
}
expect_equal "adds completion to .zshrc" "1" "$(completion_line_count "$fresh_home")"
expect_equal "adds completion to .zshrc when already on PATH" "1" "$(completion_line_count "$on_path_home")"
run_install "$on_path_home" "$on_path_home/.local/bin:$system_path" > /dev/null
expect_equal "a second run does not add completion again" "1" "$(completion_line_count "$on_path_home")"
expect_equal "the completion line hides errors" "1" \
  "$(grep -cF 'eval "$(session-notes completion zsh 2>/dev/null)"' "$on_path_home/.zshrc")"

blocked_home="$fixture_directory/blocked"
mkdir -p "$blocked_home/.local/bin"
printf 'my own script\n' > "$blocked_home/.local/bin/session-notes"
blocked_exit="yes"
blocked_output="$(run_install "$blocked_home" "$system_path")" && blocked_exit="no"
expect_equal "a file of another program fails the install" "yes" "$blocked_exit"
expect_equal "a file of another program is left alone" "my own script" \
  "$(cat "$blocked_home/.local/bin/session-notes")"
expect_equal "a file of another program is named in the error" \
  "$blocked_home/.local/bin/session-notes is not a session-notes link; move it and run the installer again." \
  "$blocked_output"

exit "$failures"
