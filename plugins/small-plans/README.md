# small-plans

Breaks work into small plans, each simple enough for a weaker model to implement and for a second one to review, then has small-model agents build them. The work comes from what you name, from the conversation, or from a saved handoff. The plans are Markdown files on your disk, and a local web page shows them all. Nothing leaves the machine.

## Usage

| Command                                     | What it does                                                         |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `/small-plans <work to plan>`               | Plans the work you name                                              |
| `/small-plans`                              | Plans the work this conversation still leaves to do                  |
| `/small-plans handoff [id] [extra context]` | Plans the work a saved handoff leaves: the newest, or handoff `<id>` |
| `/small-plans build [set]`                  | Has small-model agents implement and review each plan of a set       |
| `/small-plans open`                         | Opens every plan in the browser                                      |

Typing `/small-plans ` suggests the actions.

Each planning command has Claude list the work that is left, check it against the project as it is now, and save one plan per small change with the `write_small_plan` tool. Work that waits on a decision only you can make is left out and named in the reply.

No handoff is needed. `handoff` is one source of work among three, and it needs the handoff plugin only to have saved a handoff under `~/.claude/handoffs` (`/handoff save`). Run again on a handoff that already has plans, it keeps them and adds plans only for work they do not cover.

`open` and `build` are commands only when they stand as shown: `/small-plans build a login page with tests` plans that work.

You can also ask in your own words ("break this into small plans"); Claude calls the same tool.

## What a plan holds

A plan is one change: one goal, at most 6 steps, few files. Its body has five `## ` headings:

1. `## Goal`: one sentence on what is true when the plan is done
2. `## Context`: the files, names and decisions the implementer cannot guess. The implementer sees this plan only, never the conversation it came from
3. `## Steps`: a numbered list, each step one edit with its file and place
4. `## Check`: a command in backticks and the output to expect
5. `## Review`: the facts a reviewer confirms by reading the diff

The tool refuses a plan, and names every problem at once, when:

- a heading is missing, or `## Steps` has no numbered list or more than 6 steps
- `## Check` has no command in backticks
- the prose holds vague wording: "as appropriate", "if needed", "as needed", "where appropriate", "consider", "similar to", "etc.", "and so on", "you may", "TODO" (code fences are exempt)
- the kind is not one of `feature`, `fix`, `refactor`, `test`, `docs`, `chore`
- `depends_on` names a plan that is not earlier in the order
- a plan of the same order is already saved in the set: a saved plan is never replaced. Delete its file to write it again

## Storage

```
~/.claude/small-plans/<project>/<set>/<order>-<slug>.md
```

- `<project>` is the folder of the repository, shared by its worktrees (the name the handoff plugin uses too)
- `<set>` groups the plans of one planning run: the date and time (UTC), then a slug of the work, such as `2026-11-19-1542-add-a-dark-mode-toggle`. A set planned from a handoff ends in `handoff-<handoff file name>`, such as `2026-11-19-1542-handoff-007-fix-login`
- `<order>` is the plan's place in the build order, two digits; `<slug>` comes from the title
- Each file starts with front matter: `title`, `project`, `set`, `order`, `kind`, `status`, `depends_on` when it has any, and `created`
- `status` is `pending`, `in-progress`, `done` or `blocked`. The `set_small_plan_status` tool changes it, and only for files under the plans folder
- Set `SMALL_PLANS_DIR` to keep the plans in another folder. Handoffs are read from `~/.claude/handoffs`, or `HANDOFFS_DIR` when set

The files are plain Markdown: edit, move or delete them with any tool. A set you write by hand builds like any other.

## Build

`/small-plans build` builds this project's newest set; `/small-plans build <text>` builds the newest set whose name holds that text (`build fix-login`, `build 007`). The session coordinates and edits nothing itself. For each plan that is not done, in order:

1. The `small-plan-implementer` agent (Haiku) gets the plan's path, makes the edits and runs the check. It answers `DONE` or `BLOCKED`
2. The `small-plan-reviewer` agent (Haiku) gets the same path, reads the diff, runs the check and confirms each `## Review` line. It answers `PASS` or `FAIL` with findings
3. On `FAIL` the implementer gets the findings once, then the reviewer looks once more
4. The plan ends `done` or `blocked`. A plan that depends on one that is not done waits

Nothing is committed: the changes stay in your working tree.

## Viewer

`/small-plans open` opens every plan in your browser. It starts a small local web server (a Go program, built on first run, so it needs Go once: `brew install go`) and opens the page.

- The sidebar is grouped by project, then by set with the newest first, then lists the plans in build order
- Each set shows how many of its plans are done; each plan shows its kind and status
- The plan shows rendered Markdown. Raw HTML in a plan is not rendered
- The page reloads the plans when you come back to its tab
- The same page serves all four kinds of saved notes: Handoffs, Project notes, Small plans and Brainstorm plans. Pick one at the top of the sidebar. `/small-plans open` opens it on Small plans
- The server only reads the notes. It listens on `127.0.0.1`, port `47618`; set `CLAUDE_NOTES_PORT` to pick another, or `CLAUDE_NOTES_NO_OPEN=1` to skip opening the browser
- The handoff, project-notes and small-plans plugins each ship the same viewer, so any one of them is enough to run it
- It keeps running after the session ends. Running `/small-plans open` again reopens the same page

From a terminal: `bash ~/src/claude-kit/plugins/small-plans/bin/small-plans` runs it in the foreground; `Ctrl+C` stops it.

## Install

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install small-plans@claude-kit --scope user
```

## Develop

```
pnpm test        # claude plugin test . and go test in web/
pnpm typecheck   # once Claude Code has laid .claude-plugin/types/
```
