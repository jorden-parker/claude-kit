# 001 — Document installing the marketplace from GitHub

- Written against: `db4d830` (branch `main`, in sync with `origin/main`)
- Effort: S · Risk: very low (docs only) · Confidence: HIGH

## Why

The goal is a work-machine setup that needs only `claude plugin *` commands.
The marketplace manifest is **already committed and pushed**:

- `.claude-plugin/marketplace.json` is tracked (added in `490b397 feat: add jorden-mods marketplace`).
- `origin` is `https://github.com/jorden-parker/mods.git` (public), and `main` is level with `origin/main`.
- `prompt-optimizer/hooks/register.ts` has one import, `import type { Register } from "claude-code";`.
  It is type-only, so the plugin needs no `pnpm install` to run.

Only `prompt-optimizer/README.md` is out of date. Lines 7–30 describe a local-path install and say the
manifest "sits outside this repo". That stopped being true when `db4d830` merged the plugin into this repo.

## Drift check (run first)

```
git -C ~/src/mods ls-files .claude-plugin/marketplace.json   # expect: .claude-plugin/marketplace.json
grep -n "sits outside this repo" ~/src/mods/prompt-optimizer/README.md   # expect: line 14
```

If either check fails, STOP and report back.

## Current state (`prompt-optimizer/README.md` lines 5–30)

````
## Install

Installs at user scope, so it works in every directory:

```
claude plugin marketplace add ~/src/mods
claude plugin install prompt-optimizer@jorden-mods --scope user
```

This needs `~/src/mods/.claude-plugin/marketplace.json`, which sits outside this repo. To recreate it:

```json
{ ...17-line copy of the manifest... }
```
````

## Steps

1. In `prompt-optimizer/README.md`, replace lines 7–30 (from "Installs at user scope" through the closing
   fence of the JSON block) with:

   ````
   Installs at user scope, so it works in every directory.

   On any machine, straight from GitHub:

   ```
   claude plugin marketplace add jorden-parker/mods
   claude plugin install prompt-optimizer@jorden-mods --scope user
   ```

   On the dev machine, use the local checkout so that edits apply after `/reload-plugins`:

   ```
   claude plugin marketplace add ~/src/mods
   claude plugin install prompt-optimizer@jorden-mods --scope user
   ```

   The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.
   ````

   Leave the `## Edits`, `## Don't`, `## Uninstall` and `## Dev` sections unchanged.

2. Format the file: `cd prompt-optimizer && pnpm exec prettier --check README.md`. If the check fails, run
   `--write`.

## Out of scope

- `.claude-plugin/marketplace.json` and `prompt-optimizer/.claude-plugin/plugin.json`. Both are correct as they are.
- All code files and hooks.

## Done criteria

```
grep -c "sits outside this repo" prompt-optimizer/README.md          # 0
grep -c "marketplace add jorden-parker/mods" prompt-optimizer/README.md   # 1
cd prompt-optimizer && pnpm exec prettier --check README.md          # passes
```

Manual check (optional, done by the user on the work machine): run the two GitHub commands, then
`claude plugin list`. The output should show `prompt-optimizer@jorden-mods`, and `/optimize` should be available.

## Escape hatch

If `claude plugin marketplace add jorden-parker/mods` is rejected, use the full URL
`https://github.com/jorden-parker/mods.git`. If the shorthand is unsupported in this CLI version, document that
URL instead. Do not change the manifest.

## Maintenance

- Every plugin added to `marketplace.json` must be pushed before other machines can see it. They pick up changes
  with `claude plugin marketplace update jorden-mods`.
- If the repo is ever made private, GitHub installs on the work machine need git credentials there.
