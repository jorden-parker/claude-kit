#!/usr/bin/env bash

verification_fingerprint() (
  set -o pipefail
  local repository_root="$1" command_text="$2"
  (
    cd "$repository_root" || exit 1
    printf '%s\n' "$command_text"
    git rev-parse HEAD || exit 1
    env | LC_ALL=C sort | sed '/^_=/d; /^SHLVL=/d; /^PWD=/d; /^OLDPWD=/d'
    git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' source_path; do
      printf '%s\n' "$source_path"
      if [ -f "$source_path" ]; then shasum "$source_path" || exit 1
      else printf 'missing\n'; fi
    done
  ) | shasum | cut -c1-40
)

verification_cache_path() {
  local fingerprint
  fingerprint="$(verification_fingerprint "$1" "$2")" || return 1
  printf '%s/claude-verification/%s/%s' "${TMPDIR:-/tmp}" "$(printf '%s' "$3" | shasum | cut -c1-16)" "$fingerprint"
}

verification_cached() {
  [ "${CLAUDE_KIT_VERIFY_CACHE:-1}" != "0" ] || return 1
  local cache_path="$1" recorded_at age
  [ -f "$cache_path" ] || return 1
  recorded_at="$(cat "$cache_path")"
  [[ "$recorded_at" =~ ^[0-9]+$ ]] || return 1
  age="$(( $(date +%s) - recorded_at ))"
  [ "$age" -ge 0 ] && [ "$age" -lt 60 ]
}

verification_save() {
  [ -n "$1" ] || return 0
  mkdir -p "$(dirname "$1")" && date +%s > "$1"
}
