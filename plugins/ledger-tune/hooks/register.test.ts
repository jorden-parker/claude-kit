import { expect, test } from "claude-code/testing";

const CLOUD_OPTIONS = { options: { model: "sonnet" } };

const ledgerTune = (args: string) => ({
  command: "ledger-tune",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 80 },
});

test(
  "ledger-tune with no arguments asks for the skill with none",
  CLOUD_OPTIONS,
  async ($) => {
    const reply = await $.command.run(ledgerTune("  "));

    expect(reply.text).toBe(
      "Run the ledger-tune:ledger-tune skill with the Skill tool. Arguments: none"
    );
  }
);

test(
  "ledger-tune passes the typed arguments to the skill",
  CLOUD_OPTIONS,
  async ($) => {
    const reply = await $.command.run(ledgerTune("verify since 2026-11-25"));

    expect(reply.text).toBe(
      "Run the ledger-tune:ledger-tune skill with the Skill tool. Arguments: verify since 2026-11-25"
    );
  }
);
