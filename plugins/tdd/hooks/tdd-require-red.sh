#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/tdd-lib.sh"

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
project_directory="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
[ -n "$session_id" ] && [ -n "$file_path" ] && [ -n "$project_directory" ] || exit 0

relative_path="${file_path#"$project_directory"/}"

if tdd_path_is_test_file "$relative_path"; then
  tdd_record_test_written "$session_id"
  exit 0
fi

tdd_path_is_implementation "$relative_path" || exit 0
tdd_enforcement_disabled "$project_directory" && exit 0
tdd_detect_test_command "$project_directory" >/dev/null || exit 0

[ "$(tdd_last_result "$session_id")" = "fail" ] && exit 0
tdd_test_written "$session_id" && exit 0

if [ -f "$file_path" ]; then
  reminder="TDD reminder: editing $relative_path without a failing test this session. If this adds or changes behaviour, write a failing test for it and run it before or right after this edit."
  jq -n --arg reminder "$reminder" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $reminder}}'
  exit 0
fi

echo "TDD: $relative_path is a new implementation file and no test has been written or failed this session. Write a test for it first (it does not need to run yet), then create the file. (Override once with TDD_SKIP=1 or pin behaviour in .claude/tdd.json with {\"enforce\": false}.)" >&2
exit 2
