Evidence for a UX/UI finding. The `discussion` of every UX/UI comment holds these three, in this order. This is not optional:

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
