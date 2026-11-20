#!/usr/bin/env bash
set -uo pipefail
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE

hook="$(cd "$(dirname "$0")/../hooks" && pwd)/lint-fallow-gate.sh"
fixture_directory="$(mktemp -d)"
repository="$fixture_directory/repository"
export TMPDIR="$fixture_directory/state"
mkdir -p "$TMPDIR"
failures=0

mkdir -p "$repository/.claude"
git -C "$repository" init -q
git -C "$repository" config user.email test@example.com
git -C "$repository" config user.name test
printf 'export const value = 1;\n' > "$repository/app.ts"
git -C "$repository" add -A
git -C "$repository" commit -qm initial
printf 'export const value = 2;\n' > "$repository/app.ts"

pin_checks() {
  printf '{"lintCommand": "%s", "fallowCommand": "%s"}\n' "$1" "$2" > "$repository/.claude/quality.json"
}

user_prompt_line() {
  printf '{"type":"user","message":{"role":"user","content":"%s"}}' "$1"
}

tool_use_line() {
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool","name":"%s","input":{"file_path":"%s"}}]}}' "$1" "$2"
}

write_transcript() {
  local transcript_path="$1"; shift
  printf '%s\n' "$@" > "$transcript_path"
}

run_gate() {
  local session_id="$1" transcript_path="$2" agent_transcript_path="$3" stop_hook_active="${4:-false}"
  printf '{"session_id":"%s","transcript_path":"%s","agent_transcript_path":"%s","cwd":"%s","stop_hook_active":%s}' \
    "$session_id" "$transcript_path" "$agent_transcript_path" "$repository" "$stop_hook_active" \
    | "$hook" 2>"$fixture_directory/stderr"
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

expect_stderr() {
  local description="$1" expected_text="$2"
  if grep -qF "$expected_text" "$fixture_directory/stderr"; then
    echo "PASS: $description"
  else
    echo "FAIL: $description (stderr lacks: $expected_text)"
    cat "$fixture_directory/stderr"
    failures=$((failures + 1))
  fi
}

parent_transcript="$fixture_directory/parent.jsonl"
write_transcript "$parent_transcript" "$(user_prompt_line "build the plans")"
subagent_transcript="$fixture_directory/subagent.jsonl"
write_transcript "$subagent_transcript" \
  "$(user_prompt_line "implement the plan")" \
  "$(tool_use_line Edit "$repository/app.ts")"

pin_checks "echo lint-error-in-app && false" "true"
run_gate lint-fails "$parent_transcript" "$subagent_transcript"
expect_exit "a subagent that edited code is blocked while lint fails" 2 $?
expect_stderr "the block names the lint output" "lint-error-in-app"

pin_checks "true" "echo fallow-verdict-fail && false"
run_gate fallow-fails "$parent_transcript" "$subagent_transcript"
expect_exit "a subagent that edited code is blocked while fallow fails" 2 $?
expect_stderr "the block names the fallow output" "fallow-verdict-fail"

pin_checks "true" "true"
run_gate checks-pass "$parent_transcript" "$subagent_transcript"
expect_exit "a subagent passes when lint and fallow pass" 0 $?

pin_checks "false" "false"
read_only_transcript="$fixture_directory/read-only.jsonl"
write_transcript "$read_only_transcript" \
  "$(user_prompt_line "explain the code")" \
  "$(tool_use_line Read "$repository/app.ts")"
run_gate read-only "$read_only_transcript" ""
expect_exit "a turn that edited nothing and delegated nothing is not checked" 0 $?

delegating_transcript="$fixture_directory/delegating.jsonl"
write_transcript "$delegating_transcript" \
  "$(user_prompt_line "build the plans")" \
  "$(tool_use_line Agent "")"
run_gate delegating "$delegating_transcript" ""
expect_exit "a main session whose turn delegated to an agent is blocked while checks fail" 2 $?

run_gate no-bypass "$parent_transcript" "$subagent_transcript" true
expect_exit "a second stop attempt is still blocked while checks fail" 2 $?

for attempt in 1 2 3 4; do run_gate loop-guard "$parent_transcript" "$subagent_transcript" true; done
run_gate loop-guard "$parent_transcript" "$subagent_transcript" true
expect_exit "the fifth block in a row still blocks" 2 $?
run_gate loop-guard "$parent_transcript" "$subagent_transcript" true
expect_exit "after five blocks in a row the gate lets the agent stop" 0 $?
expect_stderr "the release says the checks still fail" "still failing"

rm -rf "$fixture_directory"
[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "All lint-fallow-gate tests passed"
