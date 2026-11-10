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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
    mockStore(on);
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
    mock.clock(on);
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

const HANDOFFS_KEY = "handoffs";
const NOVEMBER_NINTH = Date.UTC(2026, 10, 9, 14, 32);

const storedHandoff = (
  handoffId: number,
  recap: string,
  createdAt = NOVEMBER_NINTH,
  cwd = "/repo"
) => ({ handoffId, createdAt, cwd, focus: "", recap });

const answerRecap = (on: On, text = "Resume prompt") => {
  on("model.complete", () => ({
    value: { isAnswered: true, text, usage: MODEL_USAGE },
  }));
};

testWithSession(
  "a built recap is stored with an id, time, directory and focus",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const store = mockStore(on);
    answerRecap(on);
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(handoff("the auth change"));

    expect(store.get(HANDOFFS_KEY)).toEqual([
      {
        handoffId: 1,
        createdAt: NOVEMBER_NINTH,
        cwd: "/repo",
        focus: "the auth change",
        recap: "Resume prompt",
      },
    ]);
  }
);

testWithSession(
  "--new stores the recap too, with the next free id",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const store = mockStore(on, {
      [HANDOFFS_KEY]: [storedHandoff(4, "Older recap")],
    });
    answerRecap(on);
    on("command.run", { command: "clear" }, () => ({ text: "" }));
    on("prompt.submit", (_, e) => ({ text: e.text }));

    await $.command.run(handoff("--new"));
    await clock.settle();

    expect(store.get(HANDOFFS_KEY)).toEqual([
      storedHandoff(4, "Older recap"),
      storedHandoff(5, "Resume prompt"),
    ]);
  }
);

testWithSession(
  "only the latest 50 handoffs are kept",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const fiftyStoredHandoffs = Array.from({ length: 50 }, (_, index) =>
      storedHandoff(index + 1, `Recap ${index + 1}`)
    );
    const store = mockStore(on, { [HANDOFFS_KEY]: fiftyStoredHandoffs });
    answerRecap(on);
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(handoff(""));

    const storedHandoffs = store.get(HANDOFFS_KEY) as { handoffId: number }[];
    expect(storedHandoffs.length).toBe(50);
    expect(storedHandoffs[0]!.handoffId).toBe(2);
    expect(storedHandoffs[49]!.handoffId).toBe(51);
  }
);

testWithSession("--list with nothing stored says so", [], async ($, on) => {
  mockStore(on);

  const reply = await $.command.run(handoff("--list"));

  expect(reply.text).toBe(
    "No handoffs stored yet. Run /handoff to create one."
  );
});

testWithSession(
  "--list shows every stored handoff, newest first, with its first line",
  [],
  async ($, on) => {
    mockStore(on, {
      [HANDOFFS_KEY]: [
        storedHandoff(
          1,
          "Fix the login bug\n\nThe test in auth.test.ts fails."
        ),
        storedHandoff(
          2,
          "\nShip the release notes",
          Date.UTC(2026, 10, 10, 9, 5),
          "/other"
        ),
      ],
    });

    const reply = await $.command.run(handoff("--list"));

    expect(reply.text).toBe(
      [
        "#2  2026-11-10 09:05  /other  Ship the release notes",
        "#1  2026-11-09 14:32  /repo  Fix the login bug",
        "",
        "Run /handoff --resume <id> to continue one in a new session.",
      ].join("\n")
    );
  }
);

testWithSession(
  "--resume <id> clears the session and submits that stored recap",
  [],
  async ($, on) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const store = mockStore(on, {
      [HANDOFFS_KEY]: [
        storedHandoff(1, "First recap"),
        storedHandoff(2, "Second recap"),
      ],
    });
    const handoffSteps: string[] = [];
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: { isAnswered: true, text: "x", usage: MODEL_USAGE } };
    });
    on("command.run", { command: "clear" }, () => {
      handoffSteps.push("clear");
      return { text: "" };
    });
    on("prompt.submit", (_, e) => {
      handoffSteps.push(`submit:${e.text}`);
      return { text: e.text };
    });

    const reply = await $.command.run(handoff("--resume 2"));
    expect(reply.text).toBe(HANDING_OFF_MESSAGE);

    await clock.settle();

    expect(handoffSteps).toEqual(["clear", "submit:Second recap"]);
    expect(modelCalls).toBe(0);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
    expect((store.get(HANDOFFS_KEY) as unknown[]).length).toBe(2);
  }
);

