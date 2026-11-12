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

rules_output="$(cd / && "$hook_directory/print-code-style-rules.sh" 2>&1)"

expect_printed "prints the comments rule" "Do not write comments in code" "$rules_output"
expect_printed "prints the naming rule" "No identifiers under 3 characters" "$rules_output"
expect_printed "prints the naming escape hatch" "naming-allowlist.txt" "$rules_output"
expect_not_printed "leaves out the TDD rules" "## TDD" "$rules_output"

[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "all passed"
