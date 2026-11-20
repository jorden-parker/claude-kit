#!/usr/bin/env bash
set -u

if [ $# -lt 2 ]; then
  echo "usage: render-mod.sh <mod_dir> <output_prefix> [slash_command|null] [columns] [rows] [trusted_folder]" >&2
  exit 2
fi

mod_dir="$(cd "$1" && pwd)"
output_prefix="$2"
slash_command="${3:-null}"
columns="${4:-160}"
rows="${5:-45}"
trusted_folder="${6:-$PWD}"
session_name="render-$$"
tmux_socket="${TMPDIR:-/tmp}/rm-$$.sock"
if [ "${#tmux_socket}" -gt 90 ]; then tmux_socket="/tmp/rm-$$.sock"; fi
clean_env=$(env | grep -oE '^CLAUDE[A-Z_]*' | sed 's/^/-u /' | tr '\n' ' ')
launch_script="$output_prefix.launch.sh"

run_tmux() { tmux -S "$tmux_socket" "$@"; }

screen_matches() { run_tmux capture-pane -p -t "$session_name" 2>/dev/null | grep -qiE "$1"; }

wait_for_screen() {
  for _ in $(seq 1 "$2"); do
    if screen_matches "$1"; then return 0; fi
    sleep 1
  done
  return 1
}

printf '#!/usr/bin/env bash\nenv %s claude --plugin-dir %q 2> %q\necho "EXIT=$?" > %q\nsleep 600\n' \
  "$clean_env" "$mod_dir" "$output_prefix.err" "$output_prefix.exit" > "$launch_script"

run_tmux new-session -d -s "$session_name" -x "$columns" -y "$rows" -c "$trusted_folder" "bash '$launch_script'"
if ! wait_for_screen "for shortcuts|shift\+tab|auto mode|accept edits|bypass" 60; then
  echo "render-mod: Claude Code did not reach the prompt; see $output_prefix.err and $output_prefix.txt" >&2
fi
sleep 4
if [ "$slash_command" != "null" ]; then
  run_tmux send-keys -t "$session_name" -l "$slash_command"
  sleep 1
  run_tmux send-keys -t "$session_name" Enter
  sleep 6
fi

run_tmux capture-pane -p -e -N -t "$session_name" > "$output_prefix.ansi"
run_tmux capture-pane -p -t "$session_name" > "$output_prefix.txt"
run_tmux kill-server 2>/dev/null
rm -f "$launch_script"

if command -v uvx >/dev/null 2>&1; then
  uvx -q --from ansi2html ansi2html < "$output_prefix.ansi" \
    | sed 's|</head>|<style>.ansi2html-content{line-height:1.12;font-family:Menlo,"SF Mono",monospace;font-size:13px;letter-spacing:0}</style></head>|' \
    > "$output_prefix.html"
fi
echo "render-mod: wrote $output_prefix.txt, .ansi$( [ -f "$output_prefix.html" ] && echo ', .html')"
