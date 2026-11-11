---
name: build-plans
description: Implement brainstorm plans from .claude/brainstorm/plans/. A plan is a run folder (plan-YYYY-MM-DD-HHMM/ with index.md, plan folders and step files) or a legacy single file (plan-YYYY-MM-DD-HHMM.md). Use whenever the user asks to implement, build, run or carry out a plan, "the plan", "the latest plan", several plans or a plan path, even when they give no path. Checks each run, delegates each step to small-model subagents, and has a strong-model subagent review the finished work.
---

# Build brainstorm plans

You coordinate the build. You do not write source code. You keep your own context small: pass paths between agents, never file contents. You may write files inside a plan folder: ticking checkboxes, and writing the replacement and fix step files the reviewer returns. Write nothing else.

Do not commit anything.

## Find the plans

Plans live in `.claude/brainstorm/plans/` under the project's working directory. Never ask the user where they are.

If the user or the command already gave paths, use them as they are, resolved against the working directory, and skip the rest of this section.

Otherwise:

1. List that folder. Names sort oldest to newest, because they are UTC timestamps. A run folder and a legacy file with the same timestamp are the same run.
2. Pick the plans the user means:
   - "the plan", "the latest plan" or no detail: the newest entry.
   - A name, a date, or words from a title: the matching entries. A run's title is the `# Plans:` line of its index.md. A legacy file's title is its `# Plan:` line.
   - "all of them" or several plans: every matching entry, oldest first.
   - A path the user gives: that path, wherever it is.
3. If the folder is missing or empty, say so and suggest `/brainstorm-plan`. If the request could mean different entries, ask with AskUserQuestion, showing each candidate's name and title.

## Build a run

Work through the plans in each run one at a time. Finish one plan through its final review before starting the next.

1. Run `git rev-parse --short HEAD` and compare it with the "Written against" line in the run's index.md. If they differ, note that for the report and carry on.
2. Check the run. Call `mcp__brainstorm__check_brainstorm_plan` with `{ "path": "<absolute run folder>" }`. If its schema is not loaded, load it with ToolSearch first. The reply is `OK`, or one problem per line.
3. If the reply is not `OK`:
   1. Call the Agent tool with subagent_type `brainstorm:plan-reviewer`. Its prompt is the word "repair", the absolute run folder path, and the problem lines verbatim.
   2. Write each file it returns over the existing file with the same path.
   3. Check the run again. If problems remain, stop this run: build none of its plans, and report the problem lines.
4. Read index.md. Build the plans in its Order section, skipping any whose dependency did not finish (see below). Each plan is a plan folder, as described next.

## Build a plan folder

1. Read the `Kind` and `Depends on` lines of the plan's plan.md. Use the folder's own name in reports.
2. Dependencies: a plan has finished when its final review returned APPROVED in this run, or when every line in its plan.md was already ticked before this run started. If any dependency did not finish, skip this plan, say so in the report, and go on with the plans that do not depend on it.
3. Uncommitted changes: run `git status --short`. Get the files this plan names with `grep -h -- '- File:' <plan folder>/step-*.md`. If one of those files is already dirty, and no earlier plan in this run changed it, stop and ask the user with AskUserQuestion before building this plan.
4. Record a base: run `git stash create`. If it prints nothing, use `git rev-parse HEAD`. Keep that commit as this plan's base.
5. Build the unticked lines of plan.md in file order. The `## Steps` lines come first, then any lines under `## Fixes`. Skip the lines already ticked `- [x]`, so a resumed build picks up at the first unticked line.
6. For each unticked line, call the Agent tool with subagent_type `brainstorm:step-implementer`. Its prompt is the absolute path of that line's step file, and nothing else. Wait for the reply before the next line.
7. On DONE, change that line's `- [ ]` to `- [x]` in plan.md.
8. On BLOCKED, retry once: call the Agent tool with subagent_type `brainstorm:step-implementer` and `model: "sonnet"`. Its prompt is the absolute step path, a blank line, then the first BLOCKED reply verbatim. On DONE, tick the line as in step 7.
9. If the retry is BLOCKED too, call the Agent tool with subagent_type `brainstorm:plan-reviewer` for the unblock job. Its prompt is the word "unblock", the absolute step path, and both replies verbatim.
   - If it replies PLAN WRONG, stop this plan, report its explanation, and skip the plans that depend on it.
   - Otherwise it returns replacement step files: `step-NNa.md`, `step-NNb.md`, and so on. Write them into the plan folder. Delete the blocked `step-NN.md`, because the checker would report a step file that plan.md does not list. In plan.md, replace the blocked step's line with one unticked line for each replacement, in order.
   - Build the replacement lines as in step 6. If a replacement is BLOCKED, do not retry or unblock it: stop this plan, report it, and skip the plans that depend on it.
10. When every line in plan.md is ticked, call the Agent tool with subagent_type `brainstorm:plan-reviewer` for the final review. Its prompt is the word "final review", the absolute plan folder path, the base commit, and the fix round number: 1 for the first review, then one more after each fix round.
11. If it replies APPROVED, the plan is finished. Go to the report.
12. If it replies FIXES NEEDED:
    - If two fix rounds are already done, do not build more. Report the fixes as open.
    - Otherwise write each fix file it returns into the plan folder, using the names it gives (`fix-R-NN.md`). Under `## Fixes` in plan.md, create the heading just before `## Done criteria` if it is missing, then add one unticked line per fix: `- [ ] [fix-R-NN](fix-R-NN.md): <title>`. Build those lines as in steps 6 to 9, then go back to step 10.

Legacy single-file plans have no checker and no checkboxes. Their steps are `### Step N` sections under `## Steps`. Do this instead:

- Read the file once, to get its Context section and its steps. Record the base as in step 4 of the plan folder flow.
- For each step, call the Agent tool with subagent_type `brainstorm:step-implementer`. Its prompt is the plan file path, the plan's Context section verbatim, and that one step verbatim. Do not write any files.
- BLOCKED: retry once with `model: "sonnet"`, with the same prompt followed by the first reply. Then unblock with `brainstorm:plan-reviewer`, passing the plan path, the step and both replies. Give its replacement steps to new implementers in the same prompt form. A replacement that is BLOCKED or a PLAN WRONG reply stops the plan.
- Final review: `brainstorm:plan-reviewer` with the word "final review", the plan file path, the base and the fix round number. The fix steps come back as text. Give each one to an implementer in the same prompt form, then review again, under the same two-round limit.

Spike plans (`Kind: spike`) use the same folder flow. Their steps write findings.md. The final review checks that findings.md answers every question. When a spike plan finishes, report the findings path and say that the idea needs a new `/brainstorm-plan` run before anything is changed.

## Report

When every plan is handled, reply with one block per plan:

- Plan: its folder or file path, and whether it is a run's plan or a legacy file.
- Steps: how many lines were ticked, out of how many, including fixes.
- Verdict: APPROVED, or the reason it stopped.
- Open fixes: each fix title still open, or "none".
- Skipped: plans skipped, and why.
- Diff: the output of `git diff --stat <base>`.
- For a spike: the findings path.

For each run, also say whether its commit differs from the one it was written against, and list any problem lines that stopped it.
