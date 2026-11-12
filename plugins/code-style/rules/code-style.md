# Coding rules: comments and naming

These apply to all code written in any repo.

## Comments

- Do not write comments in code. Code must be self-explanatory.
- Replace explanatory comments with descriptive names: extract a named function or variable.
- No docstrings, `//`, `/* */`, `#`, or `--` comments, including trailing ones.
- Allowed only: shebangs, license/copyright headers, and tool directives
  (`noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `shellcheck`, `nolint`, `pragma`).
- Markdown, text, JSON, HTML, and CSS files are exempt.
- A PostToolUse hook (`no-comments.sh`, code-style plugin) blocks Edit/Write calls that add comments.

## Naming

- No identifiers under 3 characters, except `i`, `j`, `k` loop indices and `e` for exceptions.
- No abbreviations (`repo`, `ctx`, `cfg`, `usr`, `btn`, `tmp`, `val`, `res`, `req`) unless an established library convention (e.g. Express `req`/`res`).
- No vague names (`data`, `info`, `item`, `handler`, `manager`, `helper`, `util`, `process`, `handle`).
- Booleans are prefixed `is`, `has`, `can`, or `should`.
- Functions are verb phrases; classes and types are nouns.
- Prefer a long clear name over a short vague one.
- Reuse the repo's existing domain vocabulary.
- Escape hatch: list extra allowed identifiers, one per line, in `.claude/naming-allowlist.txt`.
