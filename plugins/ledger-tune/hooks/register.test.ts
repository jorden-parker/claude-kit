import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, test, type Engine } from "claude-code/testing";

const autocompleteAt = (text: string) => {
  const start = text.search(/\S*$/);
  return { text, cursor: text.length, token: text.slice(start), start };
};

type AutocompleteCall = {
  autocomplete: (
    input: PromptAutocompleteInput
  ) => Promise<PromptAutocompleteResult>;
};

const autocomplete = ($: Engine, text: string) =>
  ($.prompt as unknown as AutocompleteCall).autocomplete(autocompleteAt(text));

const suggestedTexts = (reply: { suggestions: readonly { text: string }[] }) =>
  reply.suggestions.map((suggestion) => suggestion.text);

test("typing /ledger-tune with a space suggests read, apply and verify", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const emptyReply = await autocomplete($, "/ledger-tune ");

  expect(suggestedTexts(emptyReply)).toEqual(["read", "apply", "verify"]);
  expect(emptyReply.suggestions[0]!.description).toBe(
    "Recommend changes from the ledger data"
  );
});

test("a partial first word after /ledger-tune suggests only the matching subcommand", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const partReply = await autocomplete($, "/ledger-tune ve");

  expect(suggestedTexts(partReply)).toEqual(["verify"]);
});

test("the word after /ledger-tune verify suggests since", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const emptyReply = await autocomplete($, "/ledger-tune verify ");
  const partReply = await autocomplete($, "/ledger-tune verify s");

  expect(suggestedTexts(emptyReply)).toEqual(["since"]);
  expect(suggestedTexts(partReply)).toEqual(["since"]);
});

test("other commands, plain text and later words after read get no /ledger-tune suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const otherReply = await autocomplete($, "/other ");
  const plainReply = await autocomplete($, "ledger-tune ");
  const commandReply = await autocomplete($, "/ledger-tune");
  const laterWordReply = await autocomplete($, "/ledger-tune read ");

  expect(suggestedTexts(otherReply)).toEqual([]);
  expect(suggestedTexts(plainReply)).toEqual([]);
  expect(suggestedTexts(commandReply)).toEqual([]);
  expect(suggestedTexts(laterWordReply)).toEqual([]);
});

test("suggestions from other plugins are kept, the ledger-tune rows come after them", async ($, on) => {
  on("prompt.autocomplete", () => ({
    suggestions: [{ text: "other", description: "From another plugin" }],
  }));

  const reply = await autocomplete($, "/ledger-tune ");

  expect(suggestedTexts(reply)).toEqual(["other", "read", "apply", "verify"]);
});
