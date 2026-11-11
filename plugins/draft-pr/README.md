# draft-pr

Two skills draft GitHub work and open it as a page in the browser. Nothing reaches GitHub until you click the page's button.

| Skill                           | What it does                                                     |
| ------------------------------- | ---------------------------------------------------------------- |
| `/draft-pr [notes]`             | Drafts a pull request for this branch in the project's template. |
| `/draft-pr-review [PR] [focus]` | Drafts a review of a pull request as Conventional Comments.      |

Plain words work too: "draft a PR for this branch", "review PR 42".

The menu lists the skills by their full names, `/draft-pr:draft-pr` and `/draft-pr:draft-pr-review`. The plugin registers no command of its own: the engine serves each skill as a command, and refuses a plugin command that has a skill's name.

The session stays quiet. Claude prints no title, body, comment or summary: the draft is on the page, and the last line in the session says the page opened.

## Usage

`/draft-pr` drafts a PR from the current branch into the default branch.

`/draft-pr against release, mention the migration` passes notes to the draft.

`/draft-pr-review` reviews the PR of the current branch.

`/draft-pr-review 42 focus on the auth changes` reviews PR 42.

## The PR draft

The body follows the project's PR template. Claude looks in `.github/`, the project root and `docs/` for `pull_request_template.md` (any letter case) and for the `.md` files of a `PULL_REQUEST_TEMPLATE/` folder. With several templates it picks the one that fits, or asks. With none it uses a default layout: Summary, Changes, Testing.

The `render_pr_draft` tool refuses a body that drops a heading or a checklist item of the template, and names what is missing, so the draft cannot drift from the format.

The page:

- A title field and a body editor with **Write**, **Preview** and **Split** views. The preview renders Markdown as you type.
- A **Template** panel: each section of the template, marked Filled, Empty or Missing as you edit.
- **Copy body** and **Copy title**.
- **Post to GitHub**: asks once, pushes the branch to `origin`, then runs `gh pr create`. An **Open as a draft** box makes it a draft PR.
- When the branch already has an open PR, the button reads **Update #N on GitHub** and replaces that PR's title and description.

## The review draft

Every comment is a [Conventional Comment](https://conventionalcomments.org): a label, optional decorations, a subject and a discussion.

```
**issue (blocking, security):** The token is logged.

Anyone with log access can replay the session. Log the token id instead.
```

The `render_pr_review_draft` tool refuses a comment with an unknown label, an empty subject, or a line that the PR's diff does not show, and lists every problem, so the review GitHub receives is one it accepts.

The page:

- One card per comment, grouped by file, with the diff lines it sits on.
- **Edit** on a card opens its label, decorations, subject and discussion. The rendered comment updates as you type. **Edit all** opens every card.
- **Copy** on a card copies that one comment. Comments are copied one at a time.
- **Include** leaves a comment out of the post without deleting it.
- Filter tabs per label, and counts of included and blocking comments.
- A summary with a preview, and the review type: Comment, Approve, Request changes, or Pending (saved on GitHub for you to finish there).
- **Post to GitHub**: asks once, then posts one review with the included comments through `gh api`. A review is posted once.

## Both pages

- A minimal, high-contrast design in the Vercel style, in light and dark mode. No external scripts, fonts or images.
- Edits are saved in the browser as you type. **Reset** returns to the original draft.
- `Cmd/Ctrl + Enter` posts, after the same confirmation. `Esc` cancels.
- All text from the model is HTML-escaped. The preview escapes HTML before it renders Markdown.

## How posting works

A page in a browser cannot run `gh`, so the plugin starts a small local helper, `server/draft-server.mjs`, for each draft:

- It listens on `127.0.0.1` only, on a random port, under a random token in the URL. It refuses requests from any other origin.
- It serves the page, and posts only when the page's button is confirmed. The repository, branches, PR number and comment positions come from the saved draft, not from the page.
- It stops two hours after the page's last contact. A page open in a tab keeps it alive.

Posting needs `node`, `gh` (signed in) and `git` on the PATH. Without `node` the page opens as a file: editing, preview and the copy buttons work, and the post button is off.

## Where things are saved

Drafts go to `.claude/draft-pr/` in the project, as `pr-YYYY-MM-DD-HHMM.html` or `review-<number>-YYYY-MM-DD-HHMM.html` (UTC), each with a `.json` beside it. The folder gets a `.gitignore` of `*`, so drafts stay out of git.

## Where things live

| File                              | Holds                                                   |
| --------------------------------- | ------------------------------------------------------- |
| `hooks/register.ts`               | The two render tools and their checks.                  |
| `hooks/pr-template.ts`            | Finding the PR template and checking a body against it. |
| `hooks/conventional-comment.ts`   | The labels, the decorations and the comment format.     |
| `hooks/diff-lines.ts`             | Reading a diff: which lines a comment can sit on.       |
| `hooks/draft-page.ts`             | The HTML of both pages.                                 |
| `hooks/page-style.ts`             | The pages' CSS.                                         |
| `hooks/page-script.ts`            | The pages' behaviour: editing, preview, copy, post.     |
| `server/draft-server.mjs`         | The local helper that serves a page and posts for it.   |
| `skills/draft-pr/SKILL.md`        | How Claude drafts a PR.                                 |
| `skills/draft-pr-review/SKILL.md` | How Claude drafts a review.                             |

The comment format is written twice and must change together: `formatConventionalComment` in `hooks/conventional-comment.ts`, and `formatComment` in `hooks/page-script.ts`.

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install draft-pr@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install draft-pr@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir` while it is installed. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall draft-pr@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```

`pnpm test` runs the hooks tests with `claude plugin test`, then the helper's tests with `node --test`.
