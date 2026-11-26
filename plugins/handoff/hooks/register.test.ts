import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

type HandoffTestBody = (
  $: Engine,
  on: On,
  handoffFiles: Map<string, string>,
  store: Map<string, unknown>
) => unknown;

const NOVEMBER_NINTH = Date.UTC(2026, 10, 9, 14, 32);
const HANDOFFS_ROOT = "/home/tester/.claude/handoffs";

const parentFolder = (path: string) => path.slice(0, path.lastIndexOf("/"));

const ranCommands: string[][] = [];

const answerGit = (stdout: string, exitCode = 0) => ({
  value: {
    exitCode,
    stdout,
    stderr: "",
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
});

const mockHandoffFiles = (
  on: On,
  commonGitFolder = "/repo/.git",
  environment: Record<string, string> = {}
) => {
  const handoffFiles = new Map<string, string>();
  on("env.get", (_, e) => ({
    value: { HOME: "/home/tester", ...environment }[e.name],
  }));
  on("process.run", (_, e) => {
    ranCommands.push([...e.argv]);
    return commonGitFolder
      ? answerGit(`${commonGitFolder}\n`)
      : answerGit("", 128);
  });
  on("fs.list", (_, e) => ({
    value: [...handoffFiles.keys()]
      .filter((path) => parentFolder(path) === e.path)
      .map((path) => ({
        name: path.slice(e.path.length + 1),
        kind: "file" as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
  }));
  on("fs.read", (_, e) => ({ value: handoffFiles.get(e.path) ?? "" }));
  on("fs.write", (_, e) => {
    handoffFiles.set(e.path, e.text);
    return { value: undefined };
  });
  return handoffFiles;
};

const handoffPath = (handoffId: number, slug: string, projectName = "repo") =>
  `${HANDOFFS_ROOT}/${projectName}/${String(handoffId).padStart(3, "0")}-${slug}.md`;

const handoffText = (
  recap: string,
  createdAt = NOVEMBER_NINTH,
  focus = "",
  projectName = "repo"
) =>
  [
    "---",
    `title: ${recap.trim().split("\n")[0]}`,
    `project: ${projectName}`,
    `created: ${new Date(createdAt).toISOString()}`,
    "cwd: /repo",
    ...(focus ? [`focus: ${focus}`] : []),
    "---",
    "",
    recap,
    "",
  ].join("\n");

const listSavedHandoffs = (handoffFiles: Map<string, string>) =>
  Object.fromEntries(handoffFiles);

const slugify = (recap: string) =>
  (recap.trim().split("\n")[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const seedHandoff = (
  handoffFiles: Map<string, string>,
  handoffId: number,
  recap: string,
  createdAt = NOVEMBER_NINTH
) => {
  handoffFiles.set(
    handoffPath(handoffId, slugify(recap)),
    handoffText(recap, createdAt)
  );
};

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
  body: HandoffTestBody
) =>
  test(
    name,
    { options: { writer: "haiku", hasConversationTurns: false } },
    ($, on) => {
      on("session.cwd", () => ({ value: "/repo" }));
      on("session.messages", () => ({ value: messages }));
      return body($, on, mockHandoffFiles(on), mockStore(on));
    }
  );

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
const SAVED_FIRST_HANDOFF_MESSAGE = `Saved as handoff #1 in ${handoffPath(1, "resume-prompt")}. Run /handoff resume 1 to load it into a new session.`;

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

const testWithConversationWriter = (name: string, body: HandoffTestBody) =>
  test(name, { options: { writer: "conversation" } }, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    return body($, on, mockHandoffFiles(on), mockStore(on));
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

const HANDOFF_GLYPH = "📜 ";

const withoutHandoffGlyph = (shownText: string) => {
  expect(shownText.startsWith(HANDOFF_GLYPH)).toBe(true);
  return shownText.slice(HANDOFF_GLYPH.length);
};

const collectToasts = (on: On) => {
  const toasts: string[] = [];
  on("ui.toast", (_, e) => {
    toasts.push(withoutHandoffGlyph(e.text));
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

const testWithSubagentWriter = (name: string, body: HandoffTestBody) =>
  test(
    name,
    { options: { writer: "subagent", hasConversationTurns: false } },
    ($, on) => {
      on("session.cwd", () => ({ value: "/repo" }));
      on("session.messages", () => ({ value: CONVERSATION }));
      return body($, on, mockHandoffFiles(on), mockStore(on));
    }
  );

testWithSession(
  "an API error on haiku starts a Haiku subagent with the same conversation digest",
  CONVERSATION,
  async ($, on) => {
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    on("model.complete", () => ({ value: REJECTED_REPLY }));

    const reply = await $.command.run(handoff("save the failing test"));

    expect(reply.text).toBe(
      "Haiku could not write the recap (API error 400, invalid_request). A subagent is writing the recap…"
    );
    expect(spawnedAgents).toHaveLength(1);
    expect(spawnedAgents[0]?.agentType).toBe("handoff:recap");
    expect(spawnedAgents[0]?.model).toBe("haiku");
    expect(spawnedAgents[0]?.prompt).toContain("Do not use any tools");
    expect(spawnedAgents[0]?.prompt).toContain("Output only the note");
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

    const reply = await $.command.run(handoff("save"));
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

    const reply = await $.command.run(handoff("save"));

    expect(reply.text).toBe(SUBAGENT_WRITING_MESSAGE);
    expect(modelCalls).toBe(0);
    expect(spawnedAgents).toHaveLength(1);
  }
);

testWithSubagentWriter(
  "save stores the recap the subagent wrote and reports its id in a toast",
  async ($, on, handoffFiles, store) => {
    mock.clock(on);
    answerTurns(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const toasts = collectToasts(on);

    await $.command.run(handoff("save"));
    const turnResult = await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );

    expect(turnResult.text).toBe("Resume prompt");
    expect(toasts).toEqual([SAVED_FIRST_HANDOFF_MESSAGE]);
    expect(listSavedHandoffs(handoffFiles)).toEqual({
      [handoffPath(1, "resume-prompt")]: handoffText("Resume prompt", 0),
    });
  }
);

testWithSubagentWriter(
  "another subagent that ends while a recap is awaited is left alone",
  async ($, on, handoffFiles, store) => {
    mock.clock(on);
    answerTurns(on);
    collectSpawnedAgents(on);
    const toasts = collectToasts(on);

    await $.command.run(handoff("save"));
    await endAgentTurn($, "agent-other", "Read README.md", "Unrelated report");

    expect(toasts).toEqual([]);
    expect(handoffFiles.size).toBe(0);
  }
);

testWithSubagentWriter(
  "a subagent that ends with no answer leaves the recap to the conversation",
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    answerTurns(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    const statuses = collectStatuses(on);
    const toasts = collectToasts(on);

    await $.command.run(handoff("save"));
    await endAgentTurn($, RECAP_AGENT_ID, spawnedAgents[0]?.prompt ?? "", "");
    await clock.settle();

    expect(submittedPrompts).toHaveLength(1);
    expect(submittedPrompts[0]).toContain("The conversation above is");
    expect(statuses).toEqual([
      SUBAGENT_WRITING_MESSAGE,
      WRITING_IN_CONVERSATION_MESSAGE,
    ]);
    expect(toasts).toEqual([]);
    expect(handoffFiles.size).toBe(0);

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
    statuses.push(
      e.text === undefined ? undefined : withoutHandoffGlyph(e.text)
    );
    return { value: undefined };
  });
  return statuses;
};

testWithSubagentWriter(
  "the status line says a subagent is writing, then pins the outcome until the next prompt",
  async ($, on) => {
    mock.clock(on);
    answerTurns(on);
    ignoreToasts(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const statuses = collectStatuses(on);

    await $.command.run(handoff("save"));
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
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    const statuses = collectStatuses(on);

    await $.command.run(handoff("save"));
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
    answerTurns(on);
    ignoreToasts(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
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
    answerTurns(on);
    ignoreToasts(on);
    const spawnedAgents = collectSpawnedAgents(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
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

    const pendingReply = $.command.run(handoff("save"));
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
  "save stores the recap the conversation wrote and reports its id beneath the answer",
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    await clock.settle();
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      "Resume prompt"
    );

    expect(turnResult.text).toBe(SAVED_FIRST_HANDOFF_MESSAGE);
    expect(listSavedHandoffs(handoffFiles)).toEqual({
      [handoffPath(1, "resume-prompt")]: handoffText("Resume prompt", 0),
    });
  }
);

testWithConversationWriter(
  "another turn that ends while a recap is awaited is left alone",
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    answerTurns(on);
    collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
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
    expect(handoffFiles.size).toBe(0);
  }
);

testWithConversationWriter(
  "a recap turn that ends with no answer reports the empty reply and stores nothing",
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    answerTurns(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    await clock.settle();
    const turnResult = await endRecapTurn($, submittedPrompts[0] ?? "", "");

    expect(turnResult.text).toBe("Could not build the recap (empty reply).");
    expect(handoffFiles.size).toBe(0);
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

    const reply = await $.command.run(handoff("save"));
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
    mockStore(on);

    const reply = await $.command.run(handoff("save"));

    expect(reply.text).toBe("Nothing to recap yet.");
    expect(submittedPrompts).toEqual([]);
  }
);

testWithConversationWriter(
  "a recap the conversation wrote is filled into the composer",
  async ($, on) => {
    const clock = mock.clock(on);
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

    const reply = await $.command.run(handoff("save"));

    expect(models).toEqual(["haiku", "haiku", "haiku"]);
    expect(waits).toEqual([1000, 2000]);
    expect(reply.text).toContain("Saved as handoff #1 in ");
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

testWithSession(
  "a leading classifier-unavailable notice is stripped, also inside a code fence, and other Note lines stay",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on);
    const fills: string[] = [];
    const modelReplies = [
      "Note: The server-side auto mode classifier (the safety classifer) was unavailable and the action was allowed.\nIt may be retried.\n\nNote: The server-side auto mode classifier (the safety classifer) was unavailable and the action was allowed.\nIt may be retried.\n\nResume prompt\nmore",
      "```text\nNote: The server-side auto mode classifier (the safety classifer) was unavailable and the action was allowed.\nIt may be retried.\n\nResume prompt\n```",
      "Note: remember the migration\n\nResume prompt",
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
      "Resume prompt\nmore",
      "Resume prompt",
      "Note: remember the migration\n\nResume prompt",
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

const seedStore = (
  store: Map<string, unknown>,
  entries: Record<string, unknown>
) => {
  for (const [key, value] of Object.entries(entries)) store.set(key, value);
};

const allowSessionStart = (on: On) => {
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
};

testWithSession(
  "resume falls back to the composer when the session cannot be cleared",
  CONVERSATION,
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    seedHandoff(handoffFiles, 1, "Resume prompt");
    const fills: string[] = [];
    let submits = 0;
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

    await $.command.run(handoff("resume 1"));
    await clock.settle();

    expect(fills).toEqual(["Resume prompt"]);
    expect(submits).toBe(0);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
  }
);

testWithSession(
  "a pending handoff is filled into the composer when a session starts",
  [],
  async ($, on, handoffFiles, store) => {
    allowSessionStart(on);
    seedStore(store, { [PENDING_HANDOFF_KEY]: "Resume prompt" });
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
  async ($, on, handoffFiles, store) => {
    allowSessionStart(on);
    seedStore(store, { [PENDING_HANDOFF_KEY]: "Resume prompt" });
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
const storedHandoff = (
  handoffId: number,
  recap: string,
  createdAt = NOVEMBER_NINTH,
  cwd = "/repo"
) => ({ handoffId, createdAt, cwd, focus: "", recap });

const collectRecapPrompts = (on: On) => {
  const recapPrompts: string[] = [];
  on("model.complete", (_, e) => {
    recapPrompts.push(e.prompt);
    return {
      value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
    };
  });
  return recapPrompts;
};

const answerRecap = (on: On, text = "Resume prompt") => {
  on("model.complete", () => ({
    value: { isAnswered: true, text, usage: MODEL_USAGE },
  }));
};

testWithSession(
  "a built recap is saved as a file with its title, project, time, directory and focus",
  CONVERSATION,
  async ($, on, handoffFiles) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    answerRecap(on);
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(handoff("the auth change"));

    expect(listSavedHandoffs(handoffFiles)).toEqual({
      [handoffPath(1, "resume-prompt")]: handoffText(
        "Resume prompt",
        NOVEMBER_NINTH,
        "the auth change"
      ),
    });
  }
);

testWithSession(
  "list shows the ten newest handoffs and counts the older ones",
  [],
  async ($, on, handoffFiles) => {
    for (let handoffId = 1; handoffId <= 12; handoffId++)
      seedHandoff(handoffFiles, handoffId, `Recap ${handoffId}`);

    const reply = await $.command.run(handoff("list"));

    const replyLines = (reply.text ?? "").split("\n");
    expect(replyLines[1]).toBe("#12  2026-11-09 14:32  Recap 12");
    expect(replyLines[10]).toBe("#3  2026-11-09 14:32  Recap 3");
    expect(replyLines[11]).toBe("…and 2 older.");
  }
);

const refuseSubagents = (on: On) => {
  on("agent.spawn", () => {
    throw new Error("agent.spawn is not available outside Claude Code.");
  });
};

testWithSubagentWriter(
  "a host that cannot start subagents gets the recap from the model call",
  async ($, on, handoffFiles) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    refuseSubagents(on);
    answerRecap(on);
    on("prompt.fill", () => ({ isFilled: true }));

    const reply = await $.command.run(handoff(""));

    expect(reply.text).toBe(
      "Recap filled into the composer. Edit it or press Enter."
    );
    expect(listSavedHandoffs(handoffFiles)).toEqual({
      [handoffPath(1, "resume-prompt")]: handoffText("Resume prompt"),
    });
  }
);

testWithSubagentWriter(
  "a host that cannot start subagents and refuses the model call leaves the recap to the conversation",
  async ($, on) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const submittedPrompts = collectSubmittedPrompts(on);
    refuseSubagents(on);
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: REJECTED_REPLY };
    });

    const reply = await $.command.run(handoff("save"));
    await clock.settle();

    expect(reply.text).toBe(
      "Haiku could not write the recap (API error 400, invalid_request). Writing the recap in the conversation…"
    );
    expect(modelCalls).toBe(1);
    expect(submittedPrompts).toHaveLength(1);
  }
);

testWithSession(
  "list with nothing saved for the project says so",
  [],
  async ($) => {
    const reply = await $.command.run(handoff("list"));

    expect(reply.text).toBe(
      "No handoffs for repo yet. Run /handoff to create one."
    );
  }
);

const RESUME_HINT =
  "Run /handoff resume <id> to load one into a new session, or claude-notes in a terminal to browse them all.";

testWithSession(
  "list shows the project's handoffs, newest first, with their first line",
  [],
  async ($, on, handoffFiles) => {
    seedHandoff(
      handoffFiles,
      1,
      "# Fix the login bug\n\nThe test in auth.test.ts fails."
    );
    seedHandoff(
      handoffFiles,
      2,
      "\nShip the release notes",
      Date.UTC(2026, 10, 10, 9, 5)
    );
    handoffFiles.set(`${HANDOFFS_ROOT}/other/001-elsewhere.md`, "Elsewhere");
    handoffFiles.set(`${HANDOFFS_ROOT}/repo/notes.md`, "Not a handoff");

    const reply = await $.command.run(handoff("list"));

    expect(reply.text).toBe(
      [
        "Handoffs for repo, newest first:",
        "#2  2026-11-10 09:05  Ship the release notes",
        "#1  2026-11-09 14:32  Fix the login bug",
        "",
        RESUME_HINT,
      ].join("\n")
    );
  }
);

const collectHandoffSteps = (on: On) => {
  const handoffSteps: string[] = [];
  on("command.run", { command: "clear" }, () => {
    handoffSteps.push("clear");
    return { text: "" };
  });
  on("prompt.submit", (_, e) => {
    handoffSteps.push(`submit:${e.text}`);
    return { text: e.text };
  });
  on("prompt.fill", (_, e) => {
    handoffSteps.push(`fill:${e.text}`);
    return { isFilled: true };
  });
  return handoffSteps;
};

testWithSession(
  "resume <id> clears the session and submits that saved recap",
  [],
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    seedHandoff(handoffFiles, 1, "First recap");
    seedHandoff(handoffFiles, 2, "Second recap");
    const handoffSteps = collectHandoffSteps(on);
    let modelCalls = 0;
    on("model.complete", () => {
      modelCalls += 1;
      return { value: { isAnswered: true, text: "x", usage: MODEL_USAGE } };
    });

    const reply = await $.command.run(handoff("resume 1"));
    expect(reply.text).toBe(HANDING_OFF_MESSAGE);

    await clock.settle();

    expect(handoffSteps).toEqual(["clear", "fill:First recap"]);
    expect(modelCalls).toBe(0);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
    expect(handoffFiles.size).toBe(2);
  }
);

testWithSession(
  "resume without an id continues the project's latest handoff",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    seedHandoff(handoffFiles, 2, "Second recap");
    seedHandoff(handoffFiles, 10, "Tenth recap");
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("resume"));
    await clock.settle();

    expect(handoffSteps).toEqual(["clear", "fill:Tenth recap"]);
  }
);

const resumeRequestFill = (recap: string, request: string) =>
  `fill:The user's request: ${request}\n\nDo only what this request asks. The handoff below is background from an earlier session, not a task: when the request is a question or an investigation, answer it with what you find, and start no fix, change no code and spawn no subagents to implement anything unless the request asks for that.\n\n<handoff>\n${recap}\n</handoff>`;

testWithSession(
  "resume <id> with extra context fills the request as the task and the saved recap as background",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    seedHandoff(handoffFiles, 1, "First recap");
    seedHandoff(handoffFiles, 2, "Second recap");
    const savedFiles = listSavedHandoffs(handoffFiles);
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("resume 1 start with the failing test"));
    await clock.settle();

    expect(handoffSteps).toEqual([
      "clear",
      resumeRequestFill("First recap", "start with the failing test"),
    ]);
    expect(listSavedHandoffs(handoffFiles)).toEqual(savedFiles);
  }
);

testWithSession(
  "resume with words and no id makes them the request on the latest handoff",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    seedHandoff(handoffFiles, 1, "First recap");
    seedHandoff(handoffFiles, 2, "Second recap");
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("resume start with the failing test"));
    await clock.settle();

    expect(handoffSteps).toEqual([
      "clear",
      resumeRequestFill("Second recap", "start with the failing test"),
    ]);
  }
);

testWithSession(
  "resume with an unknown id names it and points to the list",
  [],
  async ($, on, handoffFiles) => {
    seedHandoff(handoffFiles, 1, "First recap");

    const reply = await $.command.run(handoff("resume 9"));

    expect(reply.text).toBe(
      "No handoff #9 for repo. Run /handoff list to see its handoffs."
    );
  }
);

testWithSession(
  "resume with nothing saved for the project says so",
  [],
  async ($) => {
    const reply = await $.command.run(handoff("resume"));

    expect(reply.text).toBe(
      "No handoffs for repo yet. Run /handoff to create one."
    );
  }
);

testWithSession(
  "save writes the recap to a file and reports its id and path without touching the composer",
  CONVERSATION,
  async ($, on, handoffFiles) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    seedHandoff(handoffFiles, 2, "Older recap");
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

    const reply = await $.command.run(handoff("save the auth change"));

    expect(reply.text).toBe(
      `Saved as handoff #3 in ${handoffPath(3, "resume-prompt")}. Run /handoff resume 3 to load it into a new session.`
    );
    expect(handoffFiles.get(handoffPath(3, "resume-prompt"))).toBe(
      handoffText("Resume prompt", NOVEMBER_NINTH, "the auth change")
    );
    expect(fills).toBe(0);
    expect(submits).toBe(0);
  }
);

