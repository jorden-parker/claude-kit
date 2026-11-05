import { expect, test } from "claude-code/testing";

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const optimize = (args: string) => ({
  command: "optimize",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 80 },
});

test("optimize returns the rewritten prompt and copies it", async ($, on) => {
  const prompts: string[] = [];
  const copied: string[] = [];
  on("ui.copy", (_, e) => {
    copied.push(e.text);
    return { value: { isCopied: true } };
  });
  on("model.complete", (_, e) => {
    prompts.push(e.prompt);
    return {
      value: { isAnswered: true, text: " Better prompt\n", usage: USAGE },
    };
  });

  const reply = await $.command.run(optimize("fix bug"));

  expect(reply.text).toBe("Better prompt\n\n(Copied to clipboard)");
  expect(copied).toEqual(["Better prompt"]);
  expect(prompts).toEqual(["fix bug"]);
});

test('only the text after the last "Rewritten prompt:" marker is used', async ($, on) => {
  const copied: string[] = [];
  on("ui.copy", (_, e) => {
    copied.push(e.text);
    return { value: { isCopied: true } };
  });
  on("model.complete", () => ({
    value: {
      isAnswered: true,
      text: 'Rewrite the draft…\n\nDraft: "fix bug"\n\nRewritten prompt:\n\nBetter prompt\n',
      usage: USAGE,
    },
  }));

  const reply = await $.command.run(optimize("fix bug"));

  expect(copied).toEqual(["Better prompt"]);
  expect(reply.text).toBe("Better prompt\n\n(Copied to clipboard)");
});

test("a failed copy returns the bare prompt", async ($, on) => {
  on("model.complete", () => ({
    value: { isAnswered: true, text: "Better prompt", usage: USAGE },
  }));
  on("ui.copy", () => ({
    value: { isCopied: false, reason: "no-clipboard" },
  }));

  const reply = await $.command.run(optimize("fix bug"));

  expect(reply.text).toBe("Better prompt");
});

test("empty args return the usage line without a model call", async ($, on) => {
  let calls = 0;
  let copies = 0;
  on("ui.copy", () => {
    copies += 1;
    return { value: { isCopied: true } };
  });
  on("model.complete", () => {
    calls += 1;
    return { value: { isAnswered: true, text: "x", usage: USAGE } };
  });

  const reply = await $.command.run(optimize("  "));

  expect(reply.text).toBe("Usage: /optimize <prompt>");
  expect(calls).toBe(0);
  expect(copies).toBe(0);
});

test("a failed model call returns the error line", async ($, on) => {
  let copies = 0;
  on("ui.copy", () => {
    copies += 1;
    return { value: { isCopied: true } };
  });
  on("model.complete", () => ({
    value: {
      isAnswered: false,
      reason: "api-error",
      status: 500,
      error: "server_error",
      usage: USAGE,
    },
  }));

  const reply = await $.command.run(optimize("fix bug"));

  expect(reply.text).toBe("Could not optimize the prompt (api-error).");
  expect(copies).toBe(0);
});
