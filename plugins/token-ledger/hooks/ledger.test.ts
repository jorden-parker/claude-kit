import { expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeNudge,
  composeSummary,
  countLastReplyWords,
  formatReport,
  type LedgerEntry,
  readNewestEntries,
  recordReplyMeter,
  recordSession,
  summarizeTranscript,
  takeReplyNote,
  waitForLastReply,
} from "./ledger.ts";

const entryWithTools = (
  session: string,
  resultCharactersByTool: Record<string, number>
): LedgerEntry => ({
  session,
  project: "shop",
  updatedAt: "2026-01-02T03:04:05.000Z",
  contextTokens: 1000,
  lastNudgeTokens: 0,
  main: {},
  subagents: {},
  resultCharactersByTool,
});

test("formatReport lists the biggest tools beside the guards caps", () => {
  const report = formatReport([
    entryWithTools("session-1", { Bash: 20_000, Read: 5000, Agent: 1000 }),
    entryWithTools("session-2", {
      Bash: 10_000,
      mcp__notes__list: 8000,
      run_shell_command: 2000,
    }),
  ]);
  const shellCap = "bash-trim caps at 150 lines, 400 characters a line";
  expect(report).toContain(
    "Biggest tool results across these sessions, beside the guards caps:"
  );
  expect(report).toContain(`  Bash 30k chars: ${shellCap}`);
  expect(report).toContain(`  run_shell_command 2k chars: ${shellCap}`);
  expect(report).toContain(
    "  mcp__notes__list 8k chars: bash-trim caps at 300 lines (off when GUARDS_MCP_TRIM=0)"
  );
  expect(report).toContain("  Read 5k chars: read-guard caps at 300 lines");
  expect(report).toContain("  Agent 1k chars: no guards cap");
  expect(report.indexOf("  Bash 30k")).toBeLessThan(
    report.indexOf("  mcp__notes__list 8k")
  );
});

test("formatReport reads an entry saved without tool results", () => {
  const olderEntry = {
    ...entryWithTools("session-3", {}),
    resultCharactersByTool: undefined,
  } as unknown as LedgerEntry;
  expect(formatReport([olderEntry])).toContain("session-3");
});

const assistantLine = (
  messageId: string,
  model: string,
  usage: Record<string, number>,
  content: unknown[] = []
) =>
  JSON.stringify({
    type: "assistant",
    message: { id: messageId, model, usage, content },
  });

const toolResultLine = (toolUseId: string, text: string) =>
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }],
    },
  });

const usage = (
  input: number,
  cacheWrite: number,
  cacheRead: number,
  output: number
) => ({
  input_tokens: input,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
  output_tokens: output,
});

const transcript = (...lines: string[]) => lines.join("\n");

test("sums token use per model and counts a repeated message id once", () => {
  const summary = summarizeTranscript(
    transcript(
      assistantLine("msg_1", "fable", usage(10, 100, 1000, 5)),
      assistantLine("msg_1", "fable", usage(10, 100, 1000, 50)),
      assistantLine("msg_2", "fable", usage(1, 2, 3, 4)),
      assistantLine("msg_3", "haiku", usage(7, 0, 0, 9))
    )
  );
  expect(summary.byModel).toEqual({
    fable: { input: 11, cacheWrite: 102, cacheRead: 1003, output: 54 },
    haiku: { input: 7, cacheWrite: 0, cacheRead: 0, output: 9 },
  });
});

test("the context size is what the last message read and wrote", () => {
  const summary = summarizeTranscript(
    transcript(
      assistantLine("msg_1", "fable", usage(10, 100, 1000, 5)),
      assistantLine("msg_2", "fable", usage(20, 200, 2000, 5))
    )
  );
  expect(summary.contextTokens).toBe(2220);
});

test("the context size at the start is what the first message read and wrote", () => {
  const summary = summarizeTranscript(
    transcript(
      assistantLine("msg_1", "fable", usage(10, 100, 1000, 5)),
      assistantLine("msg_2", "fable", usage(20, 200, 2000, 5))
    )
  );
  expect(summary.startContextTokens).toBe(1110);
});

const toolCallLine = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    id: "msg_1",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "toolu_1", name: "Bash" }],
  },
});

const lastReplyLine = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", id: "msg_2", stop_reason: "end_turn" },
});

function writeTranscriptFile(...lines: string[]): string {
  const transcriptPath = join(
    mkdtempSync(join(tmpdir(), "ledger-")),
    "session.jsonl"
  );
  writeFileSync(transcriptPath, transcript(...lines));
  return transcriptPath;
}

