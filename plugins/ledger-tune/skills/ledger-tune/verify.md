For the output caps, run `for i in $(seq 30); do printf '%0300d\n' $i; done` and expect a line saying `characters hidden from the middle`.

When the arguments include `since <date>`, run `claude-ledger --verify <date>` instead. A date alone means midnight, so add the time (for example `2026-11-25T14:30`) when the fix landed during that day.
