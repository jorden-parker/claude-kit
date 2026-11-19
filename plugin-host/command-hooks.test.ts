import { expect, test } from "bun:test";
import {
  additionalContextsOf,
  blockingReasonOf,
  hookCommandsOf,
  runCommandHooks,
} from "./command-hooks";

const HOOKS_FILE = {
  hooks: {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "bash-only" }] },
      { matcher: "Edit|Write", hooks: [{ type: "command", command: "edits-only" }] },
      { hooks: [{ type: "prompt", command: "not-a-command-hook" }] },
    ],
  },
};

test("hookCommandsOf keeps the command hooks whose matcher fits the tool", () => {
  const commands = hookCommandsOf(HOOKS_FILE, "PreToolUse", "Write").map(
    (hook) => hook.command
  );

  expect(commands).toEqual(["edits-only"]);
});

test("a hook gets the input on stdin and the plugin root, and exit 2 blocks with its stderr", async () => {
  const [outcome] = await runCommandHooks(
    [
      {
        type: "command",
        command: 'echo "$(cat) ${CLAUDE_PLUGIN_ROOT} $CLAUDE_PROJECT_DIR" >&2; exit 2',
      },
    ],
    "/plugin/root",
    process.cwd(),
    { tool_name: "Bash" }
  );

  expect(blockingReasonOf(outcome!)).toBe(
    `{"tool_name":"Bash"} /plugin/root ${process.cwd()}`
  );
});

test("a deny decision on stdout blocks, and additionalContext is read from the same shape", async () => {
  const [denied, advised] = await runCommandHooks(
    [
      {
        type: "command",
        command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"Not allowed"}}'`,
      },
      {
        type: "command",
        command: `echo '{"hookSpecificOutput":{"additionalContext":"Write a test first"}}'`,
      },
    ],
    "/plugin/root",
    process.cwd(),
    {}
  );

  expect(blockingReasonOf(denied!)).toBe("Not allowed");
  expect(blockingReasonOf(advised!)).toBeUndefined();
  expect(additionalContextsOf(advised!, false)).toEqual(["Write a test first"]);
});
