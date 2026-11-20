import { expect, test } from "bun:test";
import { decideCiStatus as decide } from "./ci-status.ts";
import type { Run } from "./command-run.ts";

const GITHUB_REMOTE = "git@github.com:owner/project.git\n";
const sessionStart = { hook_event_name: "SessionStart", cwd: "/project" };

function fakeRun(remoteUrl: string, runListOutput: string | null) {
  const commands: string[][] = [];
  const run: Run = (command) => {
    commands.push(command);
    if (command[0] === "git") return { ok: true, output: remoteUrl };
    return runListOutput === null ? null : { ok: true, output: runListOutput };
  };
  return { run, commands };
}

test("ci-status warns when the latest run on main failed", () => {
  const { run, commands } = fakeRun(
    GITHUB_REMOTE,
    '[{"conclusion":"failure"}]'
  );
  const result = decide(sessionStart, run) as any;
  expect(result.output.systemMessage).toContain("CI on main failed");
  expect(result.output.hookSpecificOutput.additionalContext).toContain(
    "CI on main failed"
  );
  expect(commands[1]).toEqual([
    "gh",
    "run",
    "list",
    "--branch",
    "main",
    "--limit",
    "1",
    "--json",
    "conclusion",
  ]);
});

test("ci-status stays silent when the latest run on main passed", () => {
  const { run } = fakeRun(GITHUB_REMOTE, '[{"conclusion":"success"}]');
  expect(decide(sessionStart, run)).toBeNull();
});

test("ci-status never calls gh outside a GitHub repository", () => {
  const { run, commands } = fakeRun(
    "https://gitlab.com/owner/project.git\n",
    '[{"conclusion":"failure"}]'
  );
  expect(decide(sessionStart, run)).toBeNull();
  expect(commands).toHaveLength(1);
});

test("ci-status stays silent when gh is missing, fails or lists no runs", () => {
  for (const runListOutput of [null, "not json", "[]"]) {
    const { run } = fakeRun(GITHUB_REMOTE, runListOutput);
    expect(decide(sessionStart, run)).toBeNull();
  }
});
