#!/usr/bin/env bash
set -uo pipefail

maximum_blocks_per_turn=1

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
transcript_path="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)" || exit 0
[ -n "$session_id" ] && [ -n "$transcript_path" ] && [ -f "$transcript_path" ] || exit 0

current_turn_actions="$(jq -c '
  def is_user_prompt:
    .type == "user"
    and (.isMeta != true)
    and ((.message.content | type) == "string"
         or ((.message.content | type) == "array"
             and all(.message.content[]; .type != "tool_result")));
  def is_non_code_extension:
    test("\\.(md|mdx|markdown|txt|rst|adoc|json|jsonc|jsonl|ya?ml|toml|ini|cfg|conf|env|lock|csv|tsv|log|svg|png|jpe?g|gif)$"; "i");
  def is_scratch_location:
    test("/\\.claude/(projects|plans|todos|file-history|paste-cache|session-env)/|/scratchpad/|^/(private/)?tmp/");
  def is_code_path: (length > 0) and (is_non_code_extension | not) and (is_scratch_location | not);
  def bash_changed_code_paths:
    [(.toolUseResult.bashEditDiff.files? // [])[]
     | (if type == "object" then .filePath else . end)
     | select(is_code_path)];
  if is_user_prompt then {kind: "prompt", uuid: .uuid}
  elif .type == "assistant" and (.message.content | type) == "array" then
    .message.content[] | select(.type == "tool_use")
    | if .name == "Edit" or .name == "Write" or .name == "NotebookEdit" then
        (.input.file_path // .input.notebook_path // "") as $edited_path
        | if ($edited_path | is_code_path) then {kind: "edit", path: $edited_path}
          else {kind: "non_code_edit"} end
      else {kind: "tool", name: .name} end
  elif .type == "user" and (bash_changed_code_paths | length > 0) then {kind: "edit", paths: bash_changed_code_paths}
  else empty end
' -- "$transcript_path" 2>/dev/null)" || exit 0

last_prompt_line_number="$(printf '%s\n' "$current_turn_actions" | grep -n '"kind":"prompt"' | tail -n 1 | cut -d: -f1)"
[ -n "$last_prompt_line_number" ] || exit 0
turn_prompt_uuid="$(printf '%s\n' "$current_turn_actions" | sed -n "${last_prompt_line_number}p" | jq -r '.uuid // "unknown"')"
turn_actions="$(printf '%s\n' "$current_turn_actions" | tail -n +"$((last_prompt_line_number + 1))")"

last_mutation_line_number="$(printf '%s\n' "$turn_actions" \
  | grep -n '"kind":"edit"' | tail -n 1 | cut -d: -f1)"
[ -n "$last_mutation_line_number" ] || exit 0

verification_after_last_mutation="$(printf '%s\n' "$turn_actions" \
  | tail -n +"$((last_mutation_line_number + 1))" \
  | jq -r 'select(.kind == "tool" and (.name | IN("Bash", "Read", "Grep", "Glob")))
      | "verified"' | head -n 1)"
[ "$verification_after_last_mutation" = "verified" ] && exit 0

safe_session_id="$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_-' '_')"
safe_prompt_uuid="$(printf '%s' "$turn_prompt_uuid" | tr -c 'A-Za-z0-9_-' '_')"
state_directory="${TMPDIR:-/tmp}/claude-verify-gate/${safe_session_id}"
block_count_file="$state_directory/${safe_prompt_uuid}.blocks"
mkdir -p "$state_directory" 2>/dev/null || exit 0
previous_block_count="$(cat "$block_count_file" 2>/dev/null || echo 0)"
[[ "$previous_block_count" =~ ^[0-9]+$ ]] || previous_block_count=0
[ "$previous_block_count" -ge "$maximum_blocks_per_turn" ] && exit 0
echo $((previous_block_count + 1)) > "$block_count_file" 2>/dev/null

cat >&2 <<'MESSAGE'
Verification required before reporting this task finished. This turn changed code, and nothing checked the result afterwards. Run a quick verification now: execute the tests or a command that exercises the change, or read back a changed file and confirm it is what the task asked for. Then state the verified result in your final message instead of assuming it worked. If verification fails, fix it and verify again.
MESSAGE
exit 2
