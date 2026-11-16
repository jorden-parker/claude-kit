import type { PromptSubmitAttachment } from "claude-code";
import { expect, test, type TestBody } from "claude-code/testing";

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const CLOUD_OPTIONS = { options: { model: "sonnet" } };

const testWithEmptySession = (
  name: string,
  body: TestBody,
  selectedText?: string
) =>
  test(name, CLOUD_OPTIONS, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: [] }));
    on("session.model", () => ({ value: "sonnet" }));
    on("ui.selection", () => ({
      value: selectedText === undefined ? undefined : { text: selectedText },
    }));
    return body($, on);
  });

const refuseFill = () => ({ isFilled: false, refusal: "no_composer" as const });

const submitFromComposer = (
  text: string,
  attachments?: PromptSubmitAttachment[]
) => ({
  text,
  wait: false,
  origin: { kind: "composer" as const },
  ...(attachments ? { attachments } : {}),
});

const optimize = (args: string) => ({
  command: "optimize",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 80 },
});

testWithEmptySession(
  "optimize returns the rewritten prompt and copies it",
  async ($, on) => {
    on("prompt.fill", refuseFill);
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
    expect(reply.context).toEqual(["Better prompt"]);
    expect(copied).toEqual(["Better prompt"]);
    expect(prompts[0]).toContain("<draft>\nfix bug\n</draft>");
  }
);

testWithEmptySession(
  'only the text after the last "Rewritten prompt:" marker is used',
  async ($, on) => {
    on("prompt.fill", refuseFill);
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
  }
);

testWithEmptySession("a failed copy returns the bare prompt", async ($, on) => {
  on("prompt.fill", refuseFill);
  on("model.complete", () => ({
    value: { isAnswered: true, text: "Better prompt", usage: USAGE },
  }));
  on("ui.copy", () => ({
    value: { isCopied: false, reason: "no-clipboard" },
  }));

  const reply = await $.command.run(optimize("fix bug"));

  expect(reply.text).toBe("Better prompt");
  expect(reply.context).toEqual(["Better prompt"]);
});

testWithEmptySession(
  "empty args return the usage line without a model call",
  async ($, on) => {
    let modelCalls = 0;
    let copies = 0;
    on("ui.copy", () => {
      copies += 1;
      return { value: { isCopied: true } };
    });
    on("model.complete", () => {
      modelCalls += 1;
      return { value: { isAnswered: true, text: "x", usage: USAGE } };
    });

    const reply = await $.command.run(optimize("  "));

    expect(reply.text).toBe(
      "Usage: /optimize <prompt>, or select text in the transcript and run /optimize."
    );
    expect(modelCalls).toBe(0);
    expect(copies).toBe(0);
  }
);

testWithEmptySession(
  "a failed model call returns the error line",
  async ($, on) => {
    on("clock.sleep", () => ({ value: undefined }));
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

    expect(reply.text).toBe(
      "Could not optimize the prompt (API error 500, server_error)."
    );
    expect(copies).toBe(0);
  }
);

testWithEmptySession(
  "the optimized prompt is filled into the composer instead of copied",
  async ($, on) => {
    const fills: { text: string; mode?: string }[] = [];
    let copies = 0;
    on("model.complete", () => ({
      value: { isAnswered: true, text: "Better prompt", usage: USAGE },
    }));
    on("prompt.fill", (_, e) => {
      fills.push({ text: e.text, mode: e.mode });
      return { isFilled: true };
    });
    on("ui.copy", () => {
      copies += 1;
      return { value: { isCopied: true } };
    });

    const reply = await $.command.run(optimize("fix bug"));

    expect(fills).toEqual([{ text: "Better prompt", mode: "replace" }]);
    expect(copies).toBe(0);
    expect(reply.text).toBe(
      "Prompt filled into the composer. Edit it or press Enter."
    );
  }
);

testWithEmptySession(
  "wrapping code fences and quotes are stripped from the model output",
  async ($, on) => {
    const fills: string[] = [];
    const modelReplies = [
      "```text\nBetter prompt\n```",
      '"Better prompt"',
      "'Better prompt'",
      'Rewritten prompt:\n```\n"Better prompt"\n```\n',
    ];
    on("model.complete", () => ({
      value: { isAnswered: true, text: modelReplies.shift()!, usage: USAGE },
    }));
    on("prompt.fill", (_, e) => {
      fills.push(e.text);
      return { isFilled: true };
    });

    for (let i = 0; i < 4; i++) await $.command.run(optimize("fix bug"));

    expect(fills).toEqual([
      "Better prompt",
      "Better prompt",
      "Better prompt",
      "Better prompt",
    ]);
  }
);

