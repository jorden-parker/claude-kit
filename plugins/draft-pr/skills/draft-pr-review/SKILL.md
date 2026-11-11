---
name: draft-pr-review
description: Draft a review of a GitHub pull request as Conventional Comments (label, optional decorations, subject, discussion) and open it as an editable page in the browser. Use whenever the user asks to review a PR or pull request, draft review comments, or give feedback on a PR, by number, URL, or for the current branch. Posts nothing to GitHub; the page has the button for that.
argument-hint: "[PR number or URL] [focus]"
---

# Draft a pull request review

You draft the review. You do not post it. The draft opens as a page in the browser, where the user edits each comment, previews it, copies it, or posts the review with a button.

## Stay quiet

The page is the only output.

- Do not print a comment, a finding, the summary or a verdict in the session, while you work or at the end.
- Do not run `gh pr review`, `gh pr comment`, a `gh api` call that writes, or any other command that changes GitHub.
- Do not check out the PR or change the working tree.
- Your last message is the tool's one-line result, and nothing else.

The notes are the words after the command, or the request that led here. They can name the PR and what to focus on.

## 1. Find the PR

- The notes name a number or a URL: use it.
- Otherwise: `gh pr view --json number --jq .number` gives the PR of the current branch.

Stop, and say why in one line, when there is no PR.

## 2. Read the change

- `gh pr view <number> --json title,body,author,baseRefName,headRefName,headRefOid,files`
- `gh pr diff <number>`
- The code around each change. When `git rev-parse HEAD` equals `headRefOid`, read the files in the working tree. Otherwise read a file at the PR's head with `gh api "repos/{owner}/{repo}/contents/<path>?ref=<headRefOid>" -H "Accept: application/vnd.github.raw"`.
- The project's rules: CLAUDE.md, CONTRIBUTING.md and the linter config, where they exist.

## 3. Review

Look for, most important first:

1. Bugs: wrong logic, unhandled cases, broken callers.
2. Security: unchecked input, leaked secrets, missing authorization.
3. Missing or weak tests for the changed behaviour.
4. Breaks of the project's own rules and conventions.
5. Names and structure that will mislead the next reader.
6. Work worth praising.

Check each finding against the code before you write it. Drop what you cannot show. Prefer a few comments that matter over many that do not.

## 4. Write Conventional Comments

Every comment has four parts:

```
<label> [decorations]: <subject>

[discussion]
```

| Label        | Use it for                                                       |
| ------------ | ---------------------------------------------------------------- |
| `praise`     | Something done well. Sincere, never a lead-in to criticism.      |
| `issue`      | A specific problem. Say the fix in the discussion.               |
| `suggestion` | An improvement. Say what to change and why it is better.         |
| `todo`       | A small, necessary change.                                       |
| `question`   | A possible problem you could not confirm. Ask.                   |
| `nitpick`    | A trivial preference. Never blocking.                            |
| `thought`    | An idea the change raised. Never blocking.                       |
| `chore`      | A process task to do before merging, with a link to the process. |
| `note`       | Something the reader should know. Never blocking.                |
| `typo`       | A misspelling.                                                   |
| `polish`     | Nothing is wrong, but it could be better.                        |
| `quibble`    | The same as `nitpick`.                                           |

Decorations go in a list. The standard ones:

- `blocking`: must be resolved before the PR is accepted.
- `non-blocking`: must not stop the PR.
- `if-minor`: resolve it only if the change is small.

A comment has at most one of `blocking` and `non-blocking`. Put one of them on every `issue`, `todo`, `suggestion` and `question`. Add a topic decoration, such as `security` or `test`, when it helps: lowercase words joined by hyphens.

Rules for every comment:

- One point per comment.
- The subject is one sentence that stands alone.
- The discussion gives the reason and the next step. Leave it empty when the subject says it all.
- For a concrete replacement of the commented lines, put a GitHub suggestion block in the discussion: a code fence whose language is `suggestion`.
- Write to the author as a colleague: say "we" and "this", not "you".

Where a comment goes:

- On a line: `path` and `line`. The line must be one the PR's diff shows, added or context. `side` is `RIGHT`, the default, for a line number in the new file, and `LEFT` for a removed line's number in the old file.
- On a range: `startLine` as well, in the same diff hunk as `line`.
- On the whole PR: no `path` and no `line`.

## 5. Open the page

Write a `summary` of one to three sentences: the overall state of the PR, and what blocks it if anything does.

Leave `event` out, so the page starts on Comment. Set `APPROVE` or `REQUEST_CHANGES` only when the user asked for that verdict. The user picks the verdict on the page.

Call `mcp__draft-pr__render_pr_review_draft` once. If its schema is not loaded, load it with ToolSearch first. If the tool does not exist even then, stop and say in one line that the draft-pr plugin's tools are not loaded. Do not write the page yourself, and do not run the plugin's scripts.

```json
{
  "number": 42,
  "summary": "<overall comment>",
  "comments": [
    {
      "path": "src/auth.ts",
      "line": 12,
      "label": "issue",
      "decorations": ["blocking", "security"],
      "subject": "<one sentence>",
      "discussion": "<reason and next step>"
    }
  ]
}
```

When the tool denies the call, fix every problem it lists and call it again. When it succeeds, reply with its result line and stop.
