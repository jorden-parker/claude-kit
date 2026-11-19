import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import {
  expect,
  mock,
  test,
  type Engine,
  type TestBody,
} from "claude-code/testing";

const MODEL_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const FILLED_MESSAGE =
  "Recap filled into the composer. Edit it or press Enter.";

const REJECTED_REPLY = {
  isAnswered: false,
  reason: "api-error",
  status: 400,
  error: "invalid_request",
  usage: MODEL_USAGE,
} as const;

const RATE_LIMITED_REPLY = {
  isAnswered: false,
  reason: "api-error",
  status: 429,
  error: "rate_limit",
  usage: MODEL_USAGE,
} as const;

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
  "a model call that fails without an API error returns the error line",
  CONVERSATION,
  async ($, on) => {
    let copies = 0;
    on("ui.copy", () => {
      copies += 1;
      return { value: { isCopied: true } };
    });
    on("model.complete", () => ({
      value: { isAnswered: false, reason: "aborted", usage: MODEL_USAGE },
    }));

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe("Could not build the recap (aborted).");
    expect(copies).toBe(0);
  }
);

const RECAP_TURN_ID = "turn-recap";
const WRITING_IN_CONVERSATION_MESSAGE =
  "Writing the recap in the conversation…";
const SAVED_FIRST_HANDOFF_MESSAGE =
  "Saved as handoff #1. Run /handoff --resume 1 to continue it in a new session.";

const answerTurns = (on: On) => {
  on("turn.start", (_, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_, e) => ({ text: e.answer }));
};

const collectSubmittedPrompts = (on: On) => {
  const submittedPrompts: string[] = [];
  on("prompt.submit", (_, e) => {
    submittedPrompts.push(e.text);
    return { text: e.text };
  });
  return submittedPrompts;
};

const endRecapTurn = async ($: Engine, promptText: string, answer: string) => {
  await $.turn.start({ text: promptText, turnId: RECAP_TURN_ID });
  return $.turn.complete({
    answer,
    durationMs: 1,
    isAborted: false,
    turnId: RECAP_TURN_ID,
    reason: "answer",
  });
};

const testWithConversationWriter = (name: string, body: TestBody) =>
  test(name, { options: { writer: "conversation" } }, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    return body($, on);
  });

const RECAP_AGENT_ID = "agent-recap";
const SUBAGENT_WRITING_MESSAGE = "A subagent is writing the recap…";

const collectSpawnedAgents = (on: On) => {
  const spawnedAgents: {
    prompt: string;
    agentType: string;
    model: string | undefined;
  }[] = [];
  on("agent.spawn", (_, e) => {
    const agentToolInput = e as unknown as { subagent_type?: string };
    spawnedAgents.push({
      prompt: e.prompt,
      agentType: agentToolInput.subagent_type ?? e.subagentType,
      model: e.model,
    });
    return { model: "claude-opus-5-5", agentId: RECAP_AGENT_ID };
  });
  return spawnedAgents;
};

const collectToasts = (on: On) => {
  const toasts: string[] = [];
  on("ui.toast", (_, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  return toasts;
};

const endAgentTurn = async (
  $: Engine,
  agentId: string,
  promptText: string,
  answer: string
) => {
  const turnId = `turn-of-${agentId}`;
  await $.turn.start({ text: promptText, turnId, agentId });
  return $.turn.complete({
    answer,
    durationMs: 1,
    isAborted: false,
    turnId,
    agentId,
    reason: "answer",
  });
};

const testWithSubagentWriter = (name: string, body: TestBody) =>
  test(name, { options: { writer: "subagent" } }, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    return body($, on);
  });

testWithSession(
  "an API error on haiku starts a Haiku subagent with the same conversation digest",
  CONVERSATION,
  async ($, on) => {
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    on("model.complete", () => ({ value: REJECTED_REPLY }));

    const reply = await $.command.run(handoff("--save the failing test"));

    expect(reply.text).toBe(
      "Haiku could not write the recap (API error 400, invalid_request). A subagent is writing the recap…"
    );
    expect(spawnedAgents).toHaveLength(1);
    expect(spawnedAgents[0]?.agentType).toBe("general-purpose");
    expect(spawnedAgents[0]?.model).toBe("haiku");
    expect(spawnedAgents[0]?.prompt).toContain("Do not use any tools");
    expect(spawnedAgents[0]?.prompt).toContain("Output only the prompt");
    expect(spawnedAgents[0]?.prompt).toContain("Working directory: /repo");
    expect(spawnedAgents[0]?.prompt).toContain(
      "user: Fix the login bug in auth.ts"
    );
    expect(spawnedAgents[0]?.prompt).toContain(
      "<focus>\nthe failing test\n</focus>"
    );
    expect(submittedPrompts).toEqual([]);
  }
);

testWithSession(
  "a subagent that cannot start leaves the recap to the conversation",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    on("agent.spawn", () => ({ deny: "agents are off" }));
    on("model.complete", () => ({ value: REJECTED_REPLY }));

    const reply = await $.command.run(handoff("--save"));
    await clock.settle();

    expect(reply.text).toBe(
      "Haiku could not write the recap (API error 400, invalid_request). Writing the recap in the conversation…"
    );
    expect(submittedPrompts).toHaveLength(1);
  }
);

