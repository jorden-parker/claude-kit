#!/bin/sh
set -u
umask 077
command_name="${1:-record}"
state_directory="$HOME/.cache/token-ledger"
mkdir -p "$state_directory" || exit 0
write_launch_status() {
  [ "$command_name" = record ] || return 0
  status_file="$state_directory/recorder-launch.json.$$"
  printf '{"updatedAt":"%s","outcome":"%s"}\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" > "$status_file"
  mv "$status_file" "$state_directory/recorder-launch.json"
}
write_launch_status started
runtime="${TOKEN_LEDGER_BUN:-}"
if [ -z "$runtime" ]; then
  runtime="$(command -v bun 2>/dev/null || true)"
  if [ -z "$runtime" ]; then
    for candidate in "$HOME/.bun/bin/bun" "${BUN_INSTALL:-$HOME/.bun}/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
      if [ -x "$candidate" ]; then runtime="$candidate"; break; fi
    done
  fi
fi
if [ -z "$runtime" ] || [ ! -x "$runtime" ]; then
  write_launch_status runtime-missing
  echo 'token-ledger: Bun could not be found in the hook environment. See Recording status in the report.' >&2
  exit 0
fi
script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if "$runtime" "$script_directory/run.ts" "$command_name"; then
  write_launch_status exited
else
  write_launch_status runtime-failed
  echo 'token-ledger: the recorder process failed. See Recording status in the report and the hook error above.' >&2
fi
exit 0
