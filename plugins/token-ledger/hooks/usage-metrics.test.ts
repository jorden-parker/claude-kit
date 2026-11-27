import { expect, test } from "bun:test";
import { normalizeUsage, parseRates, taskMetrics } from "./usage-metrics.ts";

test("missing usage is unknown and reasoning is not charged twice", () => {
  expect(normalizeUsage({}).reasoning).toBeUndefined();
  const usage = normalizeUsage(
    {
      model: "sol",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 12 },
      },
    },
    { sol: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } }
  );
  expect(usage.input).toBe(60);
  expect(usage.reasoning).toBe(12);
  expect(usage.estimatedCost).toBeCloseTo(0.0001155);
  expect(
    normalizeUsage({
      usage: { input_tokens: 100, cache_read_input_tokens: 30 },
    }).input
  ).toBe(100);
  expect(parseRates('{"bad":{"input":-1}}')).toEqual({});
});
test("tasks count workers, resumes and denials and deduplicate usage", () => {
  const message = { id: "reply", model: "sol", usage: { output_tokens: 10 } };
  const transcript = [
    { type: "user", message: { content: "fix" } },
    {
      message: {
        content: [
          { type: "tool_use", name: "Agent", input: { resume: "worker" } },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", is_error: true, content: "hook denied" },
        ],
      },
    },
    { message },
    { message },
    { type: "user", message: { content: "next" } },
  ]
    .map((value) => JSON.stringify(value))
    .join("\n");
  const tasks = taskMetrics(transcript);
  expect(tasks).toHaveLength(2);
  expect(tasks[0]?.requests).toHaveLength(1);
  expect(tasks[0]?.workerCalls).toBe(1);
  expect(tasks[0]?.resumedWorkers).toBe(1);
  expect(tasks[0]?.hookDenials).toBe(1);
});

test("Bedrock counters normalize without assuming missing cache is zero", () => {
  const result = normalizeUsage({
    model: "bedrock-sol",
    usage: {
      inputTokens: 12,
      outputTokens: 4,
      cacheReadInputTokens: 5,
      cacheWriteInputTokens: 2,
    },
  });
  expect(result).toMatchObject({
    input: 12,
    output: 4,
    cacheRead: 5,
    cacheWrite: 2,
  });
  expect(
    normalizeUsage(
      { model: "sol", usage: { input_tokens: 10, output_tokens: 4 } },
      { sol: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }
    ).estimatedCost
  ).toBeUndefined();
});

test("comparison includes worker cost and keeps legacy cost unknown", async () => {
  const { summarizeRuns } = await import("../bin/compare-runs.ts");
  const task = {
    task: 1,
    workerCalls: 1,
    resumedWorkers: 0,
    hookDenials: 0,
    requests: [{ resolvedModel: "sol", estimatedCost: 1 }],
  };
  const entry = {
    session: "test",
    project: "test",
    updatedAt: "2026-01-01",
    contextTokens: 0,
    lastNudgeTokens: 0,
    main: {},
    subagents: {},
    resultCharactersByTool: {},
    tasks: [task],
    workerTasks: [
      [
        {
          ...task,
          workerCalls: 0,
          requests: [{ resolvedModel: "haiku", estimatedCost: 0.1 }],
        },
      ],
    ],
  };
  expect(summarizeRuns([entry]).estimatedCost).toBeCloseTo(1.1);
  expect(summarizeRuns([{ ...entry, tasks: undefined }]).estimatedCost).toBe(
    "unknown"
  );
});
