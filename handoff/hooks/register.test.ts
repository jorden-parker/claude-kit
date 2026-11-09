import type { On } from "claude-code";
import { expect, mock, test, type TestBody } from "claude-code/testing";

const MODEL_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const FILLED_MESSAGE =
  "Recap filled into the composer. Edit it or press Enter.";

const buildSessionMessage = (role: "user" | "assistant", text: string) => ({
  role,
  text,
  toolUses: [],
});

type SessionMessageRow = ReturnType<typeof buildSessionMessage>;

const CONVERSATION = [
  buildSessionMessage("user", "Fix the login bug in auth.ts"),
  buildSessionMessage("assistant", "I changed auth.ts and ran pnpm test"),
];

const testWithSession = (
  name: string,
  messages: SessionMessageRow[],
  body: TestBody
) =>
  test(name, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: messages }));
    return body($, on);
  });

const refuseFill = () => ({ isFilled: false, refusal: "no_composer" as const });

const handoff = (args: string) => ({
  command: "handoff",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 80 },
});

testWithSession(
  "an empty session returns the no-recap line without a model call",
  [],
  async ($, on) => {
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: { isAnswered: true, text: "x", usage: MODEL_USAGE } };
    });

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Nothing to recap yet.");
    expect(modelCalls).toBe(0);
  }
);

testWithSession(
  "a session with only blank messages returns the no-recap line",
  [buildSessionMessage("user", "   ")],
  async ($, on) => {
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: { isAnswered: true, text: "x", usage: MODEL_USAGE } };
    });

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Nothing to recap yet.");
    expect(modelCalls).toBe(0);
  }
);

testWithSession(
  "the model prompt carries the working directory and the conversation",
  CONVERSATION,
  async ($, on) => {
    const prompts: string[] = [];
    on("prompt.fill", () => ({ isFilled: true }));
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
      };
    });

    await $.command.run(handoff(""));

    expect(prompts[0]).toContain("Working directory: /repo");
    expect(prompts[0]).toContain("user: Fix the login bug in auth.ts");
    expect(prompts[0]).toContain(
      "assistant: I changed auth.ts and ran pnpm test"
    );
    expect(prompts[0]).not.toContain("<focus>");
  }
);

const LONG_CONVERSATION = Array.from({ length: 45 }, (_, index) =>
  buildSessionMessage("user", `message ${index}`)
);

testWithSession(
  "only the last 40 non-empty messages are sent, each truncated",
  [...LONG_CONVERSATION, buildSessionMessage("assistant", "y".repeat(1600))],
  async ($, on) => {
    const prompts: string[] = [];
    on("prompt.fill", () => ({ isFilled: true }));
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
      };
    });

    await $.command.run(handoff(""));

    expect(prompts[0]).not.toContain("user: message 5\n");
    expect(prompts[0]).toContain("user: message 6\n");
    expect(prompts[0]).toContain("user: message 44\n");
    expect(prompts[0]).toContain(`assistant: ${"y".repeat(1500)}…`);
    expect(prompts[0]).not.toContain("y".repeat(1501));
  }
);

testWithSession(
  "a focus argument is passed inside focus tags",
  CONVERSATION,
  async ($, on) => {
    const prompts: string[] = [];
    on("prompt.fill", () => ({ isFilled: true }));
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
      };
    });

    await $.command.run(handoff("  the auth change  "));

    expect(prompts[0]).toContain("<focus>\nthe auth change\n</focus>");
  }
);

testWithSession(
  "the recap is filled into the composer instead of copied",
  CONVERSATION,
  async ($, on) => {
    const fills: { text: string; mode?: string }[] = [];
    let copies = 0;
    on("model.complete", () => ({
      value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
    }));
    on("prompt.fill", (_, e) => {
      fills.push({ text: e.text, mode: e.mode });
      return { isFilled: true };
    });
    on("ui.copy", () => {
      copies += 1;
      return { value: { isCopied: true } };
    });

    const reply = await $.command.run(handoff(""));

    expect(fills).toEqual([{ text: "Resume prompt", mode: "replace" }]);
    expect(copies).toBe(0);
    expect(reply.text).toBe(FILLED_MESSAGE);
    expect(reply.context).toEqual(["Resume prompt"]);
  }
);

testWithSession(
  "when the composer refuses, the recap is copied to the clipboard",
  CONVERSATION,
  async ($, on) => {
    on("prompt.fill", refuseFill);
    const copiedTexts: string[] = [];
    on("ui.copy", (_, e) => {
      copiedTexts.push(e.text);
      return { value: { isCopied: true } };
    });
    on("model.complete", () => ({
      value: { isAnswered: true, text: " Resume prompt\n", usage: MODEL_USAGE },
    }));

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Resume prompt\n\n(Copied to clipboard)");
    expect(reply.context).toEqual(["Resume prompt"]);
    expect(copiedTexts).toEqual(["Resume prompt"]);
  }
);

testWithSession(
  "a failed copy returns the bare recap",
  CONVERSATION,
  async ($, on) => {
    on("prompt.fill", refuseFill);
    on("model.complete", () => ({
      value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
    }));
    on("ui.copy", () => ({
      value: { isCopied: false, reason: "no-clipboard" },
    }));

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Resume prompt");
    expect(reply.context).toEqual(["Resume prompt"]);
  }
);

