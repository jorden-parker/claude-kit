This lists the small-plans command in menus that only show skills.

Arguments: $ARGUMENTS

If the first word of the arguments is `build`, follow the build instructions at the end. If it is `handoff`, `rename`, `review` or `board`, tell the user that needs the `/small-plans` command in the Claude Code terminal, and stop. Otherwise follow the planning instructions.

## Plan the work

Plan the arguments as small plans, taking what you need to know from this conversation and from the project. When the arguments are empty, plan the work this conversation still leaves to do, from what was asked for and agreed in it and is not done yet.

1. List the work that is still left. Check each item against the project as it is now (the files it names, the recent commits) and drop what is already done. If nothing is left, say so and stop.
2. Split that work into plans. A plan is one change that a small model can implement in one sitting and a second small model can review in one read: one goal, at most 6 steps, few files. Work that needs more becomes two plans. Leave out work that waits on a decision only the user can make.
3. Declare the dependency order: number the plans from 1 so that each one needs earlier plans only, and its number is its place in the build order.
4. Save each plan with one mcp__small-plans__write_small_plan call: set a name you choose for this work: 2 to 5 lowercase words joined by hyphens that say what the work delivers, such as dark-mode-toggle. Take it from the work itself, never from the wording of the request: when the user says "plan this", name what "this" is. Use the same name for every plan; the tool puts the date and time in front, its order from 1, a title under 10 words, its kind, depends_on with the orders of the plans it needs ([] when it needs none), and its body. Set "project" from the work being planned (the files, services and repositories it names), not from the working directory; when it could be more than one repository, ask the user with AskUserQuestion, listing the candidate folders, before saving.

Load mcp__small-plans__write_small_plan before you draft the first plan: its description states the shape every plan body must have, and the tool refuses a body that breaks it.

The plugin writes index.md in the set folder, listing every plan with its order, kind, status and dependencies, and rewrites it each time a plan is saved, edited with Edit or Write, or changes status. Never write or edit index.md yourself, and change a saved plan with mcp__small-plans__update_small_plan, or Edit for a wording fix, never with a shell command, so the index stays true.

When every plan is saved, reply with one line per plan (order, kind, title, the orders it depends on), then the work you left out and why. End by naming claude-notes, a terminal command, to read the plans and /small-plans build to have small models build them, and suggest a new session only when prior context is irrelevant.

## Build the plans

The set is the folder named by the second word of the arguments under ~/.local/share/small-plans/<project>/, or the newest set with plans not done when no name is given. Call `mcp__small-plans__list_small_plans` to find it and its plans not done, then use its folder, the plan the third word picks (every plan when it is empty) and one line per plan not done in the places marked below.

Build the plans in <set folder>, in the order listed below. A plan waits until every plan it depends on is done. For detailed plans coordinate the full worker/reviewer flow below. For direct and standard plans follow the planning-level instructions at the end instead. A plan's status changes through mcp__small-plans__start_small_plan, mcp__small-plans__finish_small_plan and, for blocked, mcp__small-plans__set_small_plan_status; never edit index.md or a status line by hand. Load those three tools and mcp__small-plans__check_small_plan with one ToolSearch call.

Plans not done (file, title, kind, status, depends on, check command):
<one line per plan from the list tool>

Each plan is built in its own git worktree, on its own branch:

- Branch name: when <project folder>/branch-convention.md exists, follow the convention it states. Otherwise start an Explore agent with model "haiku" to read the repository's CONTRIBUTING.md, CLAUDE.md, AGENTS.md, the guides under .github/ and docs/, and `git branch -a --sort=-committerdate | head -n 20`, and reply with the branch naming convention in one line, or "none"; write that line to the file with Write. When the convention is none, name the branch `<type>/<plan slug>`, the type from the plan's kind: feat for a feature, bug for a fix, refactor, test, docs or chore.
- Base: the branch of the plan it depends on, when it depends on one; otherwise the branch checked out where the build started.

For each plan:

1. Call mcp__small-plans__start_small_plan with the plan's path, a folder inside the repository, the branch and the base. It marks the plan in-progress, creates the worktree or reuses the one an earlier build left on that branch, and answers `Worktree: <path>`.
2. Start the small-plans:small-plan-implementer agent. Its prompt is the plan file's absolute path, then a line `Worktree: <path>`. It answers DONE or BLOCKED.
3. On DONE, call mcp__small-plans__check_small_plan with the plan's path, the worktree and the plan's check command as listed above. It runs the plan's check, lint, fallow and the tests, saves their output to a report file and answers one line for each, then `Report: <path>`. Never run a plan's check command with Bash yourself. If mcp__small-plans__check_small_plan says the command was refused, do not call it again for that plan; tell the user what it says. When Lint, Fallow or Tests is FAIL, start a new small-plans:small-plan-implementer agent with the two lines, then a line `Fix: <report path>`, and call mcp__small-plans__check_small_plan again. Allow at most 3 such rounds, then go to step 7; a failing guard does not count as a fix round.
4. Start the small-plans:small-plan-reviewer agent with the two lines, then a line `Report: <report path>`. It answers PASS, or FAIL and `Findings: <path>`.
5. On PASS, call mcp__small-plans__finish_small_plan with the plan's path, the worktree and one short conventional commit subject in the style of `git log --oneline -n 10`. It commits everything changed in the worktree with that subject alone, pushes the branch, removes the worktree, which keeps the branch, and marks the plan done. Never call it before the reviewer answers PASS. When it answers that a git step failed, the worktree is kept: say so in the plan's report line.
6. On FAIL, start a new small-plans:small-plan-implementer agent with the two lines, then a line `Fix: <findings path>`, and go again from step 3. Allow at most 3 fix rounds.
7. When the implementer answers BLOCKED, or the work still fails after 3 fix rounds, find the root cause: for this step only, read the plan and its report or findings file. When another plan provides the missing piece, build that plan first and base this branch on it; when the plan is wrong, correct the plan file; otherwise start a new small-plans:small-plan-implementer agent with the two lines, a `Fix: <path>` line and the cause. Keep going while each attempt changes the failure. Set the status to blocked only when the fix needs something only the user can give, or two attempts in a row leave the failure unchanged; the reason says what you tried and what is still needed. Keep its worktree and go on with the next plan that does not depend on it.

When every plan is handled, run `git status --short` in the checkout where the build started. When it shows changes, ask the user with AskUserQuestion whether to commit and push them as logical conventional commits, never a file that holds a secret such as `.env`.

Finish with one line per plan: order, title, status, branch and the fix rounds it took, with the reason for each plan that is blocked or still waiting.

Choose direct for one bounded change, standard for related steps, detailed for explicit exact edits or demonstrated ambiguity; record Level in Context. Legacy plans remain detailed. For direct implement, check and review directly; standard uses one worker and one review, resuming corrections when supported. Exact code and separate review agents are detailed-only requirements. Preserve worktrees, status tools, checks and publishing behavior. Suggest a fresh session only at task boundaries when old context is irrelevant. Apply style only to changed code and classify existing failures only from observed baselines.