testWithSession(
  "the old dashed flags still pick their action",
  CONVERSATION,
  async ($, on, handoffFiles) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    answerRecap(on);

    const reply = await $.command.run(handoff("--save the auth change"));

    expect(reply.text).toContain("Saved as handoff #1");
    expect(handoffFiles.get(handoffPath(1, "resume-prompt"))).toContain(
      "focus: the auth change"
    );
  }
);

testWithSession(
  "handoffs kept in the plugin store by earlier versions are filed as files once",
  [],
  async ($, on, handoffFiles, store) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    seedStore(store, {
      [HANDOFFS_KEY]: [
        storedHandoff(1, "First recap"),
        { ...storedHandoff(2, "Second recap"), focus: "the parser" },
      ],
    });

    const reply = await $.command.run(handoff("list"));

    expect(reply.text).toContain("#2  2026-11-09 14:32  Second recap");
    expect(listSavedHandoffs(handoffFiles)).toEqual({
      [handoffPath(1, "first-recap")]: handoffText("First recap"),
      [handoffPath(2, "second-recap")]: handoffText(
        "Second recap",
        NOVEMBER_NINTH,
        "the parser"
      ),
    });
    expect(store.has(HANDOFFS_KEY)).toBe(false);
  }
);

const PROJECT_NAME_BY_GIT_FOLDER = {
  "/src/claude-kit/.git": "claude-kit",
  "/src/thing.git": "thing",
  "/src/thing/.bare": "thing",
  "/src/parent/.git/modules/library": "library",
};

