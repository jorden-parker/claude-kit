import type { Register } from "claude-code";

const LEDGER_TUNE_COMMAND = "ledger-tune";
const LEDGER_TUNE_SKILL = "ledger-tune:ledger-tune";
const NO_ARGUMENTS = "none";

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: LEDGER_TUNE_COMMAND,
      description:
        "Cut context, tokens and cost from the ledger data: read, apply, verify",
      argumentHint: "[read|apply|verify] [since YYYY-MM-DD]",
    });
    return next(e);
  });

  on("command.run", { command: LEDGER_TUNE_COMMAND }, async ($, e) => {
    const commandArguments = e.args.trim() || NO_ARGUMENTS;
    return {
      text: `Run the ${LEDGER_TUNE_SKILL} skill with the Skill tool. Arguments: ${commandArguments}`,
    };
  });
};
