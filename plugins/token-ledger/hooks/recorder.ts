import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { recordSession, recordReplyMeter, waitForLastReply } from "./ledger.ts";
export type RecorderStatus = {
  updatedAt: string;
  outcome: string;
  reason?: string;
};
export function saveRecorderStatus(
  home: string,
  outcome: string,
  reason?: string
) {
  const folder = join(home, ".cache/token-ledger");
  mkdirSync(folder, { recursive: true });
  const temporary = join(folder, `recorder-${crypto.randomUUID()}.tmp`);
  writeFileSync(
    temporary,
    JSON.stringify({ updatedAt: new Date().toISOString(), outcome, reason }),
    { mode: 0o600 }
  );
  renameSync(temporary, join(folder, "recorder-status.json"));
}
export function readRecorderStatus(
  home: string,
  name = "recorder-status.json"
): RecorderStatus | undefined {
  try {
    const status = JSON.parse(
      readFileSync(join(home, ".cache/token-ledger", name), "utf8")
    );
    return typeof status.updatedAt === "string" &&
      typeof status.outcome === "string"
      ? status
      : undefined;
  } catch {
    return undefined;
  }
}
export async function recordHook(input: string, home: string) {
  saveRecorderStatus(home, "received");
  let phase = "reading-event";
  try {
    const event = JSON.parse(input);
    if (!event?.session_id) {
      saveRecorderStatus(home, "ignored", "missing-session-id");
      return null;
    }
    if (!event.transcript_path) {
      saveRecorderStatus(home, "ignored", "missing-transcript-path");
      return null;
    }
    if (!existsSync(event.transcript_path)) {
      saveRecorderStatus(home, "ignored", "transcript-not-found");
      return null;
    }
    phase = "reading-transcript";
    await waitForLastReply(event.transcript_path, 50, 40);
    phase = "saving-session";
    const output = recordSession(event, home, new Date());
    saveRecorderStatus(
      home,
      output ? "saved" : "ignored",
      output ? undefined : "session-not-written"
    );
    try {
      recordReplyMeter(event, home);
    } catch {}
    return output;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "error";
    saveRecorderStatus(home, "failed", phase + ":" + code);
    console.error("token-ledger: " + String(error));
    return null;
  }
}
