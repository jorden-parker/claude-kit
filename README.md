# claude-kit

A Claude Code plugin marketplace. Each plugin is one self-contained piece;
install any of them on its own.

## Plugins

| Plugin                                        | What it does                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| [prompt-optimizer](plugins/prompt-optimizer/) | `/optimize` rewrites a draft prompt with repo context and fills it into the composer. |
| [handoff](plugins/handoff/)                   | `/handoff` turns the session into a prompt a fresh session can pick up.               |
| [brainstorm](plugins/brainstorm/)             | `/brainstorm`, with `plan` and `build` modes: ideas to plans to code.                 |
| [draft-pr](plugins/draft-pr/)                 | `/draft-pr`, `/draft-pr-review`: drafts in the browser, posted only when you click.   |
| [adhd-style](plugins/adhd-style/)             | Output style: answer first, short chunks, one next step.                              |
| [code-style](plugins/code-style/) | Writes the comment and naming rules into each session and blocks edits that break them. |
| [tdd](plugins/tdd/) | Enforces red, green, refactor: blocks implementation edits until a failing test run and finishing while tests fail. |
| [quality-gates](plugins/quality-gates/) | Blocks commits and pushes that fail fallow audit, and finishing a code change with no verification. |
| [guards](plugins/guards/) | Command guards: denies unbounded git log, diff and find, trims long Bash output, limits Reads of large files, blocks commits that skip hooks or fail checks, and asks for a browser check after UI edits. |
| [design](plugins/design/) | `/design`, with `new`, `redesign`, `audit` and `apply` modes: mockups in the project's own theme, opened in the browser, and a consistency audit. |
| [session-notes](plugins/session-notes/) | Notes each session's prompts, edited files and commands outside Claude's context; `/notes` shows them in a pane. |

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

Run this once per clone. Git then runs Prettier, the type check and the
tests of every plugin with staged changes before each commit:

```
git config core.hooksPath .githooks
```
