#!/usr/bin/env bash
set -euo pipefail

cli_url="${SESSION_NOTES_CLI_URL:-https://raw.githubusercontent.com/jorden-parker/claude-kit/main/plugins/session-notes/bin/session-notes}"
install_directory="$HOME/.local/bin"
install_path="$install_directory/session-notes"

mkdir -p "$install_directory"
downloaded_cli="$(mktemp "$install_directory/.session-notes.XXXXXX")"
trap 'rm -f "$downloaded_cli"' EXIT
curl -fsSL "$cli_url" -o "$downloaded_cli"
chmod 755 "$downloaded_cli"
mv -f "$downloaded_cli" "$install_path"
printf 'Installed %s\n' "$install_path"

case ":$PATH:" in
  *":$install_directory:"*) exit 0 ;;
esac

if [ "$(basename "${SHELL:-}")" = "zsh" ]; then
  zshrc_path="${ZDOTDIR:-$HOME}/.zshrc"
  # shellcheck disable=SC2016
  path_line='export PATH="$HOME/.local/bin:$PATH"'
  if ! grep -qsF "$path_line" "$zshrc_path"; then
    printf '\n%s\n' "$path_line" >> "$zshrc_path"
    printf 'Added ~/.local/bin to your PATH in %s\n' "$zshrc_path"
  fi
  printf 'Open a new terminal, or run: source %s\n' "$zshrc_path"
else
  printf 'Add %s to your PATH to run session-notes.\n' "$install_directory"
fi
