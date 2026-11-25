---
name: build-plans
description: Implement brainstorm plans from ~/.claude/brainstorm/<project>/plans/. Each run folder (plan-YYYY-MM-DD-HHMM/) holds index.md, which lists every plan with its status and build order, and one folder per plan with its plan.md and step files. Use whenever the user asks to implement, build, run, resume or carry out a plan, "the plan", "the latest plan", several plans or a plan path, even when they give no path. Checks each run, delegates each plan's steps to one small-model subagent, has a strong-model subagent review the finished work, and records each plan's status in its plan.md and in the index.
user-invocable: false
---

# Build brainstorm plans

You coordinate the build. You do not write source code. You keep your own context small: pass paths between agents, never file contents.

Every agent you start makes this session re-read its whole context, so a long session makes every step cost more. When this session already holds the planning conversation or other long work, say so in one line before the first agent: `/clear`, then `/brainstorm build`, is cheaper. Then carry on with the build unless the user stops you.

You write only inside a run folder, and only two things: the checkbox lines of a plan.md, and the step files the reviewer returns. The implementer ticks the lines it builds. The only commits are the ones the final review's step 2 makes, after the reviewer approves a plan, and the leftover-work commits at the end of the build.

## The files

- Run folder: `plan-YYYY-MM-DD-HHMM/`, written by one `/brainstorm plan`. It holds index.md and one plan folder per plan.
- index.md: the index of the run. Its table has one row per plan, in build order: the link to the plan.md, the status, the kind, and the plans it depends on.
- Plan folder: `NN-slug/`. Its plan.md has the plan's own `- Status:` line and one checkbox line per step. Each line links one step file.
- Status: `pending`, `in-progress`, `done` or `blocked`. A plan.md and its index.md row always show the same status.

Two tools work on these files. If a tool's schema is not loaded, load it with ToolSearch first.

- `mcp__brainstorm__check_brainstorm_plan` with `{ "path": "<absolute run folder>" }` checks a run. It replies `OK`, or one problem per line.
- `mcp__brainstorm__set_brainstorm_plan_status` with `{ "path": "<absolute plan folder>", "status": "<status>" }` writes a status to the plan.md and to its index.md row. Every status change goes through this tool. Never edit a status by hand.

## Find the runs

The request names the runs: in the user's own words, or in the `<runs>` block that `/brainstorm build` passes on unchanged.

If it gives paths, use them as they are, and skip the rest of this section. A relative path is under the plans folder. A path to a plan folder means: build only that plan of its run.