testWithSession(
  "--resume with an unknown id names it and points to the list",
  [],
  async ($, on) => {
    mockStore(on, { [HANDOFFS_KEY]: [storedHandoff(1, "First recap")] });

    const reply = await $.command.run(handoff("--resume 9"));

    expect(reply.text).toBe(
      "No handoff #9. Run /handoff --list to see the stored handoffs."
    );
  }
);

testWithSession("--resume without an id shows the list", [], async ($, on) => {
  mockStore(on, { [HANDOFFS_KEY]: [storedHandoff(1, "First recap")] });

  const reply = await $.command.run(handoff("--resume"));

  expect(reply.text).toBe(
    [
      "#1  2026-11-09 14:32  /repo  First recap",
      "",
      "Run /handoff --resume <id> to continue one in a new session.",
    ].join("\n")
  );
});

testWithSession(
  "--save stores the recap and reports its id without touching the composer",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const store = mockStore(on, {
      [HANDOFFS_KEY]: [storedHandoff(2, "Older recap")],
    });
    answerRecap(on);
    let fills = 0;
    let submits = 0;
    on("prompt.fill", () => {
      fills += 1;
      return { isFilled: true };
    });
    on("prompt.submit", (_, e) => {
      submits += 1;
      return { text: e.text };
    });

    const reply = await $.command.run(handoff("--save the auth change"));

    expect(reply.text).toBe(
      "Saved as handoff #3. Run /handoff --resume 3 to continue it in a new session."
    );
    expect(fills).toBe(0);
    expect(submits).toBe(0);
    expect(store.get(HANDOFFS_KEY)).toEqual([
      storedHandoff(2, "Older recap"),
      { ...storedHandoff(3, "Resume prompt"), focus: "the auth change" },
    ]);
  }
);

const PLAN_SEPARATOR = "---handoff---";

testWithSession(
  "--each stores one handoff per suggested plan and lists their ids",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const store = mockStore(on, {
      [HANDOFFS_KEY]: [storedHandoff(2, "Older recap")],
    });
    answerRecap(
      on,
      `Add a context meter\n\nShow usage.\n${PLAN_SEPARATOR}\n\`\`\`\nBuild a plans runner\n\`\`\`\n${PLAN_SEPARATOR}\n`
    );
    let fills = 0;
    on("prompt.fill", () => {
      fills += 1;
      return { isFilled: true };
    });

    const reply = await $.command.run(handoff("--each"));

    expect(reply.text).toBe(
      [
        "Saved 2 handoffs, one per suggested plan:",
        "#3  Add a context meter",
        "#4  Build a plans runner",
        "",
        "Run /handoff --resume <id> to continue one in a new session.",
      ].join("\n")
    );
    expect(fills).toBe(0);
    expect(store.get(HANDOFFS_KEY)).toEqual([
      storedHandoff(2, "Older recap"),
      storedHandoff(3, "Add a context meter\n\nShow usage."),
      storedHandoff(4, "Build a plans runner"),
    ]);
  }
);

testWithSession(
  "--each keeps the latest assistant message whole and asks for one handoff per plan",
  [
    buildSessionMessage("user", "x".repeat(1600)),
    buildSessionMessage("assistant", "p".repeat(4000)),
    buildSessionMessage("user", "  "),
  ],
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    mockStore(on);
    const requests: { system: string; prompt: string }[] = [];
    on("model.complete", (_, e) => {
      requests.push({ system: e.system ?? "", prompt: e.prompt });
      return {
        value: { isAnswered: true, text: "Plan one", usage: MODEL_USAGE },
      };
    });

    await $.command.run(handoff("--each the plugin ideas"));

    expect(requests[0]!.prompt).toContain(`assistant: ${"p".repeat(4000)}\n`);
    expect(requests[0]!.prompt).not.toContain("x".repeat(1501));
    expect(requests[0]!.prompt).toContain("<focus>\nthe plugin ideas\n</focus>");
    expect(requests[0]!.system).toContain(PLAN_SEPARATOR);
  }
);

testWithSession(
  "--each with a reply holding no plans says so and stores nothing",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const store = mockStore(on);
    answerRecap(on, `\n${PLAN_SEPARATOR}\n  \n`);

    const reply = await $.command.run(handoff("--each"));

    expect(reply.text).toBe("No suggested plans found to hand off.");
    expect(store.has(HANDOFFS_KEY)).toBe(false);
  }
);
