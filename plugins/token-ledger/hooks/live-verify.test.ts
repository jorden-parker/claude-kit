import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startVerifyServer } from "./live-verify.ts";

test("live report reads new session results without restarting", async () => {
  const home = mkdtempSync(join(tmpdir(), "live-ledger-"));
  const folder = join(home, ".cache/token-ledger");
  mkdirSync(join(folder, "sessions"), { recursive: true });
  writeFileSync(
    join(folder, "fixes.jsonl"),
    JSON.stringify({ title: "Update", appliedAt: "2026-11-27T00:00:00Z" }) +
      "\n"
  );
  const { server, url } = startVerifyServer(home, {
    discover: async () => ({ roots: [], message: "Test discovery" }),
  });
  try {
    expect(await (await fetch(url)).text()).toContain(
      "Usage by model and role"
    );
    const first = await fetch(url + "?view=comparison");
    expect(first.headers.get("cache-control")).toBe("no-store");
    const initial = await first.text();
    expect(initial).toContain("After<small>0 sessions");
    expect(initial).toContain("D1 · No session results recorded");
    writeFileSync(
      join(folder, "sessions", "new.json"),
      JSON.stringify({
        session: "new",
        project: "test",
        startedAt: "2026-11-27T01:00:00Z",
        updatedAt: "2026-11-27T01:01:00Z",
        contextTokens: 100,
        lastNudgeTokens: 0,
        main: {},
        subagents: {},
        resultCharactersByTool: {},
      })
    );
    const updated = await (await fetch(url + "?view=comparison")).text();
    expect(updated).toContain("After<small>1 sessions");
    expect(updated).toContain("D4 · Receiving After results");
    expect(updated).toContain("2026-11-27T01:01:00Z");
    expect(updated).toContain("setTimeout(refreshReadings, 2000)");
    expect(updated).toContain("!getSelection()?.toString()");
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
    expect((await fetch(url + "wrong")).status).toBe(404);
  } finally {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});

test("browser refresh retains readings on disconnect and defers replacing selected text", async () => {
  const { runInNewContext } = await import("node:vm");
  const { liveVerifyScript } = await import("./verify-page.ts");
  const timers: (() => Promise<void>)[] = [];
  const status = { textContent: "" };
  const current = { innerHTML: "old readings" };
  let next = "new readings";
  let selection = "";
  let disconnected = false;
  runInNewContext(liveVerifyScript, {
    document: {
      hidden: false,
      getElementById() {
        return status;
      },
      querySelector() {
        return current;
      },
    },
    location: { href: "http://127.0.0.1/test" },
    async fetch() {
      if (disconnected) throw Error("offline");
      return {
        ok: true,
        async text() {
          return next;
        },
      };
    },
    DOMParser: class {
      parseFromString(text: string) {
        return {
          querySelector() {
            return { innerHTML: text };
          },
        };
      }
    },
    getSelection() {
      return {
        toString() {
          return selection;
        },
      };
    },
    setTimeout(callback: () => Promise<void>, delay: number) {
      expect(delay).toBe(2000);
      timers.push(callback);
    },
  });
  await timers.shift()!();
  expect(current.innerHTML).toBe("new readings");
  next = "later readings";
  selection = "copying";
  await timers.shift()!();
  expect(current.innerHTML).toBe("new readings");
  selection = "";
  await timers.shift()!();
  expect(current.innerHTML).toBe("later readings");
  disconnected = true;
  await timers.shift()!();
  expect(current.innerHTML).toBe("later readings");
  expect(status.textContent).toContain("Disconnected");
  disconnected = false;
  await timers.shift()!();
  expect(status.textContent).toContain("Live");
});

test("a report records raw transcripts without Stop hooks and preserves selected comparison", async () => {
  const home = mkdtempSync(join(tmpdir(), "live-source-"));
  const ledger = join(home, ".cache/token-ledger");
  const project = join(home, ".claude/projects/project");
  mkdirSync(ledger, { recursive: true });
  mkdirSync(project, { recursive: true });
  const original = "2026-11-27T13:00:00.000Z";
  writeFileSync(
    join(ledger, "fixes.jsonl"),
    [
      { title: "Cost change", appliedAt: original },
      { title: "Report update", appliedAt: "2026-11-27T16:00:00.000Z" },
    ]
      .map((fix) => JSON.stringify(fix))
      .join("\n")
  );
  writeFileSync(
    join(project, "new.jsonl"),
    JSON.stringify({
      timestamp: "2026-11-27T15:00:00.000Z",
      cwd: "/work",
      message: {
        id: "reply",
        model: "sol",
        usage: { input_tokens: 4, output_tokens: 1 },
        content: [],
        stop_reason: "tool_use",
      },
    }) + "\n"
  );
  const { server, url } = startVerifyServer(home, {
    discover: async () => ({
      roots: [project],
      message: "Connected to Codeburn",
    }),
  });
  try {
    expect(await (await fetch(url + "?view=comparison")).text()).toContain(
      "After<small>0 sessions"
    );
    const selected = await (
      await fetch(url + "?deployment=" + encodeURIComponent(original))
    ).text();
    expect(selected).toContain("After<small>1 sessions");
    expect(selected).toContain("Connected to Codeburn");
    expect(selected).toContain("Compare since");
    expect((await fetch(url + "?deployment=invalid")).status).toBe(400);
    expect(
      JSON.parse(readFileSync(join(ledger, "verify-comparison.json"), "utf8"))
        .since
    ).toBe(original);
  } finally {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});

test("background export pushes a usage event and updates the same report URL", async () => {
  const home = mkdtempSync(join(tmpdir(), "ledger-stream-"));
  const dir = join(home, ".cache/token-ledger/sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "id.json"),
    JSON.stringify({
      session: "id",
      project: "private",
      updatedAt: "2026-11-27",
      main: {},
      subagents: {},
      resultCharactersByTool: {},
    })
  );
  const { parseExport } = await import("./codeburn-usage.ts");
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { server, url } = startVerifyServer(home, {
    discover: async () => ({ roots: [], message: "test" }),
    loadUsage: async (_, entries) => {
      await ready;
      return parseExport(
        {
          schema: "codeburn.export.v2",
          currency: { code: "GBP" },
          records: [],
          sessions: [{ "Session ID": "id", "Cost (GBP)": 2 }],
        },
        entries
      );
    },
  });
  const abort = new AbortController();
  try {
    const stream = await fetch(url + "/events", { signal: abort.signal });
    const reader = stream.body!.getReader();
    await reader.read();
    expect(await (await fetch(url)).text()).toContain("Refreshing Codeburn");
    finish();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "event: usage"
    );
    expect(await (await fetch(url)).text()).toContain(
      "Codeburn matched 1 of 1"
    );
  } finally {
    finish();
    abort.abort();
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});