for (const [commonGitFolder, projectName] of Object.entries(
  PROJECT_NAME_BY_GIT_FOLDER
)) {
  test(
    `a worktree whose repository is ${commonGitFolder} files its handoffs under ${projectName}`,
    { options: { writer: "haiku", hasConversationTurns: false } },
    async ($, on) => {
      on("session.cwd", () => ({ value: "/worktrees/feature-branch" }));
      on("session.messages", () => ({ value: CONVERSATION }));
      mock.clock(on, { now: NOVEMBER_NINTH });
      mockStore(on);
      answerRecap(on);
      ranCommands.length = 0;
      const handoffFiles = mockHandoffFiles(on, commonGitFolder);

      await $.command.run(handoff("save"));

      expect([...handoffFiles.keys()]).toEqual([
        handoffPath(1, "resume-prompt", projectName),
      ]);
      expect(ranCommands[0]).toEqual([
        "git",
        "-C",
        "/worktrees/feature-branch",
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
    }
  );
}

test(
  "a folder outside git files its handoffs under its own name",
  { options: { writer: "haiku", hasConversationTurns: false } },
  async ($, on) => {
    on("session.cwd", () => ({ value: "/scratch/My Notes" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    mock.clock(on, { now: NOVEMBER_NINTH });
    mockStore(on);
    answerRecap(on);
    const handoffFiles = mockHandoffFiles(on, "");

    await $.command.run(handoff("save"));

    expect([...handoffFiles.keys()]).toEqual([
      handoffPath(1, "resume-prompt", "My-Notes"),
    ]);
  }
);

test(
  "HANDOFFS_DIR moves the handoffs folder",
  { options: { writer: "haiku", hasConversationTurns: false } },
  async ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    mock.clock(on, { now: NOVEMBER_NINTH });
    mockStore(on);
    answerRecap(on);
    const handoffFiles = mockHandoffFiles(on, "/repo/.git", {
      HANDOFFS_DIR: "/elsewhere",
    });

    await $.command.run(handoff("save"));

    expect([...handoffFiles.keys()]).toEqual([
      "/elsewhere/repo/001-resume-prompt.md",
    ]);
  }
);

const PLAN_SEPARATOR = "---handoff---";

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

test("typing the first word after /handoff suggests every action", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/handoff ");

  expect(suggestedTexts(reply)).toEqual(["save", "list", "resume"]);
});

test("a partly typed /handoff action narrows the suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/handoff re");

  expect(suggestedTexts(reply)).toEqual(["resume"]);
});

test("later words, other words and other commands get no /handoff suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const laterWordReply = await autocomplete($, "/handoff the auth re");
  const focusReply = await autocomplete($, "/handoff au");
  const otherReply = await autocomplete($, "/optimize re");
  const commandReply = await autocomplete($, "/handoff");

  expect(suggestedTexts(laterWordReply)).toEqual([]);
  expect(suggestedTexts(focusReply)).toEqual([]);
  expect(suggestedTexts(otherReply)).toEqual([]);
  expect(suggestedTexts(commandReply)).toEqual([]);
});

