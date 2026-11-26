# brainstorm

One command, `/brainstorm`, takes a project from ideas to code. Its first word picks the mode:

| Command                    | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `/brainstorm [focus]`      | Studies the project and opens a page of ideas.                 |
| `/brainstorm plan <picks>` | Turns picked ideas into plans, one folder each, with an index. |
| `/brainstorm build [runs]` | Has small models build the plans, and a strong model review.   |

Add `--topic <name>` (one word, anywhere in the arguments) to any of them to keep the ideas and plan runs under `~/.local/share/brainstorm/<name>/` for a topic that is not a repository, the way small-plans takes a plain project name.

Only `plan` and `build` as the first word pick a mode. Anything else is the focus of a new brainstorm. To brainstorm on a focus that starts with one of those words, put another word first: `/brainstorm the build pipeline`.

`/brainstorm` brainstorms improvements: security issues, must-have fixes, quick wins, performance, developer experience, and creative or moonshot ideas. The result is a self-contained HTML page, saved under `~/.local/share/brainstorm/<project>/` and opened in the browser. `<project>` is the repository the ideas are about: the one `/brainstorm <focus>` names, or else the session's, and Claude asks you when the focus could mean more than one. The folder is named after the repository, shared by its worktrees, the same name the handoff, project-notes and small-plans plugins file under.

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
- Ticking ideas raises a bar at the bottom with the `/brainstorm plan` command to paste, plus **Copy**, **Mark done** and **Clear** (or Esc). The command is as short as it can be: `all`, a category name, or numbers with ranges such as `1-3 6`.
- A minimal, high-contrast design in the Vercel style, in light and dark mode. No external scripts, fonts or images.

Pages are named `brainstorm-YYYY-MM-DD-HHMM.html` (UTC). The ideas are also saved beside each page as `brainstorm-YYYY-MM-DD-HHMM.json`, numbered as on the page. Nothing is written inside the project. A `.claude/brainstorm/` folder that an earlier version left in the project is moved to the new folder the next time you run `/brainstorm`.

All text from the model is HTML-escaped before it is written to the page.

## From ideas to code

`/brainstorm plan 2 5` reads the newest saved brainstorm and has Claude write a plan for ideas 2 and 5. It also takes ranges (`2-5`), a category (`security`), or `all`, mixed freely. With no picks it lists the ideas.

### The plan files

Each `/brainstorm plan` writes a run folder, `~/.local/share/brainstorm/<project>/plans/plan-YYYY-MM-DD-HHMM/`. `BRAINSTORM_DIR` replaces `~/.local/share/brainstorm`. The plugin lets Claude read and write files in that folder without a permission prompt, and nowhere else. `claude-notes`, run in a terminal, shows the plans in the browser, under Brainstorm plans. Every plan gets a folder and a file of its own:

```
plan-2026-11-11-1200/
  index.md
  01-token-expiry/
    plan.md
    step-01.md
    step-02.md
  02-replay-mode/
    plan.md
    step-01.md
    findings.md
```

- `index.md`: the index of the run. One table row per plan, in build order, with its title, the link to its `plan.md`, its status, its kind, the plans it depends on and the ideas it covers. Below the table: the ideas that were dropped, and why.
- `NN-slug/plan.md`: one plan per idea, merged only when two ideas change the same code. It holds the plan's own `Status` line, the goal, the Context every step needs (CLAUDE.md rules and every hook that can block an edit), a checkbox per step, and the done criteria.
- `NN-slug/step-NN.md`: one self-contained file per step. A small model builds the plan from these files, one at a time. Edits are find-and-replace blocks with exact text, or whole new files. Each step ends with one narrow check. Test steps come before code steps.
- Spike plans: ideas with large effort or the moonshot category. Their steps answer questions in `findings.md` and change no product code. Such an idea needs a new `/brainstorm plan` run before anything is built.

The index table looks like this:

```
| Order | Plan                                             | Status      | Kind   | Depends on      | Ideas |
| ----- | ------------------------------------------------ | ----------- | ------ | --------------- | ----- |
| 1     | [Reject expired tokens](01-token-expiry/plan.md) | done        | change | none            | #2    |
| 2     | [Replay mode](02-replay-mode/plan.md)            | in-progress | spike  | 01-token-expiry | #5    |
```

