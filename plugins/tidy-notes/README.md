# tidy-notes

Reformats the Markdown notes in the four note stores so they are consistently formatted, without changing their content. Plugins cannot import each other, so the store folder lookup is a copy of the one in `project-notes`.

## Use

- `/tidy-notes` is a dry run. It lists the files that would change (a count per store, then each path) and the problems found, and writes nothing.
- `/tidy-notes apply` writes the changed files.

Claude runs the `tidy_notes` tool (`{ "apply": true }` to write). Only `*.md` files are touched.

## Note kinds

Every regular `*.md` file, at any depth, in `~/.local/share/<store>` (overridden by `HANDOFFS_DIR`, `PROJECT_NOTES_DIR`, `SMALL_PLANS_DIR`, `BRAINSTORM_DIR`; an empty value means the default): `handoffs`, `project-notes`, `small-plans`, `brainstorm`. A store folder that does not exist is skipped, and symbolic links and other non-regular entries are never read. A file that cannot be read or written is reported as a problem and the walk goes on.

## Fixes

Protected lines are never changed, and no rule below applies inside them: fenced code blocks (` ``` ` or `~~~`, an unclosed fence runs to the end), lines starting with four or more spaces or a tab (indented code, so a nested bullet indented four or more spaces keeps its marker), and HTML blocks from a line starting `<pre`, `<script`, `<style`, `<textarea` or `<!--` up to the line holding the matching closing tag or `-->`.

- LF line endings (a lone CR counts as a line ending).
- No trailing spaces or tabs; a hard line break (two spaces, then a non-blank line) keeps exactly two.
- No blank lines at the start of the file, exactly one newline at the end, runs of blank lines become one, except a run between two protected lines is kept.
- ATX headings get one blank line before (unless first) and after (unless last).
- `*` and `+` bullets become `-`; thematic breaks such as `* * *` stay.
- Front matter is the top block only when line 1 is `---`, line 2 looks like `key:` and a closing `---` follows; otherwise it is body. Inside it: blank lines removed and keys reordered only when every non-blank line is a single-line `key: value` (not `|` or `>` block scalars); otherwise its lines stay as they are. Either way there is exactly one blank line after the closing `---`.
- Key order: handoffs `title, project, created, cwd, focus`; project-notes `title, project, created, category, source`; unknown keys follow in their original order. Other stores keep their order.
- Running it twice gives the same text as once.

Before a write, the old and new text are split into front matter and body the same way. Blank lines are dropped and trailing whitespace ignored (leading indentation counts), and a leading `*` or `+` bullet counts as `-`. The body lines must be equal in the same order and the front matter lines equal as a sorted list. If not, the file is skipped and reported as a problem.

## Problems

Reported, never fixed.

- handoffs, project-notes and small-plans: missing front matter; an H1 in the body (the title lives in front matter). A plan file written by `small-plans` has front matter and `##` sections, so it follows the handoff check; the generated `index.md` of a plan set (an H1, no front matter) is exempt.
- brainstorm: has front matter; an H1 count other than one (outside fences).
- every store: a file name not matching `^[a-z0-9]+([.-][a-z0-9]+)*\.md$`; a tab character outside fenced code.
