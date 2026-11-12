#!/usr/bin/env bash
set -uo pipefail

hook_directory="$(cd "$(dirname "$0")/../hooks" && pwd)"
gate="$hook_directory/verify-before-finish-gate.sh"
fixture_directory="$(mktemp -d)"
failures=0

write_transcript() {
  local transcript_path="$1"; shift
  printf '%s\n' "$@" > "$transcript_path"
}

user_prompt_line() {
  printf '{"type":"user","uuid":"%s","message":{"role":"user","content":"%s"}}' "$1" "$2"
}

tool_use_line() {
  printf '{"type":"assistant","uuid":"%s","message":{"role":"assistant","content":[{"type":"tool_use","id":"%s","name":"%s","input":%s}]}}' "$1" "$1" "$2" "$3"
}

tool_result_line() {
  printf '{"type":"user","uuid":"%s","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"%s","content":"ok"}]}%s}' "$1" "$2" "$3"
}

text_line() {
  printf '{"type":"assistant","uuid":"%s","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}' "$1" "$2"
}

run_gate() {
  local transcript_path="$1" session_id="$2" stop_hook_active="${3:-false}"
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","stop_hook_active":%s}' \
    "$session_id" "$transcript_path" "$fixture_directory" "$stop_hook_active" \
    | "$gate" 2>"$fixture_directory/stderr"
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

transcript="$fixture_directory/edit-then-stop.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Read '{"file_path":"/x/app.py"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-edit-then-stop; status=$?
expect_exit "blocks when the last action of the turn is an edit with no verification after it" 2 "$status"
grep -q 'verif' "$fixture_directory/stderr" || { echo "FAIL: block message should mention verification"; failures=$((failures + 1)); }

transcript="$fixture_directory/edit-then-verify.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Bash '{"command":"pytest -q"}')" \
  "$(tool_result_line r2 a2 ',"toolUseResult":{"stdout":"1 passed","stderr":""}')" \
  "$(text_line a3 'Done, tests pass.')"
run_gate "$transcript" session-edit-then-verify; status=$?
expect_exit "allows when a verification tool call follows the last edit" 0 "$status"

transcript="$fixture_directory/bash-write-then-stop.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'add script')" \
  "$(tool_use_line a1 Bash '{"command":"printf x > /x/build.sh"}')" \
  "$(tool_result_line r1 a1 ',"toolUseResult":{"stdout":"","stderr":"","bashEditDiff":{"files":["/x/build.sh"]}}')" \
  "$(text_line a2 'Done.')"
run_gate "$transcript" session-bash-write; status=$?
expect_exit "blocks when a Bash command changed files and nothing verified afterwards" 2 "$status"

transcript="$fixture_directory/read-only.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'what does this do')" \
  "$(tool_use_line a1 Read '{"file_path":"/x/app.py"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(text_line a2 'It parses input.')"
run_gate "$transcript" session-read-only; status=$?
expect_exit "allows a turn that changed nothing" 0 "$status"

transcript="$fixture_directory/previous-turn-edit.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(text_line a2 'Done.')" \
  "$(user_prompt_line u2 'thanks, what time is it')" \
  "$(text_line a3 'No clock access.')"
run_gate "$transcript" session-previous-turn; status=$?
expect_exit "ignores edits from earlier turns" 0 "$status"

transcript="$fixture_directory/loop-cap.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(text_line a2 'Done.')"
run_gate "$transcript" session-loop-cap; first=$?
run_gate "$transcript" session-loop-cap true; second=$?
run_gate "$transcript" session-loop-cap true; third=$?
expect_exit "first stop without verification blocks" 2 "$first"
expect_exit "second stop stops blocking so the session cannot loop" 0 "$second"
expect_exit "third stop keeps passing" 0 "$third"

transcript="$fixture_directory/transcript-growth-only.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'list files')" \
  "$(tool_use_line a1 Bash '{"command":"ls"}')" \
  "$(tool_result_line r1 a1 ',"toolUseResult":{"stdout":"a","stderr":"","bashEditDiff":{"files":[{"filePath":"/Users/me/.claude/projects/-Users-me/abc.jsonl"}]}}')" \
  "$(text_line a2 'Two files.')"
run_gate "$transcript" session-transcript-growth; status=$?
expect_exit "ignores Bash edit diffs that only touch session transcripts" 0 "$status"

transcript="$fixture_directory/edit-then-grep.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Grep '{"pattern":"foo","path":"/x"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-edit-then-grep; status=$?
expect_exit "allows when a Grep follows the last edit" 0 "$status"

transcript="$fixture_directory/edit-then-read-other-file.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Read '{"file_path":"/x/other.py"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-edit-then-read-other; status=$?
expect_exit "allows when the follow-up Read is of any file" 0 "$status"

transcript="$fixture_directory/edit-then-read-changed-file.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix the bug')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Read '{"file_path":"/x/app.py"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-edit-then-read-changed; status=$?
expect_exit "allows when the follow-up Read is of a file changed this turn" 0 "$status"

transcript="$fixture_directory/bash-write-then-read-written-file.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'add config')" \
  "$(tool_use_line a1 Bash '{"command":"printf x > /x/build.sh"}')" \
  "$(tool_result_line r1 a1 ',"toolUseResult":{"stdout":"","stderr":"","bashEditDiff":{"files":[{"filePath":"/x/build.sh"}]}}')" \
  "$(tool_use_line a2 Read '{"file_path":"/x/build.sh"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-bash-write-then-read; status=$?
expect_exit "allows a Read of a file that a Bash command wrote this turn" 0 "$status"

transcript="$fixture_directory/docs-only-edit.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'update the readme')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/README.md","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Write '{"file_path":"/x/config.json","content":"{}"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-docs-only; status=$?
expect_exit "allows a turn that only changed docs or config files" 0 "$status"

transcript="$fixture_directory/memory-and-scratchpad-edit.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'remember this')" \
  "$(tool_use_line a1 Write '{"file_path":"/Users/me/.claude/projects/-Users-me/memory/note.py","content":"x"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Write '{"file_path":"/private/tmp/claude-501/proj/session/scratchpad/probe.py","content":"x"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(tool_use_line a3 Write '{"file_path":"/Users/me/.claude/plans/plan.sh","content":"x"}')" \
  "$(tool_result_line r3 a3 '')" \
  "$(text_line a4 'Saved.')"
run_gate "$transcript" session-memory-scratchpad; status=$?
expect_exit "allows edits limited to memory, plans, and scratchpad files" 0 "$status"

transcript="$fixture_directory/code-then-docs-edit.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix and document')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Edit '{"file_path":"/x/CHANGELOG.md","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r2 a2 '')" \
  "$(text_line a3 'Done.')"
