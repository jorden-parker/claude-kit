import { defaultRun, type Run } from "./command-run.ts";
import type { HookEvent, HookResult } from "./types.ts";

const GITHUB_REMOTE = /github\.com[:/]/;
const LATEST_MAIN_RUN = [
  "gh",
  "run",
  "list",
  "--branch",
  "main",
  "--limit",
  "1",
  "--json",
  "conclusion",
];
const RED_CI_WARNING =
  "CI on main failed on its latest run. See it with `gh run list --branch main --limit 1`, and fix it before pushing more.";

function readLatestConclusion(runListOutput: string): unknown {
  try {
    return JSON.parse(runListOutput)[0]?.conclusion;
  } catch {
    return undefined;
  }
}

export function decideCiStatus(
  event: HookEvent,
  run: Run = defaultRun
): HookResult {
  const workingFolder = event.cwd ?? process.cwd();
  const remote = run(["git", "remote", "get-url", "origin"], workingFolder);
  if (!remote?.ok || !GITHUB_REMOTE.test(remote.output)) return null;
  const latestMainRun = run(LATEST_MAIN_RUN, workingFolder);
  if (!latestMainRun?.ok) return null;
  if (readLatestConclusion(latestMainRun.output) !== "failure") return null;
  return {
    output: {
      systemMessage: RED_CI_WARNING,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: RED_CI_WARNING,
      },
    },
  };
}
