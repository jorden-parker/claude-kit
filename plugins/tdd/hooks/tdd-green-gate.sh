#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/tdd-lib.sh"
source "$(dirname "$0")/turn-edits-lib.sh"

payload="$(cat)" || exit 0
[ "$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
project_directory="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
transcript_path="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)" || exit 0
[ -n "$transcript_path" ] || exit 0
[ -n "$project_directory" ] && [ -d "$project_directory" ] || exit 0

cd "$project_directory" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0
tdd_enforcement_disabled "$project_directory" && exit 0
repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

changed_source_files="$(
  { git -C "$repository_root" diff --name-only HEAD 2>/dev/null || git -C "$repository_root" diff --name-only --cached 2>/dev/null
    git -C "$repository_root" ls-files --others --exclude-standard 2>/dev/null; } \
    | grep -E '\.(js|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|cs)$' \
    | grep -Ev '(^|/)(node_modules|dist|build|vendor|plugins|cache|venv|third_party)/|(^|/)\.[^/]+/' \
    | keep_paths_edited_this_turn "$transcript_path" "$project_directory" "$repository_root"
)"
[ -n "$changed_source_files" ] || exit 0

test_command="$(tdd_detect_test_command "$project_directory")" || exit 0

if command -v timeout >/dev/null 2>&1; then
  test_output="$(timeout 300 bash -c "$test_command" 2>&1)"
elif command -v gtimeout >/dev/null 2>&1; then
  test_output="$(gtimeout 300 bash -c "$test_command" 2>&1)"
elif command -v perl >/dev/null 2>&1; then
  test_output="$(perl -e 'alarm 300; exec @ARGV' bash -c "$test_command" 2>&1)"
else
  test_output="$(bash -c "$test_command" 2>&1)"
fi
test_status=$?

if [ "$test_status" -eq 0 ]; then
  [ -n "$session_id" ] && tdd_record_result "$session_id" "pass"
  exit 0
fi

[ -n "$session_id" ] && tdd_record_result "$session_id" "fail"
{
  echo "Tests are failing. Fix them before finishing:"
  printf '%s\n' "$test_output" | tail -n 40
} >&2
exit 2
