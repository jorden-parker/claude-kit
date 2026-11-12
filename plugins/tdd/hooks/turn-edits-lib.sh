#!/usr/bin/env bash

paths_edited_this_turn() {
  local transcript_path="$1"
  [ -f "$transcript_path" ] || return 0
  jq -r '
    def is_user_prompt:
      .type == "user"
      and (.isMeta != true)
      and ((.message.content | type) == "string"
           or ((.message.content | type) == "array"
               and all(.message.content[]; .type != "tool_result")));
    if is_user_prompt then "prompt"
    elif .type == "assistant" and (.message.content | type) == "array" then
      .message.content[]
      | select(.type == "tool_use" and (.name | IN("Edit", "Write", "NotebookEdit")))
      | "edit\t" + (.input.file_path // .input.notebook_path // "")
    elif .type == "user" then
      (.toolUseResult | objects | .bashEditDiff | objects | .files // [])[]
      | (if type == "object" then .filePath else . end)
      | strings
      | "edit\t" + .
    else empty end
  ' -- "$transcript_path" 2>/dev/null \
    | awk -F '\t' '
        $1 == "prompt" { edited_count = 0; next }
        $1 == "edit" && $2 != "" { edited_paths[++edited_count] = $2 }
        END { for (i = 1; i <= edited_count; i++) print edited_paths[i] }
      '
}

repository_relative_paths_edited_this_turn() {
  local transcript_path="$1" working_directory="$2" repository_root="$3"
  local resolved_root edited_path parent_directory relative_directory
  resolved_root="$(cd "$repository_root" 2>/dev/null && pwd -P)" || return 0
  paths_edited_this_turn "$transcript_path" | while IFS= read -r edited_path; do
    case "$edited_path" in /*) ;; *) edited_path="$working_directory/$edited_path" ;; esac
    parent_directory="$(cd "$(dirname "$edited_path")" 2>/dev/null && pwd -P)" || continue
    case "$parent_directory/" in "$resolved_root"/*) ;; *) continue ;; esac
    relative_directory="${parent_directory#"$resolved_root"}"
    relative_directory="${relative_directory#/}"
    printf '%s\n' "${relative_directory:+$relative_directory/}$(basename "$edited_path")"
  done | sort -u
}

keep_paths_edited_this_turn() {
  local transcript_path="$1" working_directory="$2" repository_root="$3" edited_paths
  edited_paths="$(repository_relative_paths_edited_this_turn "$transcript_path" "$working_directory" "$repository_root")"
  [ -n "$edited_paths" ] || return 0
  grep -Fxf <(printf '%s\n' "$edited_paths")
}
