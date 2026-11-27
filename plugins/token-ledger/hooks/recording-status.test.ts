import { expect, test } from "bun:test";
import { recordingStatus, formatRecordingStatus } from "./recording-status.ts";
import type { LedgerEntry } from "./ledger.ts";
const cutoff = "2026-11-27T13:00:00Z";
const entry = (
  startedAt: string | undefined,
  updatedAt: string
): LedgerEntry => ({
  session: "private-session",
  project: "private-project",
  startedAt,
  updatedAt,
  contextTokens: 1,
  lastNudgeTokens: 0,
  main: {},
  subagents: {},
  resultCharactersByTool: {},
});
test("diagnostics distinguish no recording, old sessions, unknown starts and qualifying sessions", () => {
  expect(recordingStatus([]).code).toBe("D0");
  expect(recordingStatus([], cutoff).code).toBe("D1");
  expect(
    recordingStatus(
      [entry("2026-11-27T12:00:00Z", "2026-11-27T12:30:00Z")],
      cutoff
    ).code
  ).toBe("D2");
  const old = entry("2026-11-27T12:00:00Z", "2026-11-27T14:00:00Z");
  expect(recordingStatus([old], cutoff).code).toBe("D3");
  expect(recordingStatus([entry(undefined, old.updatedAt)], cutoff).code).toBe(
    "D3"
  );
  const current = entry("2026-11-27T13:30:00Z", "2026-11-27T14:30:00Z");
  const status = recordingStatus([old, current], cutoff);
  expect(status).toMatchObject({
    code: "D4",
    qualifyingSessions: 1,
    excludedSessions: 1,
    latestStartedAt: current.startedAt,
    latestUpdatedAt: current.updatedAt,
  });
  const text = formatRecordingStatus(status);
  expect(text).toContain(cutoff);
  expect(text).not.toContain("private-");
});
