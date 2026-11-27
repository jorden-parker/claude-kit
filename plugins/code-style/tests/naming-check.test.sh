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
expect_message "first violation gets the full instructions" present "Report unrelated existing names separately." "$first_message"
expect_message "a repeat violation still names the identifier" present "tmp" "$second_message"
expect_message "a repeat violation leaves out the long instructions" absent "Report unrelated existing names separately." "$second_message"

grant_home="$fixture_directory/home"
mkdir -p "$grant_home/.claude/hook-bypass"
write_grant() {
  printf '%s\t%s\n' "$1" "$2" > "$grant_home/.claude/hook-bypass/grants.tsv"
}

run_naming_hook() {
  local session_id="$1" file_path="$2"
  jq -n --arg session_id "$session_id" --arg file_path "$file_path" --arg cwd "$fixture_directory" \
    '{session_id: $session_id, cwd: $cwd, tool_name: "Edit", tool_input: {file_path: $file_path, new_string: "const tmp = 1;"}}' \
    | TMPDIR="$fixture_directory" bash "$hook_path" >/dev/null 2>&1
}

expect_hook_exit() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $description"
  else
    echo "FAIL: $description (expected exit $expected, got $actual)"
    failures=$((failures + 1))
  fi
}

write_grant "$(( $(date +%s) + 600 ))" "$fixture_directory/totals.ts"
HOME="$grant_home" run_naming_hook grant-live "$fixture_directory/totals.ts"
expect_hook_exit "allows a vague name in a file with a live bypass grant for its path" 0 $?
write_grant "$(( $(date +%s) - 1 ))" "$fixture_directory/totals.ts"
HOME="$grant_home" run_naming_hook grant-expired "$fixture_directory/totals.ts"
expect_hook_exit "blocks a vague name in a file with an expired bypass grant for its path" 2 $?
write_grant "$(( $(date +%s) + 600 ))" "$fixture_directory/other.ts"
HOME="$grant_home" run_naming_hook grant-other "$fixture_directory/totals.ts"
expect_hook_exit "blocks a vague name in a file with a live bypass grant for another path" 2 $?

rm -rf "$fixture_directory"
[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "all passed"
