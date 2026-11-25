# claude-kit

A Claude Code plugin marketplace. Each plugin is one self-contained piece;
install any of them on its own. Sync scripts install the same plugins into
[Qwen Code, pi](#qwen-code-and-pi), [OpenCode](#opencode) and [Crush](#crush).

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
| [guards](plugins/guards/) | Command guards: caps unbounded git log, diff and find at 150 lines, trims long Bash and MCP output and saves the full text to a file, caps Reads of large files at 300 lines, forces context-heavy lookups onto a Haiku subagent, blocks commits that skip hooks or fail checks, and, opted in, asks for a browser check after UI edits. |
| [ui-design](plugins/ui-design/) | `/ui-design`, with `new`, `redesign`, `audit`, `apply`, `fix` and `gallery` modes: mockups in the project's own theme, opened in the browser, a consistency audit, fixes for its findings, and a gallery of every saved design and audit. |
| [project-notes](plugins/project-notes/) | Claude writes categorised project notes (`fact`, `finding`, `decision`, `reference`, `debugging`) as Markdown files under `~/.claude/project-notes/<project>/<category>/`; a debugging note must hold the reasoning, steps, evidence, findings, next steps and a drafted Shortcut ticket; `/project-notes organise` files existing session notes the same way |
| [small-plans](plugins/small-plans/) | `/small-plans` breaks work into small plans a weaker model can implement and review, saved under `~/.claude/small-plans/<project>/<set>/`: the work you name, what the conversation leaves, or with `handoff` what a saved handoff leaves; `build` has Haiku agents implement a whole set or one plan while the session reviews and sends back fixes; `rename <set> <new name>` renames a set. |
| [token-ledger](plugins/token-ledger/) | Records each session's token use (main session and subagents, per model, cache reads and writes, tool result size per tool), shows a one-line summary after each turn, prints a report of recent sessions, and suggests `/handoff` then `/clear` when the context grows large. |
| [ledger-tune](plugins/ledger-tune/) | Reads the token-ledger data, recommends changes that cut context, tokens and cost, applies the ones you pick and verifies them against later sessions. |

## Saved notes

Four plugins save Markdown, and they follow one layout:

| Kind | Saved at | Name |
| --- | --- | --- |
| Handoffs | `~/.claude/handoffs/<project>/` | `NNN-<slug>.md` |
| Project notes | `~/.claude/project-notes/<project>/<category>/` | `YYYY-MM-DD-<slug>.md` |
| Small plans | `~/.claude/small-plans/<project>/<YYYY-MM-DD-HHMM-slug>/` | `NN-<slug>.md` |
| Brainstorm plans | `~/.claude/brainstorm/<project>/plans/plan-YYYY-MM-DD-HHMM/` | `NN-<slug>/plan.md` |

- `<project>` is the name of the folder that holds the repository, shared by its git worktrees, or the working folder's name outside git. A session in a Claude Code worktree that git no longer knows (`<repo>/.claude/worktrees/<name>`) still files under `<repo>`
- `/project-notes audit` finds notes, handoffs, plans and brainstorms saved under a worktree's or other folder's name and moves them under the repository's name
- A slug is the title in lowercase letters, digits and hyphens, 60 characters at most
- Handoffs, project notes and small plans start with front matter: `title`, `project`, `created` (UTC), then the fields of their kind. The title is a short name of the work
- Brainstorm plans keep their own format, a `# Plan:` heading with `- Status:` lines, an `index.md` per run and step files, because `check_brainstorm_plan` checks it
- One local web page shows all four, picked from its sidebar: run `claude-notes` in a terminal (see [Notes viewer](#notes-viewer))

## Notes viewer

`claude-notes` serves one local web page with every handoff, project note, small plan and brainstorm plan, picked from its sidebar. It runs from a terminal, not inside a session.

```
ln -s ~/src/claude-kit/notes-viewer/claude-notes ~/.local/bin/claude-notes
claude-notes                  # opens http://127.0.0.1:47618
claude-notes small-plans      # opens on one section: handoffs, project-notes, small-plans or brainstorm
```

- It is a Go program, built on first run and again after the viewer changes, so it needs Go: `brew install go`
- On a machine with only the marketplace, link `~/.claude/plugins/marketplaces/claude-kit/notes-viewer/claude-notes` instead
- Every note and plan has Edit and Delete buttons. A small plan set's heading adds a plan to the set or deletes the whole set. Each delete asks first and can't be undone
- The editor's Project field moves a handoff, project note or small plan to another project. A handoff takes the next free number there, a project note gets `-2` when its name is taken, and a small plan keeps its set and number (refused if that number is taken). Brainstorm plans don't move: each run's `index.md` lists its plans
- A project heading's pencil renames that project's folder in every section and rewrites each note's `project:` line. It is refused when the name is empty, the same, has characters other than letters, digits, `.`, `-` and `_`, or is already taken in any section. Sessions in a repo still write to the folder named after the repo, so rename the repo folder too or new notes land under the old name
- A save is refused, with every problem listed, unless the text follows its section's format. The rules live in `noteFormats` in `notes-viewer/note_format.go` and match what each plugin writes:
  - All: a title of up to 100 characters with a letter or digit, and a body that isn't empty
  - Handoffs, project notes and small plans: front matter of `name: value` lines with `title`, `project` and an ISO `created`. `project` matches the project folder
  - Handoffs also need `cwd`. Project notes need a `category` (fact, finding, decision, reference or debugging) that matches its folder; debugging notes need the six `##` sections the project-notes plugin asks for
  - Small plans: `set`, `order`, `kind` and `status` as small-plans writes them, `order` matching the file number, `depends_on` naming earlier plans, `## Goal`, `## Context`, `## Steps` (1 to 6 numbered), `## Check` (a command in backticks) and `## Review`, and none of the banned vague phrases outside code fences
  - Brainstorm plans: a `# Plan: <title>` first line, a `- Status:` line, `## Context`, `## Steps`, and no banned phrases
- The server only writes files that match a section's note layout, and refuses requests from other hosts or origins. It listens on `127.0.0.1`, port `47618`; `CLAUDE_NOTES_PORT` picks another, `CLAUDE_NOTES_NO_OPEN=1` skips opening the browser
- If it is already running, `claude-notes` opens the same page again. `Ctrl+C` stops it
- The Token use section lists each project's token use from token-ledger's `~/.cache/token-ledger/sessions/`, with a bar against the biggest project and a table of its sessions. It is read-only; `TOKEN_LEDGER_DIR` reads another folder
- The page reloads the notes when you come back to its tab. Raw HTML in a note is not rendered
- It serves `index.html` from the checkout and reloads the page whenever that file is saved. Go changes still need `Ctrl+C` and a rerun

## Set up and update

`claude-kit-update` sets up a machine, installs every claude-kit plugin that is not installed yet, and brings every installed plugin up to date in one run. Each plugin update is recorded as a fix, so `/ledger-tune verify` can compare sessions before and after it. The first run, by its path, links it onto the PATH; after that `claude-kit-update` works from any terminal:

```
~/src/claude-kit/claude-kit-update
```

1. Pulls this checkout (`git pull --ff-only`)
2. Adds the claude-kit marketplace from this checkout if Claude Code does not have it yet
3. Updates every marketplace
4. Updates every installed plugin, from any marketplace, in its own scope
5. Links `claude-notes`, `claude-ledger`, `claude-kit-update` and `claude-kit-doctor` into `~/.local/bin` (`CLAUDE_KIT_LINK_DIR` picks another folder); a real file already at that path is left alone

It needs `git`, `claude` and `jq` on the PATH. A failed pull or update does not stop the others; the run ends by naming each failure and exits 1. Start a new Claude Code session afterwards to load the updated plugins.

`claude-kit-doctor` prints each claude-kit plugin's version in this checkout beside the version Claude Code has installed (from `~/.claude/plugins/installed_plugins.json`), marks each `ok`, `stale` or `not installed`, and exits 1 when any is stale.

### Plugin profiles

Every enabled plugin puts its rules, skills and tool names into each session, whether the project uses them or not. `claude-kit-update profile` turns plugins on and off for one project, so a session loads only what fits it. Run it in the project's folder:

```
claude-kit-update profile web     # code-style, tdd, quality-gates, ui-design, vercel and frontend-design on
claude-kit-update profile code    # code-style, tdd and quality-gates on; ui-design, vercel and frontend-design off
claude-kit-update profile notes   # all six off, for folders of notes and documents
```

- It writes `enabledPlugins` in the project's `.claude/settings.local.json`, which is yours alone, and keeps every other setting in that file
- Plugins it does not name, such as guards and handoff, keep their user-level setting
- It pulls and updates nothing. Start a new Claude Code session in the project to load the profile

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

## Qwen Code and pi

`./sync-qwen` installs the plugins into [Qwen Code](https://github.com/QwenLM/qwen-code)
and `./sync-pi` into [pi](https://github.com/earendil-works/pi). Run one again after
any change here.

```
./sync-qwen              # every plugin
./sync-qwen tdd guards   # only these
./sync-pi                # every plugin with a register.ts module or command hooks, for your user
./sync-pi --local        # for the project in the current folder only
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
- **register.ts plugins** (`brainstorm`, `ui-design`, `draft-pr`, `handoff`,
  `small-plans`, `project-notes`, `prompt-optimizer`) are installed with their MCP server and
  commands. Their `hooks/hooks.json` is dropped so Qwen Code does not warn about an
  invalid `modules` hook event.
- **Output styles** (`adhd-style`) are copied to `~/.qwen/output-styles/`, since Qwen
  Code drops them on install. Pick one with `/output-style`.

`sync-pi` builds each register.ts plugin and each plugin with Claude Code command
hooks as a local pi package under `~/.pi/agent/claude-kit/<plugin>/` and adds it with
`pi install`. It skips output-style plugins. pi has no subagents, so `/brainstorm build`
and the plan clarity pass cannot delegate there.

### How command hooks run in pi

pi has no hook config, so `plugin-host/pi-hooks.ts` runs a plugin's unchanged
`hooks/hooks.json` command hooks inside a pi extension, `pi-hooks-extension.js`. Each
hook gets Claude Code's stdin JSON (`session_id`, `cwd`, `hook_event_name`,
`tool_name`, `tool_input`, `tool_response`, `transcript_path`), and runs with
`CLAUDE_PLUGIN_ROOT` and `CLAUDE_PROJECT_DIR` set.

| Claude Code hook | pi event | What the bridge does |
| --- | --- | --- |
| `SessionStart` | `session_start`, injected by `before_agent_start` | stdout and `additionalContext` reach the first prompt |
| `PreToolUse` | `tool_call` | exit 2 or a deny decision blocks; `additionalContext` is added to that call's result |
| `PostToolUse` | `tool_result` | exit 2 or `decision: "block"` feeds the reason back; `updatedToolOutput` replaces the text |
| `Stop` | `agent_before_settle` | exit 2 or a block decision asks for one more turn, and the follow-up sets `stop_hook_active` |

- Tool names and inputs take Claude Code's shape: `bash` is `Bash`, `edit` is `Edit`
  with `old_string`/`new_string` joined over all its edits, `read` is `Read`, `find` is
  `Glob`, and paths become absolute `file_path`.
- `transcript_path` is a temporary Claude Code-style JSONL of the current branch, with
  user prompts and tool calls. It has no tool results, and bash commands do not count
  as edits.
- `SubagentStop` has no pi event and is skipped. `updatedInput` and `ask` decisions are
  not reproduced. Matching hooks run in parallel and every one runs, even after another
  blocks. When several replace a tool's output, the last replacement wins.

`./sync-pi --local` builds the packages under `.pi/claude-kit/` of the current folder
and lists them in its `.pi/settings.json`, so only that project gets them. This repo
is set up that way: `.pi/settings.json` is committed and the built packages are not,
so run `./sync-pi --local` once after cloning, and again after changing a plugin. pi
asks you to trust the project before it loads them.

`qwen extensions link` does not work here: it wants a `qwen-extension.json` in the source folder.

### OpenCode

`./sync-opencode` installs the plugins into [OpenCode](https://opencode.ai), for your
user. `./sync-opencode tdd guards` syncs only those. It needs `opencode`, `jq`, `rsync`,
`bun` and `node`. `OPENCODE_CONFIG_DIR` overrides `~/.config/opencode`.

- **Skills, commands and agents** are copied to `skills/`, `commands/` and `agents/`
  of the config folder. Claude Code tool names such as `mcp__brainstorm__run_brainstorm`
  become OpenCode's `brainstorm_run_brainstorm`. Agents become subagents: the Claude-only
  `model` is dropped, and a `tools` list becomes `edit`, `bash` and `webfetch` denials.
- **register.ts plugins** run as an MCP server, built like Qwen Code's and declared in
  `opencode.json` under `mcp.servers` (directly under `mcp` for OpenCode 1.x). The
  store is `~/.config/opencode/claude-kit-store/<plugin>.json`.
- **Command hooks** (`tdd`, `guards`, `quality-gates`, and `code-style`'s hooks) run
  through one plugin file each, `plugins/claude-kit-<plugin>-hooks.js`. This needs
  OpenCode 2 or later; on 1.x the script reports them as not ported.
- **Output styles** (`adhd-style`) are listed under `instructions` in `opencode.json`,
  without their frontmatter. The style is always on; OpenCode cannot switch it.
- `claude-kit/<plugin>.files` records what each sync wrote. The next sync deletes those
  files first, and a full sync removes plugins that left the repo. A file it did not
  write is never overwritten: that plugin fails until you move the file away.
- `opencode.jsonc` is never rewritten, since it may hold comments; rename it to
  `opencode.json` or add the MCP server and instructions by hand.

#### How command hooks run in OpenCode

`plugin-host/opencode-hooks.ts` runs a plugin's unchanged `hooks/hooks.json` command
hooks inside an OpenCode server plugin. Each hook gets the same stdin JSON and
environment as in pi, described above.

| Claude Code hook | OpenCode hook | What the bridge does |
| --- | --- | --- |
| `SessionStart` | `context`, the first time a session calls the model | stdout and `additionalContext` are added to the system prompt of every model call |
| `PreToolUse` | `execute.before` | exit 2 or a deny decision fails that call with the reason; `additionalContext` is added to that call's result |
| `PostToolUse` | `execute.after` | exit 2 or `decision: "block"` feeds the reason back; `updatedToolOutput` replaces the text |
| `Stop` | `experimental.idle` | exit 2 or a block decision sends the reason as input, and the next stop sets `stop_hook_active` |

- Tool names and inputs take Claude Code's shape: `shell` is `Bash`, `read` is `Read`,
  `write` is `Write`, `edit` is `Edit` with `old_string`/`new_string`, `subagent` is
  `Agent`, and `path` becomes an absolute `file_path`. A `patch` call becomes one
  `Write` for each added file and one `Edit` for each updated file.
- `transcript_path` is a temporary Claude Code-style JSONL with user prompts and tool
  calls. It has no tool results, so the `guards` lookup budget never fills there.
- `SubagentStop` has no OpenCode hook and is skipped. `SessionStart` and `Stop` hooks do
  not run for a subagent's session. `updatedInput` and `ask` decisions are not reproduced.
- A mistake inside the bridge is logged and never blocks a tool call.
- The bridge is written against the OpenCode 2.3.2 source and tested against a stand-in
  for its plugin API. It has not been run inside OpenCode yet.

### Crush

`./sync-crush` installs the plugins into [Crush](https://github.com/charmbracelet/crush),
for your user. `./sync-crush tdd guards` syncs only those. It needs `crush`, `jq`,
`rsync`, `bun` and `node`. `CRUSH_GLOBAL_CONFIG` overrides `~/.config/crush`. The
generated config was loaded with `crush` 0.96.1.

- **Skills and commands** are copied to `skills/` and `commands/` of the config folder.
  A command shows in the commands palette as `user:<name>` and asks for `ARGUMENTS`.
  Claude Code tool names such as `mcp__brainstorm__run_brainstorm` become Crush's
  `mcp_brainstorm_run_brainstorm`.
- **register.ts plugins** run as an MCP server, built like Qwen Code's. The store is
  `~/.config/crush/claude-kit-store/<plugin>.json`.
- **Rules and output styles** (`context/*.md`, `output-styles/*.md`) are added as
  context files with `option context-path`, without frontmatter. They are always on.
- **Agents** are left out, since Crush has no user-defined subagents. `/brainstorm build`,
  `/small-plans build` and the plan clarity pass cannot delegate there.
- Each plugin gets one config fragment, `claude-kit/<plugin>.crushrc`, and
  `claude-kit/crushrc` sources them all. Your own `crushrc` gets one line that sources
  that file when it exists. Nothing else in `crushrc` or `crush.json` is changed.
- `claude-kit/<plugin>.files` records the skills and commands each sync wrote, with the
  same rules as for OpenCode: a file the script did not write is never overwritten.

#### Which hooks run in Crush

Crush runs hooks before a tool call and at no other time. A plugin lists the hooks that
can run there in `portable-hooks/crush.json`, in the format of `hooks/hooks.json` with
`PreToolUse` as the only event. `plugin-host/crush-hooks.ts` runs them: `bash` is `Bash`,
`view` is `Read`, `edit` and `multiedit` are `Edit`, `write` is `Write`. There is no
`transcript_path`.

| Plugin | Runs in Crush | Stays in Claude Code |
| --- | --- | --- |
| `guards` | the Bash, commit and Read guards | output trim, lookup budget, opt-in browser check |
| `quality-gates` | the fallow gate on commit and push | the verification gate at finish |
| `tdd` | a new implementation file needs a test file written first | recording failing test runs, the green gate at finish |
| `code-style` | the comment and naming checks, which refuse the edit before it lands | the naming review gate at finish |

## Design Studio

A standalone tool, outside any Claude Code session. It writes fresh UI mockups
with a local Qwen model and renders them with the ui-design plugin's own tools.

```
design-studio/cli.ts "Onboarding screen for a recipe app" --variants 2 --size 9b --project ~/src/my-app
```

- It opens a monitor page in the browser: the steps, every model call with its
  token counts and speed, and the model's output as it is written. The same
  steps print in the terminal. `--no-open` leaves the browser alone.
- The model is the claude-lite size you name with `--size`, or claude-lite's
  default. `CLAUDE_LITE_HOME` overrides `~/src/claude-lite`. The size's model
  must already be built (`cl ollama <size>`).
- The project's saved theme (`.claude/ui-design/theme.json`) is reused. With
  none, the studio writes a starter theme from a ui-ux-pro-max palette.
- Each variant follows one ui-ux-pro-max direction. `UI_UX_PRO_MAX_HOME`
  overrides `~/.claude/skills/ui-ux-pro-max`.
- The plugin's `render_design` checks the variants. A refusal goes back to the
  model, twice at most; a variant still refused is dropped.
- The design page lands in `<project>/.claude/ui-design/` and opens in the
  browser. Needs `bun`, `python3` and a running Ollama. Tests: `bun test design-studio`.

## Layout

```
.claude-plugin/marketplace.json   lists every plugin and its folder
plugins/<name>/                   one plugin: its own plugin.json, README, package.json and tests
plugin-host/                      runs register.ts plugins and command hooks outside Claude Code (engine, MCP server, hook bridges, build)
notes-viewer/                     claude-notes: the local web page for saved notes (Go)
design-studio/                    standalone tool: fresh mockups from a local Qwen model, with a live monitor page
sync-qwen, sync-pi, sync-opencode, sync-crush   install the plugins into Qwen Code, pi, OpenCode and Crush
claude-kit-update                 sets up the marketplace, updates every installed plugin
claude-kit-update profile <name>  turns plugins on or off for the project in the current folder
claude-kit-doctor                 compares each plugin's checkout version with the installed one
check                             runs every test suite; --staged runs only staged ones (the pre-commit hook); --changed-since <rev> runs only the ones changed since that commit (CI); fails when a plugin changed since origin/main without a version bump
```

## Rules for plugins

- A plugin never imports, reads or calls another plugin's files. Each is
  installed as a copy of its own folder.
- Code needed by two plugins is copied, not shared. `.fallowrc.json` lists the
  deliberate copies.
- A plugin works when every other plugin is missing.
- To add a plugin: create `plugins/<name>/` with `.claude-plugin/plugin.json`,
  then add an entry to `.claude-plugin/marketplace.json` and a row to the
  plugin table at the top. `tests/repository.test.sh` fails when either is
  missing, and when the two copies of `turn-edits-lib.sh` differ.
- A hook that needs only the tool call, and can run before it, is also listed in
  `portable-hooks/crush.json`, so `sync-crush` installs it.
- A command takes plain words (`save`, `plan`), not dashed flags, and
  completes them: a `prompt.autocomplete` hook in `hooks/register.ts` suggests
  each one with a short description, with a test for it. Copy the pattern from
  `plugins/handoff/` or `plugins/brainstorm/`.

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
