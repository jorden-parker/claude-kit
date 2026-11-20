import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeNudge,
  composeSummary,
  formatReport,
  type LedgerEntry,
  recordSession,
  summarizeTranscript,
} from "./ledger.ts";

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
  expect(composeNudge(149_999, 0, 150_000)).toBeNull();
  expect(composeNudge(180_000, 150_000, 150_000)).toBeNull();
});

test("a nudge at the threshold and again after 50,000 more tokens", () => {
  expect(composeNudge(150_000, 0, 150_000)).toContain("150k tokens");
  expect(composeNudge(150_000, 0, 150_000)).toContain("/handoff");
  expect(composeNudge(200_000, 150_000, 150_000)).toContain("200k tokens");
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
  const { userHome, event } = createSession(160_000);
  const firstOutput = recordSession(event, userHome, new Date());
  expect(firstOutput?.systemMessage).toContain("160k tokens");
  expect(savedEntry(userHome).lastNudgeTokens).toBe(160_000);
  const secondOutput = recordSession(event, userHome, new Date());
  expect(secondOutput?.systemMessage).toStartWith("Context 160k.");
  expect(secondOutput?.systemMessage).not.toContain("/handoff");
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

test("TOKEN_LEDGER_NUDGE_TOKENS moves the threshold", () => {
  const { userHome, event } = createSession(1000);
  process.env.TOKEN_LEDGER_NUDGE_TOKENS = "500";
  try {
    expect(recordSession(event, userHome, new Date())?.systemMessage).toContain(
      "1k tokens"
    );
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
