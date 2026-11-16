#!/usr/bin/env bash
set -uo pipefail

hook_directory="$(cd "$(dirname "$0")/../hooks" && pwd)"
source "$hook_directory/tdd-lib.sh"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
failures=0

expect_detected() {
  local description="$1" package_manifest="$2" expected="$3" project_directory actual
  project_directory="$(mktemp -d "$fixture_directory/project.XXXXXX")"
  printf '%s\n' "$package_manifest" > "$project_directory/package.json"
  actual="$(tdd_detect_test_command "$project_directory")"
  if [ "$actual" = "$expected" ]; then
    echo "ok: $description"
  else
    echo "FAIL: $description: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
}

expect_detected "a jest test script turns watch mode off" \
  '{"scripts": {"test": "jest"}}' \
  'npm test --silent -- --watchAll=false'
expect_detected "jest named only in a dependency keeps the plain command" \
  '{"scripts": {"test": "vitest run"}, "devDependencies": {"eslint-plugin-jest": "^28.0.0"}}' \
  'npm test --silent'
expect_detected "jest named only in the description keeps the plain command" \
  '{"description": "Not jest", "scripts": {"test": "node --test"}}' \
  'npm test --silent'

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all passed"