test(
  "save shows the recap and says why when its file cannot be written",
  { options: { writer: "haiku", hasConversationTurns: false } },
  async ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    on("env.get", () => ({ value: "/home/tester" }));
    on("process.run", () => answerGit("/repo/.git\n"));
    on("fs.list", () => ({ value: [] }));
    on("fs.write", () => ({ deny: "the folder is read-only" }));
    mock.clock(on, { now: NOVEMBER_NINTH });
    mockStore(on);
    answerRecap(on);

    const reply = await $.command.run(handoff("save"));

    expect(reply.text).toContain("The handoff could not be saved (");
    expect(reply.text).toContain("the folder is read-only");
    expect(reply.text).toContain("The recap:\n\nResume prompt");
  }
);

const SAMPLE_SECRET = `ghp_${"a".repeat(36)}`;

test(
  "save refuses to write a recap that holds a secret and names its kind",
  { options: { writer: "haiku", hasConversationTurns: false } },
  async ($, on) => {
    const writtenPaths: string[] = [];
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    on("env.get", () => ({ value: "/home/tester" }));
    on("process.run", () => answerGit("/repo/.git\n"));
    on("fs.list", () => ({ value: [] }));
    on("fs.write", (_, e) => {
      writtenPaths.push(e.path);
      return { value: undefined };
    });
    mock.clock(on, { now: NOVEMBER_NINTH });
    mockStore(on);
    answerRecap(on, `Resume prompt\n\nDeploy with ${SAMPLE_SECRET}.`);

    const reply = await $.command.run(handoff("save"));

    expect(reply.text).toContain("holds a secret (GitHub token)");
    expect(reply.text).not.toContain(SAMPLE_SECRET);
    expect(writtenPaths).toEqual([]);
  }
);

