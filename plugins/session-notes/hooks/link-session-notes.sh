#!/usr/bin/env bash
set -euo pipefail

cli_path="$(cd "$(dirname "$0")/../bin" && pwd)/session-notes"
link_directory="${SESSION_NOTES_LINK_DIR:-$HOME/.local/bin}"
link_path="$link_directory/session-notes"

refuse_foreign_file() {
  printf '%s is not a session-notes link; move it and run the installer again.\n' "$link_path" >&2
  exit 1
}

if [ -L "$link_path" ]; then
  case "$(readlink "$link_path")" in
    */bin/session-notes) ;;
    *) refuse_foreign_file ;;
  esac
elif [ -e "$link_path" ]; then
  refuse_foreign_file
fi

mkdir -p "$link_directory"
ln -sfn "$cli_path" "$link_path"