test("waits until Claude Code has written the turn's last reply", async () => {
  const transcriptPath = writeTranscriptFile(
    toolCallLine,
    toolResultLine("toolu_1", "hello")
  );
  setTimeout(() => appendFileSync(transcriptPath, `\n${lastReplyLine}`), 20);
  expect(await waitForLastReply(transcriptPath, 5, 200)).toBe(true);
  expect(readFileSync(transcriptPath, "utf8")).toContain("msg_2");
});

test("stops waiting when the last reply never arrives", async () => {
  const transcriptPath = writeTranscriptFile(lastReplyLine, toolCallLine);
  expect(await waitForLastReply(transcriptPath, 1, 3)).toBe(false);
});

test("adds up tool result characters per tool", () => {
  const summary = summarizeTranscript(
    transcript(
      assistantLine("msg_1", "fable", usage(1, 0, 0, 1), [
        { type: "tool_use", id: "toolu_1", name: "Bash" },
        { type: "tool_use", id: "toolu_2", name: "Read" },
      ]),
      toolResultLine("toolu_1", "12345"),
      toolResultLine("toolu_2", "123"),
      assistantLine("msg_2", "fable", usage(1, 0, 0, 1), [
        { type: "tool_use", id: "toolu_3", name: "Bash" },
      ]),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_3",
              content: [{ type: "text", text: "12" }, { type: "image" }],
            },
          ],
        },
      })
    )
  );
  expect(summary.resultCharactersByTool).toEqual({ Bash: 7, Read: 3 });
});

test("a broken line is skipped", () => {
  const summary = summarizeTranscript(
    transcript(
      '{"message": {"usage"',
      assistantLine("msg_1", "fable", usage(1, 1, 1, 1))
    )
  );
  expect(summary.contextTokens).toBe(3);
});

test("no nudge under the threshold or right after one", () => {
  expect(composeNudge(112_999, 0, 113_000, 73_000)).toBeNull();
  expect(composeNudge(160_000, 113_000, 113_000, 73_000)).toBeNull();
});

test("a nudge at the threshold and again after 50,000 more tokens", () => {
  expect(composeNudge(113_000, 0, 113_000, 73_000)).toContain("113k tokens");
  expect(composeNudge(113_000, 0, 113_000, 73_000)).toContain(
    "up from 73k at the start"
  );
  expect(composeNudge(113_000, 0, 113_000, 73_000)).toContain("/handoff");
  expect(composeNudge(163_000, 113_000, 113_000, 73_000)).toContain(
    "163k tokens"
  );
});

function createSession(contextTokens: number) {
  const userHome = mkdtempSync(join(tmpdir(), "ledger-"));
  const projectFolder = join(userHome, "projects");
  const subagentFolder = join(projectFolder, "session-1", "subagents");
  mkdirSync(subagentFolder, { recursive: true });
  const transcriptPath = join(projectFolder, "session-1.jsonl");
  writeFileSync(
    transcriptPath,
    assistantLine("msg_1", "fable", usage(0, 0, contextTokens, 10))
  );
  writeFileSync(
    join(subagentFolder, "agent-a.jsonl"),
    assistantLine("msg_2", "haiku", usage(5, 0, 0, 6))
  );
  const event = {
    session_id: "session-1",
    cwd: "/Users/tester/src/shop",
    transcript_path: transcriptPath,
  };
  return { userHome, event };
}

function createGrowingSession(startTokens: number, contextTokens: number) {
  const session = createSession(contextTokens);
  writeFileSync(
    session.event.transcript_path,
    transcript(
      assistantLine("msg_0", "fable", usage(0, 0, startTokens, 10)),
      assistantLine("msg_1", "fable", usage(0, 0, contextTokens, 10))
    )
  );
  return session;
}

const savedEntry = (userHome: string) =>
  JSON.parse(
    readFileSync(
      join(userHome, ".cache/token-ledger/sessions/session-1.json"),
      "utf8"
    )
  );

test("a recorded session holds the main and subagent totals", () => {
  const { userHome, event } = createSession(1000);
  const output = recordSession(
    event,
    userHome,
    new Date("2026-01-02T03:04:05Z")
  );
  expect(output?.systemMessage).toBe(
    "Context 1k. Session: in 0k, cache write 0k, cache read 1k, out 0k. Subagents: in 0k, cache write 0k, cache read 0k, out 0k."
  );
  expect(savedEntry(userHome)).toEqual({
    session: "session-1",
    project: "shop",
    updatedAt: "2026-01-02T03:04:05.000Z",
    contextTokens: 1000,
    lastNudgeTokens: 0,
    main: { fable: { input: 0, cacheWrite: 0, cacheRead: 1000, output: 10 } },
    subagents: { haiku: { input: 5, cacheWrite: 0, cacheRead: 0, output: 6 } },
    resultCharactersByTool: {},
  });
});

