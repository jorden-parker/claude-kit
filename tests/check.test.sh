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

origin_repository="$sandbox/origin"
release_copy="$sandbox/release"
mkdir -p "$origin_repository/tests" "$origin_repository/plugins/demo/.claude-plugin"
cp "$repository_root/check" "$origin_repository/check"
echo 'exit 0' > "$origin_repository/tests/repository.test.sh"
echo '{"name": "demo", "version": "1.0.0"}' > "$origin_repository/plugins/demo/.claude-plugin/plugin.json"
echo "first" > "$origin_repository/plugins/demo/README.md"
git -C "$origin_repository" init -q -b main
git -C "$origin_repository" add -A
git -C "$origin_repository" -c user.name=check -c user.email=check@example.com commit -qm release
git clone -q "$origin_repository" "$release_copy"

echo "second" > "$release_copy/plugins/demo/README.md"
git -C "$release_copy" add -A
bump_output="$("$release_copy/check" --staged 2>&1)"
bump_status=$?
expect "check fails when a plugin changed without a version bump" [ "$bump_status" -ne 0 ]
expect "the failure names the plugin folder" grep -qF "plugins/demo" <<<"$bump_output"
expect "the failure says the version was not bumped" grep -qF "without a version bump" <<<"$bump_output"

echo '{"name": "demo", "version": "1.0.1"}' > "$release_copy/plugins/demo/.claude-plugin/plugin.json"
git -C "$release_copy" add -A
"$release_copy/check" --staged >/dev/null 2>&1
expect "check passes once the plugin's version is bumped" [ $? -eq 0 ]

[ "$failures" -eq 0 ] || exit 1
