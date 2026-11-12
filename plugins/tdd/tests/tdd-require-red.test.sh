#!/usr/bin/env bash
set -uo pipefail

hook_directory="$(cd "$(dirname "$0")/../hooks" && pwd)"
fixture_directory="$(mktemp -d)"
repository="$fixture_directory/repository"
export TMPDIR="$fixture_directory/state"
failures=0
unset TDD_SKIP

mkdir -p "$repository/.claude" "$repository/src" "$TMPDIR"
printf '{"testCommand": "pytest"}\n' > "$repository/.claude/tdd.json"
printf 'class Account:\n    pass\n' > "$repository/src/account.py"

run_hook() {
  local session_id="$1" tool_name="$2" file_path="$3"
  printf '{"session_id":"%s","tool_name":"%s","cwd":"%s","tool_input":{"file_path":"%s"}}' \
    "$session_id" "$tool_name" "$repository" "$file_path" \
    | "$hook_directory/tdd-require-red.sh" >"$fixture_directory/stdout" 2>"$fixture_directory/stderr"
}

record_test_run() {
  local session_id="$1" exit_code="$2"
  printf '{"session_id":"%s","tool_input":{"command":"pytest"},"tool_response":{"exit_code":%s}}' \
    "$session_id" "$exit_code" | "$hook_directory/tdd-record-test-run.sh"
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

expect_stdout() {
  local description="$1" pattern="$2"
  if grep -q "$pattern" "$fixture_directory/stdout"; then
    echo "PASS: $description"
  else
    echo "FAIL: $description"
    failures=$((failures + 1))
  fi
}

run_hook session-existing Edit "$repository/src/account.py"
expect_exit "allows editing an existing class with no test run yet" 0 $?
expect_stdout "reminds to add a test when editing without a failing run" "additionalContext"

run_hook session-overwrite Write "$repository/src/account.py"
expect_exit "allows rewriting an existing file" 0 $?

run_hook session-new Write "$repository/src/ledger.py"
expect_exit "blocks a new implementation file with no test" 2 $?

run_hook session-test-first Write "$repository/tests/test_ledger.py"
expect_exit "allows writing a test file" 0 $?
run_hook session-test-first Write "$repository/src/ledger.py"
expect_exit "allows a new implementation file after a test was written" 0 $?

record_test_run session-red 1
run_hook session-red Write "$repository/src/ledger.py"
expect_exit "allows a new implementation file after a failing run" 0 $?
run_hook session-red Edit "$repository/src/account.py"
expect_exit "allows editing after a failing run" 0 $?
if [ -s "$fixture_directory/stdout" ]; then
  echo "FAIL: no reminder once a failing run is recorded"
  failures=$((failures + 1))
else
  echo "PASS: no reminder once a failing run is recorded"
fi

record_test_run session-green 0
run_hook session-green Write "$repository/src/ledger.py"
expect_exit "blocks a new implementation file after only a passing run" 2 $?

rm -rf "$fixture_directory"
[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "all passed"
