#!/usr/bin/env bash
set -uo pipefail

readonly MAX_REPORTED_LINES=5
readonly VIOLATION_MESSAGE="Comments are not allowed in this repo. Remove them and make the code self-explanatory (extract a named function or variable instead)."

comment_style_for_extension() {
  case "$1" in
    js|ts|jsx|tsx|go|rs|java|kt|swift|c|cpp|h|cs) echo "slash" ;;
    py) echo "python" ;;
    rb|sh|bash|zsh|yaml|yml|toml) echo "hash" ;;
    sql|lua) echo "dash" ;;
    *) echo "" ;;
  esac
}

lowercase_extension_of() {
  local base_name="${1##*/}"
  [[ "$base_name" == *.* ]] || return 0
  printf '%s' "${base_name##*.}" | tr '[:upper:]' '[:lower:]'
}

find_comment_lines() {
  local style="$1"
  awk -v style="$style" '
    function count_char(text, ch,    stripped) {
      stripped = text
      return gsub(ch, "", stripped)
    }
    function has_balanced_quotes(prefix) {
      return count_char(prefix, "\"") % 2 == 0 && count_char(prefix, "\047") % 2 == 0 && count_char(prefix, "`") % 2 == 0
    }
    function has_trailing_marker(line, marker,    position, width) {
      width = length(marker)
      for (position = 2; position <= length(line) - width + 1; position++) {
        if (substr(line, position, width) == marker && substr(line, position - 1, 1) ~ /[ \t]/ && has_balanced_quotes(substr(line, 1, position - 1))) {
          if (marker == "--" && substr(line, position + 2, 1) !~ /^[ \t]?$/) continue
          return 1
        }
      }
      return 0
    }
    function is_allowed_directive(line,    lowered) {
      lowered = tolower(line)
      if (lowered ~ /spdx|copyright|license|noqa|type: ignore|eslint-disable|eslint-enable|@ts-ignore|@ts-expect-error|prettier-ignore|pragma|nolint|shellcheck|coding[:=]/) return 1
      if (line ~ /^[ \t]*#!/ || line ~ /^[ \t]*#\[/) return 1
      if (line ~ /^[ \t]*#(include|define|ifdef|ifndef|if|elif|else|endif|undef)/) return 1
      return 0
    }
    function is_slash_comment(line, trimmed,    rest) {
      if (inside_block_comment) {
        if (index(line, "*/")) inside_block_comment = 0
        return 1
      }
      if (trimmed ~ /^\/\*/) {
        rest = substr(trimmed, 3)
        if (!index(rest, "*/")) inside_block_comment = 1
        return 1
      }
      if (trimmed ~ /^\/\//) return 1
      return has_trailing_marker(line, "//") || has_trailing_marker(line, "/*")
    }
    function is_hash_comment(line, trimmed) {
      return trimmed ~ /^#/ || has_trailing_marker(line, "#")
    }
    function is_dash_comment(line, trimmed) {
      return trimmed ~ /^--/ || has_trailing_marker(line, "--")
    }
    function is_python_docstring(trimmed,    was_awaiting) {
      was_awaiting = awaiting_docstring
      if (trimmed == "") return 0
      awaiting_docstring = 0
      return was_awaiting && trimmed ~ /^[rRbBuUfF]?("|\047)/
    }
    {
      trimmed = $0
      sub(/^[ \t]+/, "", trimmed)
      flagged = 0
      if (!inside_block_comment && is_allowed_directive($0)) {
        next
      }
      if (style == "slash") flagged = is_slash_comment($0, trimmed)
      else if (style == "hash") flagged = is_hash_comment($0, trimmed)
      else if (style == "dash") flagged = is_dash_comment($0, trimmed)
      else if (style == "python") {
        flagged = is_python_docstring(trimmed) || is_hash_comment($0, trimmed)
        if ($0 ~ /^[ \t]*(async[ \t]+)?(def|class)[ \t].*:[ \t]*$/) awaiting_docstring = 1
      }
      if (flagged) print NR ": " $0
    }
  '
}

main() {
  local payload file_path new_text extension style offending_lines

  payload="$(cat)" || exit 0
  file_path="$(jq -r '.tool_input.file_path // empty' <<<"$payload" 2>/dev/null)" || exit 0
  new_text="$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$payload" 2>/dev/null)" || exit 0
  [[ -n "$file_path" && -n "$new_text" ]] || exit 0

  extension="$(lowercase_extension_of "$file_path")"
  style="$(comment_style_for_extension "$extension")"
  [[ -n "$style" ]] || exit 0

  offending_lines="$(printf '%s\n' "$new_text" | find_comment_lines "$style")" || exit 0
  [[ -n "$offending_lines" ]] || exit 0

  {
    printf '%s\n' "$offending_lines" | head -n "$MAX_REPORTED_LINES"
    echo "$VIOLATION_MESSAGE"
  } >&2
  exit 2
}

main
