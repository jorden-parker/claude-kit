import { expect, test } from "bun:test";
import { decide } from "./bypass-guard.ts";

const decisionFor = (event: Parameters<typeof decide>[0]) =>
  (decide(event) as any)?.output.hookSpecificOutput;

test("request_hook_bypass asks the user with the files and reason", () => {
  const decision = decisionFor({
    tool_name: "mcp__guards__request_hook_bypass",
    tool_input: {
      files: ["/repo/seed.json", "/repo/fixtures/users.json"],
      reason: "Seed data, not code",
    },
  });
  expect(decision.permissionDecision).toBe("ask");
  expect(decision.hookEventName).toBe("PreToolUse");
  expect(decision.permissionDecisionReason).toBe(
    "Skip the TDD, no-comments and naming checks for 15 minutes on: /repo/seed.json, /repo/fixtures/users.json. Reason: Seed data, not code"
  );
});

test.each([
  "echo '0\t/repo/a.json' >> ~/.claude/hook-bypass/grants.tsv",
  "rm -rf $HOME/.claude/hook-bypass",
  "cat ~/.claude/hook-bypass/grants.tsv",
])("Bash cannot touch the grant store: %s", (command) => {
  const decision = decisionFor({
    tool_name: "Bash",
    tool_input: { command },
  });
  expect(decision.permissionDecision).toBe("deny");
  expect(decision.permissionDecisionReason).toBe(
    "Only the request_hook_bypass tool may write hook bypass grants."
  );
});

test.each([
  ["Edit", { file_path: "/home/u/.claude/hook-bypass/grants.tsv" }],
  ["Write", { file_path: "/home/u/.claude/hook-bypass/grants.tsv" }],
  ["NotebookEdit", { notebook_path: "/home/u/.claude/hook-bypass/grants.tsv" }],
])("%s cannot write the grant store", (toolName, toolInput) => {
  const decision = decisionFor({ tool_name: toolName, tool_input: toolInput });
  expect(decision.permissionDecision).toBe("deny");
  expect(decision.permissionDecisionReason).toBe(
    "Only the request_hook_bypass tool may write hook bypass grants."
  );
});

test("an unrelated Bash command gets no decision", () => {
  expect(
    decide({ tool_name: "Bash", tool_input: { command: "bun test" } })
  ).toBeNull();
});

test("an unrelated Edit gets no decision", () => {
  expect(
    decide({
      tool_name: "Edit",
      tool_input: { file_path: "/repo/src/index.ts" },
    })
  ).toBeNull();
});
