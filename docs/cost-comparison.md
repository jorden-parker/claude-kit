# Compare complete tasks

Keep Sol at medium effort and preserve the same resolved model mappings during the first comparison. On the work machine select 5–10 representative tasks: a small edit, a test failure, a verbose lookup, a multi-file change and a planning task. Use identical starting revisions in isolated checkouts. Run each task with the released baseline and the updated plugins; alternate ordering to reduce warm-cache bias. Never run both versions against the same mutable checkout.

Copy the corresponding session JSON records from `~/.cache/token-ledger/sessions/` into separate baseline and candidate folders. Record task title, starting revision, plugin versions, actual resolved models, success/failure, user corrections and elapsed seconds alongside each run. Do not count a cheaper failed task as a saving. Compare median billed dollars per successful task, all worker calls (including resumed corrections), hook denials, reasoning usage and elapsed time. Session totals include every worker; task-level attribution is unknown when the harness does not expose parent IDs. Compare one task per session for reliable attribution.

Set `TOKEN_LEDGER_PRICING` to a JSON object keyed by the exact returned model ID, with `input`, `output`, `cacheRead`, and `cacheWrite` rates per million tokens in a single currency. Use contracted Bedrock rates, not assumed public OpenAI prices. Missing fields remain unknown; reasoning tokens are already part of output and are never charged twice. Reconcile the estimates against AWS billing. Do not compare aggregate token counts across models as a substitute for dollars.

Run `bun plugins/token-ledger/bin/compare-runs.ts <baseline-folder> <candidate-folder>`. It reads ledger records only, includes workers and prints unknown if complete cost data is unavailable. Older records remain readable but cannot supply newly introduced metrics. Fill missing billing and duration/correctness observations from the provider and your run sheet.

## Live harness trimming check

Start a fresh Claude Code session on the work machine with guards enabled. Ask it to run a deterministic command printing a unique sentinel in the middle of 500 lines. Inspect the next outbound request through your approved local gateway diagnostic or harness transcript that reflects model input. Confirm the original middle text is replaced by the trim marker and the full log path works. A plugin unit test or a shortened terminal display alone is not evidence that the provider received less text. Do not capture credentials or project secrets.

The repository integration test checks the real guards hook through the host output adapter. Run the live check for each installed Claude Code version before relying on output replacement for savings. If the harness ignores replacement, use `bun <installed-guards-path>/bin/compact-run <command> [arguments...]` to produce a compact result at source. The runner retains stdout and stderr in a private temporary log, prints a bounded summary and returns the original exit status.

## Defaults and limits

`GUARDS_DELEGATE_POLICY=strict` restores the legacy enforced edit/read budgets; selective is the default. Agent allowlisting and saved per-agent model overrides still apply. Profiles are explicit project settings, not applied automatically by plugin updates. `coding` and `ui` retain the `code` and `web` aliases; `planning` and `notes` disable irrelevant plugins. A new session loads the selected profile.

Verification reuse lasts at most 60 seconds within the same session and command, hashing HEAD, tracked/untracked nonignored files and environment. Set `CLAUDE_KIT_VERIFY_CACHE=0` for checks dependent on ignored files, installed dependencies, external services, time or other inputs outside that fingerprint. Such checks must run fresh. Existing failures are only classified from an observed unchanged-revision run with the same command and environment; unknown failures remain unresolved. Hook deduplication does not turn a failed check into a pass.

A context-growth nudge is advisory: restart at a task boundary only when previous context has become irrelevant. Cached input still occupies context, but a cold restart and rediscovery can cost more than reusing it. Evaluate lower effort separately after the workflow comparison.
