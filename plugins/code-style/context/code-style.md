# Coding rules: comments and naming

- No comments or docstrings in code; use descriptive names instead. Allowed: shebangs, license headers and tool directives (`noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `shellcheck`, `nolint`, `pragma`). Markdown, text, JSON, HTML and CSS are exempt.
- Names: at least 3 characters (except `i`, `j`, `k`, `e`), no abbreviations unless a library convention (`req`/`res`), no vague names (`data`, `info`, `item`, `handler`, `manager`, `helper`, `util`). Booleans start `is`, `has`, `can` or `should`. Functions are verb phrases; types are nouns. Reuse the repo's vocabulary.
- Hooks enforce both. Extra allowed names go one per line in `.claude/naming-allowlist.txt`.

Apply these rules to introduced or changed code only. Leave unrelated existing violations alone and report them separately. Review the diff, not entire files.
