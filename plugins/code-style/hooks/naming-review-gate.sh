#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/turn-edits-lib.sh"

payload=$(cat)
stop_hook_active=$(printf '%s' "$payload" | /usr/bin/jq -r '.stop_hook_active // false' 2>/dev/null) || exit 0
[ "$stop_hook_active" = "true" ] && exit 0

session_id=$(printf '%s' "$payload" | /usr/bin/jq -r '.session_id // empty' 2>/dev/null) || exit 0
working_directory=$(printf '%s' "$payload" | /usr/bin/jq -r '.cwd // empty' 2>/dev/null) || exit 0
transcript_path=$(printf '%s' "$payload" | /usr/bin/jq -r '.transcript_path // empty' 2>/dev/null) || exit 0
[ -z "$session_id" ] && exit 0
[ -z "$working_directory" ] && exit 0
[ -z "$transcript_path" ] && exit 0

git -C "$working_directory" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git -C "$working_directory" rev-parse --verify HEAD >/dev/null 2>&1 || exit 0
repository_root=$(git -C "$working_directory" rev-parse --show-toplevel 2>/dev/null) || exit 0

tracked_changes=$(git -C "$repository_root" diff --name-only HEAD 2>/dev/null || git -C "$repository_root" diff --name-only 2>/dev/null)
untracked_files=$(git -C "$repository_root" ls-files --others --exclude-standard 2>/dev/null)

changed_source_files=$(printf '%s\n%s\n' "$tracked_changes" "$untracked_files" \
  | grep -E '\.(js|jsx|ts|tsx|py|go|rs|java|kt|swift|rb|cs|c|cpp|h)$' \
  | grep -vE '(^|/)(node_modules|vendor|dist|build|plugins|cache|\.venv|venv|third_party)/|(^|/)\.[^/]+/' \
  | keep_paths_edited_this_turn "$transcript_path" "$working_directory" "$repository_root" \
  | sort -u)

[ -z "$changed_source_files" ] && exit 0

file_list_hash=$(printf '%s\n' "$changed_source_files" | shasum | cut -c1-12)
safe_session_id=$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_-' '_')
marker_file="/tmp/claude-naming-review-${safe_session_id}-${file_list_hash}"

[ -e "$marker_file" ] && exit 0
touch "$marker_file" 2>/dev/null || exit 0

changed_file_summary=$(printf '%s\n' "$changed_source_files" | head -n 20 | paste -sd ' ' -)
echo "Before finishing, run the naming-review skill over the changed files and fix any identifiers that fail. Changed files: ${changed_file_summary}" >&2
exit 2
