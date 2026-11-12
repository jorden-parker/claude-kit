#!/usr/bin/env bash
set -euo pipefail

cli_path="$(cd "$(dirname "$0")/../bin" && pwd)/session-notes"
link_directory="${SESSION_NOTES_LINK_DIR:-$HOME/.local/bin}"
link_path="$link_directory/session-notes"

if [ -L "$link_path" ]; then
  case "$(readlink "$link_path")" in
    */bin/session-notes) ;;
    *) exit 0 ;;
  esac
elif [ -e "$link_path" ]; then
  exit 0
fi

mkdir -p "$link_directory"
ln -sfn "$cli_path" "$link_path"