test("a large context shows the user a nudge once", () => {
  const { userHome, event } = createGrowingSession(100_000, 160_000);
  const firstOutput = recordSession(event, userHome, new Date());
  expect(firstOutput?.systemMessage).toContain("160k tokens");
  expect(savedEntry(userHome).lastNudgeTokens).toBe(160_000);
  const secondOutput = recordSession(event, userHome, new Date());
  expect(secondOutput?.systemMessage).toStartWith("Context 160k.");
  expect(secondOutput?.systemMessage).not.toContain("/handoff");
});

test("the default nudge waits for 40,000 tokens of growth since the first turn", () => {
  const belowGrowth = createGrowingSession(73_000, 112_999);
  const belowOutput = recordSession(
    belowGrowth.event,
    belowGrowth.userHome,
    new Date()
  );
  expect(belowOutput?.systemMessage).not.toContain("/handoff");
  const atGrowth = createGrowingSession(73_000, 113_000);
  const atOutput = recordSession(atGrowth.event, atGrowth.userHome, new Date());
  expect(atOutput?.systemMessage).toContain("113k tokens");
  expect(atOutput?.systemMessage).toContain("up from 73k at the start");
  const slowGrowth = createGrowingSession(73_000, 81_000);
  const slowOutput = recordSession(
    slowGrowth.event,
    slowGrowth.userHome,
    new Date()
  );
  expect(slowOutput?.systemMessage).not.toContain("/handoff");
});

test("a session with no subagents leaves them out of the summary", () => {
  const entry: LedgerEntry = {
    session: "session-1",
    project: "shop",
    updatedAt: "2026-01-02T03:04:05.000Z",
    contextTokens: 60_000,
    lastNudgeTokens: 0,
    main: {
      fable: { input: 2000, cacheWrite: 60_000, cacheRead: 0, output: 1000 },
      haiku: { input: 1000, cacheWrite: 0, cacheRead: 0, output: 0 },
    },
    subagents: {},
    resultCharactersByTool: {},
  };
  expect(composeSummary(entry)).toBe(
    "Context 60k. Session: in 3k, cache write 60k, cache read 0k, out 1k."
  );
});

test("TOKEN_LEDGER_NUDGE_TOKENS moves the growth threshold", () => {
  process.env.TOKEN_LEDGER_NUDGE_TOKENS = "500";
  try {
    const belowGrowth = createGrowingSession(73_000, 73_499);
    expect(
      recordSession(belowGrowth.event, belowGrowth.userHome, new Date())
        ?.systemMessage
    ).not.toContain("/handoff");
    const atGrowth = createGrowingSession(73_000, 73_500);
    expect(
      recordSession(atGrowth.event, atGrowth.userHome, new Date())
        ?.systemMessage
    ).toContain("/handoff");
  } finally {
    delete process.env.TOKEN_LEDGER_NUDGE_TOKENS;
  }
});

test("an event with no transcript records nothing", () => {
  const userHome = mkdtempSync(join(tmpdir(), "ledger-"));
  expect(
    recordSession({ session_id: "session-1" }, userHome, new Date())
  ).toBeNull();
});

test("the report lists the newest sessions with their totals and biggest tools", () => {
  const report = formatReport([
    {
      session: "session-1",
      project: "shop",
      updatedAt: "2026-01-02T03:04:05.000Z",
      contextTokens: 120_000,
      lastNudgeTokens: 0,
      main: {
        fable: {
          input: 1000,
          cacheWrite: 20_000,
          cacheRead: 300_000,
          output: 4000,
        },
      },
      subagents: {
        haiku: { input: 50_000, cacheWrite: 0, cacheRead: 0, output: 2000 },
      },
      resultCharactersByTool: { Bash: 9000, Read: 40_000, Agent: 100 },
    },
  ]);
  expect(report).toContain("2026-01-02 03:04");
  expect(report).toContain("shop");
  expect(report).toContain("context 120k");
  expect(report).toContain(
    "fable: in 1k, cache write 20k, cache read 300k, out 4k"
  );
  expect(report).toContain("subagents haiku: in 50k");
  expect(report).toContain("Read 40k chars, Bash 9k chars, Agent 0k chars");
});

