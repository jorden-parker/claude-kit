#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0
kit_copy="$sandbox/kit"
hook_repository="$sandbox/hook-repository"
seen_variables="$sandbox/seen-variables"

expect() {
  local description="$1"
  shift
  if "$@"; then
    echo "ok: $description"
  else
    echo "FAIL: $description"
    failures=$((failures + 1))
  fi
}

mkdir -p "$kit_copy/tests"
cp "$repository_root/check" "$kit_copy/check"
cat > "$kit_copy/tests/repository.test.sh" <<'STUB'
echo "GIT_DIR=${GIT_DIR:-unset} GIT_INDEX_FILE=${GIT_INDEX_FILE:-unset}" > "$SEEN_VARIABLES"
STUB
git init -q "$hook_repository"

GIT_DIR="$hook_repository/.git" \
  GIT_INDEX_FILE="$hook_repository/.git/index" \
  SEEN_VARIABLES="$seen_variables" \
  "$kit_copy/check" --staged >/dev/null 2>&1
status=$?

expect "check passes inside a commit hook of a linked worktree" [ "$status" -eq 0 ]
expect "the tests do not inherit the hook's GIT_DIR and GIT_INDEX_FILE" \
  grep -qxF "GIT_DIR=unset GIT_INDEX_FILE=unset" "$seen_variables"

[ "$failures" -eq 0 ] || exit 1