testWithSubagentWriter(
  "the subagent writer setting starts the subagent without calling haiku",
  async ($, on) => {
    const spawnedAgents = collectSpawnedAgents(on);
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: REJECTED_REPLY };
    });

    const reply = await $.command.run(handoff("--save"));

    expect(reply.text).toBe(SUBAGENT_WRITING_MESSAGE);
    expect(modelCalls).toBe(0);
    expect(spawnedAgents).toHaveLength(1);
  }
);

testWithSubagentWriter(
  "--save stores the recap the subagent wrote and reports its id in a toast",
  async ($, on) => {
    mock.clock(on);
    const store = mockStore(on);
    answerTurns(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const toasts = collectToasts(on);

    await $.command.run(handoff("--save"));
    const turnResult = await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );

    expect(turnResult.text).toBe("Resume prompt");
    expect(toasts).toEqual([SAVED_FIRST_HANDOFF_MESSAGE]);
    expect(store.get("handoffs")).toEqual([
      {
        handoffId: 1,
        createdAt: 0,
        cwd: "/repo",
        focus: "",
        recap: "Resume prompt",
      },
    ]);
  }
);

testWithSubagentWriter(
  "another subagent that ends while a recap is awaited is left alone",
  async ($, on) => {
    mock.clock(on);
    const store = mockStore(on);
    answerTurns(on);
    collectSpawnedAgents(on);
    const toasts = collectToasts(on);

    await $.command.run(handoff("--save"));
    await endAgentTurn($, "agent-other", "Read README.md", "Unrelated report");

    expect(toasts).toEqual([]);
    expect(store.has("handoffs")).toBe(false);
  }
);

testWithSubagentWriter(
  "a subagent that ends with no answer leaves the recap to the conversation",
  async ($, on) => {
    const clock = mock.clock(on);
    const store = mockStore(on);
    answerTurns(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    const statuses = collectStatuses(on);
    const toasts = collectToasts(on);

    await $.command.run(handoff("--save"));
    await endAgentTurn($, RECAP_AGENT_ID, spawnedAgents[0]?.prompt ?? "", "");
    await clock.settle();

    expect(submittedPrompts).toHaveLength(1);
    expect(submittedPrompts[0]).toContain("The conversation above is");
    expect(statuses).toEqual([
      SUBAGENT_WRITING_MESSAGE,
      WRITING_IN_CONVERSATION_MESSAGE,
    ]);
    expect(toasts).toEqual([]);
    expect(store.has("handoffs")).toBe(false);

    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      "Resume prompt"
    );
    expect(turnResult.text).toBe(SAVED_FIRST_HANDOFF_MESSAGE);
  }
);

testWithSubagentWriter(
  "a recap the subagent wrote is filled into the composer",
  async ($, on) => {
    mock.clock(on);
    mockStore(on);
    answerTurns(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const toasts = collectToasts(on);
    const fills: string[] = [];
    on("prompt.fill", (_, e) => {
      fills.push(e.text);
      return { isFilled: true };
    });

    await $.command.run(handoff(""));
    await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );

    expect(fills).toEqual(["Resume prompt"]);
    expect(toasts).toEqual([FILLED_MESSAGE]);
  }
);

