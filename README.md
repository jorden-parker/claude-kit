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
| [session-notes](plugins/session-notes/) | Keeps Claude's notes for each session, what is left to do first, outside Claude's context; `/notes` shows them in a pane. |

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

To put the `session-notes` shell command on your PATH, run from the checkout:

```
./install-session-notes
```

To remove the marketplace and every plugin from it:

```
claude plugin marketplace remove claude-kit
```

## Qwen Code and pi

`./sync-qwen` installs the plugins into [Qwen Code](https://github.com/QwenLM/qwen-code)
and `./sync-pi` into [pi](https://github.com/earendil-works/pi). Run one again after
any change here.

```
./sync-qwen              # every plugin
./sync-qwen tdd guards   # only these
./sync-pi                # every register.ts plugin
```

Both need `jq`, `rsync`, `bun` and `node`, plus `qwen` or `pi`. `QWEN_HOME` overrides
`~/.qwen` and `PI_CODING_AGENT_DIR` overrides `~/.pi/agent`. Checked against `qwen`
0.25.0 and `pi` 0.87.1.

### How register.ts plugins run there

Neither tool can load `register.ts`, Claude Code's plugin-module API. `plugin-host/`
runs the unchanged module with a stand-in engine (real files, processes and a JSON
store) and offers what it registers to each tool in the form that tool loads:

| | Qwen Code | pi |
| --- | --- | --- |
| Tools | an MCP server, declared in the extension's `.mcp.json` | a pi extension that calls `pi.registerTool` |
| Slash commands | `commands/<name>.md` | prompt templates, `prompts/<name>.md` |
| Store | `~/.qwen/claude-kit-store/<plugin>.json` | `~/.pi/agent/claude-kit-store/<plugin>.json` |

- Tools keep their Claude Code names, such as `mcp__brainstorm__render_brainstorm`,
  so the skills call them unchanged.
- Each registered command also becomes a tool, `mcp__<plugin>__run_<command>`. The
  generated slash command tells the model to call it with the arguments and to do
  what the reply says, so the command's real logic runs.
- To word a command yourself, add `portable-commands/<name>.md` to the plugin, with
  `{{args}}` where the arguments go. It replaces the generated command on both tools.
  `handoff` does this because the model writes the recap itself, and
  `prompt-optimizer` because `/optimize` is only a prompt there.
- Left in Claude Code, because neither tool has a place for them: panes, flag and
  mode autocomplete, filling the composer, toasts, and starting a new session from a
  command. A plugin's start-up host commands do not run either.

### What each script installs

`sync-qwen` uninstalls each earlier sync and installs it fresh, since
`qwen extensions update` skips local plugins whose version did not change. Qwen Code
reads `.claude-plugin/plugin.json` itself and converts skills, agents, hooks and MCP
servers on install.

- **Hook and skill plugins** (`tdd`, `code-style`, `quality-gates`, `guards`) are
  installed as they are. Hooks that read Claude Code's transcript format may never
  block in Qwen Code; the script warns for each.
- **register.ts plugins** (`brainstorm`, `design`, `draft-pr`, `handoff`,
  `session-notes`, `prompt-optimizer`) are installed with their MCP server and
  commands. Their `hooks/hooks.json` is dropped so Qwen Code does not warn about an
  invalid `modules` hook event.
- **Output styles** (`adhd-style`) are copied to `~/.qwen/output-styles/`, since Qwen
  Code drops them on install. Pick one with `/output-style`.

`sync-pi` builds each register.ts plugin as a local pi package under
`~/.pi/agent/claude-kit/<plugin>/` and adds it with `pi install`. It skips hook-only
and output-style plugins: pi runs no Claude Code hooks. pi has no subagents, so
`/brainstorm build` and the plan clarity pass cannot delegate there.

`qwen extensions link` does not work here: it wants a `qwen-extension.json` in the source folder.

## Layout

```
.claude-plugin/marketplace.json   lists every plugin and its folder
plugins/<name>/                   one plugin: its own plugin.json, README, package.json and tests
plugin-host/                      runs register.ts plugins outside Claude Code (engine, MCP server, pi extension, build)
sync-qwen, sync-pi                install the plugins into Qwen Code and pi
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
