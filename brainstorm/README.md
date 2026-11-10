# brainstorm

`/brainstorm [focus]` has Claude study the project in the current working directory and brainstorm improvements: security issues, must-have fixes, quick wins, performance, developer experience, and creative or moonshot ideas. The result is a self-contained HTML page, saved under `.claude/brainstorm/` in the project and opened in the browser.

## Usage

`/brainstorm` brainstorms across the whole project.

`/brainstorm the onboarding flow` centers the brainstorm on one area.

The command hands Claude the brainstorm instructions as a prompt. Claude reads the code, then calls the plugin's `render_brainstorm` tool with every idea. The tool writes the page and opens it with `open`, then `xdg-open`, then `cmd /c start`. If none of them works, the path is reported instead.

## The page

Built to be scanned, not read:

- **Start here**: the three most urgent ideas, each with its next step.
- Ideas grouped into **Do now**, **Next up** and **Later**, most urgent first (security before must-haves before the rest).
- One card per idea: a short title, a category tag, an effort badge, a **Next step** line, the reasoning folded under **Why**, and the files it touches.
- Category filter chips that stay at the top while scrolling.
- A **Done** checkbox per card and a progress bar, remembered in the browser.
- A number on every card and a **Plan** checkbox. Ticking ideas shows the `/brainstorm-plan` command to paste, with a **Copy** button.
- Light and dark mode. No external scripts, fonts or images.

Pages are named `brainstorm-YYYY-MM-DD-HHMM.html` (UTC). The ideas are also saved beside each page as `brainstorm-YYYY-MM-DD-HHMM.json`, numbered as on the page. The folder gets a `.gitignore` of `*`, so pages stay out of git.

All text from the model is HTML-escaped before it is written to the page.

## From ideas to code

`/brainstorm-plan 2 5` reads the newest saved brainstorm and has Claude write a plan for ideas 2 and 5. With no numbers it lists the ideas. The plan goes to `.claude/brainstorm/plans/plan-YYYY-MM-DD-HHMM.md`.

Every step in a plan is written for a small model that sees only that step and the plan's Context section. Steps name exact files, quote the text to replace, give the new code, and end with one check command. Test steps come before code steps.

`/brainstorm-build` implements the newest plan. To pick others, pass one or more file names or paths. A bare file name such as `plan-2026-11-09-1200.md` is looked up in the plans folder, and several plans run in the order given.

Plain requests work too. Saying "implement the latest plan" or "build the two caching plans" loads the plugin's `build-plans` skill. The skill tells Claude where the plans live and runs the same flow.

The main session coordinates and writes no code itself:

1. Each step goes to a fresh `step-implementer` subagent on Haiku, one after another. It replies DONE or BLOCKED.
2. A blocked step goes to the `plan-reviewer` subagent on Opus, which writes smaller replacement steps.
3. When every step is done, `plan-reviewer` reviews the whole diff, runs the checks and the tests, and replies APPROVED or with fix steps.
4. Fix steps go back to implementers. The reviewer looks again, for at most two rounds.

Nothing is committed. The two agents are defined in `agents/` and the skill in `skills/build-plans/`. Change their `model` there to use other models.

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/mods
claude plugin install brainstorm@jorden-mods --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/mods
claude plugin install brainstorm@jorden-mods --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir` while it is installed. It then loads twice: once as `@inline` and once as `@jorden-mods`.

## Uninstall

```
claude plugin uninstall brainstorm@jorden-mods
```

## Dev

```
pnpm test
pnpm typecheck
```
