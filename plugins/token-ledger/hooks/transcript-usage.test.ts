import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTranscriptIndex, transcriptDay } from "./transcript-usage.ts";
import { verifyTranscripts } from "./verify-transcripts.ts";
import { reportPricing } from "./usage-pricing.ts";
import { startVerifyServer } from "./live-verify.ts";

test("raw main and worker calls power overview and calendar without an export, recorder or deployment", async () => {
  const home = mkdtempSync(join(tmpdir(), "transcript-report-"));
  const root = join(home, ".claude/projects/private-project");
  const child = join(root, "parent/subagents");
  mkdirSync(child, { recursive: true });
  const date = new Date("2026-11-26T23:59:59.990Z");
  const row = (
    id: string,
    timestamp: string,
    output: number,
    model = "claude-opus-5-5"
  ) =>
    JSON.stringify({
      type: "assistant",
      requestId: "request-" + id,
      sessionId: "parent",
      timestamp,
      message: {
        id,
        model,
        role: "assistant",
        content: "PRIVATE MESSAGE",
        usage: {
          input_tokens: 100,
          output_tokens: output,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 50,
        },
      },
    });
  const first = row("one", date.toISOString(), 1);
  writeFileSync(
    join(root, "parent.jsonl"),
    [
      first,
      row("one", "2026-11-27T00:00:01Z", 2),
      row("marker", date.toISOString(), 0, "<synthetic>"),
    ].join("\n")
  );
  writeFileSync(join(root, "replay.jsonl"), first);
  writeFileSync(
    join(child, "agent-w.jsonl"),
    row("two", "2026-11-27T00:00:02Z", 3, "unpriced")
  );
  writeFileSync(
    join(child, "agent-w.meta.json"),
    JSON.stringify({ agentType: "Explore", description: "PRIVATE DESCRIPTION" })
  );
  const { server, url } = startVerifyServer(home, {
    discover: async () => ({ roots: [], message: "CLI unavailable" }),
    loadUsage: async () => {
      throw Error("Codeburn unavailable");
    },
  });
  try {
    const { calls, errors } = await createTranscriptIndex(home, "")();
    expect(calls.length).toBe(2);
    expect(errors).toBe(0);
    const pricing = reportPricing({});
    expect(
      transcriptDay(calls, "2026-11-26", "America/New_York", pricing, errors)
    ).toMatchObject({
      calls: 2,
      priced: 1,
      cost: 0.00055,
      cacheRead: 100,
      unpriced: true,
      unpricedModels: ["unpriced"],
    });
    expect(
      transcriptDay(calls, "2026-11-26", "UTC", pricing, errors)
    ).toMatchObject({ calls: 1, priced: 1 });
    const page = await (await fetch(url)).text();
    for (const text of [
      "Last 1 session ·",
      "Explore",
      "No matching rate",
      "Reference estimate",
      "USD",
      "1 of 1 sessions have local transcript evidence",
    ])
      expect(page).toContain(text);
    for (const secret of [
      "private-project",
      "PRIVATE MESSAGE",
      "PRIVATE DESCRIPTION",
      "request-one",
      "agent-w",
    ])
      expect(page).not.toContain(secret);
    const day = new Date(date).toLocaleDateString("sv-SE");
    const selected = await (await fetch(url + "?day=" + day)).text();
    expect(selected).toContain("1 fully priced");
    const record = {
      sessionId: "parent",
      model: "claude-opus-5-5",
      timestamp: date.toISOString(),
      inputTokens: 100,
      outputTokens: 2,
      cacheReadTokens: 50,
      cacheWriteTokens: 20,
    };
    const worker = {
      ...record,
      sessionId: "agent-w",
      model: "unpriced",
      timestamp: "2026-11-27T00:00:02Z",
      outputTokens: 3,
      subagentType: "Explore",
    };
    const verify = (records: unknown[]) =>
      verifyTranscripts(records, calls, new Set(["parent"]));
    expect(verify([record, worker])).toMatchObject({
      matched: 2,
      mismatched: 0,
      missingExport: 0,
    });
    expect(
      verify([
        {
          ...record,
          timestamp: undefined,
          requestId: "request-one",
          outputTokens: 9,
        },
      ])
    ).toMatchObject({ mismatched: 1, missingExport: 1 });
    expect(verify([{ ...record, messageId: "wrong" }])).toMatchObject({
      missingTranscript: 1,
      missingExport: 2,
    });
    expect(
      verify([record, record, { ...worker, cacheReadTokens: undefined }])
    ).toMatchObject({ matched: 0, inconclusive: 3 });
  } finally {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});

test("a refreshed index reconciles conflicting roles, modified streams and removed sources", async () => {
  const home = mkdtempSync(join(tmpdir(), "ledger-updates-"));
  const root = join(home, ".claude/projects/project");
  const folder = join(root, "s/subagents");
  mkdirSync(folder, { recursive: true });
  const main = join(root, "s.jsonl"),
    worker = join(folder, "agent-w.jsonl");
  const row = JSON.stringify({
    type: "assistant",
    sessionId: "s",
    timestamp: "2026-11-26T12:00:00Z",
    message: {
      id: "id",
      model: "claude-opus-5-5",
      usage: {
        input_tokens: 7,
        output_tokens: 8,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
  const index = createTranscriptIndex(home, "", 0);
  try {
    writeFileSync(main, row);
    writeFileSync(worker, row);
    const first = await index();
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0].worker).toBeUndefined();
    rmSync(worker);
    writeFileSync(
      main,
      row + "\n" + row.replace('"output_tokens":8', '"output_tokens":12')
    );
    const second = await index();
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].worker).toBe(false);
    expect(second.calls[0].usage.output).toBe(12);
    rmSync(main);
    expect((await index()).calls).toHaveLength(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("daily coverage includes calls outside the recent 20 and keeps configured currency separate", async () => {
  const { recentTranscripts } = await import("./transcript-usage.ts");
  const { normalizeUsage } = await import("./usage-metrics.ts");
  const time = Date.parse("2026-11-26T12:00:00Z");
  const calls = Array.from({ length: 21 }, (_, i) => ({
    first: time + i,
    last: time + i,
    times: new Set([time + i]),
    source: String(i),
    session: String(i),
    worker: false,
    finished: true,
    messageId: String(i),
    usage: normalizeUsage({
      model: i === 0 ? "custom" : "claude-opus-5-5",
      usage: {
        input_tokens: 100,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }),
  }));
  const pricing = reportPricing(
    { custom: { input: 1e6, output: 1, cacheRead: 1, cacheWrite: 1 } },
    "GBP"
  );
  expect(recentTranscripts(calls, [])).toHaveLength(20);
  expect(recentTranscripts(calls, []).some((e) => e.session === "0")).toBe(
    false
  );
  expect(transcriptDay(calls, "2026-11-26", "UTC", pricing, 0)).toMatchObject({
    calls: 21,
    priced: 1,
    configuredCalls: 1,
    unpriced: true,
    cost: 100,
    currency: "GBP",
  });
});