testWithSession(
  "new refuses a recap that holds a secret and hands nothing on",
  CONVERSATION,
  async ($, on, handoffFiles, store) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const handoffSteps: string[] = [];
    answerRecap(on, `Resume prompt\n\nDeploy with ${SAMPLE_SECRET}.`);
    on("command.run", { command: "clear" }, () => {
      handoffSteps.push("clear");
      return { text: "" };
    });
    on("prompt.submit", (_, e) => {
      handoffSteps.push(`submit:${e.text}`);
      return { text: e.text };
    });

    const reply = await $.command.run(handoff("new"));
    await clock.settle();

    expect(reply.text).toContain("holds a secret (GitHub token)");
    expect(reply.text).not.toContain(SAMPLE_SECRET);
    expect(handoffSteps).toEqual([]);
    expect(store.has(PENDING_HANDOFF_KEY)).toBe(false);
    expect(handoffFiles.size).toBe(0);
  }
);

const BOX_PANE = {
  plugin: "handoff",
  component: "Pane",
  requestId: "handoff",
  surface: "terminal",
  props: {
    title: "Handoff",
    isFocused: true,
    bodyColumns: 60,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const;

const BOX_BAND = {
  plugin: "handoff",
  component: "AbovePrompt",
  surface: "terminal",
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 90,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const;

const NOTES_BOX_MESSAGE =
  "Add notes for the next session in the box, then press Enter. Cancel drops it.";
const RESUME_BOX_MESSAGE =
  "Pick a handoff in the box and add notes if you like. Cancel drops it.";

const trackPane = (on: On, isPlaced: boolean) => {
  const paneCalls: string[] = [];
  on("ui.open", (_, e) => {
    paneCalls.push(`open:${e.title}`);
    return {
      value: isPlaced
        ? { isPlaced: true as const }
        : { isPlaced: false as const, reason: "no-surface" as const },
    };
  });
  on("ui.close", () => {
    paneCalls.push("close");
    return { value: undefined };
  });
  return paneCalls;
};

const useBand = (on: On) => {
  on("session.surfaces", () => ({ value: ["terminal" as const] }));
  return trackPane(on, true);
};

const placeBoxPane = (on: On, isPlaced = true) => {
  on("session.surfaces", () => ({ value: ["vscode" as const] }));
  return trackPane(on, isPlaced);
};

testWithSession(
  "save with no focus opens the notes box, then gives the notes to the recap writer as guidance",
  CONVERSATION,
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    const toasts = collectToasts(on);
    const paneCalls = useBand(on);
    const recapPrompts: string[] = [];
    on("model.complete", (_, e) => {
      recapPrompts.push(e.prompt);
      return {
        value: { isAnswered: true, text: "Resume prompt", usage: MODEL_USAGE },
      };
    });
    const handoffSteps = collectHandoffSteps(on);

    const reply = await $.command.run(handoff("save"));

    expect(reply.text).toBe(NOTES_BOX_MESSAGE);
    expect(paneCalls).toEqual([]);
    expect(recapPrompts).toEqual([]);

    const box = await $.ui.mount(BOX_BAND);
    await box.input({ key: "notes", text: " start with the failing test \n" });
    await clock.settle();

    expect(paneCalls).toEqual([]);
    expect(recapPrompts[0]).toContain(
      "<guidance>\nstart with the failing test\n</guidance>"
    );
    expect(handoffSteps).toEqual([]);
    expect(handoffFiles.get(handoffPath(1, "resume-prompt"))).toBe(
      handoffText("Resume prompt")
    );
    expect(toasts).toEqual(["Building recap…", SAVED_FIRST_HANDOFF_MESSAGE]);
  }
);

testWithSession(
  "the notes box opens under the shared heading with a pride stripe",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    useBand(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);

    expect(
      await box.find({ type: "Text", text: "📜 Notes for the next session" })
    ).toBeDefined();
    expect(await box.findAll({ type: "Text", text: /^━━$/ })).toHaveLength(6);
  }
);

testWithSession(
  "the notes box heading is semibold, with a subtle divider across the body below it",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    useBand(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);

    const heading = await box.find({
      type: "Text",
      text: "📜 Notes for the next session",
    });
    expect(heading?.props).toMatchObject({ weight: "semibold" });
    expect(heading?.props).not.toHaveProperty("bold");
    const divider = await box.find({ type: "Text", text: /^─+$/ });
    expect(divider?.text).toBe("─".repeat(86));
    expect(divider?.props).toMatchObject({ color: "subtle", wrap: "clip" });
  }
);

testWithSession(
  "the notes box puts its buttons and key hint on one footer row",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    useBand(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);

    expect((await box.find({ key: "handoff-footer" }))?.props).toMatchObject({
      flexDirection: "row",
      justifyContent: "space-between",
    });
    expect(
      (await box.find({ type: "Text", text: /Cancel to drop$/ }))?.props
    ).toMatchObject({ dimColor: true, wrap: "truncate-end" });
  }
);

testWithSession(
  "the notes box keeps two columns at the sides and one row above it, none below",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    useBand(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);

    const root = await box.find({ key: "handoff-box" });
    expect(root?.props).toMatchObject({ paddingX: 2, marginTop: 1 });
    expect(root?.props).not.toHaveProperty("paddingBottom");
    expect(root?.props).not.toHaveProperty("paddingTop");
    expect(root?.props).not.toHaveProperty("paddingY");
  }
);

testWithSession(
  "pressing Enter on an empty notes box hands off without notes",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    useBand(on);
    answerRecap(on);
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);
    await box.input({ key: "notes", text: "" });
    await clock.settle();

    expect(handoffSteps).toEqual([]);
  }
);

testWithSession(
  "the box's button hands off with the notes typed so far",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    useBand(on);
    const recapPrompts = collectRecapPrompts(on);
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);
    await box.input({ key: "notes", text: "ship it", kind: "change" });
    await box.press({ key: "continue" });
    await clock.settle();

    expect(recapPrompts[0]).toContain("<guidance>\nship it\n</guidance>");
    expect(handoffSteps).toEqual([]);
  }
);

