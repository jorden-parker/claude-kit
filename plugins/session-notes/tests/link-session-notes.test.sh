#!/usr/bin/env bash
set -uo pipefail

plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
link_script="$plugin_root/hooks/link-session-notes.sh"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
export SESSION_NOTES_LINK_DIR="$fixture_directory/bin"
link_path="$SESSION_NOTES_LINK_DIR/session-notes"
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

ln -sfn "/somewhere/else/notes-tool" "$link_path"
bash "$link_script"
expect_equal "leaves a link to another program alone" \
  "/somewhere/else/notes-tool" "$(readlink "$link_path")"

rm -f "$link_path"
printf 'my own script\n' > "$link_path"
bash "$link_script"
expect_equal "leaves a real file alone" "my own script" "$(cat "$link_path")"

exit "$failures"