run_gate "$transcript" session-code-then-docs; status=$?
expect_exit "blocks when a code edit is unverified even if a docs edit came last" 2 "$status"

transcript="$fixture_directory/code-verify-then-docs-edit.jsonl"
write_transcript "$transcript" \
  "$(user_prompt_line u1 'fix and document')" \
  "$(tool_use_line a1 Edit '{"file_path":"/x/app.py","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r1 a1 '')" \
  "$(tool_use_line a2 Bash '{"command":"pytest -q"}')" \
  "$(tool_result_line r2 a2 ',"toolUseResult":{"stdout":"1 passed","stderr":""}')" \
  "$(tool_use_line a3 Edit '{"file_path":"/x/CHANGELOG.md","old_string":"a","new_string":"b"}')" \
  "$(tool_result_line r3 a3 '')" \
  "$(text_line a4 'Done.')"
run_gate "$transcript" session-code-verify-then-docs; status=$?
expect_exit "allows a trailing docs edit after the code was verified" 0 "$status"

transcript="$fixture_directory/no-transcript.jsonl"
run_gate "$transcript" session-missing; status=$?
expect_exit "allows when the transcript is missing" 0 "$status"

rm -rf "$fixture_directory"
rm -rf "${TMPDIR:-/tmp}"/claude-verify-gate/session-*
[ "$failures" -eq 0 ]
