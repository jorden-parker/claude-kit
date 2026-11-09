# session-recap

`/handoff [focus]` summarizes the current session into a prompt a fresh session can pick up (goal, what is done, what is left, files and commands mentioned, open questions), then fills it into the composer so you can edit it or press Enter. An optional focus argument centers the recap on one topic.

## Usage

`/handoff` recaps the whole session.

`/handoff the failing test` centers the recap on the failing test.

The recap uses the last 40 messages of the conversation. Nothing beyond the conversation is added. With no messages it says "Nothing to recap yet."

When the composer cannot take the text (a headless run, or a dialog holding the keys), the recap is copied to the clipboard and printed instead. The recap is also handed to the model as hidden context, so a follow-up like "continue from that" refers to the recap.

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/mods
claude plugin install session-recap@jorden-mods --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/mods
claude plugin install session-recap@jorden-mods --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`. It then loads twice: once as `@inline` and once as `@jorden-mods`.

## Uninstall

```
claude plugin uninstall session-recap@jorden-mods
claude plugin marketplace remove jorden-mods
```

## Dev

```
pnpm test
pnpm typecheck
```