const buildSessionMessage = (role: "user" | "assistant", text: string) => ({
  role,
  text,
  toolUses: [],
});

test(
  "the model prompt carries the working directory, the last six non-blank messages and the delimited draft",
  CLOUD_OPTIONS,
  async ($, on) => {
    const prompts: string[] = [];
    const longText = "x".repeat(600);
    on("session.cwd", () => ({
      value: "/Users/jorden/src/claude-kit/plugins/prompt-optimizer",
    }));
    on("session.messages", () => ({
      value: [
        buildSessionMessage("user", "dropped"),
        buildSessionMessage("assistant", "first kept"),
        buildSessionMessage("user", longText),
        buildSessionMessage("assistant", "The bug is in hooks/register.ts"),
        buildSessionMessage("user", ""),
        buildSessionMessage("assistant", "a"),
        buildSessionMessage("user", "b"),
        buildSessionMessage("assistant", "last kept"),
      ],
    }));
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("fix the bug"));

    const [prompt] = prompts;
    expect(prompt).toContain(
      "Working directory: /Users/jorden/src/claude-kit/plugins/prompt-optimizer"
    );
    expect(prompt).not.toContain("dropped");
    expect(prompt).toContain("assistant: first kept");
    expect(prompt).toContain("user: " + "x".repeat(500) + "…");
    expect(prompt).not.toContain("x".repeat(501));
    expect(prompt).toContain("assistant: The bug is in hooks/register.ts");
    expect(prompt).not.toContain("user: \n");
    expect(prompt).toContain("assistant: last kept");
    expect(prompt).toContain("<draft>\nfix the bug\n</draft>");
  }
);

test(
  "a long message cut at an emoji keeps the prompt valid UTF-16",
  CLOUD_OPTIONS,
  async ($, on) => {
    const prompts: string[] = [];
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({
      value: [buildSessionMessage("assistant", "x".repeat(499) + "🤖 tail")],
    }));
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("fix the bug"));

    const [prompt] = prompts;
    expect(prompt).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    );
    expect(prompt).toContain("assistant: " + "x".repeat(499) + "🤖…");
  }
);

