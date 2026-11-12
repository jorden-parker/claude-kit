#!/usr/bin/env bash
set -uo pipefail

hook_directory="$(cd "$(dirname "$0")/../hooks" && pwd)"
failures=0

expect_printed() {
  local description="$1" pattern="$2" output="$3"
  if printf '%s' "$output" | grep -q "$pattern"; then
    echo "PASS: $description"
  else
    echo "FAIL: $description"
    failures=$((failures + 1))
  fi
}

expect_not_printed() {
  local description="$1" pattern="$2" output="$3"
  if printf '%s' "$output" | grep -q "$pattern"; then
    echo "FAIL: $description"
    failures=$((failures + 1))
  else
    echo "PASS: $description"
  fi
}

rules_output="$(cd / && "$hook_directory/print-tdd-rules.sh" 2>&1)"

expect_printed "prints the red step" "write one failing test first" "$rules_output"
expect_printed "prints the rule against editing tests to pass" "Never edit a test to make it pass" "$rules_output"
expect_printed "prints the test command pin" ".claude/tdd.json" "$rules_output"
expect_not_printed "leaves out the comment rules" "Do not write comments" "$rules_output"

[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "all passed"
