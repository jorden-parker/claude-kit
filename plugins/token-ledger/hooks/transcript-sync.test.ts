import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptSync } from "./transcript-sync.ts";
import { parseCodeburnDiscovery } from "./codeburn.ts";
const cutoff = "2026-11-27T14:00:00.000Z";
const line = (timestamp: string, content: unknown, extra = {}) =>
  JSON.stringify({
    timestamp,
    cwd: "/work/project",
    message: { content, ...extra },
  }) + "\n";
const usageLine = (timestamp: string, id = "reply") =>
  line(
    timestamp,
    [
      {
        type: "tool_use",
        id: "tool1",
        name: "Bash",
        input: { command: "test" },
      },
    ],
    {
      id,
      model: "sol",
      usage: { input_tokens: 7, output_tokens: 2 },
      stop_reason: "tool_use",
    }
  );
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "sync-ledger-"));
  const project = join(home, ".claude/projects/project");
  mkdirSync(project, { recursive: true });
  return {
    home,
    project,
    path: join(project, "session.jsonl"),
    record: join(home, ".cache/token-ledger/sessions/session.json"),
  };
}
test("imports live usage and later tool results with no hooks, once per session", () => {
  const { home, path, record } = fixture();
  try {
    writeFileSync(path, usageLine("2026-11-27T15:00:00.000Z"));
    const sync = createTranscriptSync(home);
    expect(sync(cutoff).synced).toBe(1);
    let saved = JSON.parse(readFileSync(record, "utf8"));
    expect(saved.updatedAt).toBe("2026-11-27T15:00:00.000Z");
    expect(saved.main.sol.input).toBe(7);
    expect(saved.project).toBe("project");
    expect(saved.lastNudgeTokens).toBe(0);
    expect(sync(cutoff).synced).toBe(0);
    appendFileSync(
      path,
      line("2026-11-27T15:01:00.000Z", [
        { type: "tool_result", tool_use_id: "tool1", content: "result text" },
      ]) + '{"partial":'
    );
    expect(sync(cutoff).synced).toBe(1);
    saved = JSON.parse(readFileSync(record, "utf8"));
    expect(saved.main.sol.input).toBe(7);
    expect(saved.resultCharactersByTool.Bash).toBe(11);
    expect(saved.updatedAt).toBe("2026-11-27T15:01:00.000Z");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("an older comparison can import transcripts skipped at the latest deployment", () => {
  const { home, path, record } = fixture();
  try {
    writeFileSync(path, usageLine("2026-11-27T15:00:00.000Z"));
    const sync = createTranscriptSync(home);
    expect(sync("2026-11-27T16:00:00.000Z").synced).toBe(0);
    expect(sync(cutoff).synced).toBe(1);
    expect(JSON.parse(readFileSync(record, "utf8")).startedAt).toBe(
      "2026-11-27T15:00:00.000Z"
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("Codeburn locations are deduplicated and subagents stay under their parent", () => {
  const { home, path, record, project } = fixture();
  try {
    writeFileSync(path, usageLine("2026-11-27T15:00:00.000Z"));
    const children = join(project, "session/subagents");
    mkdirSync(children, { recursive: true });
    writeFileSync(
      join(children, "agent.jsonl"),
      usageLine("2026-11-27T15:02:00.000Z", "worker-reply")
    );
    const sync = createTranscriptSync(home);
    expect(sync(cutoff, [project, project]).synced).toBe(1);
    expect(JSON.parse(readFileSync(record, "utf8")).subagents.sol.input).toBe(
      7
    );
    appendFileSync(
      join(children, "agent.jsonl"),
      usageLine("2026-11-27T15:03:00.000Z", "worker-next")
    );
    expect(sync(cutoff).synced).toBe(1);
    expect(JSON.parse(readFileSync(record, "utf8")).subagents.sol.input).toBe(
      14
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("Codeburn discovery accepts local existing roots and fails safely for unsupported output", () => {
  const result = parseCodeburnDiscovery({
    providers: [
      {
        provider: "claude",
        candidatesFound: 70,
        probePaths: [
          { exists: true, path: "/custom/projects" },
          { exists: true, path: "/custom/projects" },
          { exists: false, path: "/missing" },
          { exists: true, path: "relative" },
        ],
      },
    ],
  });
  expect(result.roots).toEqual(["/custom/projects"]);
  expect(result.message).toContain("70 candidate sessions");
  expect(parseCodeburnDiscovery({}).roots).toEqual([]);
});

test("recovers historical per-call detail only when archived totals match", () => {
  const { home, path, record } = fixture();
  try {
    writeFileSync(path, usageLine("2026-11-27T15:00:00.000Z"));
    createTranscriptSync(home)(cutoff);
    const old = JSON.parse(readFileSync(record, "utf8"));
    delete old.tasks;
    delete old.workerTasks;
    old.lastNudgeTokens = 72100;
    writeFileSync(record, JSON.stringify(old));
    createTranscriptSync(home)("2026-11-28T00:00:00Z");
    const recovered = JSON.parse(readFileSync(record, "utf8"));
    expect(recovered.tasks[0].requests[0].input).toBe(7);
    expect(recovered.updatedAt).toBe(old.updatedAt);
    expect(recovered.lastNudgeTokens).toBe(72100);
    old.main.sol.input++;
    writeFileSync(record, JSON.stringify(old));
    createTranscriptSync(home)(undefined);
    expect(JSON.parse(readFileSync(record, "utf8"))).toEqual(old);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