test("the command registers with an argument hint and does not run mid-turn", async ($, on) => {
  const registeredCommands: { argumentHint?: string; immediate?: true }[] = [];
  on("command.register", (_, e) => {
    registeredCommands.push({
      argumentHint: e.argumentHint,
      immediate: e.immediate,
    });
    return { value: { command: "optimize" } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(registeredCommands).toEqual([
    { argumentHint: "[draft, or select text first]", immediate: undefined },
  ]);
});

testWithEmptySession(
  "a toast shows before the model call and the filled prompt reaches the model as context",
  async ($, on) => {
    const callOrder: string[] = [];
    on("ui.toast", (_, e) => {
      callOrder.push(`toast:${e.text}`);
      return { value: undefined };
    });
    on("model.complete", () => {
      callOrder.push("model");
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    const reply = await $.command.run(optimize("fix bug"));

    expect(callOrder).toEqual(["toast:Optimizing prompt…", "model"]);
    expect(reply.context).toEqual(["Better prompt"]);
  }
);

testWithEmptySession(
  "an empty rewrite reports an error without touching the composer or clipboard",
  async ($, on) => {
    let fills = 0;
    let copies = 0;
    const modelReplies = ["```\n```", '""', "Rewritten prompt:", "   \n"];
    on("model.complete", () => ({
      value: { isAnswered: true, text: modelReplies.shift()!, usage: USAGE },
    }));
    on("prompt.fill", () => {
      fills += 1;
      return { isFilled: true };
    });
    on("ui.copy", () => {
      copies += 1;
      return { value: { isCopied: true } };
    });

    const commandReplies: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      commandReplies.push((await $.command.run(optimize("fix bug"))).text);
    }

    expect(commandReplies).toEqual(
      Array(4).fill("Could not optimize the prompt (empty reply).")
    );
    expect(fills).toBe(0);
    expect(copies).toBe(0);
  }
);

testWithEmptySession(
  "quotes are stripped only when the inner text holds none of that quote character",
  async ($, on) => {
    const fills: string[] = [];
    const modelReplies = ["'Fix x' and 'add y'", '"Fix the bug"'];
    on("model.complete", () => ({
      value: { isAnswered: true, text: modelReplies.shift()!, usage: USAGE },
    }));
    on("prompt.fill", (_, e) => {
      fills.push(e.text);
      return { isFilled: true };
    });

    for (let i = 0; i < 2; i++) await $.command.run(optimize("fix bug"));

    expect(fills).toEqual(["'Fix x' and 'add y'", "Fix the bug"]);
  }
);

const API_ERROR_REPLY = {
  isAnswered: false,
  reason: "api-error",
  status: 400,
  error: "invalid_request",
  usage: USAGE,
} as const;

test(
  "an API error on the configured model retries once on the session's model",
  CLOUD_OPTIONS,
  async ($, on) => {
    const models: string[] = [];
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: [] }));
    on("session.model", () => ({ value: "claude-opus-5-5" }));
    on("model.complete", (_, e) => {
      models.push(e.model);
      return {
        value:
          models.length === 1
            ? API_ERROR_REPLY
            : { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    const reply = await $.command.run(optimize("fix bug"));

    expect(models).toEqual(["sonnet", "claude-opus-5-5"]);
    expect(reply.text).toBe(
      "Prompt filled into the composer. Edit it or press Enter."
    );
  }
);

const RATE_LIMIT_REPLY = {
  isAnswered: false,
  reason: "api-error",
  status: 429,
  error: "rate_limit",
  usage: USAGE,
} as const;

testWithEmptySession(
  "a rate-limited call is retried on the same model after backing off",
  async ($, on) => {
    const models: string[] = [];
    const waits: number[] = [];
    on("clock.sleep", (_, e) => {
      waits.push(e.ms);
      return { value: undefined };
    });
    on("model.complete", (_, e) => {
      models.push(e.model);
      return {
        value:
          models.length < 3
            ? RATE_LIMIT_REPLY
            : { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    const reply = await $.command.run(optimize("fix bug"));

    expect(models).toEqual(["sonnet", "sonnet", "sonnet"]);
    expect(waits).toEqual([1000, 2000]);
    expect(reply.text).toBe(
      "Prompt filled into the composer. Edit it or press Enter."
    );
  }
);

testWithEmptySession(
  "a call still rate-limited after every backoff returns the error line",
  async ($, on) => {
    const waits: number[] = [];
    on("clock.sleep", (_, e) => {
      waits.push(e.ms);
      return { value: undefined };
    });
    on("model.complete", () => ({ value: RATE_LIMIT_REPLY }));

    const reply = await $.command.run(optimize("fix bug"));

    expect(waits).toEqual([1000, 2000, 4000]);
    expect(reply.text).toBe(
      "Could not optimize the prompt (API error 429, rate_limit)."
    );
  }
);

testWithEmptySession(
  "a request the API rejects is not retried after a backoff",
  async ($, on) => {
    const waits: number[] = [];
    on("clock.sleep", (_, e) => {
      waits.push(e.ms);
      return { value: undefined };
    });
    on("model.complete", () => ({ value: API_ERROR_REPLY }));

    await $.command.run(optimize("fix bug"));

    expect(waits).toEqual([]);
  }
);

testWithEmptySession(
  "an API error is not retried when the session already runs the configured model",
  async ($, on) => {
    const models: string[] = [];
    on("model.complete", (_, e) => {
      models.push(e.model);
      return { value: API_ERROR_REPLY };
    });

    const reply = await $.command.run(optimize("fix bug"));

    expect(models).toEqual(["sonnet"]);
    expect(reply.text).toBe(
      "Could not optimize the prompt (API error 400, invalid_request)."
    );
  }
);

testWithEmptySession(
  "a failed model call exits non-zero in a headless run",
  async ($, on) => {
    on("clock.sleep", () => ({ value: undefined }));
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

    expect(reply.exitCode).toBe(1);
  }
);

testWithEmptySession(
  "an empty rewrite and empty args exit non-zero in a headless run",
  async ($, on) => {
    on("model.complete", () => ({
      value: { isAnswered: true, text: "   ", usage: USAGE },
    }));

    const emptyRewriteReply = await $.command.run(optimize("fix bug"));
    const emptyArgsReply = await $.command.run(optimize(""));

    expect(emptyRewriteReply.exitCode).toBe(1);
    expect(emptyArgsReply.exitCode).toBe(1);
  }
);

testWithEmptySession(
  "a successful rewrite leaves the exit code alone",
  async ($, on) => {
    on("model.complete", () => ({
      value: { isAnswered: true, text: "Better prompt", usage: USAGE },
    }));
    on("prompt.fill", () => ({ isFilled: true }));

    const reply = await $.command.run(optimize("fix bug"));

    expect(reply.exitCode).toBe(undefined);
  }
);

testWithEmptySession(
  "with no args the selected transcript text is the draft",
  async ($, on) => {
    const prompts: string[] = [];
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    const reply = await $.command.run(optimize(""));

    expect(prompts[0]).toContain("<draft>\nmake the tests faster\n</draft>");
    expect(reply.text).toBe(
      "Prompt filled into the composer. Edit it or press Enter."
    );
  },
  "  make the tests faster  "
);

testWithEmptySession(
  "with no args and no selection the usage line names both ways",
  async ($, on) => {
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: { isAnswered: true, text: "x", usage: USAGE } };
    });

    const reply = await $.command.run(optimize(""));

    expect(reply.text).toBe(
      "Usage: /optimize <prompt>, or select text in the transcript and run /optimize."
    );
    expect(modelCalls).toBe(0);
  }
);

testWithEmptySession(
  "typed args win over a selection",
  async ($, on) => {
    const prompts: string[] = [];
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("typed"));

    expect(prompts[0]).toContain("<draft>\ntyped\n</draft>");
    expect(prompts[0]).not.toContain("selected");
  },
  "selected"
);

test(
  "the rewrite uses the configured model and appends the configured instructions to the rules",
  { options: { model: "sonnet", instructions: "Always mention TDD." } },
  async ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: [] }));
    const requests: { model: string; system?: string }[] = [];
    on("model.complete", (_, e) => {
      requests.push({ model: e.model, system: e.system });
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("fix bug"));

    expect(requests[0]?.model).toBe("sonnet");
    expect(requests[0]?.system).toContain("Output only the rewritten prompt");
    expect(requests[0]?.system?.endsWith("Always mention TDD.")).toBe(true);
  }
);

testWithEmptySession(
  "with no extra instructions the rules end with the output rule",
  async ($, on) => {
    const requests: { model: string; system?: string }[] = [];
    on("model.complete", (_, e) => {
      requests.push({ model: e.model, system: e.system });
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("fix bug"));

    expect(requests[0]?.model).toBe("sonnet");
    expect(requests[0]?.system).toContain(
      "Keep every action, target and constraint"
    );
    expect(
      requests[0]?.system?.endsWith(
        "Output only the rewritten prompt, with no preamble, quotes or explanation."
      )
    ).toBe(true);
  }
);

testWithEmptySession(
  "images attached to an /optimize submission are named for the model as part of the optimized prompt",
  async ($, on) => {
    const enteredSubmissions: { text: string; context?: readonly string[] }[] =
      [];
    on("prompt.submit", (_, e) => {
      enteredSubmissions.push({ text: e.text, context: e.context });
      return { text: e.text };
    });

    await $.prompt.submit(
      submitFromComposer("/optimize fix the layout bug", [
        { type: "image", mediaType: "image/png", filename: "before.png" },
        { type: "image", mediaType: "image/jpeg" },
        {
          type: "document",
          mediaType: "application/pdf",
          filename: "spec.pdf",
        },
      ])
    );

    expect(enteredSubmissions[0]?.text).toBe("/optimize fix the layout bug");
    expect(enteredSubmissions[0]?.context).toEqual([
      "The /optimize command above was submitted with 2 attached images: before.png (image/png), image 2 (image/jpeg). They belong with the optimized prompt; refer to them when it runs.",
    ]);
  }
);

testWithEmptySession(
  "submissions without images, and non-optimize submissions with images, get no attachment context",
  async ($, on) => {
    const contexts: (readonly string[] | undefined)[] = [];
    on("prompt.submit", (_, e) => {
      contexts.push(e.context);
      return { text: e.text };
    });

    await $.prompt.submit(submitFromComposer("/optimize fix the bug"));
    await $.prompt.submit(
      submitFromComposer("fix the bug", [
        { type: "image", mediaType: "image/png" },
      ])
    );
    await $.prompt.submit(
      submitFromComposer("/optimize fix the bug", [
        {
          type: "document",
          mediaType: "application/pdf",
          filename: "spec.pdf",
        },
      ])
    );

    expect(contexts).toEqual([undefined, undefined, undefined]);
  }
);

testWithEmptySession(
  "a reply that opens by saying what the rewriter could not see keeps only the rewrite",
  async ($, on) => {
    const filledPromptTexts: string[] = [];
    on("model.complete", () => ({
      value: {
        isAnswered: true,
        text: "I can't see the codebase or the referenced \"[Image #4]\" from here, so the rewrite below keeps the draft's requests intact and marks where specifics are needed.\n\nWorking directory: /repo\n\nUsing the /frontend-design skill, make the following changes:\n\n1. Fix the layout bug shown in [Image #4].",
        usage: USAGE,
      },
    }));
    on("prompt.fill", (_, e) => {
      filledPromptTexts.push(e.text);
      return { isFilled: true };
    });

    await $.command.run(optimize("fix the layout bug [Image #4]"));

    expect(filledPromptTexts).toEqual([
      "Using the /frontend-design skill, make the following changes:\n\n1. Fix the layout bug shown in [Image #4].",
    ]);
  }
);

testWithEmptySession(
  "a draft that itself says what the author cannot see keeps its first paragraph",
  async ($, on) => {
    const filledPromptTexts: string[] = [];
    const rewrittenPrompt =
      "I can't see the submit button on small screens.\n\nFix the layout in form.css.";
    on("model.complete", () => ({
      value: { isAnswered: true, text: rewrittenPrompt, usage: USAGE },
    }));
    on("prompt.fill", (_, e) => {
      filledPromptTexts.push(e.text);
      return { isFilled: true };
    });

    await $.command.run(
      optimize("i can't see the submit button on small screens, fix form.css")
    );

    expect(filledPromptTexts).toEqual([rewrittenPrompt]);
  }
);

testWithEmptySession(
  "the rules tell the rewriter it has no file or image access and to keep image references verbatim",
  async ($, on) => {
    const systemPrompts: (string | undefined)[] = [];
    on("model.complete", (_, e) => {
      systemPrompts.push(e.system);
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("fix bug"));

    const [system] = systemPrompts;
    expect(system).toContain("You cannot open files or view images");
    expect(system).toContain("Never say what you cannot see");
    expect(system).toContain("[Image #N]");
    expect(system).toContain("Do not restate the working directory");
  }
);

testWithEmptySession(
  "images attached to the /optimize submission are listed for the rewriter once",
  async ($, on) => {
    const prompts: string[] = [];
    on("prompt.submit", (_, e) => ({ text: e.text }));
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Better prompt", usage: USAGE },
      };
    });
    on("prompt.fill", () => ({ isFilled: true }));

    await $.prompt.submit(
      submitFromComposer("/optimize fix the layout bug", [
        { type: "image", mediaType: "image/png", filename: "before.png" },
      ])
    );
    await $.command.run(optimize("fix the layout bug"));
    await $.command.run(optimize("fix the other bug"));

    expect(prompts[0]).toContain(
      "Attached images (the agent will see them; the rewriter does not): before.png (image/png)"
    );
    expect(prompts[1]).not.toContain("Attached images");
  }
);

const OLLAMA_URL = "http://127.0.0.1:11434";

const buildHttpResponse = (status: number, body: unknown) => ({
  value: {
    status,
    ok: status < 400,
    headers: {},
    text: JSON.stringify(body),
  },
});

const waitForever = () => new Promise<never>(() => {});

type OllamaRequest = { url: string; body: Record<string, unknown> };

const answerOllama =
  (
    requests: OllamaRequest[],
    loadedModels: string[],
    chatReply = buildHttpResponse(200, {
      message: { role: "assistant", content: "Better prompt" },
    })
  ) =>
  (_: unknown, e: { url: string; init?: { body?: string } }) => {
    requests.push({ url: e.url, body: JSON.parse(e.init?.body ?? "{}") });
    return e.url.endsWith("/api/ps")
      ? buildHttpResponse(200, {
          models: loadedModels.map((name) => ({ name, model: name })),
        })
      : chatReply;
  };

const testLocalRewrite = (
  name: string,
  body: TestBody,
  answerSleep: (
    _: unknown,
    e: { ms: number }
  ) => Promise<never> | { value: undefined } = waitForever
) =>
  test(name, { options: {} }, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: [] }));
    on("session.model", () => ({ value: "sonnet" }));
    on("ui.selection", () => ({ value: undefined }));
    on("clock.sleep", answerSleep);
    return body($, on);
  });