### Status

A plan's status is in two places that always match: the `- Status:` line of its `plan.md`, and its row in `index.md`.

| Status        | Means                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `pending`     | Written, not started.                                                                                |
| `in-progress` | A build started it. Its ticked steps are done.                                                       |
| `done`        | Every step is ticked and the final review approved it.                                               |
| `blocked`     | The build could not fix a failure itself: the fix needs the user, or two attempts left it unchanged. |

The planner writes `pending` in both places. After that, every change goes through the `set_brainstorm_plan_status` tool, which writes the plan file and the index row in one call. The `check_brainstorm_plan` tool reports any plan whose two statuses differ.

### Planning

Before it finishes, the planner calls the `check_brainstorm_plan` tool on the run folder. The tool checks the format, the statuses, the find text and the banned phrases, and replies `OK` or one problem per line. The planner fixes every problem. Then one `step-reader` subagent per plan reads its steps for anything a small model would have to guess, and the planner rewrites what it could not follow, for at most two rounds.

### Building

`/brainstorm build` lists the four newest runs and builds the one you pick; with one run it builds that one without asking. To name runs instead, add run folder names, paths, a date or words from a title, or `all` for every run, oldest first. The command passes those words on as they are, and the `build-plans` skill finds the runs. Saying "implement the latest plan" in plain words works too, and so does naming one plan of a run.

For each run, the build:

1. Checks the run again, so find text that went stale since planning is caught. `plan-reviewer` repairs what the checker rejects.
2. Takes the plans in index order. It leaves `done` plans alone, and skips a plan whose dependencies are not `done`.
3. Sends each plan to one `step-implementer` subagent on Haiku, which builds the unticked steps in order and ticks each one. A blocked step is retried once on Sonnet, which also builds the steps after it, then `plan-reviewer` splits it into smaller steps.
4. Ends each plan with a `plan-reviewer` review. Fixes come back as more steps of the same plan, for at most two rounds per build.
5. Sets the plan to `done`, or, when a failure is left after the steps above, works out its root cause and keeps fixing, setting the plan to `blocked` with the reason only when the fix needs the user or two attempts in a row leave the failure unchanged.

Before a plan starts, and again when a step or a failure shows one, the build looks for a missing step: something the plan needs that no step provides, such as an uninstalled dependency or a file another plan creates. It adds that step ahead of the one that needs it, or builds the plan that provides it first, and asks you only when only you can supply it.

A stopped build is resumed by running `/brainstorm build` again: `done` plans are left alone and every other plan carries on at its first unticked step. Nothing is committed. The whole flow is written once, in `skills/build-plans/SKILL.md`.

The skill has `user-invocable: false`, so it stays out of the slash menu and `/brainstorm` is the plugin's only entry there. Claude still loads it for `/brainstorm build` and for plain-word requests.

## Transcript card

Setting a plan status places a small PLAN card in the transcript with the plan title, status and short path.

## Where things live

| File                          | Holds                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `hooks/register.ts`           | The command and its modes, the tools, the page, and the prompts. |
| `hooks/plan-check.ts`         | The `check_brainstorm_plan` rules and limits.                    |
| `hooks/plan-status.ts`        | The statuses, and how they are read and written in both files.   |
| `skills/build-plans/SKILL.md` | The build flow.                                                  |
| `agents/step-reader.md`       | Reads a plan's steps for ambiguity before the build. Haiku.      |
| `agents/step-implementer.md`  | Builds a plan's steps, one at a time. Haiku.                     |
| `agents/plan-reviewer.md`     | Reviews, unblocks and repairs. Opus.                             |

To use other models, change `model` in the agent files. The retry of a blocked step runs on Sonnet, which is set in `skills/build-plans/SKILL.md`.

Each format is written in as few places as it can be:

- The index and plan formats: the templates in `hooks/register.ts`. `hooks/plan-status.ts` reads the status line and the index rows.
- The step file format: the template in `hooks/register.ts`, and the example in `agents/plan-reviewer.md`. They must change together.
- The banned phrases and the 60-line limit: `hooks/plan-check.ts`. `agents/plan-reviewer.md` repeats them.

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
