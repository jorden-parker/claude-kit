import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  const { server, url } = startVerifyServer(home);
  try {
    const first = await fetch(url);
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
    const updated = await (await fetch(url)).text();
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
