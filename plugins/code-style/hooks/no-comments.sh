#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/hook-bypass-lib.sh"

readonly MAX_REPORTED_LINES=5
readonly VIOLATION_MESSAGE="Comments are not allowed. Remove every comment in this file. Spawn a subagent with the Agent tool to do it (subagent_type guards:worker when listed, else model haiku). Not a fit for this file (seed data, fixtures, config)? Ask the user with the request_hook_bypass tool."

readonly REPEAT_VIOLATION_MESSAGE="Comments are not allowed. Remove them all, then carry on. Not a fit? Ask the user via request_hook_bypass."

violation_message_for_session() {
  local session_id="$1" marker_directory marker_path
  [[ -n "$session_id" ]] || { echo "$VIOLATION_MESSAGE"; return 0; }
  marker_directory="${TMPDIR:-/tmp}/claude-code-style/$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_-' '_')"
  marker_path="$marker_directory/comment-violation-shown"
  if [[ -f "$marker_path" ]]; then
    echo "$REPEAT_VIOLATION_MESSAGE"
    return 0
  fi
  mkdir -p "$marker_directory" 2>/dev/null && : > "$marker_path"
  echo "$VIOLATION_MESSAGE"
}

comment_style_for_shebang() {
  case "$1" in
    '#!'*python*) echo "python" ;;
    '#!'*node*|'#!'*deno*|'#!'*bun*) echo "slash" ;;
    '#!'*sh*|'#!'*ruby*|'#!'*perl*) echo "hash" ;;
    *) echo "" ;;
  esac
}

comment_style_for_file() {
  local file_path="$1" base_name="${1##*/}" extension=""
  if [[ "$base_name" != *.* ]]; then
    comment_style_for_shebang "$(head -n 1 "$file_path" 2>/dev/null)"
    return 0
  fi
  extension="$(printf '%s' "${base_name##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$extension" in
    js|mjs|cjs|jsx|ts|mts|cts|tsx|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|scala|dart) echo "slash" ;;
    py|pyi) echo "python" ;;
    rb|sh|bash|zsh|fish|yaml|yml|toml) echo "hash" ;;
    sql|lua) echo "dash" ;;
    *) echo "" ;;
  esac
}

find_comment_lines() {
  local style="$1" whole_file="$2"
  awk -v style="$style" -v whole_file="$whole_file" '
    function comment_start(line, marker, boundary,    position, character, open_quote) {
      open_quote = ""
      for (position = 1; position <= length(line); position++) {
        character = substr(line, position, 1)
        if (open_quote != "") {
          if (character == "\\") position++
          else if (character == open_quote) open_quote = ""
          continue
        }
        if (substr(line, position, length(marker)) == marker && (position == 1 || substr(line, position - 1, 1) ~ boundary)) return position
        if (index("\"\047`", character)) open_quote = character
      }
      return 0
    }
    function is_allowed_comment(text,    lowered) {
      if (NR == 1 && text ~ /^#!/) return 1
      lowered = tolower(text)
      if (lowered ~ /spdx|copyright|license|coding[:=]/) return 1
      sub(/^[ \t]*(\/\/+|\/\*+|#+|--+|\*+)[ \t]*/, "", lowered)
      if (lowered ~ /^(noqa|type: ?ignore|pragma|nolint|shellcheck|eslint-|@ts-|prettier-ignore|biome-ignore|deno-lint-ignore)/) return 1
      if (lowered ~ /^(pylint:|ruff:|mypy:|fmt:|isort:|rubocop:|swiftlint:|clang-format|cspell:|istanbul |c8 |v8 )/) return 1
      return lowered ~ /^(go:|\+build|<reference|frozen_string_literal|yaml-language-server|webpack|@vite-ignore|[#@]__pure__)/
    }
    function find_marker_comment(line, marker,    position) {
      position = comment_start(line, marker, "[ \t]")
      if (position) comment_text = substr(line, position)
    }
    function find_slash_comment(line, trimmed,    line_start, block_start) {
      if (inside_block_comment) {
        if (index(line, "*/")) inside_block_comment = 0
        if (is_allowed_comment(trimmed)) is_block_comment_allowed = 1
        if (!is_block_comment_allowed) comment_text = trimmed
        return
      }
      line_start = comment_start(line, "//", "[ \t;{}(),]")
      block_start = comment_start(line, "/*", "[ \t;{}(),]")
      if (!block_start || (line_start && line_start < block_start)) {
        if (line_start) comment_text = substr(line, line_start)
        return
      }
      comment_text = substr(line, block_start)
      if (index(substr(comment_text, 3), "*/")) return
      inside_block_comment = 1
      is_block_comment_allowed = is_allowed_comment(comment_text)
      if (comment_text ~ /^\/\*+[ \t]*$/) comment_text = ""
    }
    function find_python_docstring(line, trimmed,    was_awaiting) {
      if (trimmed == "" || trimmed ~ /^#/) return
      was_awaiting = awaiting_docstring
      awaiting_docstring = 0
      if (was_awaiting && trimmed ~ /^[rRbBuUfF]?("|\047)/) comment_text = trimmed
      if (trimmed ~ /^(async[ \t]+)?(def|class)[ \t]/) inside_signature = 1
      if (inside_signature && line ~ /:[ \t]*(#.*)?$/) {
        inside_signature = 0
        awaiting_docstring = 1
      }
    }
    BEGIN { awaiting_docstring = whole_file }
    {
      trimmed = $0
      sub(/^[ \t]+/, "", trimmed)
      comment_text = ""
      if (style == "slash") find_slash_comment($0, trimmed)
      else if (style == "dash") find_marker_comment($0, "--")
      else {
        if (style == "python") find_python_docstring($0, trimmed)
        if (comment_text == "") find_marker_comment($0, "#")
      }
      if (comment_text != "" && !is_allowed_comment(comment_text)) print NR ": " $0
    }
  '
}

main() {
  local payload file_path new_text whole_file style offending_lines session_id

  command -v jq >/dev/null || { echo "no-comments.sh: jq is not installed, so comments are not checked." >&2; exit 1; }
  payload="$(cat)" || exit 0
  file_path="$(jq -r '.tool_input.file_path // empty' <<<"$payload" 2>/dev/null)" || exit 0
  new_text="$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$payload" 2>/dev/null)" || exit 0
  whole_file="$(jq -r 'if .tool_input.content then 1 else 0 end' <<<"$payload" 2>/dev/null)" || exit 0
  [[ -n "$file_path" && -n "$new_text" ]] || exit 0
  hook_bypass_granted "$file_path" && exit 0

  style="$(comment_style_for_file "$file_path")"
  [[ -n "$style" ]] || exit 0

  offending_lines="$(printf '%s\n' "$new_text" | find_comment_lines "$style" "$whole_file")" || exit 0
  [[ -n "$offending_lines" ]] || exit 0
  session_id="$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null)" || session_id=""

  {
    printf '%s\n' "$offending_lines" | head -n "$MAX_REPORTED_LINES"
    violation_message_for_session "$session_id"
  } >&2
  exit 2
}

main