const collectStatuses = (on: On) => {
  const statuses: (string | undefined)[] = [];
  on("ui.status", (_, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  return statuses;
};

testWithSubagentWriter(
  "the status line says a subagent is writing, then pins the outcome until the next prompt",
  async ($, on) => {
    mock.clock(on);
    mockStore(on);
    answerTurns(on);
    ignoreToasts(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const statuses = collectStatuses(on);

    await $.command.run(handoff("--save"));
    expect(statuses).toEqual([SUBAGENT_WRITING_MESSAGE]);

    await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );
    expect(statuses).toEqual([
      SUBAGENT_WRITING_MESSAGE,
      SAVED_FIRST_HANDOFF_MESSAGE,
    ]);

    await $.turn.start({ text: "Next task", turnId: "turn-next" });
    expect(statuses).toEqual([
      SUBAGENT_WRITING_MESSAGE,
      SAVED_FIRST_HANDOFF_MESSAGE,
      undefined,
    ]);
  }
);

testWithConversationWriter(
  "the status line says the conversation is writing and clears when that turn ends",
  async ($, on) => {
    const clock = mock.clock(on);
    mockStore(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    const statuses = collectStatuses(on);

    await $.command.run(handoff("--save"));
    await clock.settle();
    await endRecapTurn($, submittedPrompts[0] ?? "", "Resume prompt");

    expect(statuses).toEqual([WRITING_IN_CONVERSATION_MESSAGE, undefined]);
  }
);

const submitAgentReport = ($: Engine, agentId: string) =>
  $.prompt.submit({
    text: `<agent-message from="${agentId}">\n[Subagent hand-back] The final report of a subagent.\n</agent-message>`,
    origin: { kind: "peer" },
    wait: false,
  });

testWithSubagentWriter(
  "the recap subagent's report is kept out of the conversation",
  async ($, on) => {
    mock.clock(on);
    mockStore(on);
    answerTurns(on);
    ignoreToasts(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("--save"));
    await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );
    const submitResult = await submitAgentReport($, RECAP_AGENT_ID);

    expect(submitResult.drop).toBe(
      "The handoff subagent finished; its result is in the status line."
    );
    expect(submittedPrompts).toEqual([]);
  }
);

testWithSubagentWriter(
  "another subagent's report reaches the conversation",
  async ($, on) => {
    mock.clock(on);
    mockStore(on);
    answerTurns(on);
    ignoreToasts(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("--save"));
    await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );
    const submitResult = await submitAgentReport($, "agent-other");

    expect(submitResult.drop).toBe(undefined);
    expect(submittedPrompts).toHaveLength(1);
  }
);

testWithSession(
  "a call rate-limited on every haiku try waits 7 seconds, under the hook's 10 second budget",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on);
    const models: string[] = [];
    const spawnedAgents = collectSpawnedAgents(on);
    on("model.complete", (_, e) => {
      models.push(e.model);
      return { value: RATE_LIMITED_REPLY };
    });

    const pendingReply = $.command.run(handoff("--save"));
    await clock.settle();
    await clock.advance(7000);
    const reply = await pendingReply;

    expect(models).toEqual(["haiku", "haiku", "haiku", "haiku"]);
    expect(reply.text).toBe(
      "Haiku could not write the recap (API error 429, rate_limit). A subagent is writing the recap…"
    );
    expect(spawnedAgents).toHaveLength(1);
  }
);

testWithConversationWriter(
  "--save stores the recap the conversation wrote and reports its id beneath the answer",
  async ($, on) => {
    const clock = mock.clock(on);
    const store = mockStore(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("--save"));
    await clock.settle();
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      "Resume prompt"
    );

    expect(turnResult.text).toBe(SAVED_FIRST_HANDOFF_MESSAGE);
    expect(store.get("handoffs")).toEqual([
      {
        handoffId: 1,
        createdAt: 0,
        cwd: "/repo",
        focus: "",
        recap: "Resume prompt",
      },
    ]);
  }
);

testWithConversationWriter(
  "another turn that ends while a recap is awaited is left alone",
  async ($, on) => {
    const clock = mock.clock(on);
    const store = mockStore(on);
    answerTurns(on);
    collectSubmittedPrompts(on);

    await $.command.run(handoff("--save"));
    await clock.settle();
    await $.turn.start({ text: "Something else", turnId: "turn-other" });
    const turnResult = await $.turn.complete({
      answer: "Unrelated answer",
      durationMs: 1,
      isAborted: false,
      turnId: "turn-other",
      reason: "answer",
    });

    expect(turnResult.text).toBe("Unrelated answer");
    expect(store.has("handoffs")).toBe(false);
  }
);

testWithConversationWriter(
  "a recap turn that ends with no answer reports the empty reply and stores nothing",
  async ($, on) => {
    const clock = mock.clock(on);
    const store = mockStore(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("--save"));
    await clock.settle();
    const turnResult = await endRecapTurn($, submittedPrompts[0] ?? "", "");

    expect(turnResult.text).toBe("Could not build the recap (empty reply).");
    expect(store.has("handoffs")).toBe(false);
  }
);