test("readNewestEntries returns every stored session for Infinity and the newest for a count", () => {
  const userHome = mkdtempSync(join(tmpdir(), "ledger-"));
  const sessionFolder = join(userHome, ".cache/token-ledger/sessions");
  mkdirSync(sessionFolder, { recursive: true });
  for (let index = 0; index < 12; index++) {
    const name = `session-${index}`;
    const path = join(sessionFolder, `${name}.json`);
    writeFileSync(path, JSON.stringify(entryWithTools(name, {})));
    const time = new Date(2026, 0, 1, 0, index);
    utimesSync(path, time, time);
  }
  expect(readNewestEntries(userHome, Infinity)).toHaveLength(12);
  expect(readNewestEntries(userHome, 5).map((entry) => entry.session)).toEqual([
    "session-11",
    "session-10",
    "session-9",
    "session-8",
    "session-7",
  ]);
});

const promptLine = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text } });

const assistantTextLine = (messageId: string, text: string) =>
  assistantLine(messageId, "fable", usage(1, 0, 0, 1), [
    { type: "text", text },
  ]);

test("counts narration before a tool call apart from the final reply", () => {
  const counts = countLastReplyWords(
    transcript(
      promptLine("fix the build"),
      assistantLine("msg_1", "fable", usage(1, 0, 0, 1), [
        { type: "text", text: "Let me check the build log now." },
        { type: "tool_use", id: "toolu_1", name: "Bash" },
      ]),
      toolResultLine("toolu_1", "build failed"),
      assistantTextLine("msg_2", "The build now passes after the fix.")
    )
  );
  expect(counts).toEqual({ finalWords: 7, narrationWords: 7 });
});

test("a tool_result user entry does not start a new reply", () => {
  const counts = countLastReplyWords(
    transcript(
      promptLine("first question"),
      assistantLine("msg_1", "fable", usage(1, 0, 0, 1), [
        { type: "text", text: "Working on it." },
        { type: "tool_use", id: "toolu_1", name: "Bash" },
      ]),
      toolResultLine("toolu_1", "output"),
      assistantTextLine("msg_2", "Done here now.")
    )
  );
  expect(counts).toEqual({ finalWords: 3, narrationWords: 3 });
});

test("no assistant text gives zero words", () => {
  const counts = countLastReplyWords(
    transcript(
      promptLine("hello"),
      assistantLine("msg_1", "fable", usage(1, 0, 0, 1), [
        { type: "tool_use", id: "toolu_1", name: "Bash" },
      ]),
      toolResultLine("toolu_1", "output")
    )
  );
  expect(counts).toEqual({ finalWords: 0, narrationWords: 0 });
});

test("sidechain entries and broken lines are not counted", () => {
  const sidechainLine = JSON.stringify({
    type: "assistant",
    isSidechain: true,
    message: {
      id: "msg_9",
      content: [{ type: "text", text: "one two three" }],
    },
  });
  const counts = countLastReplyWords(
    transcript(
      promptLine("question"),
      '{"type": "assistant", "message"',
      sidechainLine,
      assistantTextLine("msg_1", "Answer  with   spaces.")
    )
  );
  expect(counts).toEqual({ finalWords: 3, narrationWords: 0 });
});

const replyNotePath = (userHome: string) =>
  join(userHome, ".cache/token-ledger/notes/session-1.txt");

test("a reply over the word budget leaves a note that the next prompt reads", () => {
  const { userHome, event } = createSession(1000);
  const longReply = Array.from({ length: 160 }, () => "word").join(" ");
  writeFileSync(
    event.transcript_path,
    transcript(promptLine("explain it"), assistantTextLine("msg_1", longReply))
  );
  recordReplyMeter(event, userHome);
  const note =
    "Your last reply ran 160 words (budget 150) with 0 words of narration between tool calls (budget 40). Say less: write nothing between tool calls, and keep the final reply under 150 words unless the reader asked you to explain.";
  expect(readFileSync(replyNotePath(userHome), "utf8")).toBe(note);
  expect(takeReplyNote("session-1", userHome)).toEqual({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: note,
    },
  });
  expect(existsSync(replyNotePath(userHome))).toBe(false);
});

test("a reply within budget removes an old note", () => {
  const { userHome, event } = createSession(1000);
  writeFileSync(
    event.transcript_path,
    transcript(promptLine("short?"), assistantTextLine("msg_1", "Yes."))
  );
  mkdirSync(join(userHome, ".cache/token-ledger/notes"), { recursive: true });
  writeFileSync(replyNotePath(userHome), "stale note");
  recordReplyMeter(event, userHome);
  expect(existsSync(replyNotePath(userHome))).toBe(false);
  expect(takeReplyNote("session-1", userHome)).toBeNull();
});
