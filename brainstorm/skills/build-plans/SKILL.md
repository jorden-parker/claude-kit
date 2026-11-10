---
name: build-plans
description: Implement one or more brainstorm plans. The plans live in .claude/brainstorm/plans/ in the project, named plan-YYYY-MM-DD-HHMM.md, and are written by /brainstorm-plan. Use whenever the user asks to implement, build, run or carry out a plan, "the plan", "the latest plan" or several plans, even when they give no path. Delegates each step to small-model subagents and has a strong-model subagent review the work.
---

# Build brainstorm plans

## Find the plans

Plans live in `.claude/brainstorm/plans/` under the project's working directory. Never ask the user where they are.

1. List that folder. File names sort oldest to newest, because they are UTC timestamps.
2. Pick the plans the user means:
   - "the plan", "the latest plan" or no detail: the newest file.
   - A file name, a date, or words from a plan's title: the matching files. Read each plan's first line, `# Plan: <title>`, to match titles.
   - "all of them" or several plans: every matching file, oldest first.
   - A path the user gives: that path, wherever it is.
3. If the folder is missing or empty, say so and suggest `/brainstorm-plan`. If the request could mean different plans, ask with AskUserQuestion, showing each candidate's file name and title.

## Implement them

You coordinate. You do not write code yourself, and you keep your own context small: pass text between agents instead of reading source files. Do one plan at a time, through its final review, before starting the next.

1. Read the plan. If it has no steps, skip it and say so. Run `git rev-parse HEAD` and `git status --short`. Record that commit as the plan's base. If files the plan names already have uncommitted changes that this run did not make, stop and ask the user before going on.
2. For each step, in order, call the Agent tool with subagent_type `brainstorm:step-implementer`. Its prompt is the plan path, the plan's Context section verbatim, and that one step verbatim. Wait for each step before starting the next, because steps build on each other.
3. An implementer replies DONE or BLOCKED. On BLOCKED, call the Agent tool with subagent_type `brainstorm:plan-reviewer`, passing the plan path, the step and the implementer's reply, and ask it to unblock the step. Give its replacement steps to new implementers. If a replacement is blocked too, stop and report.
4. When every step is DONE, call the Agent tool with subagent_type `brainstorm:plan-reviewer` for the final review, passing the plan path and the base commit. It replies APPROVED, or FIXES NEEDED with fix steps in the plan's step format.
5. Give each fix step to a new `brainstorm:step-implementer`, in order, then ask the reviewer for a final review again. Stop after two rounds of fixes, even if fixes remain.
6. Do not commit. For each plan, reply with the steps done, the reviewer's verdict, any fixes still open, and the output of `git diff --stat` against its base.
