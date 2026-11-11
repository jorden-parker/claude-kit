# brainstorm

`/brainstorm [focus]` has Claude study the project in the current working directory and brainstorm improvements: security issues, must-have fixes, quick wins, performance, developer experience, and creative or moonshot ideas. The result is a self-contained HTML page, saved under `.claude/brainstorm/` in the project and opened in the browser.

## Usage

`/brainstorm` brainstorms across the whole project.

`/brainstorm the onboarding flow` centers the brainstorm on one area.

The command hands Claude the brainstorm instructions as a prompt. Claude reads the code, then calls the plugin's `render_brainstorm` tool with every idea. The tool writes the page and opens it with `open`, then `xdg-open`, then `cmd /c start`. If none of them works, the path is reported instead.

## The page

Built to be scanned, not read:

- A stats row: idea counts per priority and a progress meter with **Reset**.
- **Start here**: the three most urgent ideas, each with its next step.
- Ideas grouped into **Do now**, **Next up** and **Later**, most urgent first (security before must-haves before the rest).
- One card per idea: a short title, a category tag, an effort badge, a **Next step** line, the reasoning folded under **Why**, and the files it touches.
- Category filter tabs that stay at the top while scrolling.
- A **Done** checkbox per card and a progress meter, remembered in the browser.
- A number on every card and a **Plan** checkbox. **Select all** ticks every idea, and **Select all in <category>** ticks the ideas of the filtered category.
- Ticking ideas raises a bar at the bottom with the `/brainstorm-plan` command to paste, plus **Copy**, **Mark done** and **Clear** (or Esc). The command is as short as it can be: `all`, a category name, or numbers with ranges such as `1-3 6`.
- A minimal, high-contrast design in the Vercel style, in light and dark mode. No external scripts, fonts or images.

Pages are named `brainstorm-YYYY-MM-DD-HHMM.html` (UTC). The ideas are also saved beside each page as `brainstorm-YYYY-MM-DD-HHMM.json`, numbered as on the page. The folder gets a `.gitignore` of `*`, so pages stay out of git.

All text from the model is HTML-escaped before it is written to the page.

## From ideas to code

`/brainstorm-plan 2 5` reads the newest saved brainstorm and has Claude write a plan for ideas 2 and 5. It also takes ranges (`2-5`), a category (`security`), or `all`, mixed freely. With no arguments it lists the ideas.

Each run writes a folder, `.claude/brainstorm/plans/plan-YYYY-MM-DD-HHMM/`:

- `index.md`: the plans in build order, the ideas each covers, what each depends on, and what was dropped.
- `NN-slug/plan.md`: one plan per idea, merged only when two ideas change the same code. It holds the goal, the Context every step needs (CLAUDE.md rules and every hook that can block an edit), a checkbox per step, and the done criteria.
- `NN-slug/step-NN.md`: one self-contained file per step. A small model sees only that file. Edits are find-and-replace blocks with exact text, or whole new files. Each step ends with one narrow check. Test steps come before code steps.
- Spike plans: ideas with large effort or the moonshot category. Their steps answer questions in `findings.md` and change no product code. Such an idea needs a new `/brainstorm-plan` run before anything is built.

Before it finishes, the planner calls the `check_brainstorm_plan` tool on the run folder. The tool checks the format, the find text and the banned phrases, and replies `OK` or one problem per line. The planner fixes every problem. Then one `step-reader` subagent per step reads it for anything a small model would have to guess, and the planner rewrites what it could not follow, for at most two rounds.

`/brainstorm-build` builds the newest run. To pick others, pass plan names or run folder paths, or `all` for every run, oldest first. Legacy single-file plans (`plan-YYYY-MM-DD-HHMM.md`) still build. Progress is kept in the checkboxes, so a stopped build resumes at its first unticked step. Each build first runs `check_brainstorm_plan` again, so find text that went stale since planning is caught and sent to `plan-reviewer` for repair before any step runs.

Plain requests work too. Saying "implement the latest plan" loads the plugin's `build-plans` skill, the single source for the build flow:

1. Each step goes to a fresh `step-implementer` subagent on Haiku, one after another. A BLOCKED step is retried once on Sonnet.
2. If Sonnet is blocked too, `plan-reviewer` on Opus unblocks it with smaller steps.
3. When every step is done, `plan-reviewer` reviews the diff, runs the checks and the tests, and replies APPROVED or with fix steps. At most two rounds of fixes.

Nothing is committed. The three agents are `step-reader` and `step-implementer` on Haiku and `plan-reviewer` on Opus, in `agents/`. The skill is in `skills/build-plans/`. Change the `model` in those files to use other models.

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install brainstorm@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install brainstorm@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir` while it is installed. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall brainstorm@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```