testWithSession(
  "save with no focus takes notes in the box and saves the recap written from them",
  CONVERSATION,
  async ($, on, handoffFiles) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    const toasts = collectToasts(on);
    useBand(on);
    const recapPrompts = collectRecapPrompts(on);

    const reply = await $.command.run(handoff("save"));
    expect(reply.text).toBe(NOTES_BOX_MESSAGE);
    const box = await $.ui.mount(BOX_BAND);
    await box.input({ key: "notes", text: "the deploy is on Monday" });

    expect(recapPrompts[0]).toContain(
      "<guidance>\nthe deploy is on Monday\n</guidance>"
    );
    expect(handoffFiles.get(handoffPath(1, "resume-prompt"))).toBe(
      handoffText("Resume prompt")
    );
    expect(toasts).toEqual([
      "Building recap…",
      `Saved as handoff #1 in ${handoffPath(1, "resume-prompt")}. Run /handoff resume 1 to load it into a new session.`,
    ]);
  }
);

testWithSession(
  "a focus after save skips the box",
  CONVERSATION,
  async ($, on) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const paneCalls = useBand(on);
    answerRecap(on);

    const reply = await $.command.run(handoff("save the auth change"));

    expect(reply.text).toContain("Saved as handoff #1");
    expect(paneCalls).toEqual([]);
  }
);

testWithSession(
  "the box's Cancel button closes it and cancels the handoff",
  CONVERSATION,
  async ($, on, handoffFiles) => {
    mock.clock(on, { now: NOVEMBER_NINTH });
    const toasts = collectToasts(on);
    const paneCalls = useBand(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);
    await box.press({ key: "cancel" });

    expect(paneCalls).toEqual([]);
    expect(toasts).toEqual(["Handoff cancelled."]);
    expect(await box.find({ type: "Input" })).toBeUndefined();
    expect(handoffFiles.size).toBe(0);
  }
);

testWithSession(
  "on vscode a pane that cannot be placed is closed and the handoff runs at once",
  CONVERSATION,
  async ($, on) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    ignoreToasts(on);
    const paneCalls = placeBoxPane(on, false);
    answerRecap(on);
    const handoffSteps = collectHandoffSteps(on);

    const reply = await $.command.run(handoff("save"));
    await clock.settle();

    expect(reply.text).toBe(SAVED_FIRST_HANDOFF_MESSAGE);
    expect(paneCalls).toEqual(["open:Handoff notes", "close"]);
    expect(handoffSteps).toEqual([]);
  }
);

testWithSession(
  "resume with nothing after it opens a picker, and a pick resumes that handoff with the notes",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    const paneCalls = useBand(on);
    seedHandoff(handoffFiles, 1, "First recap");
    seedHandoff(handoffFiles, 2, "Second recap");
    const handoffSteps = collectHandoffSteps(on);

    const reply = await $.command.run(handoff("resume"));
    expect(reply.text).toBe(RESUME_BOX_MESSAGE);
    expect(paneCalls).toEqual([]);
    expect(handoffSteps).toEqual([]);

    const box = await $.ui.mount(BOX_BAND);
    const picker = await box.find({ type: "Select" });
    expect(picker?.props.options).toEqual([
      { value: "2", label: "#2  2026-11-09 14:32  Second recap" },
      { value: "1", label: "#1  2026-11-09 14:32  First recap" },
    ]);
    await box.input({ key: "notes", text: "skip the docs", kind: "change" });
    await box.select({ key: "handoff", value: "1" });
    await clock.settle();

    expect(handoffSteps).toEqual([
      "clear",
      resumeRequestFill("First recap", "skip the docs"),
    ]);
  }
);

testWithSession(
  "Enter in the picker's notes resumes the latest handoff",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    useBand(on);
    seedHandoff(handoffFiles, 1, "First recap");
    seedHandoff(handoffFiles, 2, "Second recap");
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("resume"));
    const box = await $.ui.mount(BOX_BAND);
    await box.input({ key: "notes", text: "" });
    await clock.settle();

    expect(handoffSteps).toEqual(["clear", "fill:Second recap"]);
  }
);

testWithSession(
  "resume with nothing saved says so without opening the picker",
  [],
  async ($, on) => {
    const paneCalls = useBand(on);

    const reply = await $.command.run(handoff("resume"));

    expect(reply.text).toBe(
      "No handoffs for repo yet. Run /handoff to create one."
    );
    expect(paneCalls).toEqual([]);
  }
);

testWithSession(
  "the box draws its field, picker and buttons on every surface",
  [],
  async ($, on, handoffFiles) => {
    useBand(on);
    seedHandoff(handoffFiles, 1, "First recap");
    await $.command.run(handoff("resume"));

    for (const surface of ["terminal", "desktop"] as const) {
      const box = await $.ui.mount({ ...BOX_BAND, surface });

      expect(await box.find({ type: "Input" })).toBeDefined();
      expect(await box.find({ type: "Select" })).toBeDefined();
      expect(await box.findAll({ type: "Button" })).toHaveLength(2);
      await box.unmount();
    }
  }
);

testWithSession(
  "the band draws nothing with no box open, and yields to a survey",
  CONVERSATION,
  async ($, on) => {
    useBand(on);
    const idleBand = await $.ui.mount(BOX_BAND);
    expect(await idleBand.find({ type: "Input" })).toBeUndefined();
    expect(await idleBand.find({ type: "Text" })).toBeUndefined();

    await $.command.run(handoff("save"));
    const surveyBand = await $.ui.mount({
      ...BOX_BAND,
      props: { ...BOX_BAND.props, hasSurvey: true },
    });
    expect(await surveyBand.find({ type: "Input" })).toBeUndefined();
  }
);

testWithSession(
  "the notes box focuses its field and hints at Cancel instead of Esc",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    useBand(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);

    expect((await box.find({ type: "Input" }))?.props).toMatchObject({
      autoFocus: true,
    });
    expect(
      (await box.find({ type: "Text", text: /Cancel to drop$/ }))?.text
    ).toBe("Enter hands off · Tab moves · Cancel to drop");
  }
);

testWithSession(
  "on vscode, which draws no band, the box opens in a pane instead",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    const paneCalls = placeBoxPane(on);

    const reply = await $.command.run(handoff("save"));

    expect(reply.text).toBe(NOTES_BOX_MESSAGE);
    expect(paneCalls).toEqual(["open:Handoff notes"]);
    const box = await $.ui.mount({ ...BOX_PANE, surface: "vscode" });
    expect(await box.find({ type: "Input" })).toBeDefined();
  }
);

