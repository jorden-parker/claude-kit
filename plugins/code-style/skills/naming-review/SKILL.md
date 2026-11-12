---
name: naming-review
description: Review new and renamed identifiers in the git diff for clear, descriptive names and fix failures. Use before finishing any task that changed source code.
---

# Naming review

1. Run `git diff HEAD` (and read any untracked source files). List every new or renamed identifier: variables, constants, parameters, functions, methods, classes, types, files.
2. For each identifier, ask: could a new teammate guess its contents or purpose without reading the body? If not, it fails.
3. Check the mechanical rules:
   - No identifiers under 3 characters, except `i`, `j`, `k` loop indices and `e` for exceptions.
   - No cryptic abbreviations (`repo`, `ctx`, `cfg`, `usr`, `btn`, `tmp`, `val`, `res`, `req`) unless they are an established library convention such as Express `req`/`res`.
   - No vague names (`data`, `info`, `item`, `thing`, `stuff`, `handler`, `manager`, `helper`, `util`, `process`, `handle`).
   - Booleans are prefixed `is`, `has`, `can`, `should`, `did`, or `will`.
   - Functions are verb phrases; classes and types are nouns.
   - Reuse the repository's existing domain vocabulary instead of inventing synonyms. Search the codebase if unsure.
4. Prefer a long clear name over a short vague one.
5. Rename every failure at its definition and all usages, then re-run tests or type checks if the rename touched many sites.
6. Finish with one line: the renames made (`old -> new, ...`) or `all identifiers pass`.