testWithSession(
  "a failed model call returns the error line",
  CONVERSATION,
  async ($, on) => {
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
        usage: MODEL_USAGE,
      },
    }));

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Could not build the recap (api-error).");
    expect(copies).toBe(0);
  }
);

testWithSession(
  "an empty model reply returns the empty-reply line",
  CONVERSATION,
  async ($, on) => {
    on("model.complete", () => ({
      value: { isAnswered: true, text: "```\n```", usage: MODEL_USAGE },
    }));

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Could not build the recap (empty reply).");
  }
);

testWithSession(
  "a wrapping code fence is stripped and any other text is filled verbatim",
  CONVERSATION,
  async ($, on) => {
    const fills: string[] = [];
    const modelReplies = [
      "```text\nResume prompt\n```",
      "```\nResume prompt\n```\n",
      '"Resume prompt"',
    ];
    on("model.complete", () => ({
      value: {
        isAnswered: true,
        text: modelReplies.shift()!,
        usage: MODEL_USAGE,
      },
    }));
    on("prompt.fill", (_, e) => {
      fills.push(e.text);
      return { isFilled: true };
    });

    for (let i = 0; i < 3; i++) await $.command.run(handoff(""));

    expect(fills).toEqual([
      "Resume prompt",
      "Resume prompt",
      '"Resume prompt"',
    ]);
  }
);

const HANDING_OFF_MESSAGE = "Handing off to a new session…";
const PENDING_HANDOFF_KEY = "pendingHandoff";

const sessionStart = () => ({
  cwd: "/repo",
  surface: "terminal" as const,
  isInteractive: true,
});

const ignoreToasts = (on: On) => {
  on("ui.toast", () => ({ value: undefined }));
};

const mockStore = (on: On, entries: Record<string, unknown> = {}) => {
  const store = new Map(Object.entries(entries));
  on("store.get", (_, e) => ({ value: store.get(e.key) }));
  on("store.set", (_, e) => {
    store.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", (_, e) => {
    store.delete(e.key);
    return { value: undefined };
  });
  return store;
};

const allowSessionStart = (on: On) => {
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
};

testWithSession(
  "--new clears the session, then submits the recap as the first prompt",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const store = mockStore(on);
    const handoffSteps: string[] = [];
    let fills = 0;
    on("model.complete", () => ({
      value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
    }));
    on("prompt.fill", () => {
      fills += 1;
      return { isFilled: true };
    });
    on("command.run", { command: "clear" }, () => {
      handoffSteps.push("clear");
      return { text: "" };
    });
    on("prompt.submit", (_, e) => {
      handoffSteps.push(`submit:${e.text}:${e.origin?.kind}`);
      return { text: e.text };
    });

    const reply = await $.command.run(handoff("--new"));
    expect(reply.text).toBe(HANDING_OFF_MESSAGE);
    expect(handoffSteps).toEqual([]);

    await clock.settle();

    expect(handoffSteps).toEqual(["clear", "submit:Resume prompt:plugin"]);
    expect(fills).toBe(0);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
  }
);

testWithSession(
  "--new keeps the rest of the arguments as the focus",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const store = mockStore(on);
    const prompts: string[] = [];
    on("model.complete", (_, e) => {
      prompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
      };
    });
    on("command.run", { command: "clear" }, () => ({ text: "" }));
    on("prompt.submit", (_, e) => ({ text: e.text }));

    await $.command.run(handoff("the auth change --new"));
    await clock.settle();

    expect(prompts[0]).toContain("<focus>\nthe auth change\n</focus>");
  }
);

testWithSession(
  "--new falls back to the composer when the session cannot be cleared",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const store = mockStore(on);
    const fills: string[] = [];
    let submits = 0;
    on("model.complete", () => ({
      value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
    }));
    on("command.run", { command: "clear" }, () => {
      throw new Error("not now");
    });
    on("prompt.submit", (_, e) => {
      submits += 1;
      return { text: e.text };
    });
    on("prompt.fill", (_, e) => {
      fills.push(e.text);
      return { isFilled: true };
    });

    await $.command.run(handoff("--new"));
    await clock.settle();

    expect(fills).toEqual(["Resume prompt"]);
    expect(submits).toBe(0);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
  }
);

testWithSession(
  "a pending handoff is filled into the composer when a session starts",
  [],
  async ($, on) => {
    allowSessionStart(on);
    const store = mockStore(on, { [PENDING_HANDOFF_KEY]: "Resume prompt" });
    const fills: { text: string; mode?: string }[] = [];
    on("prompt.fill", (_, e) => {
      fills.push({ text: e.text, mode: e.mode });
      return { isFilled: true };
    });

    await $.session.start(sessionStart());

    expect(fills).toEqual([{ text: "Resume prompt", mode: "replace" }]);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
  }
);

testWithSession(
  "a pending handoff stays stored when the composer refuses it",
  [],
  async ($, on) => {
    allowSessionStart(on);
    const store = mockStore(on, { [PENDING_HANDOFF_KEY]: "Resume prompt" });
    on("prompt.fill", refuseFill);

    await $.session.start(sessionStart());

    expect(store.get(PENDING_HANDOFF_KEY)).toBe("Resume prompt");
  }
);

testWithSession(
  "a session with nothing pending starts without touching the composer",
  [],
  async ($, on) => {
    allowSessionStart(on);
    mockStore(on);
    let fills = 0;
    on("prompt.fill", () => {
      fills += 1;
      return { isFilled: true };
    });

    await $.session.start(sessionStart());

    expect(fills).toBe(0);
  }
);
