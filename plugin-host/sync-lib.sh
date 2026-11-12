#!/usr/bin/env bash

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exit_after_usage_request() {
  case "${2:-}" in -h | --help) echo "$1"; exit 0 ;; esac
}

require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null || { echo "$command_name not found on PATH" >&2; exit 1; }
  done
}

select_plugin_folders() {
  plugin_folders=()
  if [ "$#" -eq 0 ]; then
    plugin_folders=("$repository_root"/plugins/*/)
    return
  fi
  local plugin_name
  for plugin_name in "$@"; do plugin_folders+=("$repository_root/plugins/$plugin_name"); done
}

read_plugin_name() {
  jq -r .name "$1/.claude-plugin/plugin.json"
}

uses_module_api() {
  [ -f "$1/hooks/hooks.json" ] && jq -e 'has("modules")' "$1/hooks/hooks.json" >/dev/null
}

stage_plugin() {
  local target="$1" plugin_folder="$2" staged_folder="$3"
  mkdir -p "$staged_folder"
  rsync -a --delete --exclude node_modules --exclude tests --exclude .git --exclude output-styles \
    "$plugin_folder/" "$staged_folder/"
  if uses_module_api "$plugin_folder"; then
    bun "$repository_root/plugin-host/build.ts" "$target" "$plugin_folder" "$staged_folder"
  fi
}

report_failed_plugins() {
  [ "$#" -eq 0 ] && return 0
  echo "Failed: $*" >&2
  exit 1
}
