#!/usr/bin/env bash
set -uo pipefail
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE

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

qwen_prompt_line() {
  printf '{"type":"user","uuid":"%s","provenance":"real_user","message":{"role":"user","parts":[{"text":"%s"}]}}' "$1" "$2"
}

qwen_call_line() {
  printf '{"type":"assistant","uuid":"%s","provenance":"assistant_output","message":{"role":"model","parts":[{"functionCall":{"id":"%s","name":"%s","args":{"file_path":"%s","old_string":"1","new_string":"2"}}}]}}' "$1" "$1" "$2" "$3"
}

qwen_tool_result_line() {
  printf '{"type":"tool_result","uuid":"%s","provenance":"tool_result","message":{"role":"user","parts":[{"functionResponse":{"id":"%s","name":"edit","response":{"output":"ok"}}}]}}' "$1" "$1"
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

run_hook naming-review-gate.sh "$no_edit_transcript" naming-no-edit; status=$?
expect_exit "naming gate skips a turn that edited nothing, even in a dirty repo" 0 "$status"

run_hook naming-review-gate.sh "$edit_transcript" naming-edit; status=$?
expect_exit "naming gate blocks a turn that edited a changed source file" 2 "$status"
expect_stderr_mentions "naming gate lists the file edited this turn" 'app.py'
expect_stderr_omits "naming gate omits dirty files this turn did not touch" 'other.py'

run_hook naming-review-gate.sh "$earlier_turn_transcript" naming-earlier-turn; status=$?
expect_exit "naming gate ignores edits from earlier turns" 0 "$status"

run_hook naming-review-gate.sh "$bash_edit_transcript" naming-bash-edit; status=$?
expect_exit "naming gate counts files changed through Bash this turn" 2 "$status"
expect_stderr_mentions "naming gate lists the Bash-edited file" 'other.py'

run_hook naming-review-gate.sh "$outside_repository_transcript" naming-outside; status=$?
expect_exit "naming gate skips edits outside the repository" 0 "$status"

qwen_edit_transcript="$fixture_directory/qwen-edit.jsonl"
write_transcript "$qwen_edit_transcript" \
  "$(qwen_prompt_line u1 'change app.py')" \
  "$(qwen_call_line a1 edit "$repository/app.py")" \
  "$(qwen_tool_result_line r1)"

qwen_write_transcript="$fixture_directory/qwen-write.jsonl"
write_transcript "$qwen_write_transcript" \
  "$(qwen_prompt_line u1 'write other.py')" \
  "$(qwen_call_line a1 write_file "$repository/other.py")" \
  "$(qwen_tool_result_line r1)"

qwen_earlier_turn_transcript="$fixture_directory/qwen-earlier-turn.jsonl"
write_transcript "$qwen_earlier_turn_transcript" \
  "$(qwen_prompt_line u1 'change app.py')" \
  "$(qwen_call_line a1 edit "$repository/app.py")" \
  "$(qwen_prompt_line u2 'thanks, what next')"

run_hook naming-review-gate.sh "$qwen_edit_transcript" naming-qwen-edit; status=$?
expect_exit "naming gate blocks a Qwen Code edit to a changed source file" 2 "$status"
expect_stderr_mentions "naming gate lists the file a Qwen Code edit changed" 'app.py'

run_hook naming-review-gate.sh "$qwen_write_transcript" naming-qwen-write; status=$?
expect_exit "naming gate counts a Qwen Code write_file this turn" 2 "$status"
expect_stderr_mentions "naming gate lists the file a Qwen Code write_file changed" 'other.py'

run_hook naming-review-gate.sh "$qwen_earlier_turn_transcript" naming-qwen-earlier-turn; status=$?
expect_exit "naming gate ignores Qwen Code edits from earlier turns" 0 "$status"

rm -rf "$fixture_directory"
rm -f /tmp/claude-naming-review-naming-*
if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all passed"
