import { join } from "node:path";
import { text as readStreamText } from "node:stream/consumers";
import {
  DEFAULT_TIMEOUT_SECONDS,
  additionalContextsOf,
  blockingReasonOf,
  definedValues,
  doesMatcherMatch,
  hookCommandsOf,
  readHooksFile,
  runCommandHooks,
  type HooksFile,
} from "./command-hooks";

const CLAUDE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  view: "Read",
  edit: "Edit",
  multiedit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  ls: "LS",
  agent: "Agent",
};
const EVENT_NAME = "PreToolUse";
const BLOCKING_EXIT_CODE = 2;
const TIMEOUT_MARGIN_SECONDS = 5;

export const CRUSH_HOOKS_PATH = join("portable-hooks", "crush.json");

const toClaudeToolInput = (
  crushToolName: string,
  input: Record<string, any>
): Record<string, any> => {
  if (crushToolName !== "multiedit" || !Array.isArray(input.edits)) return input;
  const edits: { old_string: string; new_string: string }[] = input.edits;
  return {
    ...input,
    old_string: edits.map((edit) => edit.old_string).join("\n"),
    new_string: edits.map((edit) => edit.new_string).join("\n"),
  };
};

export const describeCrushHooks = (hooksFile: HooksFile) => {
  const hookGroups = hooksFile.hooks?.[EVENT_NAME] ?? [];
  const matchesEveryTool = hookGroups.some(
    (group) => !group.matcher || group.matcher === "*"
  );
  const crushToolNames = Object.keys(CLAUDE_TOOL_NAMES).filter((crushToolName) =>
    hookGroups.some((group) =>
      doesMatcherMatch(group.matcher, CLAUDE_TOOL_NAMES[crushToolName])
    )
  );
  const timeouts = hookGroups
    .flatMap((group) => group.hooks ?? [])
    .map((hook) => hook.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  return {
    matcher: matchesEveryTool ? undefined : `^(${crushToolNames.join("|")})$`,
    timeoutSeconds: Math.max(...timeouts) + TIMEOUT_MARGIN_SECONDS,
  };
};

export const runCrushHooks = async ({ pluginRoot }: { pluginRoot: string }) => {
  const toolCall = JSON.parse(await readStreamText(process.stdin));
  const toolName = CLAUDE_TOOL_NAMES[toolCall.tool_name] ?? toolCall.tool_name;
  const outcomes = await runCommandHooks(
    hookCommandsOf(
      readHooksFile(join(pluginRoot, CRUSH_HOOKS_PATH)),
      EVENT_NAME,
      toolName
    ),
    pluginRoot,
    toolCall.cwd,
    {
      session_id: toolCall.session_id,
      cwd: toolCall.cwd,
      hook_event_name: EVENT_NAME,
      tool_name: toolName,
      tool_input: toClaudeToolInput(toolCall.tool_name, toolCall.tool_input ?? {}),
    }
  );
  const reasons = definedValues(outcomes.map(blockingReasonOf));
  if (reasons.length > 0) {
    process.stderr.write(`${reasons.join("\n")}\n`);
    process.exitCode = BLOCKING_EXIT_CODE;
    return;
  }
  const contexts = outcomes.flatMap((outcome) =>
    additionalContextsOf(outcome, false)
  );
  if (contexts.length > 0) {
    process.stdout.write(`${JSON.stringify({ context: contexts })}\n`);
  }
};
