#!/usr/bin/env bash

tdd_sanitize_session_id() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_'
}

tdd_state_directory() {
  printf '%s/claude-tdd/%s' "${TMPDIR:-/tmp}" "$(tdd_sanitize_session_id "$1")"
}

tdd_record_result() {
  local session_id="$1" result="$2" state_directory
  state_directory="$(tdd_state_directory "$session_id")"
  mkdir -p "$state_directory" 2>/dev/null || return 0
  printf '%s %s\n' "$result" "$(date +%s)" > "$state_directory/last-test-run" 2>/dev/null
  return 0
}

tdd_last_result() {
  local state_file
  state_file="$(tdd_state_directory "$1")/last-test-run"
  [ -f "$state_file" ] || return 0
  awk '{print $1}' "$state_file" 2>/dev/null
}

tdd_enforcement_disabled() {
  local project_directory="$1" config_file="$1/.claude/tdd.json"
  [ -n "${TDD_SKIP:-}" ] && return 0
  [ -f "$config_file" ] || return 1
  [ "$(jq -r '.enforce // true' "$config_file" 2>/dev/null)" = "false" ]
}

tdd_detect_test_command() {
  local project_directory="$1" config_file="$1/.claude/tdd.json" pinned_command
  if [ -f "$config_file" ]; then
    pinned_command="$(jq -r '.testCommand // empty' "$config_file" 2>/dev/null)"
    if [ -n "$pinned_command" ]; then
      printf '%s' "$pinned_command"
      return 0
    fi
  fi
  if [ -f "$project_directory/package.json" ] \
    && jq -e '.scripts.test' "$project_directory/package.json" >/dev/null 2>&1; then
    if grep -q 'jest' "$project_directory/package.json"; then
      printf '%s' 'npm test --silent -- --watchAll=false'
    else
      printf '%s' 'npm test --silent'
    fi
    return 0
  fi
  if [ -f "$project_directory/pytest.ini" ] \
    || { [ -f "$project_directory/pyproject.toml" ] && grep -q 'pytest' "$project_directory/pyproject.toml"; } \
    || { [ -d "$project_directory/tests" ] && [ -n "$(find "$project_directory/tests" -name '*.py' -print -quit 2>/dev/null)" ]; }; then
    printf '%s' 'python3 -m pytest -q -x'
    return 0
  fi
  if [ -f "$project_directory/go.mod" ]; then
    printf '%s' 'go test ./...'
    return 0
  fi
  if [ -f "$project_directory/Cargo.toml" ]; then
    printf '%s' 'cargo test -q'
    return 0
  fi
  if [ -f "$project_directory/Gemfile" ] && grep -q 'rspec' "$project_directory/Gemfile"; then
    printf '%s' 'bundle exec rspec'
    return 0
  fi
  return 1
}

tdd_command_is_test_runner() {
  printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_-])(npm test|npx jest|npx vitest|vitest|jest|pytest|python -m pytest|python3 -m pytest|go test|cargo test|rspec|bun test|pnpm test|yarn test|mix test|dotnet test|phpunit|mvn test|gradle test)([^[:alnum:]_-]|$)'
}

tdd_output_indicates_failure() {
  printf '%s' "$1" \
    | sed -E 's/\b0 (failed|failures|errors?)\b//Ig' \
    | grep -Eq 'FAIL|[Ff]ailed|[Ee]rror|AssertionError|not ok'
}

tdd_path_is_test_file() {
  local path="$1" name
  name="$(basename "$path")"
  case "$name" in
    *.test.*|*.spec.*|test_*.py|*_test.py|*_test.go|*_spec.rb) return 0 ;;
  esac
  case "/$path" in
    */test/*|*/tests/*|*/__tests__/*|*/spec/*) return 0 ;;
  esac
  return 1
}

tdd_path_is_implementation() {
  local path="$1" name extension
  name="$(basename "$path")"
  extension="${name##*.}"
  case "$extension" in
    js|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|cs) ;;
    *) return 1 ;;
  esac
  tdd_path_is_test_file "$path" && return 1
  case "/$path" in
    */node_modules/*|*/.claude/*|*/dist/*|*/build/*|*/vendor/*|*/plugins/*|*/cache/*|*/.venv/*|*/venv/*|*/cmd/*) return 1 ;;
  esac
  case "$name" in
    *.config.*|conftest.py|setup.py|__init__.py|index.ts|main.go) return 1 ;;
  esac
  return 0
}

tdd_sibling_test_exists() {
  local path="$1" project_directory="$2" directory name base extension search_directory candidate
  directory="$(dirname "$path")"
  name="$(basename "$path")"
  base="${name%.*}"
  extension="${name##*.}"
  for search_directory in \
    "$directory" "$directory/__tests__" "$directory/tests" "$directory/test" "$directory/spec" \
    "$project_directory/tests" "$project_directory/test" "$project_directory/spec" "$project_directory/__tests__"; do
    [ -d "$search_directory" ] || continue
    for candidate in \
      "$base.test.$extension" "$base.spec.$extension" "test_$base.py" "${base}_test.py" \
      "${base}_test.go" "${base}_spec.rb"; do
      [ -f "$search_directory/$candidate" ] && return 0
    done
  done
  return 1
}
