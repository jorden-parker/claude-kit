#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/tdd-lib.sh"

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)" || exit 0
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
project_directory="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
[ -n "$session_id" ] && [ -n "$file_path" ] && [ -n "$project_directory" ] || exit 0

relative_path="${file_path#"$project_directory"/}"

tdd_path_is_implementation "$relative_path" || exit 0
tdd_enforcement_disabled "$project_directory" && exit 0
tdd_detect_test_command "$project_directory" >/dev/null || exit 0

[ "$(tdd_last_result "$session_id")" = "fail" ] && exit 0

if [ "$tool_name" = "Edit" ] && [ -f "$file_path" ] \
  && [ -n "$(tdd_last_result "$session_id")" ] \
  && tdd_sibling_test_exists "$file_path" "$project_directory"; then
  exit 0
fi

echo "TDD: no failing test recorded this session for this change. Write a failing test for $relative_path first, run the test command, then implement. (Override once with TDD_SKIP=1 or pin behaviour in .claude/tdd.json with {\"enforce\": false}.)" >&2
exit 2