Otherwise list the plans folder. `/brainstorm build` names it in its prompt. With no such prompt it is `~/.claude/brainstorm/<project>/plans/`, where `<project>` is the name of the folder that holds the repository (for a git worktree, the main repository's folder), or the working directory's name outside git. Never ask the user where the plans are. The run folders are the entries named `plan-YYYY-MM-DD-HHMM`. The names are UTC timestamps, so they sort oldest to newest.

- "the plan" or "the latest plan": the newest run.
- No detail: the only run when there is one. With more, ask with AskUserQuestion which run to build, listing the four newest runs newest first, each option labelled with the run folder name and described by its title.
- A name, a date, or words from a title: the matching runs. A run's title is the `# Plans:` line of its index.md, and the table below it has each plan's title.
- "all of them" or several runs: every matching run, oldest first.
- One plan of a run: that run, building only that plan.

If there is no run folder, say so and suggest `/brainstorm plan`. If the request could mean different runs, ask with AskUserQuestion, showing each candidate's name and title.

## Build a run

1. Check the run with the check tool.
2. If the reply is not `OK`:
   1. Call the Agent tool with subagent_type `brainstorm:plan-reviewer`. Its prompt is the word "repair", the absolute run folder path, and the problem lines verbatim.
   2. Write each file it returns over the existing file with the same path.
   3. Check the run again. If problems remain, stop this run: build none of its plans, and report the problem lines.
3. Read index.md. Go through its rows in order, one plan at a time. Read index.md again before each plan, because statuses change as you build.
   - Status `done`: the plan is already built. Leave it.
   - A plan in its Depends on column is not `done`: skip the plan and leave its status as it is.
   - Otherwise build the plan, through to its final review, before you start the next one.

## Build a plan

A `pending` plan starts at its first step. An `in-progress` or `blocked` plan was started by an earlier build: it carries on at its first unticked line.

Before you start a plan, and again whenever a step or a failure shows it, look for a missing step: anything the plan needs that none of its steps provides, such as a dependency that is not installed, a migration, generated code, a config value, or a file or function that another plan creates. Do not build on and wait for it to fail. Take the missing step first: write its step file into the plan folder and add an unticked line for it in plan.md ahead of the step that needs it, so `brainstorm:step-implementer` does it, or, when another plan in the index provides it, build that plan first and base this plan's branch on it. Ask the user only when the missing step needs something only the user can give.

1. Create or reuse the plan's worktree, as "Worktrees" says, and note its path and branch.
2. Base: run `git -C <worktree> rev-parse HEAD` and keep that commit as this plan's base.
3. Set the plan's status to `in-progress`.
4. Build the unticked lines of plan.md, as "Build the steps" says.
5. When every line is ticked, do the final review.

Whenever these steps say the plan stops, do not stop there. Read the failing output, the plan and the code it touches, work out the root cause, and fix it: start a new `brainstorm:step-implementer` agent with the failure output and the cause you found, or correct the plan file when the plan itself is wrong, then run the checks and the final review again, as this skill says. Keep going while each attempt changes the failure. Set the plan's status to `blocked` only when the fix needs something only the user can give (a decision, a credential, access), or when two attempts in a row leave the failure unchanged; the reason then says what you tried and what is still needed. Keep its worktree so the next build carries on there, and go on with the next row of the index.

### Worktrees

Each plan is built in its own git worktree, on its own branch:

- Branch name: read the repository's own rules first: CONTRIBUTING.md, CLAUDE.md, AGENTS.md, and the guides under .github/ and docs/, then the names `git branch -a --sort=-committerdate | head -n 20` shows. Where the repository states a convention, as a work repository does, follow it exactly, ticket number and all. Only when it states none, name the branch `<type>/<plan slug>`, the type from the plan's Kind in the index: feat for code, test, docs, or spike for a spike plan.
- Base: the branch of the plan it depends on, when it depends on one; otherwise the branch checked out where the build started.
- Place: run `git rev-parse --git-common-dir`. When `git -C <that folder> rev-parse --is-bare-repository` prints true, the repository is bare: put the worktree beside the main worktree, as a sibling folder. In any other repository, put it beside the repository's top folder. Either way the folder is named after the plan slug alone, such as `add-login` for the branch `feat/add-login`: no type, no repository name and no ticket prefix. When a folder of that name already exists and is not this plan's worktree, add `-2`. Never put it inside the repository.
- Create it with `git worktree add -b <branch> <path> <base>`. When `git worktree list` already shows a worktree on that branch, left by an earlier build, reuse it.
- Run every git command, check, lint, fallow and test of the plan in its worktree, as `cd <path> && ...` or `git -C <path> ...`.

### Build the steps

One implementer builds the whole plan. It takes every unticked line of plan.md in file order, ticks each line when its step is done, and stops at the first step it cannot finish. Never call the implementer once per step.

1. Call the Agent tool with subagent_type `brainstorm:step-implementer`. Its prompt is the absolute plan folder path, then a line `Worktree: <path>`, and nothing else.
2. On DONE, read plan.md. If a line is still unticked, the plan stops. Otherwise the steps are built.
3. On BLOCKED, the reply's `Step:` line names the step that blocked. Every line before it is ticked. Retry once: the same subagent_type with `model: "sonnet"`. Its prompt is the absolute plan folder path, the `Worktree: <path>` line, a blank line, then the BLOCKED reply verbatim. The retry carries on at the blocked step and goes on with the lines after it.
4. If the retry is BLOCKED on the same step, call the Agent tool with subagent_type `brainstorm:plan-reviewer`. Its prompt is the word "unblock", the absolute step path, and both replies verbatim.
   - If it replies PLAN WRONG, the plan stops. Report its explanation.
   - Otherwise it returns replacement step files: `step-NNa.md`, `step-NNb.md`, and so on. Write them into the plan folder. Delete the blocked `step-NN.md`, because the checker reports a step file that plan.md does not list. In plan.md, replace the blocked step's line with one unticked line for each replacement, in order. Then start again at 1.
5. Treat every later reply the same way. A step's first BLOCKED gets the retry, and its second gets the unblock. A replacement step written in this build gets neither: if a reply is BLOCKED on one, the plan stops.

### Final review

1. Call the Agent tool with subagent_type `brainstorm:plan-reviewer`. Its prompt is the word "final review", the absolute plan folder path, the base commit, and the line `Worktree: <path>`.
2. If it replies APPROVED, commit and push that work in the plan's worktree: stage everything changed there, the plan's edits and its guard fixes; match the style of `git log --oneline -n 10`; commit with one short conventional subject line, such as `git commit -m "feat(scope): add the toggle"`, with no body and no Co-Authored-By or other attribution line; then run `git push -u origin <branch>` and `git worktree remove <path>`, which keeps the branch. Never commit or push work the review has not approved. If the commit or push fails, keep the worktree and say so in the plan's report line. Then set the plan's status to `done`.
3. If it replies FIXES NEEDED, it returns fix steps as more step files. Write them into the plan folder, and add one unticked line for each at the end of `## Steps` in plan.md: `- [ ] [step-NN](step-NN.md): <title>`.
   - If this build has already done two fix rounds for this plan, the plan stops. Its unticked lines are the open fixes, and the next build picks them up.
   - Otherwise build those lines as "Build the steps" says, with one implementer call for all of them, then do the final review again.

### Spike plans

A spike plan (Kind `spike` in the index) uses the same flow. Its steps write findings.md in the plan folder, and the final review checks that findings.md answers every question. When a spike plan is `done`, report the findings path and say that the idea needs a new `/brainstorm plan` run before anything is changed.

### Leftover work

When every plan is handled, commit and push the leftover work too, in the checkout where the build started: run `git status --short` and `git log --oneline -n 50 @{u}..`. Group the uncommitted changes that are left, including ones from before this build, into logical commits, one per concern, each with one short conventional subject line in the style of `git log --oneline -n 10`, with no body and no Co-Authored-By or other attribution line. Never commit a file that holds a secret, such as `.env`. Then run `git push` so no commit is left unpushed. If a commit or push fails, say so in the report.

## Report

When every run is handled, reply with one block per plan you built or skipped:

- Plan: its plan folder path.
- Branch: the plan's branch, and its worktree path while the worktree is kept.
- Status: the status it has now. For `blocked`, the reason it stopped. For a skipped plan, the dependency that is not `done`.
- Steps: how many lines are ticked, out of how many.
- Open fixes: the title of each unticked fix line, or "none".
- Diff: the output of `git diff --stat <base>`.
- For a spike: the findings path.

For a run the checker stopped, list its problem lines instead.
