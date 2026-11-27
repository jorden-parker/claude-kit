import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordHook, readRecorderStatus } from "./recorder.ts";

test("recorder reports ignored fields, unavailable transcripts, failures and success", async () => {
  const home = mkdtempSync(join(tmpdir(), "recorder-"));
  try {
    await recordHook("{}", home);
    expect(readRecorderStatus(home)?.reason).toBe("missing-session-id");
    await recordHook(JSON.stringify({ session_id: "test" }), home);
    expect(readRecorderStatus(home)?.reason).toBe("missing-transcript-path");
    await recordHook(
      JSON.stringify({
        session_id: "test",
        transcript_path: join(home, "missing"),
      }),
      home
    );
    expect(readRecorderStatus(home)?.reason).toBe("transcript-not-found");
    await recordHook(
      JSON.stringify({ session_id: "test", transcript_path: home }),
      home
    );
    expect(readRecorderStatus(home)?.outcome).toBe("failed");
    const transcript = join(home, "test.jsonl");
    writeFileSync(
      transcript,
      JSON.stringify({
        timestamp: "2026-11-27T15:00:00Z",
        message: {
          id: "message",
          role: "assistant",
          stop_reason: "end_turn",
          model: "test",
          usage: { input_tokens: 2, output_tokens: 1 },
          content: [{ type: "text", text: "private-content" }],
        },
      }) + "\n"
    );
    await recordHook(
      JSON.stringify({ session_id: "test", transcript_path: transcript }),
      home
    );
    expect(readRecorderStatus(home)?.outcome).toBe("saved");
    const status = readFileSync(
      join(home, ".cache/token-ledger/recorder-status.json"),
      "utf8"
    );
    expect(status).not.toContain("private-content");
    expect(
      JSON.parse(
        readFileSync(
          join(home, ".cache/token-ledger/sessions/test.json"),
          "utf8"
        )
      ).main.test.input
    ).toBe(2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("launcher diagnoses missing runtime and forwards the exact event to the configured runtime", async () => {
  const home = mkdtempSync(join(tmpdir(), "launch-ledger-"));
  try {
    const launcher = join(import.meta.dir, "record.sh");
    const runtime = join(home, "fake-bun");
    writeFileSync(runtime, '#!/bin/sh\ncat > "$HOME/received"\n');
    chmodSync(runtime, 0o700);
    const event = '{"session_id":"test"}';
    const call = async (binary: string) => {
      const child = Bun.spawn([launcher], {
        env: { ...process.env, HOME: home, TOKEN_LEDGER_BUN: binary },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stdin.write(event);
      child.stdin.end();
      await child.exited;
      return readRecorderStatus(home, "recorder-launch.json");
    };
    expect((await call(join(home, "missing")))?.outcome).toBe(
      "runtime-missing"
    );
    expect((await call(runtime))?.outcome).toBe("exited");
    expect(readFileSync(join(home, "received"), "utf8")).toBe(event);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("real Stop launcher records a complete event through the CLI", () => {
  const home = mkdtempSync(join(tmpdir(), "real-recorder-"));
  try {
    const transcript = join(home, "test.jsonl");
    writeFileSync(
      transcript,
      JSON.stringify({
        timestamp: "2026-11-27T15:00:00Z",
        message: {
          id: "reply",
          role: "assistant",
          stop_reason: "end_turn",
          model: "test",
          usage: { input_tokens: 7, output_tokens: 2 },
          content: [{ type: "text", text: "OK" }],
        },
      }) + "\n"
    );
    const result = Bun.spawnSync([join(import.meta.dir, "record.sh")], {
      env: { ...process.env, HOME: home, TOKEN_LEDGER_BUN: process.execPath },
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "new", transcript_path: transcript })
      ),
    });
    expect(result.exitCode).toBe(0);
    expect(readRecorderStatus(home, "recorder-launch.json")?.outcome).toBe(
      "exited"
    );
    expect(readRecorderStatus(home)?.outcome).toBe("saved");
    const record = JSON.parse(
      readFileSync(join(home, ".cache/token-ledger/sessions/new.json"), "utf8")
    );
    expect(record.main.test.input).toBe(7);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