testWithConversationWriter(
  "the conversation writer receives the box's notes as guidance",
  async ($, on) => {
    const clock = mock.clock(on);
    ignoreToasts(on);
    useBand(on);
    collectStatuses(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    const box = await $.ui.mount(BOX_BAND);
    await box.input({ key: "notes", text: "ship it" });
    await clock.settle();

    expect(submittedPrompts[0]).toContain("<guidance>\nship it\n</guidance>");
  }
);

testWithSession(
  "resume fills the composer and tells the user, without submitting",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    const toasts = collectToasts(on);
    seedHandoff(handoffFiles, 1, "First recap");
    const handoffSteps = collectHandoffSteps(on);

    await $.command.run(handoff("resume"));
    await clock.settle();

    expect(handoffSteps).toEqual(["clear", "fill:First recap"]);
    expect(toasts).toEqual([FILLED_MESSAGE]);
  }
);

testWithSession(
  "resume shows the recap when the composer refuses it, without submitting",
  [],
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on);
    const toasts = collectToasts(on);
    seedHandoff(handoffFiles, 1, "First recap");
    const submittedPrompts = collectSubmittedPrompts(on);
    on("command.run", { command: "clear" }, () => ({ text: "" }));
    on("prompt.fill", refuseFill);
    on("ui.copy", () => ({ value: { isCopied: true } }));

    await $.command.run(handoff("resume"));
    await clock.settle();

    expect(submittedPrompts).toEqual([]);
    expect(toasts).toEqual(["First recap\n\n(Copied to clipboard)"]);
  }
);

const COOKIE_QUESTION = "Should the token live in a cookie?";
const ENDPOINT_QUESTION = "Is the old endpoint still needed?";
const WRITTEN_RECAP = "Fix the login\n\nGoal: the login works.";
const ASKING_QUESTIONS_MESSAGE =
  "Checking for open questions in the conversation…";
const DECISION_LINES = [
  `- ${COOKIE_QUESTION} Answer: Cookie`,
  `- ${ENDPOINT_QUESTION} Left open`,
].join("\n");
const DECISIONS_BLOCK = `<decisions>\n${DECISION_LINES}\n</decisions>`;

const answerQuestions = (on: On, answers: Record<string, string>) => {
  const askedOptions: Record<string, string[]> = {};
  on("tool.call", { tool: "AskUserQuestion" }, (_, e) => {
    if (e.tool !== "AskUserQuestion") return { deny: "Not a question." };
    const [asked] = e.questions;
    if (!asked) return { deny: "No question was asked." };
    askedOptions[asked.question] = asked.options.map((option) => option.label);
    const answer = answers[asked.question];
    if (answer === undefined) return { deny: "The user dismissed the dialog." };
    return {
      result: {
        questions: e.questions,
        answers: { [asked.question]: answer },
      },
    };
  });
  return askedOptions;
};

const readSavedRecap = (handoffFiles: Map<string, string>) =>
  [...handoffFiles.values()][0]?.split("\n---\n\n")[1];

const collectWriterRequests = (on: On) => {
  const writerRequests: { system: string; prompt: string }[] = [];
  on("model.complete", (_, e) => {
    writerRequests.push({ system: e.system ?? "", prompt: e.prompt });
    return {
      value: { isAnswered: true, text: WRITTEN_RECAP, usage: MODEL_USAGE },
    };
  });
  return writerRequests;
};

