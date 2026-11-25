#!/usr/bin/env bash
set -uo pipefail

maximum_blocks_in_a_row=5
check_timeout_seconds=300

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
project_directory="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
transcript_path="$(printf '%s' "$payload" | jq -r '(.agent_transcript_path // "") as $agent | if $agent != "" then $agent else (.transcript_path // empty) end' 2>/dev/null)" || exit 0
[ -n "$session_id" ] && [ -f "$transcript_path" ] && [ -d "$project_directory" ] || exit 0

cd "$project_directory" || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0
repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

turn_changed_or_delegated="$(jq -rs '
  def is_user_prompt:
    (.type == "user"
     and (.isMeta != true)
     and ((.message.content | type) == "string"
          or ((.message.content | type) == "array"
              and all(.message.content[]; .type != "tool_result"))))
    or (.type == "user" and .provenance == "real_user");
  def is_changing_or_delegating:
    (.type == "assistant" and (.message.content | type) == "array"
      and any(.message.content[]; .type == "tool_use"
        and (.name | IN("Edit", "Write", "NotebookEdit", "Agent", "Task"))))
    or ((.toolUseResult | objects | .bashEditDiff | objects | .files // []) | length > 0);
  (map(is_user_prompt) | rindex(true)) as $last_prompt
  | .[(($last_prompt // -1) + 1):]
  | any(is_changing_or_delegating)
' "$transcript_path" 2>/dev/null)"
[ "$turn_changed_or_delegated" = "true" ] || exit 0

changed_code_files="$(
  { git -C "$repository_root" diff --name-only HEAD 2>/dev/null
    git -C "$repository_root" ls-files --others --exclude-standard 2>/dev/null; } \
    | grep -E '\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|py|go|rs|rb|java|kt|swift|cs|sh)$' \
    | grep -Ev '(^|/)(node_modules|dist|build|vendor|venv|third_party)/'
)"
[ -n "$changed_code_files" ] || exit 0

pinned_command() {
  local config_file="$repository_root/.claude/quality.json"
  [ -f "$config_file" ] && jq -r --arg key "$1" '.[$key] // empty' "$config_file" 2>/dev/null
}

package_runner() {
  if [ -f "$repository_root/bun.lock" ] || [ -f "$repository_root/bun.lockb" ]; then echo bun
  elif [ -f "$repository_root/pnpm-lock.yaml" ]; then echo pnpm
  elif [ -f "$repository_root/yarn.lock" ]; then echo yarn
  else echo npm; fi
}

detect_lint_command() {
  local pinned
  pinned="$(pinned_command lintCommand)"
  if [ -n "$pinned" ]; then printf '%s' "$pinned"
  elif jq -e '.scripts.lint' "$repository_root/package.json" >/dev/null 2>&1; then printf '%s run lint' "$(package_runner)"
  elif { [ -f "$repository_root/ruff.toml" ] || grep -qs '\[tool.ruff' "$repository_root/pyproject.toml"; } && command -v ruff >/dev/null; then printf 'ruff check .'
  elif [ -f "$repository_root/go.mod" ] && command -v golangci-lint >/dev/null; then printf 'golangci-lint run'
  elif [ -f "$repository_root/Cargo.toml" ] && command -v cargo >/dev/null; then printf 'cargo clippy --quiet -- -D warnings'
  fi
}

detect_fallow_command() {
  local pinned
  pinned="$(pinned_command fallowCommand)"
  if [ -n "$pinned" ]; then printf '%s' "$pinned"
  elif [ -f "$repository_root/package.json" ] && command -v fallow >/dev/null; then printf 'fallow audit --format compact'
  fi
}

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then timeout "$check_timeout_seconds" bash -c "$1" 2>&1
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$check_timeout_seconds" bash -c "$1" 2>&1
  else perl -e 'alarm shift; exec @ARGV' "$check_timeout_seconds" bash -c "$1" 2>&1; fi
}

failure_report=""
append_failure_if_check_fails() {
  local check_name="$1" check_command="$2" check_output
  [ -n "$check_command" ] || return 0
  check_output="$(cd "$repository_root" && run_with_timeout "$check_command")" && return 0
  failure_report+="$check_name failed (\`$check_command\`):"$'\n'"$(printf '%s\n' "$check_output" | tail -n 40)"$'\n\n'
}

append_failure_if_check_fails "Lint" "$(detect_lint_command)"
append_failure_if_check_fails "Fallow" "$(detect_fallow_command)"

state_directory="${TMPDIR:-/tmp}/claude-quality-gates"
mkdir -p "$state_directory" 2>/dev/null
block_count_file="$state_directory/$(printf '%s %s' "$session_id" "$transcript_path" | shasum | cut -c1-16)-lint-fallow-blocks"

if [ -z "$failure_report" ]; then
  rm -f "$block_count_file"
  exit 0
fi

blocks_so_far="$(cat "$block_count_file" 2>/dev/null || echo 0)"
if [ "$blocks_so_far" -ge "$maximum_blocks_in_a_row" ]; then
  rm -f "$block_count_file"
  {
    echo "Lint or fallow is still failing after $maximum_blocks_in_a_row blocks in a row. Stopping is allowed so the loop ends, but this work is not finished: report it as failing, not done."
    printf '%s' "$failure_report"
  } >&2
  exit 0
fi
echo $((blocks_so_far + 1)) > "$block_count_file"

{
  echo "Lint and fallow must pass before finishing. Spawn a subagent with the Agent tool to fix every failure below, including pre-existing ones this change did not introduce and ones in files no plan names. Name subagent_type guards:worker when it is listed, otherwise model haiku. If you have no Agent tool, or the fix is a few lines in one file that you may edit, fix them all yourself. A failing check is never a reason to stop or report the work as blocked: fix it, then carry on. Run the failing command again once it is fixed:"
  echo
  printf '%s' "$failure_report"
  echo "Pin the commands in .claude/quality.json as {\"lintCommand\": \"...\", \"fallowCommand\": \"...\"} when the detected ones are wrong."
} >&2
exit 2
