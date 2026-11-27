# small-plans

Breaks work into small plans, each simple enough for a weaker model to implement and for a second one to review, then has small-model agents build them. The work comes from what you name, from the conversation, or from a saved handoff. The plans are Markdown files on your disk, and a local web page shows them all. Nothing leaves the machine.

## Usage

| Command                                     | What it does                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/small-plans <work to plan>`               | Plans the work you name                                                                                                                           |
| `/small-plans`                              | Plans the work this conversation still leaves to do                                                                                               |
| `/small-plans handoff [id] [extra context]` | Plans the work a saved handoff leaves: one picked from the list, or handoff `<id>`                                                                |
| `/small-plans build [set] [order]`          | Builds a whole set or one plan: Haiku implements, a Sonnet reviewer reviews and sends back fixes                                                  |
| `/small-plans rename [set] [new name]`      | Gives a saved set a new name; its date or handoff prefix stays. Leave out the name, or both, and Claude finds the set and names it from its plans |
| `/small-plans review [set] [order]`         | Reviews a whole set or one plan: pick the set, then the whole set or one plan; lists proposed changes, then makes them                            |
| `/small-plans board`                        | Shows the build board again after you hide it                                                                                                     |

Typing `/small-plans ` suggests the actions.

Each planning command has Claude list the work that is left, check it against the project as it is now, and save one plan per small change with the `write_small_plan` tool. Work that waits on a decision only you can make is left out and named in the reply.

No handoff is needed. `handoff` is one source of work among three, and it needs the handoff plugin only to have saved a handoff under `~/.local/share/handoffs` (`/handoff save`). Run again on a handoff that already has plans, it keeps them and adds plans only for work they do not cover.

While `build` runs, a build board above the prompt shows each plan as a WAIT, RUN, PASS or FAIL pill with its elapsed time, and stays until you press `h` to hide it or the next build starts. `/small-plans board` shows a hidden board again.

`build` is a command only when it stands as shown: `/small-plans build a login page with tests` plans that work.

## Asking in your own words

Every command has a plain-words form. Claude calls the plugin's tools itself, and finds the set or plan you mean with `list_small_plans`, so you never type an exact name.

| Say                                                    | Claude calls            |
| ------------------------------------------------------ | ----------------------- |
| "Plan this", "break that into small plans"             | `write_small_plan`      |
| "What plans do I have?", "show the login plans"        | `list_small_plans`      |
| "Rename the plans to X", "give that set a better name" | `rename_small_plan_set` |
| "Change plan 3 so that...", "retitle plan 2"           | `update_small_plan`     |
| "Mark plan 2 blocked"                                  | `set_small_plan_status` |

"The plan" in a rename means the set, unless you name one plan by its order or title. Deleting a plan or a set stays with you: delete the file or folder.

### How a set gets its name

Claude names a new set from the work itself, in 2 to 5 words such as `dark-mode-toggle`, and the tool puts the date and time in front. The name never comes from the words of the request: "plan this" names what "this" is. The tool refuses a new name made only of request words (`plan-this`, `the-work`, `next-steps`) and tells Claude to name the work. A set saved under such a name still takes plans.

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
- a plan of the same order is already saved in the set: `write_small_plan` never replaces a saved plan. `update_small_plan` changes its title, kind, body or `depends_on` with the same checks, and renames the file when the title changes. It leaves the order and status alone and refuses a plan that is in-progress

## Storage

```
~/.local/share/small-plans/<project>/<set>/<order>-<slug>.md
~/.local/share/small-plans/<project>/<set>/index.md
```

Plans used to live in `~/.claude/small-plans`; `claude-kit-update` moves that folder to `~/.local/share/small-plans` after updating plugins, leaving any project folder that already exists at the new path in place.

- A plain `project` name that is not an absolute path is used as given, so a plan can belong to a topic that is not a repository; an absolute path is resolved to its repository.
- `<project>` is the repository the plan changes. Claude picks it from the work being planned, not from the folder the session started in, and asks you when more than one repository fits. The folder is named after the repository, shared by its worktrees (the name the handoff plugin uses too), also from a deleted `<repo>/.claude/worktrees/<name>` worktree. Build plans saved for another repository from a session in that repository
- `<set>` groups the plans of one planning run: the date and time (UTC), added by the tool, then the short name Claude gives the work, such as `2026-11-19-1542-dark-mode-toggle`. A later plan saved under the same short name within the hour joins that set; after that the short name starts a new set, and the older one takes plans by its full folder name. A set planned from a handoff ends in `handoff-<handoff file name>`, such as `2026-11-19-1542-handoff-007-fix-login`
- `<order>` is the plan's place in the build order, two digits; `<slug>` comes from the title
- Each file starts with front matter: `title`, `project`, `set`, `order`, `kind`, `status`, `depends_on` when it has any, and `created`
- `status` is `pending`, `in-progress`, `done` or `blocked`. The `set_small_plan_status`, `start_small_plan` and `finish_small_plan` tools change it, and only for files under the plans folder
- `index.md` lists every plan of the set in build order: order, linked title, kind, status and depends on. The plugin rewrites it each time a plan is saved, changes status, or is changed with Edit or Write. Do not edit it by hand: the next rewrite replaces it
- Set `SMALL_PLANS_DIR` to keep the plans in another folder. Handoffs are read from `~/.local/share/handoffs`, or `HANDOFFS_DIR` when set

The files are plain Markdown: edit, move or delete them with any tool. The claude-notes viewer also rewrites `index.md` when it saves, adds, moves or deletes a plan, and hides it from its list. A change made with any other tool reaches `index.md` at the next save or status change in that set. A set you write by hand builds like any other.

## Build

`/small-plans build` opens a pane listing every set of this project that still has a plan not done (newest first; sets whose plans are all done are left out; with one set it skips the pick). Picking a set opens a second pane listing every plan not done, in plan-number order with "Whole set" last (with one plan it skips the pick). Tab moves between rows, Enter picks and Esc closes the pane. Where no pane can open, an ask dialog is the fallback, showing three at a time with an "N more…" option.

- `/small-plans build <text>` picks the newest set whose name holds that text (`build fix-login`, `build 007`)
- `/small-plans build <text> <order>` builds that one plan without asking (`build fix-login 2`)

Before a plan starts, and again when a step or a failure shows one, the build looks for a missing step: something the plan needs that no step provides, such as an uninstalled dependency or a file another plan creates. It adds that step ahead of the one that needs it, or builds the plan that provides it first, and asks you only when only you can supply it.

The session coordinates; it edits no project file and reads no diff itself. For each plan, in order, the way shadcn's [improve](https://github.com/shadcn/improve) `execute` works:

1. The `start_small_plan` tool marks the plan in-progress and creates its worktree, or reuses the one an earlier build left on that branch
2. The `small-plan-implementer` agent (Haiku) gets the plan's path and its worktree, makes the edits and runs the check. It answers `DONE` or `BLOCKED`
3. The `check_small_plan` tool runs the plan's check, lint, fallow and the tests itself, with no agent. It saves their output to `<plan>.check.txt` beside the plan and gives the session one line for each, so that output stays out of the session's context. A failing lint, fallow or test run goes to a new implementer agent to fix, up to 3 rounds
4. The `small-plan-reviewer` agent (Sonnet, read-only) reviews the work like a pull request: it reads the check report, confirms the check passed and only files the plan names changed, reads the diff against each step and `## Review` line, and reads what new tests assert. It answers PASS or FAIL with numbered findings; the plugin saves the findings to `<plan>.review.txt` and hands the session only the path
5. On a FAIL the findings file goes to a new implementer, then the work is checked and reviewed again, up to 3 fix rounds
6. On a PASS the `finish_small_plan` tool commits and pushes the plan's work from its own worktree on its own branch, removes the worktree and marks the plan done; the branch stays. When the implementer stays blocked or the fix rounds run out, the session works out the root cause and keeps fixing, and the plan ends `done`, or `blocked` only when the fix needs the user or two attempts in a row leave the failure unchanged. A plan that depends on one that is not done waits

The start, check and finish tools run git and the plan's check command from the plugin, not through Claude's Bash tool: no Bash guard sees them. The check tool takes the plan's check command as an input and refuses one that differs from the plan file, so the permission prompt for that tool call shows the exact command before it runs. Build only plans whose check command you would let Claude run.

Work left uncommitted in the checkout where the build started is offered to you, with a question, to commit and push as conventional commits.

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

## Planning levels

New plans choose **direct** for one bounded change, **standard** for related multi-step work, and **detailed** for explicit exact edits or demonstrated worker ambiguity. Existing plans without a level remain detailed and continue to use the full workflow described above. Direct plans implement, check and review directly; standard plans use one worker and one review, resuming corrections when supported. Detailed plans retain exact edits and separate reviewers. All levels preserve status, worktrees, acceptance checks and publishing requirements. A context reset is optional at a task boundary when old context is irrelevant.
