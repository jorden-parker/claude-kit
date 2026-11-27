#!/usr/bin/env bash

changed_text_for_payload() {
  local payload="$1" file_path="$2" new_text="$3" previous_text temporary_directory repository_root relative_path snapshot_key snapshot_path
  if jq -e '.tool_input | has("new_string")' <<< "$payload" >/dev/null; then
    previous_text="$(jq -r '.tool_input.old_string // ""' <<< "$payload")"
  else
    snapshot_key="$(jq -r '[.session_id // "", .tool_use_id // "", .tool_input.file_path // ""] | .[]' <<< "$payload" | shasum | cut -c1-40)"
    snapshot_path="${TMPDIR:-/tmp}/claude-code-style-baselines/$snapshot_key"
    if [ -f "$snapshot_path" ]; then
      previous_text="$(cat "$snapshot_path")"
    else
    repository_root="$(git -C "$(dirname "$file_path")" rev-parse --show-toplevel 2>/dev/null)" || { printf '%s\n' "$new_text"; return; }
    relative_path="${file_path#"$repository_root/"}"
    previous_text="$(git -C "$repository_root" show "HEAD:$relative_path" 2>/dev/null)" || previous_text=""
    fi
  fi
  temporary_directory="$(mktemp -d)" || return 1
  printf '%s\n' "$previous_text" > "$temporary_directory/before"
  printf '%s\n' "$new_text" > "$temporary_directory/after"
  diff -U0 "$temporary_directory/before" "$temporary_directory/after" | awk '/^\+\+\+/ {next} /^\+/ {print substr($0,2)}'
  rm -rf "$temporary_directory"
}
