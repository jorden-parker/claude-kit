# prompt-optimizer

`/optimize <draft>` rewrites a draft prompt to be clearer and more specific.

## Install

Installs at user scope, so it works in every directory:

```
claude plugin marketplace add ~/src/mods
claude plugin install prompt-optimizer@jorden-mods --scope user
```

This needs `~/src/mods/.claude-plugin/marketplace.json`, which sits outside this repo. To recreate it:

```json
{
  "name": "jorden-mods",
  "owner": { "name": "Jorden Parker" },
  "plugins": [
    {
      "name": "prompt-optimizer",
      "source": "./prompt-optimizer",
      "description": "/optimize rewrites a draft prompt to be clearer and more specific"
    }
  ]
}
```

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`. It then loads twice: once as `@inline` and once as `@jorden-mods`.

## Uninstall

```
claude plugin uninstall prompt-optimizer@jorden-mods
claude plugin marketplace remove jorden-mods
```

## Dev

```
pnpm test
pnpm typecheck
```
