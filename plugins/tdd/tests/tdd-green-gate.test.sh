#!/usr/bin/env bash
set -uo pipefail

hook_directory="$(cd "$(dirname "$0")/../hooks" && pwd)"
fixture_directory="$(mktemp -d)"
repository="$fixture_directory/repository"
failures=0
unset TDD_SKIP

mkdir -p "$repository/.claude"
git -C "$repository" init -q
git -C "$repository" config user.email test@example.com
git -C "$repository" config user.name test
printf 'value = 1\n' > "$repository/app.py"
printf 'value = 1\n' > "$repository/other.py"
printf '{"testCommand": "false"}\n' > "$repository/.claude/tdd.json"
git -C "$repository" add -A
git -C "$repository" commit -qm initial
printf 'value = 2\n' > "$repository/app.py"
printf 'value = 2\n' > "$repository/other.py"

user_prompt_line() {
  printf '{"type":"user","uuid":"%s","message":{"role":"user","content":"%s"}}' "$1" "$2"
}

edit_line() {
  printf '{"type":"assistant","uuid":"%s","message":{"role":"assistant","content":[{"type":"tool_use","id":"%s","name":"Edit","input":{"file_path":"%s","old_string":"1","new_string":"2"}}]}}' "$1" "$1" "$2"
}

bash_edit_result_line() {
  printf '{"type":"user","uuid":"%s","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"%s","content":"ok"}]},"toolUseResult":{"bashEditDiff":{"files":[{"filePath":"%s"}]}}}' "$1" "$1" "$2"
}

string_tool_result_line() {
  printf '{"type":"user","uuid":"%s","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"%s","content":"ok"}]},"toolUseResult":"plain text"}' "$1" "$1"
}

write_transcript() {
  local transcript_path="$1"; shift
  printf '%s\n' "$@" > "$transcript_path"
}

run_hook() {
  local hook_name="$1" transcript_path="$2" session_id="$3"
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","stop_hook_active":false}' \
    "$session_id" "$transcript_path" "$repository" \
    | "$hook_directory/$hook_name" 2>"$fixture_directory/stderr"
}

expect_exit() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $description"
  else
    echo "FAIL: $description (expected exit $expected, got $actual)"
    cat "$fixture_directory/stderr"
    failures=$((failures + 1))
  fi
}

expect_stderr_mentions() {
  local description="$1" pattern="$2"
  if grep -q "$pattern" "$fixture_directory/stderr"; then
    echo "PASS: $description"
  else
    echo "FAIL: $description"
    cat "$fixture_directory/stderr"
    failures=$((failures + 1))
  fi
}

expect_stderr_omits() {
  local description="$1" pattern="$2"
  if grep -q "$pattern" "$fixture_directory/stderr"; then
    echo "FAIL: $description"
    cat "$fixture_directory/stderr"
    failures=$((failures + 1))
  else
    echo "PASS: $description"
  fi
}

no_edit_transcript="$fixture_directory/no-edit.jsonl"
write_transcript "$no_edit_transcript" "$(user_prompt_line u1 'what does app.py do')"

edit_transcript="$fixture_directory/edit.jsonl"
write_transcript "$edit_transcript" \
  "$(user_prompt_line u1 'change app.py')" \
  "$(string_tool_result_line r0)" \
  "$(edit_line a1 "$repository/app.py")"

earlier_turn_transcript="$fixture_directory/earlier-turn.jsonl"
write_transcript "$earlier_turn_transcript" \
  "$(user_prompt_line u1 'change app.py')" \
  "$(edit_line a1 "$repository/app.py")" \
  "$(user_prompt_line u2 'thanks, what next')"

bash_edit_transcript="$fixture_directory/bash-edit.jsonl"
write_transcript "$bash_edit_transcript" \
  "$(user_prompt_line u1 'change other.py with sed')" \
  "$(bash_edit_result_line r1 "$repository/other.py")"

outside_repository_transcript="$fixture_directory/outside.jsonl"
write_transcript "$outside_repository_transcript" \
  "$(user_prompt_line u1 'write a scratch script')" \
  "$(edit_line a1 "$fixture_directory/scratch.py")"

run_hook tdd-green-gate.sh "$no_edit_transcript" tdd-no-edit; status=$?
expect_exit "green gate skips the test run on a turn that edited nothing" 0 "$status"

run_hook tdd-green-gate.sh "$earlier_turn_transcript" tdd-earlier-turn; status=$?
expect_exit "green gate ignores edits from earlier turns" 0 "$status"

run_hook tdd-green-gate.sh "$edit_transcript" tdd-edit; status=$?
expect_exit "green gate runs failing tests after a turn that edited source" 2 "$status"

rm -rf "$fixture_directory"
if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all passed"
