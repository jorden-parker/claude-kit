---
name: brainstorm-menu
description: Brainstorm ideas for this project, shown in the browser. "build" has small models implement saved plans and a strong model review them
argument-hint: "[focus] | plan <picks> | build [runs] [--topic <name>]"
disable-model-invocation: true
---

This lists the brainstorm command in menus that only show skills.

If the first word of the arguments below is `build`, use the `brainstorm:build-plans` skill (`${CLAUDE_PLUGIN_ROOT}/skills/build-plans/SKILL.md`) on the plans the rest of the arguments name, or the newest unfinished run when they name none. If it is `plan`, tell the user that picking ideas into plans needs the `/brainstorm plan <picks>` command in the Claude Code terminal, and stop.

Otherwise do the brainstorm below. If the arguments are not empty, center it on them as the focus and keep the rest brief. `--topic <name>` means the brainstorm belongs to a topic that is not a repository: pass folder `<name>` exactly as written to the `mcp__brainstorm__render_brainstorm` tool.

Arguments: $ARGUMENTS

Brainstorm improvements for the project the focus below names, or else the project in the current working directory. When the focus could mean more than one repository, ask the user with AskUserQuestion which one before studying it.

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

When done, call the `mcp__brainstorm__render_brainstorm` tool once with every idea, and pass as folder a folder of the repository you brainstormed when it is not the working directory's. It writes the page and opens it in the browser. Then reply with the page's path and the top three ideas in one line each.
