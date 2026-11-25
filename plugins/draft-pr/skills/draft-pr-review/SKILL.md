---
name: draft-pr-review
description: Draft a review of a GitHub pull request as Conventional Comments (label, optional decorations, subject, discussion). Use whenever the user asks to review a PR or pull request, draft review comments, or give feedback on a PR, by number, URL, or for the current branch.
argument-hint: "[PR number or URL] [focus]"
---

# Draft a pull request review

You draft the review. You do not post it. The draft opens as a page in the browser, where the user edits each comment, previews it, copies it, or posts the review with a button.

## Stay quiet

The page is the only output.

- Do not print a comment, a finding, the summary or a verdict in the session, while you work or at the end.
- Do not run `gh pr review`, `gh pr comment`, a `gh api` call that writes, or any other command that changes GitHub.
- Do not check out the PR or change the working tree.
- Your last message is the tool's one-line result, and nothing else. The one exception: a UX/UI finding went without a screenshot. Then add one line that says why.

The notes are the words after the command, or the request that led here. They can name the PR and say what to focus on. Evidence needs no asking: every finding carries its own, as steps 3 and 4 say.

## 1. Find the PR

- The notes name a number or a URL: use it.
- Otherwise, even when the notes give only a focus: `gh pr view --json number --jq .number` gives the PR of the current branch. Do not ask which PR.

Stop, and say why in one line, when there is no PR.

## 2. Read the change

- `gh pr view <number> --json title,body,author,baseRefName,headRefName,headRefOid,files`
- `gh pr diff <number>`
- The code around each change. When `git rev-parse HEAD` equals `headRefOid`, read the files in the working tree. Otherwise read a file at the PR's head with `gh api "repos/{owner}/{repo}/contents/<path>?ref=<headRefOid>" -H "Accept: application/vnd.github.raw"`.
- The project's rules: `CLAUDE.md`, `CONTRIBUTING.md` and the linter config, where they exist.

## 3. Review

Look for, most important first:

1. Bugs: wrong logic, unhandled cases, broken callers.
2. Security: unchecked input, leaked secrets, missing authorization.
3. Missing or weak tests for the changed behaviour.
4. Breaks of the project's own rules and conventions.
5. Names and structure that will mislead the next reader.
6. Work worth praising.

Check each finding against the code before you write it. Drop what you cannot show. Prefer a few comments that matter over many that do not.

Every finding carries its evidence, on every review, whether or not the notes ask for it. Never wait to be asked for evidence, and never offer to add it later.

A UX/UI finding is any finding about what a user sees or does: layout, spacing, colour, contrast, copy, a state, a flow, keyboard or screen-reader use. Test each one in the running app and take its screenshot now, as step 4 says, before you write the comments.

## 4. Write Conventional Comments

Every comment has four parts:

```text
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
- The discussion gives the evidence, the reason and the next step. The evidence is what shows the finding is real: the code, the command and its output, or the input that breaks it. Leave the discussion empty only when the subject and the commented lines show it all.
- Put every identifier, file name, path, command and flag in backticks, in the subject and in the discussion, so it renders as inline code: `parseToken`, `src/auth.ts`, `pnpm test`.
- Put other code of more than one line in a fenced code block that names its language.
- For a concrete replacement of the commented lines, put a GitHub suggestion block in the discussion: a code fence whose language is `suggestion`.
- Write to the author as a colleague: say "we" and "this", not "you".

How every comment reads. The format above does not change: the label, the decorations, the subject and the discussion stay as they are. These rules are for the words in the subject, the discussion and the summary. The author must understand each comment fully on the first read, with no other file open.

- Write it the way you would say it to a colleague across the desk: everyday words and whole sentences.
- Keep sentences short, with one idea in each. Use the active voice and name who or what acts: "`parseToken` throws", not "an exception may be thrown".
- Say the concrete thing: what happens, on which input, and what the user or the caller then sees. Never "this may cause issues".
- Pick the simplest word that is right: "use", not "utilize"; "so", not "consequently"; "about", not "with regard to".
- Use a technical term only when the author needs it. When it is not a name from the code or the project's docs, say what it means in a few words.
- Leave nothing to decode: no arrows, no "w/", no dropped words, and no abbreviation the code does not use.
- Give the reason in plain words, so the author sees why it matters and not only what to change.
- Cut filler and stiff phrases: "it should be noted that", "consider leveraging", "in order to". Say how sure you are once, not in every sentence.
- Be kind and direct. No sarcasm, and no "just", "simply" or "obviously": they make a hard thing sound easy.
- Before the page opens, read each comment once as the author would, knowing nothing of your review. Rewrite any sentence that needs a second read.

Not this:

```text
issue (blocking): Insufficient null handling in the token parsing logic may lead to runtime exceptions.
```

This:

```text
issue (blocking): `parseToken` crashes when the `Authorization` header is missing.