testWithConversationWriter(
  "the conversation writer setting asks the conversation without calling haiku",
  async ($, on) => {
    const clock = mock.clock(on);
    let modelCalls = 0;
    const submittedPrompts = collectSubmittedPrompts(on);
    on("model.complete", () => {
      modelCalls += 1;
      return { value: REJECTED_REPLY };
    });

    const reply = await $.command.run(handoff("--save"));
    await clock.settle();

    expect(reply.text).toBe(WRITING_IN_CONVERSATION_MESSAGE);
    expect(modelCalls).toBe(0);
    expect(submittedPrompts).toHaveLength(1);
  }
);

test(
  "the conversation writer says there is nothing to recap in an empty session",
  { options: { writer: "conversation" } },
  async ($, on) => {
    const submittedPrompts = collectSubmittedPrompts(on);
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: [] }));

    const reply = await $.command.run(handoff("--save"));

    expect(reply.text).toBe("Nothing to recap yet.");
    expect(submittedPrompts).toEqual([]);
  }
);

testWithConversationWriter(
  "--each splits the recap the conversation wrote into one handoff per plan",
  async ($, on) => {
    const clock = mock.clock(on);
    mockStore(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("--each"));
    await clock.settle();
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      "Plan A\n---handoff---\nPlan B"
    );

    expect(submittedPrompts[0]).toContain("write one prompt per plan");
    expect(turnResult.text).toContain(
      "Saved 2 handoffs, one per suggested plan:"
    );
  }
);

testWithConversationWriter(
  "a recap the conversation wrote is filled into the composer",
  async ($, on) => {
    const clock = mock.clock(on);
    mockStore(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    const fills: string[] = [];
    on("prompt.fill", (_, e) => {
      fills.push(e.text);
      return { isFilled: true };
    });

    await $.command.run(handoff(""));
    await clock.settle();
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      "Resume prompt"
    );

    expect(fills).toEqual(["Resume prompt"]);
    expect(turnResult.text).toBe(FILLED_MESSAGE);
  }
);

testWithConversationWriter(
  "a refused composer copies the conversation's recap without printing it twice",
  async ($, on) => {
    const clock = mock.clock(on);
    mockStore(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    on("prompt.fill", refuseFill);
    on("ui.copy", () => ({ value: { isCopied: true } }));

    await $.command.run(handoff(""));
    await clock.settle();
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      "Resume prompt"
    );

    expect(turnResult.text).toBe(
      "The recap is the message above.\n\n(Copied to clipboard)"
    );
  }
);

testWithSession(
  "a rate-limited call is retried on haiku after backing off",
  CONVERSATION,
  async ($, on) => {
    mockStore(on);
    const models: string[] = [];
    const waits: number[] = [];
    on("clock.now", () => ({ value: 0 }));
    on("clock.sleep", (_, e) => {
      waits.push(e.ms);
      return { value: undefined };
    });
    on("model.complete", (_, e) => {
      models.push(e.model);
      return {
        value:
          models.length < 3
            ? RATE_LIMITED_REPLY
            : { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
      };
    });

    const reply = await $.command.run(handoff("--save"));

    expect(models).toEqual(["haiku", "haiku", "haiku"]);
    expect(waits).toEqual([1000, 2000]);
    expect(reply.text).toContain("Saved as handoff #1.");
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
    expect(requests[0]!.prompt).toContain(
      "<focus>\nthe plugin ideas\n</focus>"
    );
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

test("typing a dash after /handoff suggests every flag", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/handoff -");

  expect(suggestedTexts(reply)).toEqual([
    "--new",
    "--save",
    "--each",
    "--list",
    "--resume",
  ]);
  expect(reply.suggestions[0]!.description).toContain("fresh session");
});

test("a partly typed /handoff flag narrows the suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/handoff the auth --re");

  expect(suggestedTexts(reply)).toEqual(["--resume"]);
});

test("words that are not flags or other commands get no /handoff suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const focusReply = await autocomplete($, "/handoff au");
  const otherReply = await autocomplete($, "/optimize -");
  const commandReply = await autocomplete($, "/handoff");

  expect(suggestedTexts(focusReply)).toEqual([]);
  expect(suggestedTexts(otherReply)).toEqual([]);
  expect(suggestedTexts(commandReply)).toEqual([]);
});
