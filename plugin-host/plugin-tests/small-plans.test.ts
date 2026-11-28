import { beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlugin, TARGET_NAMES } from "../testing";

const PLAN_BODY = `## Goal
The profile request works after a token refresh.

## Context
- \`src/auth.ts\`: \`refreshToken\` keeps the old token in \`cachedToken\`.

## Steps
1. In \`src/auth.ts\`, set \`cachedToken = undefined\` as the first line of \`refreshToken\`.
2. In \`src/auth.test.ts\`, add a test named "a refresh clears the cached token".

## Check
- Run: \`pnpm test auth\`
- Expect: the test "a refresh clears the cached token" passes, and no test fails.

## Review
- \`refreshToken\` clears \`cachedToken\` before it requests a new token.
- No file other than \`src/auth.ts\` and \`src/auth.test.ts\` changed.`;

let plansRoot = "";

beforeEach(async () => {
  plansRoot = await mkdtemp(join(tmpdir(), "small-plans-"));
  process.env.SMALL_PLANS_DIR = plansRoot;
});

const listSavedPlanFiles = async () => {
  const [projectName] = await readdir(plansRoot);
  if (!projectName) return [];
  const [setName] = await readdir(join(plansRoot, projectName));
  return (await readdir(join(plansRoot, projectName, setName!))).sort();
};

for (const target of TARGET_NAMES) {
  test(`${target}: write_small_plan, served at tool.run, saves the plan and the set's index`, async () => {
    const plugin = await startPlugin(target, "small-plans");
    try {
      const outcome = await plugin.callTool("write_small_plan", {
        set: "token-refresh",
        order: 1,
        title: "Clear the cached token",
        kind: "fix",
        body: PLAN_BODY,
        depends_on: [],
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Plan saved to");
      expect(await listSavedPlanFiles()).toEqual([
        "01-clear-the-cached-token.md",
        "index.md",
      ]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: /small-plans handoff resolves the project and reports that it has no handoffs`, async () => {
    process.env.HANDOFFS_DIR = await mkdtemp(join(tmpdir(), "handoffs-"));
    const plugin = await startPlugin(target, "small-plans");
    try {
      const outcome = await plugin.callTool("run_small-plans", {
        args: "handoff",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("No handoffs for");
    } finally {
      await plugin.stop();
    }
  });
}
