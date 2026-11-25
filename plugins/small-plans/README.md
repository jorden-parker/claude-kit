# small-plans

Breaks work into small plans, each simple enough for a weaker model to implement and for a second one to review, then has small-model agents build them. The work comes from what you name, from the conversation, or from a saved handoff. The plans are Markdown files on your disk, and a local web page shows them all. Nothing leaves the machine.

## Usage

| Command                                     | What it does                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/small-plans <work to plan>`               | Plans the work you name                                                                      |
| `/small-plans`                              | Plans the work this conversation still leaves to do                                          |
| `/small-plans handoff [id] [extra context]` | Plans the work a saved handoff leaves: one picked from the four newest, or handoff `<id>`    |
| `/small-plans build [set] [order]`          | Builds a whole set or one plan: Haiku implements, the session reviews and sends back fixes   |
| `/small-plans rename <set> <new name>`      | Gives a saved set a new name; its date or handoff prefix stays, and the rest is the new name |
| `/small-plans board`                        | Shows the build board again after you hide it                                                |

Typing `/small-plans ` suggests the actions.

Each planning command has Claude list the work that is left, check it against the project as it is now, and save one plan per small change with the `write_small_plan` tool. Work that waits on a decision only you can make is left out and named in the reply.

No handoff is needed. `handoff` is one source of work among three, and it needs the handoff plugin only to have saved a handoff under `~/.claude/handoffs` (`/handoff save`). Run again on a handoff that already has plans, it keeps them and adds plans only for work they do not cover.

While `build` runs, a build board above the prompt shows each plan as a WAIT, RUN, PASS or FAIL pill with its elapsed time, and stays until you press `h` to hide it or the next build starts. `/small-plans board` shows a hidden board again.

`build` is a command only when it stands as shown: `/small-plans build a login page with tests` plans that work.

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
- `depends_on` is missing (pass `[]` for a plan that needs no other), or names a plan that is not earlier in the order, so the numbers always follow the dependency order
- a plan of the same order is already saved in the set: a saved plan is never replaced. Delete its file to write it again

## Storage

```
~/.claude/small-plans/<project>/<set>/<order>-<slug>.md
~/.claude/small-plans/<project>/<set>/index.md
```

- `<project>` is the repository the plan changes. Claude picks it from the work being planned, not from the folder the session started in, and asks you when more than one repository fits. The folder is named after the repository, shared by its worktrees (the name the handoff plugin uses too), also from a deleted `<repo>/.claude/worktrees/<name>` worktree. Build plans saved for another repository from a session in that repository
- `<set>` groups the plans of one planning run: the date and time (UTC), then a slug of the work, such as `2026-11-19-1542-add-a-dark-mode-toggle`. A set planned from a handoff ends in `handoff-<handoff file name>`, such as `2026-11-19-1542-handoff-007-fix-login`
- `<order>` is the plan's place in the build order, two digits; `<slug>` comes from the title
- Each file starts with front matter: `title`, `project`, `set`, `order`, `kind`, `status`, `depends_on` when it has any, and `created`
- `status` is `pending`, `in-progress`, `done` or `blocked`. The `set_small_plan_status` tool changes it, and only for files under the plans folder
- `index.md` lists every plan of the set in build order: order, linked title, kind, status and depends on. The plugin rewrites it each time a plan is saved, changes status, or is changed with Edit or Write. Do not edit it by hand: the next rewrite replaces it
- Set `SMALL_PLANS_DIR` to keep the plans in another folder. Handoffs are read from `~/.claude/handoffs`, or `HANDOFFS_DIR` when set

The files are plain Markdown: edit, move or delete them with any tool. The claude-notes viewer also rewrites `index.md` when it saves, adds, moves or deletes a plan, and hides it from its list. A change made with any other tool reaches `index.md` at the next save or status change in that set. A set you write by hand builds like any other.

## Build

`/small-plans build` lists this project's four newest sets that still have a plan not done (sets whose plans are all done are left out) and asks which to build (type a name under "Other" for an older set; with one set it skips the question). It then asks whether to build the whole set or one plan of it, listing the plans that are not done (type an order under "Other" for one not listed; with one plan left it skips the question).

- `/small-plans build <text>` picks the newest set whose name holds that text (`build fix-login`, `build 007`)
- `/small-plans build <text> <order>` builds that one plan without asking (`build fix-login 2`)

Before a plan starts, and again when a step or a failure shows one, the build looks for a missing step: something the plan needs that no step provides, such as an uninstalled dependency or a file another plan creates. It adds that step ahead of the one that needs it, or builds the plan that provides it first, and asks you only when only you can supply it.

The session coordinates and reviews; it edits no project file itself. For each plan, in order, the way shadcn's [improve](https://github.com/shadcn/improve) `execute` works:

1. The `small-plan-implementer` agent (Haiku) gets the plan's path, makes the edits and runs the check. It answers `DONE` or `BLOCKED`
2. The `small-plan-checker` agent (Haiku, read-only) runs the check, `git diff --stat`, lint, fallow and the tests, and answers PASS or FAIL for each with the output lines that show it, so that output stays out of the session's context
3. The session reviews the work like a pull request: from the checker's output it confirms the check passed and only files the plan names changed, then reads the diff against each step and `## Review` line, and reads what new tests assert. A failing lint, fallow or test run goes to a Haiku agent to fix
4. On a failed review it writes numbered findings and starts a new implementer with them, then reviews again, up to 3 fix rounds
5. When the implementer stays blocked or the fix rounds run out, the session works out the root cause and keeps fixing, and the plan ends `done`, or `blocked` only when the fix needs the user or two attempts in a row leave the failure unchanged. A plan that depends on one that is not done waits

Nothing is committed: the changes stay in your working tree.

## Viewer

Run `claude-notes` in a terminal to browse every saved note in the browser. See [Notes viewer](../../README.md#notes-viewer).

## Install

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install small-plans@claude-kit --scope user
```

## Develop

```
pnpm test        # claude plugin test .
pnpm typecheck   # once Claude Code has laid .claude-plugin/types/
```
