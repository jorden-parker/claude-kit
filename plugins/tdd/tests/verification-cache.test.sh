#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../hooks/verification-cache.sh"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
git -C "$sandbox" init -q
printf 'first\n' > "$sandbox/source.ts"
git -C "$sandbox" add source.ts
git -C "$sandbox" -c user.name=Test -c user.email=test@example.com commit -qm initial
first="$(verification_cache_path "$sandbox" 'bun test' session)"
verification_save "$first"
verification_cached "$first"
[ "$first" != "$(verification_cache_path "$sandbox" 'bun test other' session)" ]
printf 'second\n' > "$sandbox/source.ts"
[ "$first" != "$(verification_cache_path "$sandbox" 'bun test' session)" ]
git -C "$sandbox" checkout -- source.ts
printf 'new\n' > "$sandbox/untracked.ts"
[ "$first" != "$(verification_cache_path "$sandbox" 'bun test' session)" ]
rm "$sandbox/untracked.ts"
[ "$first" != "$(COST_TEST_SETTING=changed verification_cache_path "$sandbox" 'bun test' session)" ]
echo 'PASS: verification reuse invalidates for command, tracked, untracked and environment changes'
