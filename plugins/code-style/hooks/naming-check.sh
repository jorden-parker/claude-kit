#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/hook-bypass-lib.sh"

payload=$(cat)
file_path=$(printf '%s' "$payload" | /usr/bin/jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
working_directory=$(printf '%s' "$payload" | /usr/bin/jq -r '.cwd // empty' 2>/dev/null) || exit 0
new_text=$(printf '%s' "$payload" | /usr/bin/jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null) || exit 0

[ -z "$file_path" ] && exit 0
[ -z "$new_text" ] && exit 0

extension="${file_path##*.}"
case "$extension" in
  js|jsx|ts|tsx|py|go|rs|java|kt|swift|rb|cs|c|cpp|h) ;;
  *) exit 0 ;;
esac

hook_bypass_granted "$file_path" && exit 0

allowlist_file="${working_directory}/.claude/naming-allowlist.txt"
[ -f "$allowlist_file" ] || allowlist_file=""

violations=$(printf '%s\n' "$new_text" | EXTENSION="$extension" ALLOWLIST_FILE="$allowlist_file" perl -e '
  my %allowed = map { $_ => 1 } qw(i j k e x y z id _ db io ok fs os up to);
  my %vague = map { $_ => 1 } qw(tmp temp val vals res ret ctx cfg usr btn str num obj arr fn cb el elem idx cnt len buf ptr msg err data info item items thing stuff foo bar baz handler manager helper util utils process handle dosomething);
  if ($ENV{ALLOWLIST_FILE} ne "" && open(my $allowlist_handle, "<", $ENV{ALLOWLIST_FILE})) {
    while (my $allowlist_line = <$allowlist_handle>) {
      $allowlist_line =~ s/^\s+|\s+$//g;
      $allowed{lc $allowlist_line} = 1 if length $allowlist_line;
    }
    close $allowlist_handle;
  }
  my @declaration_patterns = (
    qr/\b(?:const|let|var)\s+([A-Za-z_]\w*)/,
    qr/\bfunction\s*\*?\s+([A-Za-z_]\w*)/,
    qr/\bdef\s+([A-Za-z_]\w*)/,
    qr/\bclass\s+([A-Za-z_]\w*)/,
    qr/\bfunc\s+([A-Za-z_]\w*)/,
    qr/\bfn\s+([A-Za-z_]\w*)/,
    qr/\b(?:interface|type|struct|enum)\s+([A-Za-z_]\w*)/,
  );
  push @declaration_patterns, qr/^\s*([A-Za-z_]\w*)\s*=(?!=)/ if $ENV{EXTENSION} eq "py";
  my %already_reported;
  my $line_number = 0;
  while (my $source_line = <STDIN>) {
    $line_number++;
    foreach my $pattern (@declaration_patterns) {
      while ($source_line =~ /$pattern/g) {
        my $identifier = $1;
        my $lowered = lc $identifier;
        next if $allowed{$lowered};
        my $reason;
        if (length($identifier) <= 2) { $reason = "too short" }
        elsif ($vague{$lowered}) { $reason = "cryptic or vague" }
        next unless defined $reason;
        next if $already_reported{"$line_number:$identifier"}++;
        print "line $line_number: $identifier ($reason)\n";
      }
    }
  }
' 2>/dev/null) || exit 0

[ -z "$violations" ] && exit 0

readonly FULL_INSTRUCTIONS="Rename each failing name, including pre-existing ones. Spawn a subagent with the Agent tool to do it (subagent_type guards:worker when listed, else model haiku). Not a fit for this file (seed data, fixtures, config)? Ask the user with the request_hook_bypass tool."
readonly REPEAT_INSTRUCTIONS="Rename every failing name in the file, then carry on. Not a fit? Ask the user with the request_hook_bypass tool."

instructions_for_session() {
  local session_id marker_directory marker_path
  session_id=$(printf '%s' "$payload" | /usr/bin/jq -r '.session_id // empty' 2>/dev/null) || session_id=""
  [ -n "$session_id" ] || { echo "$FULL_INSTRUCTIONS"; return 0; }
  marker_directory="${TMPDIR:-/tmp}/claude-code-style/$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_-' '_')"
  marker_path="$marker_directory/naming-violation-shown"
  if [ -f "$marker_path" ]; then
    echo "$REPEAT_INSTRUCTIONS"
    return 0
  fi
  mkdir -p "$marker_directory" 2>/dev/null && : > "$marker_path"
  echo "$FULL_INSTRUCTIONS"
}

{
  echo "Naming violations in ${file_path}:"
  printf '%s\n' "$violations" | head -n 8 | sed 's/^/  /'
  instructions_for_session
} >&2
exit 2
