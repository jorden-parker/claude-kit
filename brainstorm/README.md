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
- Light and dark mode. No external scripts, fonts or images.

Pages are named `brainstorm-YYYY-MM-DD-HHMM.html` (UTC). The folder gets a `.gitignore` of `*`, so pages stay out of git.

All text from the model is HTML-escaped before it is written to the page.

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
