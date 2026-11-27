#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/tdd-lib.sh"
source "$(dirname "$0")/verification-cache.sh"
source "$(dirname "$0")/turn-edits-lib.sh"

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
project_directory="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
transcript_path="$(printf '%s' "$payload" | jq -r '(.agent_transcript_path // "") as $agent | if $agent != "" then $agent else (.transcript_path // empty) end' 2>/dev/null)" || exit 0
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

cache_path="$(verification_cache_path "$repository_root" "$test_command" "$session_id")"
verification_cached "$cache_path" && exit 0

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

block_count_file="$(tdd_state_directory "$session_id")/green-gate-blocks-$(printf '%s' "$transcript_path" | shasum | cut -c1-16)"

if [ "$test_status" -eq 0 ]; then
  verification_save "$cache_path"
  [ -n "$session_id" ] && tdd_record_result "$session_id" "pass"
  rm -f "$block_count_file"
  exit 0
fi

[ -n "$session_id" ] && tdd_record_result "$session_id" "fail"
maximum_blocks_in_a_row=5
blocks_so_far="$(cat "$block_count_file" 2>/dev/null || echo 0)"
if [ "$blocks_so_far" -ge "$maximum_blocks_in_a_row" ]; then
  rm -f "$block_count_file"
  echo "Tests are still failing after $maximum_blocks_in_a_row blocks in a row. Stopping is allowed so the loop ends, but this work is not finished: report it as failing, not done." >&2
  exit 0
fi
mkdir -p "$(dirname "$block_count_file")" 2>/dev/null
echo $((blocks_so_far + 1)) > "$block_count_file"
{
  echo "Tests are failing. Fix regressions from this task. Classify a failure as pre-existing only with an observed baseline from the unchanged revision using the same command and environment; otherwise report it as unresolved. Report unrelated baseline failures separately."
  printf '%s\n' "$test_output" | tail -n 40
} >&2
exit 2
