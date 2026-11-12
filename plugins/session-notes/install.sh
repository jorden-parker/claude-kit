#!/usr/bin/env bash
set -euo pipefail

plugin_root="$(cd "$(dirname "$0")" && pwd)"
install_directory="${SESSION_NOTES_LINK_DIR:-$HOME/.local/bin}"

bash "$plugin_root/hooks/link-session-notes.sh"
printf 'Linked %s/session-notes to %s/bin/session-notes\n' "$install_directory" "$plugin_root"

is_on_path=false
case ":$PATH:" in
  *":$install_directory:"*) is_on_path=true ;;
esac

if [ "$(basename "${SHELL:-}")" = "zsh" ]; then
  zshrc_path="${ZDOTDIR:-$HOME}/.zshrc"
  # shellcheck disable=SC2016
  path_line='export PATH="$HOME/.local/bin:$PATH"'
  # shellcheck disable=SC2016
  completion_line='(( $+commands[session-notes] )) && eval "$(session-notes completion zsh)"'
  if [ "$is_on_path" = false ] && ! grep -qsF "$path_line" "$zshrc_path"; then
    printf '\n%s\n' "$path_line" >> "$zshrc_path"
    printf 'Added ~/.local/bin to your PATH in %s\n' "$zshrc_path"
  fi
  if ! grep -qsF "$completion_line" "$zshrc_path"; then
    printf '\n%s\n' "$completion_line" >> "$zshrc_path"
    printf 'Added session-notes completion in %s\n' "$zshrc_path"
  fi
  printf 'Open a new terminal, or run: source %s\n' "$zshrc_path"
elif [ "$is_on_path" = false ]; then
  printf 'Add %s to your PATH to run session-notes.\n' "$install_directory"
fi
