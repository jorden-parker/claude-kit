# claude-kit

A Claude Code plugin marketplace. Each plugin is one self-contained piece;
install any of them on its own.

## Plugins

| Plugin                                        | What it does                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| [prompt-optimizer](plugins/prompt-optimizer/) | `/optimize` rewrites a draft prompt with repo context and fills it into the composer. |
| [handoff](plugins/handoff/)                   | `/handoff` turns the session into a prompt a fresh session can pick up.               |
| [brainstorm](plugins/brainstorm/)             | `/brainstorm`, with `plan` and `build` modes: ideas to plans to code.                 |
| [adhd-style](plugins/adhd-style/)             | Output style: answer first, short chunks, one next step.                              |

## Install

On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install <plugin>@claude-kit --scope user
```

On the dev machine, add the local checkout instead, so edits apply after
`/reload-plugins`:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install <plugin>@claude-kit --scope user
```

Other machines pick up pushed changes with
`claude plugin marketplace update claude-kit`.

To remove the marketplace and every plugin from it:

```
claude plugin marketplace remove claude-kit
```

## Layout

```
.claude-plugin/marketplace.json   lists every plugin and its folder
plugins/<name>/                   one plugin: its own plugin.json, README, package.json and tests
```

## Rules for plugins

- A plugin never imports, reads or calls another plugin's files. Each is
  installed as a copy of its own folder.
- Code needed by two plugins is copied, not shared. `.fallowrc.json` lists the
  deliberate copies.
- A plugin works when every other plugin is missing.
- To add a plugin: create `plugins/<name>/` with `.claude-plugin/plugin.json`,
  then add an entry to `.claude-plugin/marketplace.json`.

## Dev

Each plugin with code is tested on its own:

```
cd plugins/<name>
pnpm test
pnpm typecheck
```
