#!/usr/bin/env bash

hook_bypass_granted() {
  local grants_file="$HOME/.claude/hook-bypass/grants.tsv"
  [ -f "$grants_file" ] || return 1
  GRANTED_PATH="$1" awk -F '\t' -v now="$(date +%s)" '$2 == ENVIRON["GRANTED_PATH"] && $1 > now { found = 1 } END { exit !found }' "$grants_file"
}
