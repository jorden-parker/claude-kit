#!/usr/bin/env bash
set -uo pipefail

hook_path="$(cd "$(dirname "$0")/../hooks" && pwd)/naming-check.sh"
fixture_directory="$(mktemp -d)"
failures=0

violation_message() {
  local session_id="$1"
  jq -n --arg session_id "$session_id" --arg file_path "$fixture_directory/totals.ts" --arg cwd "$fixture_directory" \
    '{session_id: $session_id, cwd: $cwd, tool_name: "Edit", tool_input: {file_path: $file_path, new_string: "const tmp = 1;"}}' \
    | TMPDIR="$fixture_directory" bash "$hook_path" 2>&1
}

expect_message() {
  local description="$1" expectation="$2" pattern="$3" message="$4" found="absent"
  printf '%s' "$message" | grep -q "$pattern" && found="present"
  if [ "$found" = "$expectation" ]; then
    echo "PASS: $description"
  else
    echo "FAIL: $description"
    failures=$((failures + 1))
  fi
}

first_message="$(violation_message repeat-session)"
second_message="$(violation_message repeat-session)"

expect_message "first violation names the identifier" present "tmp" "$first_message"
expect_message "first violation gets the full instructions" present "Spawn a subagent" "$first_message"
expect_message "a repeat violation still names the identifier" present "tmp" "$second_message"
expect_message "a repeat violation leaves out the long instructions" absent "Spawn a subagent" "$second_message"

rm -rf "$fixture_directory"
[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "all passed"
