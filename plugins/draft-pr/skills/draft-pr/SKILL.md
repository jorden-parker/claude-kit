---
name: draft-pr
description: Draft a pull request for the current branch, with a title and a body that follows the project's own PR template, and open it as an editable page in the browser. Use whenever the user asks to draft, write, prepare or describe a PR or pull request, or asks for a PR description, even when they name no branch or base. Posts nothing to GitHub; the page has the button for that.
argument-hint: "[notes, such as the base branch]"
---

# Draft a pull request

You draft the PR. You do not create it. The draft opens as a page in the browser, where the user edits it, previews it, copies it, or posts it with a button.

## Stay quiet

The page is the only output.

- Do not print the title, the body, a summary or any finding in the session, while you work or at the end.
- Do not run `gh pr create`, `gh pr edit`, `git push` or any other command that changes GitHub or the remote.
- Your last message is the tool's one-line result, and nothing else.

The notes are the words after the command, or the request that led here. They can name the base branch or what to stress.

## 1. Read the branch

- Head: `git rev-parse --abbrev-ref HEAD`.
- Base: the branch the notes name. Otherwise `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If that fails, `git symbolic-ref --short refs/remotes/origin/HEAD`, without its `origin/`.
- Commits: `git log --no-merges --format='%h %s%n%b' <base>..HEAD`.
- Changes: `git diff --stat <base>...HEAD`, then `git diff <base>...HEAD`. Open the changed files where the diff alone does not explain a change.

Uncommitted changes are not part of the PR. Leave them out.

Stop, and say why in one line, when the head is the base branch or when it has no commits the base lacks.

## 2. Find the template

Look in `.github/`, the project root and `docs/`, in that order, for:

- `pull_request_template.md`, in any letter case.
- The `.md` files of a `PULL_REQUEST_TEMPLATE/` folder, in any letter case.

Then:

- One template: use it.
- Several: use the one that fits the change. If two fit, ask with `AskUserQuestion`. Pass its path as `templatePath`.
- None: use this layout.

```markdown
## Summary

## Changes

## Testing
```

## 3. Write the draft

The title is one line, under 72 characters, in the style of the titles in `git log`.

The body is the template, filled in:

- Keep every heading and every checklist item, with the template's wording and in its order. The tool checks this.
- Replace placeholder text and the prompts inside `<!-- -->` with real content.
- Tick a checklist box only when the commits or the diff prove it. Leave the rest unticked for the user.
- A section with nothing to say keeps its heading and says "None."
- Say what changed, why, and how to test it. Short sentences and bullets.
- Put every identifier, file name, path, command, flag and branch name in backticks, so it renders as inline code: `renderInline`, `hooks/page-script.ts`, `pnpm test`.
- Put code of more than one line, and command output, in a fenced code block that names its language.
- Take every statement from the commits and the diff. Invent nothing: no test run you did not see, no issue number that is not in a commit or the branch name.

## 4. Open the page

Call `mcp__draft-pr__render_pr_draft` once. If its schema is not loaded, load it with `ToolSearch` first. If the tool does not exist even then, stop and say in one line that the draft-pr plugin's tools are not loaded. Do not write the page yourself, and do not run the plugin's scripts.

```json
{
  "title": "<title>",
  "body": "<body>",
  "base": "<base branch>",
  "templatePath": "<only when the project has several templates>",
  "isDraft": false
}
```

Set `isDraft` to `true` only when the user asked for a draft PR.

When the tool denies the call, fix what it names and call it again. When it succeeds, reply with its result line and stop.
