# Coding rules: comments and naming (all code, any repo)

## Comments

- Write no comments, docstrings or trailing comments (`//`, `/* */`, `#`, `--`). Extract a named function or variable instead.
- Allowed only: shebangs, license/copyright headers, and tool directives
  (`noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `shellcheck`, `nolint`, `pragma`).
- Markdown, text, JSON, HTML, and CSS files are exempt.

## Naming

- No identifiers under 3 characters, except `i`, `j`, `k` loop indices and `e` for exceptions.
- No abbreviations (`repo`, `ctx`, `cfg`, `usr`, `btn`, `tmp`, `val`, `res`, `req`) unless an established library convention (e.g. Express `req`/`res`).
- No vague names (`data`, `info`, `item`, `handler`, `manager`, `helper`, `util`, `process`, `handle`).
- Booleans are prefixed `is`, `has`, `can`, or `should`.
- Functions are verb phrases; classes and types are nouns.
- Reuse the repo's existing domain vocabulary.
- Escape hatch: list extra allowed identifiers, one per line, in `.claude/naming-allowlist.txt`.
