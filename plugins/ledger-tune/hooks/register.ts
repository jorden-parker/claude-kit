import type { Register } from "claude-code";

const COMMAND_PREFIX = "/ledger-tune ";
const VERIFY_PREFIX = "/ledger-tune verify ";

const FIRST_ARGUMENT_SUGGESTIONS = [
  {
    text: "read",
    description: "Recommend changes from the ledger data",
  },
  {
    text: "apply",
    description: "Apply the changes you pick",
  },
  {
    text: "verify",
    description: "Check that applied fixes worked",
  },
];

const VERIFY_ARGUMENT_SUGGESTIONS = [
  {
    text: "since",
    description: "Only check fixes made since a date (YYYY-MM-DD)",
  },
];

export const register: Register = (on) => {
  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstArgument =
      e.text.startsWith(COMMAND_PREFIX) && e.start === COMMAND_PREFIX.length;
    const isVerifyArgument =
      e.text.startsWith(VERIFY_PREFIX) && e.start === VERIFY_PREFIX.length;
    if (!isFirstArgument && !isVerifyArgument) return next(e);
    const { suggestions } = await next(e);
    const candidates = isFirstArgument
      ? FIRST_ARGUMENT_SUGGESTIONS
      : VERIFY_ARGUMENT_SUGGESTIONS;
    const matchingCandidates = candidates.filter((candidate) =>
      candidate.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingCandidates] };
  });
};
