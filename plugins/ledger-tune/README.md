# ledger-tune

`/ledger-tune` reads the token-ledger data, recommends changes that cut context, tokens and cost, applies the ones you pick, and verifies them against later sessions.

It runs in three steps:

1. **Read** runs `claude-ledger --text 40` and recommends at most five changes, largest saving first.
2. **Apply** asks which recommendations to apply, makes only those, and records each one with `claude-ledger --fixed`.
3. **Verify** checks the installed versions, runs a live check where it can, and compares the ledger before and after each fix.

## Usage

- `/ledger-tune` runs all three steps in order
- `/ledger-tune read` only reads the ledger and recommends
- `/ledger-tune apply` only applies the picked recommendations
- `/ledger-tune verify since 2026-11-25` only verifies, comparing fixes made since that date
- Typing `/ledger-tune ` suggests `read`, `apply` and `verify`, and `verify ` suggests `since`

## Requirements

- The [token-ledger](../token-ledger/) plugin, which records the data and provides the `claude-ledger` command

Updates to claude-kit plugins are installed with `claude-kit-update`.

Recommendations now require actual model routing, provider pricing and whole-task evidence including worker retries. Cache labels, large context and main-agent share alone are not proof of waste. Unknown metrics are reported as unknown.