testLocalRewrite(
  "by default the rewrite runs on the model Ollama has loaded, with thinking off",
  async ($, on) => {
    const requests: OllamaRequest[] = [];
    let cloudCallCount = 0;
    let commandCount = 0;
    on("http.fetch", answerOllama(requests, ["granite4.2:3b"]));
    on("process.run", () => {
      commandCount += 1;
      return {
        value: {
          exitCode: 1,
          stdout: "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    });
    on("model.complete", () => {
      cloudCallCount += 1;
      return { value: { isAnswered: true, text: "cloud", usage: USAGE } };
    });
    const filled: string[] = [];
    on("prompt.fill", (_, e) => {
      filled.push(e.text);
      return { isFilled: true };
    });

    await $.command.run(optimize("fix bug"));

    expect(requests.map((request) => request.url)).toEqual([
      `${OLLAMA_URL}/api/ps`,
      `${OLLAMA_URL}/api/chat`,
    ]);
    const chat = requests[1]?.body ?? {};
    expect(chat.model).toBe("granite4.2:3b");
    expect(chat.stream).toBe(false);
    expect(chat.think).toBe(false);
    expect(chat.options).toEqual({ num_predict: 1024 });
    expect(JSON.stringify(chat.messages)).toContain(
      "Output only the rewritten prompt"
    );
    expect(JSON.stringify(chat.messages)).toContain(
      "<draft>\\nfix bug\\n</draft>"
    );
    expect(cloudCallCount).toBe(0);
    expect(commandCount).toBe(0);
    expect(filled).toEqual(["Better prompt"]);
  }
);

testLocalRewrite(
  "with no model loaded the rewrite loads the plugin's own model",
  async ($, on) => {
    const requests: OllamaRequest[] = [];
    on("http.fetch", answerOllama(requests, []));
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(optimize("fix bug"));

    expect(requests[1]?.body.model).toBe("qwen3:4b-instruct-2507-q4_K_M");
  }
);

testLocalRewrite(
  "an Ollama error reply names its status and message",
  async ($, on) => {
    on(
      "http.fetch",
      answerOllama(
        [],
        [],
        buildHttpResponse(404, {
          error:
            'model "qwen3:4b-instruct-2507-q4_K_M" not found, try pulling it first',
        })
      )
    );

    const reply = await $.command.run(optimize("fix bug"));

    expect(reply.text).toBe(
      'Could not optimize the prompt (Ollama error 404, model "qwen3:4b-instruct-2507-q4_K_M" not found, try pulling it first).'
    );
    expect(reply.exitCode).toBe(1);
  }
);

testLocalRewrite(
  "an unreachable Ollama server returns the error line instead of dropping the command",
  async ($, on) => {
    on("http.fetch", () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    });

    const reply = await $.command.run(optimize("fix bug"));

    expect(reply.text).toContain(
      `Could not optimize the prompt (Ollama at ${OLLAMA_URL} did not answer:`
    );
    expect(reply.exitCode).toBe(1);
  }
);

testLocalRewrite(
  "a rewrite that runs past 25 seconds fails before the host's 30 second fetch limit",
  async ($, on) => {
    on("http.fetch", (_, e) =>
      e.url.endsWith("/api/ps")
        ? buildHttpResponse(200, { models: [] })
        : waitForever()
    );

    const reply = await $.command.run(optimize("fix bug"));

    expect(reply.text).toBe(
      `Could not optimize the prompt (Ollama at ${OLLAMA_URL} did not answer within 25 seconds).`
    );
  },
  (_: unknown, e: { ms: number }) =>
    e.ms === 25000 ? { value: undefined } : waitForever()
);

testLocalRewrite(
  "an Ollama server that does not answer fails fast instead of hanging",
  async ($, on) => {
    on("http.fetch", waitForever);

    const reply = await $.command.run(optimize("fix bug"));

    expect(reply.text).toBe(
      `Could not optimize the prompt (Ollama at ${OLLAMA_URL} did not answer within 3 seconds).`
    );
    expect(reply.exitCode).toBe(1);
  },
  () => ({ value: undefined })
);
