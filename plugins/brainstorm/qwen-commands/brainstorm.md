---
description: Brainstorm improvements for this project, or plan picked ideas with "plan <numbers>"
---

The arguments are inside the <arguments> tags at the end. Their first word picks the mode:

- `plan`: follow "Plan picked ideas". The words after it are the picks.
- `build`: reply only: /brainstorm build needs Claude Code's subagents and tools. Ask for the plan to be implemented step by step instead.
- anything else, or nothing: follow "Brainstorm". The arguments are the focus.

## Brainstorm

Brainstorm improvements for the project in the current working directory.

1. Study the project first: README, manifests, entry points, tests, CI, config, git log. Read real code, not just file names.
2. Generate 12 to 25 ideas across these categories:
   - security: vulnerabilities, leaked secrets, unsafe input handling, outdated or risky dependencies, missing auth checks.
   - must-have: bugs, missing tests, missing error handling, broken docs, anything a careful reviewer would block on.
   - quick-win: small changes with an outsized payoff.
   - performance: measurable speed or resource wins.
   - developer-experience: tooling, scripts, onboarding, feedback loops.
   - creative: features or directions the authors probably have not considered. Be bold and specific to this project.
   - moonshot: ambitious, outside-the-checkbox bets that could change what the project is.
     Include at least two security or must-have ideas when the code supports them, and at least three creative or moonshot ideas.
3. Ground every practical idea in evidence: name the file, and the line when you can. Invent nothing.
4. Keep each idea scannable: a title under 10 words, one or two sentences of why, and one concrete next step that can be started today.
5. Set priority (now, next, later) by risk and payoff, and effort (small, medium, large) honestly.
6. If there is a focus, center the brainstorm on it and keep the rest brief.

When done, number the ideas from 1, most urgent first, and write them to `.claude/brainstorm/brainstorm-YYYY-MM-DD-HHMM.md` with the current date and time. Give each idea its number, title, category, priority, effort, why, next step and files. Write `.claude/brainstorm/.gitignore` holding `*` if it is missing. Then reply with the file's path, the top three ideas in one line each, and: Run /brainstorm plan <numbers> to plan them.

## Plan picked ideas

1. Read the newest `.claude/brainstorm/brainstorm-*.md`. If there is none, reply only: No saved brainstorm in this project yet. Run /brainstorm first.
2. If there are no picks, list the ideas one per line with their numbers and stop.
3. Picks are numbers, ranges such as 2-5, a category, or `all`. If a pick matches no idea, say which and stop.
4. Study the real files each picked idea touches. Do not implement anything.
5. Write `.claude/brainstorm/plans/plan-YYYY-MM-DD-HHMM.md` with the current date and time. Give each picked idea a goal, small ordered steps that each name the exact file and change, a test step before its code step where the project has tests, and one narrow command that proves each step.
6. Reply with the plan's path and one line per idea.

<arguments>
{{args}}
</arguments>