const testWithQuestionTurn = (
  name: string,
  options: Record<string, string>,
  body: HandoffTestBody
) =>
  test(name, { options }, ($, on) => {
    on("session.cwd", () => ({ value: "/repo" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    answerTurns(on);
    ignoreToasts(on);
    collectStatuses(on);
    return body($, on, mockHandoffFiles(on), mockStore(on));
  });

testWithQuestionTurn(
  "the session's own model is asked for the open questions first, and its answer reaches the recap writer as decisions",
  { writer: "haiku" },
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    const writerRequests = collectWriterRequests(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    const reply = await $.command.run(handoff("save the auth change"));
    await clock.settle();
    const writerRequestsBeforeAnswer = [...writerRequests];
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      `The user answered.\n${DECISION_LINES}`
    );

    expect(reply.text).toBe(ASKING_QUESTIONS_MESSAGE);
    expect(submittedPrompts[0]).toContain(
      "ask the user each one with AskUserQuestion"
    );
    expect(submittedPrompts[0]).toContain("<focus>\nthe auth change\n</focus>");
    expect(writerRequestsBeforeAnswer).toEqual([]);
    expect(writerRequests[0]?.prompt).toContain(DECISIONS_BLOCK);
    expect(turnResult.text).toContain("Saved as handoff #1");
    expect(readSavedRecap(handoffFiles)).toBe(`${WRITTEN_RECAP}\n`);
  }
);

testWithQuestionTurn(
  "a session with nothing to ask tells the recap writer no question is left",
  { writer: "haiku" },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    const writerRequests = collectWriterRequests(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    await clock.settle();
    await endRecapTurn($, submittedPrompts[0] ?? "", "none");

    expect(writerRequests[0]?.prompt).toContain(
      "<decisions>\nNo question was left for the user.\n</decisions>"
    );
  }
);

testWithQuestionTurn(
  "with no writer setting the session's own model asks the open questions, then one subagent writes the recap with no haiku call",
  {},
  async ($, on) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    const spawnedAgents = collectSpawnedAgents(on);
    const writerRequests = collectWriterRequests(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    await clock.settle();
    const agentCountBeforeAnswer = spawnedAgents.length;
    const turnResult = await endRecapTurn(
      $,
      submittedPrompts[0] ?? "",
      DECISION_LINES
    );

    expect(agentCountBeforeAnswer).toBe(0);
    expect(turnResult.text).toBe(SUBAGENT_WRITING_MESSAGE);
    expect(spawnedAgents.map((agent) => agent.prompt)).toEqual([
      expect.stringContaining(DECISIONS_BLOCK),
    ]);
    expect(writerRequests).toEqual([]);
  }
);

testWithQuestionTurn(
  "interrupting the question turn cancels the handoff",
  { writer: "haiku" },
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    const writerRequests = collectWriterRequests(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    await clock.settle();
    await $.turn.start({
      text: submittedPrompts[0] ?? "",
      turnId: RECAP_TURN_ID,
    });
    await $.turn.complete({
      answer: "",
      durationMs: 1,
      isAborted: true,
      turnId: RECAP_TURN_ID,
      reason: "answer",
    });

    expect(writerRequests).toEqual([]);
    expect(handoffFiles.size).toBe(0);
  }
);

testWithSession(
  "the recap writer is told to start with a short title, to write decisions into the prompt and to list only what was left open",
  CONVERSATION,
  async ($, on) => {
    ignoreToasts(on);
    const writerRequests = collectWriterRequests(on);
    on("prompt.fill", () => ({ isFilled: true }));

    await $.command.run(handoff("the auth change"));

    expect(writerRequests[0]?.system).toContain(
      "Start with a one-line title that names the work"
    );
    expect(writerRequests[0]?.system).toContain(
      "If a <decisions> block is present"
    );
    expect(writerRequests[0]?.system).toContain(
      'a line reading exactly "Open questions for the user:"'
    );
  }
);

testWithConversationWriter(
  "the conversation writer asks the open questions itself, in the turn that writes the recap",
  async ($, on, handoffFiles) => {
    const clock = mock.clock(on, { now: NOVEMBER_NINTH });
    answerTurns(on);
    ignoreToasts(on);
    collectStatuses(on);
    const writerRequests = collectWriterRequests(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save"));
    await clock.settle();
    await endRecapTurn($, submittedPrompts[0] ?? "", WRITTEN_RECAP);

    expect(submittedPrompts).toHaveLength(1);
    expect(submittedPrompts[0]).toContain(
      "First ask the user, with AskUserQuestion"
    );
    expect(writerRequests).toEqual([]);
    expect(readSavedRecap(handoffFiles)).toBe(`${WRITTEN_RECAP}\n`);
  }
);

test(
  "a deleted worktree files its handoffs under the main repository's name",
  { options: { writer: "haiku", hasConversationTurns: false } },
  async ($, on) => {
    on("session.cwd", () => ({ value: "/repo/.claude/worktrees/feature-x" }));
    on("session.messages", () => ({ value: CONVERSATION }));
    mock.clock(on, { now: NOVEMBER_NINTH });
    mockStore(on);
    answerRecap(on);
    const handoffFiles = mockHandoffFiles(on, "");

    await $.command.run(handoff("save"));

    expect([...handoffFiles.keys()]).toEqual([
      handoffPath(1, "resume-prompt", "repo"),
    ]);
  }
);

const REPOSITORY_QUESTION = "Which repository is this handoff about?";

for (const [repositoryLine, answers, projectName] of [
  ["Repository: /src/notes-app", {}, "notes-app"],
  [
    "Repository: /src/notes-app | /src/billing",
    { [REPOSITORY_QUESTION]: "/src/billing" },
    "billing",
  ],
] as const) {
  test(
    `a recap whose ${repositoryLine} is filed under ${projectName}`,
    { options: { writer: "haiku", hasConversationTurns: false } },
    async ($, on) => {
      on("session.cwd", () => ({ value: "/repo" }));
      on("session.messages", () => ({ value: CONVERSATION }));
      mock.clock(on, { now: NOVEMBER_NINTH });
      mockStore(on);
      ignoreToasts(on);
      answerRecap(
        on,
        `Fix the login\n${repositoryLine}\n\nGoal: the login works.`
      );
      answerQuestions(on, answers);
      const handoffFiles = mockHandoffFiles(on, "");

      await $.command.run(handoff("save"));

      expect([...handoffFiles.keys()]).toEqual([
        handoffPath(1, "fix-the-login", projectName),
      ]);
      expect(readSavedRecap(handoffFiles)).toBe(
        "Fix the login\n\nGoal: the login works.\n"
      );
    }
  );
}

const SPINNER_FRAME = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/;

testWithSubagentWriter(
  "while a subagent writes the recap, the band shows a spinner header and the step list",
  async ($, on) => {
    const clock = mock.clock(on);
    useBand(on);
    answerTurns(on);
    ignoreToasts(on);
    collectStatuses(on);
    const spawnedAgents = collectSpawnedAgents(on);

    await $.command.run(handoff("save the auth change"));
    const band = await $.ui.mount(BOX_BAND);

    const header = await band.find({
      type: "Text",
      text: "📜 Handoff · Writing",
    });
    expect(header?.props).toMatchObject({ weight: "semibold" });
    const spinners = await band.findAll({ type: "Text", text: SPINNER_FRAME });
    expect(spinners[0]?.text).toBe("⠋");
    expect(spinners[0]?.props).toMatchObject({ color: "claude" });
    const done = await band.find({ type: "Text", text: "✓" });
    expect(done?.props).toMatchObject({ color: "success" });
    const pending = await band.find({ type: "Text", text: "○" });
    expect(pending?.props).toMatchObject({ dimColor: true });
    expect(
      (await band.find({ type: "Text", text: /^─+$/ }))?.props
    ).toMatchObject({ color: "subtle", wrap: "clip" });

    await clock.advance(100);
    await band.unmount();
    const nextBand = await $.ui.mount(BOX_BAND);
    expect(
      (await nextBand.find({ type: "Text", text: SPINNER_FRAME }))?.text
    ).toBe("⠙");

    await endAgentTurn(
      $,
      RECAP_AGENT_ID,
      spawnedAgents[0]?.prompt ?? "",
      "Resume prompt"
    );
    await nextBand.unmount();
    const finishedBand = await $.ui.mount(BOX_BAND);
    expect(await finishedBand.find({ type: "Text" })).toBeUndefined();
  }
);

testWithQuestionTurn(
  "the band names the open questions step first, and ends when the question turn is aborted",
  { writer: "haiku" },
  async ($, on) => {
    const clock = mock.clock(on);
    useBand(on);
    const submittedPrompts = collectSubmittedPrompts(on);

    await $.command.run(handoff("save the auth change"));
    await clock.settle();
    const band = await $.ui.mount(BOX_BAND);
    expect(
      await band.find({ type: "Text", text: "📜 Handoff · Asking" })
    ).toBeDefined();
    expect(await band.find({ type: "Text", text: "✓" })).toBeUndefined();

    const turnId = "turn-question";
    await $.turn.start({ text: submittedPrompts[0] ?? "", turnId });
    await $.turn.complete({
      answer: "",
      durationMs: 1,
      isAborted: true,
      turnId,
      reason: "aborted",
    });
    await band.unmount();
    const abortedBand = await $.ui.mount(BOX_BAND);
    expect(await abortedBand.find({ type: "Text" })).toBeUndefined();
  }
);