A request with no header reaches `header.split(" ")`, which throws, so the user gets a 500 instead of a 401. Can we return `undefined` first when `header` is empty?
```

Evidence for a UX/UI finding. The `discussion` of every UX/UI comment holds these three, in this order. This is not optional and does not depend on the notes:

1. The screenshot: a Markdown image on its own line, `![<what it shows>](<absolute path of the file>)`. That line is the whole embed. The tool takes no file and nothing is uploaded: the page reads the file from that path and shows it in the comment.
2. The code that produced the screenshot, in a fenced code block that names its language: the script, the browser tool calls or the commands, in the order you ran them. Make it complete enough that the author runs it and gets the same picture: the command that started the app, the URL, the viewport size, and any change you made to the page.
3. The steps you took to test the finding and to take the screenshot, as a numbered list a person can follow by hand: where you started, what you clicked or typed, what you saw, and what you expected instead.

When the work is tracked in Shortcut, all three still go in the comment. That is the case when the branch name holds `sc-<number>`, the PR's body links an `app.shortcut.com` story, or the session has Shortcut tools. Never leave the steps out because the story describes the feature: the story says what was asked for, and the steps say what you did. Name the story in the first step.

- Never leave a screenshot out because the tool cannot upload files, or because GitHub cannot read a local path. The user attaches the file on GitHub after posting.
- Take the screenshot yourself, with the session's browser or screenshot tools, from the PR's code: the working tree when it is at the PR's head, or a preview deployment the PR links. To show a fix, change the page in the browser, not the files, and put that change in the code block. A suggested fix gets two screenshots: before and after.
- When you cannot take a screenshot, because the session has no browser tool, the app does not start, or the PR's code is neither in the working tree nor on a preview: keep the finding only when the code shows it by itself. Say in its discussion that it has no screenshot and why, and give the code and the steps you did run.
- Never embed a screenshot you did not take, and never write code or steps you did not run.
- One screenshot shows one point. Frame it so the problem is the first thing seen, and say what it shows in the alt text.
- Save every screenshot as a PNG, with no space in its path, in a folder outside the repository, such as `$TMPDIR/draft-pr-review-<number>/`. Never write one into the working tree, never `git add`, commit or push one, and never send one to an image host or any other service.

Where a comment goes:

- On a line: `path` and `line`. The line must be one the PR's diff shows, added or context. `side` is `RIGHT`, the default, for a line number in the new file, and `LEFT` for a removed line's number in the old file.
- On a range: `startLine` as well, in the same diff hunk as `line`.
- On the whole PR: no `path` and no `line`.

## 5. Open the page

Write a `summary` of one to three sentences: the overall state of the PR, and what blocks it if anything does. Code-like text goes in backticks here too, and it reads like the comments: plain words, short sentences.

Leave `event` out, so the page starts on Comment. Set `APPROVE` or `REQUEST_CHANGES` only when the user asked for that verdict. The user picks the verdict on the page.

Call `mcp__draft-pr__render_pr_review_draft` once. If its schema is not loaded, load it with `ToolSearch` first. If the tool does not exist even then, stop and say in one line that the draft-pr plugin's tools are not loaded. Do not write the page yourself, and do not run the plugin's scripts.

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
