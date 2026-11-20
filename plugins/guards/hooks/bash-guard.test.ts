import { expect, test } from "bun:test";
import { decide } from "./bash-guard.ts";

const decisionFor = (command: string, toolName = "Bash") =>
  (decide({ tool_name: toolName, tool_input: { command } }) as any)?.output
    .hookSpecificOutput;

const denied = (command: string) =>
  decisionFor(command)?.permissionDecision === "deny";

test.each([
  "git log",
  "git -C /x log --stat",
  "git diff",
  "git diff HEAD~3",
  "find . -name '*.ts'",
  "PAGER=cat git log",
  "env git log",
  "command git diff",
  "GIT_PAGER=cat LESS=-R git diff HEAD~1",
  "cd /repo && git log",
  "git status; git diff HEAD~1",
])("caps %s at 150 lines instead of denying", (command) => {
  const decision = decisionFor(command);
  expect(decision.updatedInput.command).toBe(`${command} | head -n 150`);
  expect(decision.permissionDecision).toBeUndefined();
  expect(decision.additionalContext).toContain("head -n 150");
});

test("a capped command keeps its other inputs", () => {
  const result = decide({
    tool_name: "Bash",
    tool_input: { command: "git log", description: "Show history" },
  }) as any;
  expect(result.output.hookSpecificOutput.updatedInput).toEqual({
    command: "git log | head -n 150",
    description: "Show history",
  });
});

test.each([
  "cat package-lock.json",
  "ls && cat go.sum",
  "find . | xargs rm",
  "find . -name x || tail -5 log",
  "git log && echo done",
  "git log &",
  "git diff > change.patch",
  "git log # everything",
  "find . -name '*.orig' -print -delete",
  "find . -name '*.ts' -exec wc -l {} +",
  "git log\ngit status",
])("denies %s", (command) => expect(denied(command)).toBe(true));

test.each([
  "git log --oneline -n 20",
  "git log -5",
  "git log | head -20",
  "git diff --stat",
  "git diff | head -50",
  "find . -maxdepth 2 -name x",
  "find . -name x | wc -l",
  "cat package-lock.json | grep left-pad",
  "echo 'git log'",
  "git status",
  "cat src/a.ts",
  "PAGER=cat git log -n 5",
  "env git status",
  "echo PAGER=cat git log",
  "find . -name '*.ts' | xargs wc -l | sort -n | tail -25",
  "git log --stat | grep -v x | head -20",
])("allows %s", (command) => expect(denied(command)).toBe(false));

test("denial messages never point at the denied Glob or Grep tools", () => {
  const result = decide({ tool_input: { command: "find . -name '*.ts'" } });
  expect(JSON.stringify(result)).not.toMatch(/Glob|Grep/);
});

test("Qwen Code's shell tool is denied, since only Claude Code applies a rewritten command", () =>
  expect(decisionFor("git log", "run_shell_command").permissionDecision).toBe(
    "deny"
  ));

test("under a hook bridge the command is denied, since the bridge cannot rewrite it", () => {
  process.env.CLAUDE_KIT_HOOK_BRIDGE = "1";
  try {
    expect(decisionFor("git log").permissionDecision).toBe("deny");
  } finally {
    delete process.env.CLAUDE_KIT_HOOK_BRIDGE;
  }
});
