import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  additionalContextsOf,
  blockingReasonOf,
  definedValues,
  hookCommandsOf,
  readHooksFile,
  replacementTextOf,
  runCommandHooks,
  type HookOutcome,
} from "./command-hooks";

export { doesMatcherMatch } from "./command-hooks";

type HookContext = {
  cwd: string;
  sessionManager: {
    getBranch: () => BranchEntry[];
    getSessionId: () => string;
  };
};

type PiEventHandler = (event: any, context: HookContext) => any;

type PiHookApi = {
  on: (eventName: string, handler: PiEventHandler) => unknown;
};

type BranchEntry = {
  type: string;
  id: string;
  message?: { role: string; content: any };
};

const CLAUDE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
};
const SESSION_START_CUSTOM_TYPE = "claude-kit-session-start";
const STOP_CUSTOM_TYPE = "claude-kit-stop-hook";
const BASH_EXIT_CODE = /Command exited with code (\d+)/;
const BASH_INTERRUPTED = /Command (?:aborted|timed out)/;

const toClaudeToolName = (piToolName: string) =>
  CLAUDE_TOOL_NAMES[piToolName] ?? piToolName;

const absolutePathOf = (workingDirectory: string, filePath: unknown) =>
  typeof filePath === "string" ? resolve(workingDirectory, filePath) : undefined;

export const toClaudeToolInput = (
  piToolName: string,
  input: Record<string, any>,
  workingDirectory: string
): Record<string, any> => {
  if (piToolName === "read" || piToolName === "write") {
    return {
      ...input,
      file_path: absolutePathOf(workingDirectory, input.path),
    };
  }
  if (piToolName === "edit") {
    const edits: { oldText: string; newText: string }[] = Array.isArray(
      input.edits
    )
      ? input.edits
      : [];
    return {
      ...input,
      file_path: absolutePathOf(workingDirectory, input.path),
      old_string: edits.map((edit) => edit.oldText).join("\n"),
      new_string: edits.map((edit) => edit.newText).join("\n"),
    };
  }
  return { ...input };
};

const userContentOf = (content: any) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((block) => block?.type === "text")
      : "";

const toolUsesOf = (content: any, workingDirectory: string) =>
  Array.isArray(content)
    ? content
        .filter((block) => block?.type === "toolCall")
        .map((block) => ({
          type: "tool_use",
          id: block.id,
          name: toClaudeToolName(block.name),
          input: toClaudeToolInput(block.name, block.arguments, workingDirectory),
        }))
    : [];

export const toTranscriptLines = (
  branch: BranchEntry[],
  workingDirectory: string
): string[] =>
  branch.flatMap((entry) => {
    if (entry.type !== "message" || !entry.message) return [];
    const { role, content } = entry.message;
    if (role === "user") {
      return [
        JSON.stringify({
          type: "user",
          uuid: entry.id,
          message: { role: "user", content: userContentOf(content) },
        }),
      ];
    }
    const toolUses = role === "assistant" ? toolUsesOf(content, workingDirectory) : [];
    return toolUses.length > 0
      ? [
          JSON.stringify({
            type: "assistant",
            uuid: entry.id,
            message: { role: "assistant", content: toolUses },
          }),
        ]
      : [];
  });

const exitCodeOf = (text: string, isError: boolean) => {
  const match = BASH_EXIT_CODE.exec(text);
  return match ? Number(match[1]) : isError ? 1 : 0;
};

const toClaudeToolResponse = (
  piToolName: string,
  text: string,
  isError: boolean
) =>
  piToolName === "bash"
    ? {
        stdout: text,
        stderr: "",
        exit_code: exitCodeOf(text, isError),
        interrupted: BASH_INTERRUPTED.test(text),
      }
    : { text, is_error: isError };

export const createPiHookExtension =
  ({ pluginRoot }: { pluginRoot: string }) =>
  (pi: PiHookApi) => {
    const hooksFile = readHooksFile(join(pluginRoot, "hooks", "hooks.json"));
    const pendingSessionContexts: string[] = [];
    const contextsByToolCallId = new Map<string, string[]>();
    let isStopHookActive = false;

    const dispatch = async (
      eventName: string,
      toolName: string | undefined,
      payload: Record<string, unknown>,
      context: HookContext
    ): Promise<HookOutcome[]> => {
      const hookCommands = hookCommandsOf(hooksFile, eventName, toolName);
      if (hookCommands.length === 0) return [];
      const transcriptFolder = await mkdtemp(join(tmpdir(), "pi-hooks-transcript-"));
      try {
        const transcriptPath = join(transcriptFolder, "transcript.jsonl");
        const transcriptLines = toTranscriptLines(
          context.sessionManager.getBranch(),
          context.cwd
        );
        await writeFile(
          transcriptPath,
          transcriptLines.map((line) => `${line}\n`).join("")
        );
        const input = {
          session_id: context.sessionManager.getSessionId(),
          transcript_path: transcriptPath,
          cwd: context.cwd,
          hook_event_name: eventName,
          ...payload,
        };
        return await runCommandHooks(hookCommands, pluginRoot, context.cwd, input);
      } finally {
        await rm(transcriptFolder, { recursive: true, force: true });
      }
    };

    pi.on("session_start", async (event, context) => {
      const outcomes = await dispatch(
        "SessionStart",
        undefined,
        { source: event.reason },
        context
      );
      pendingSessionContexts.push(
        ...outcomes.flatMap((outcome) => additionalContextsOf(outcome, true))
      );
    });

    pi.on("before_agent_start", () => {
      isStopHookActive = false;
      if (pendingSessionContexts.length === 0) return undefined;
      return {
        message: {
          customType: SESSION_START_CUSTOM_TYPE,
          content: pendingSessionContexts.splice(0).join("\n\n"),
          display: false,
        },
      };
    });

    pi.on("tool_call", async (event, context) => {
      const toolName = toClaudeToolName(event.toolName);
      const outcomes = await dispatch(
        "PreToolUse",
        toolName,
        {
          tool_name: toolName,
          tool_input: toClaudeToolInput(event.toolName, event.input, context.cwd),
          tool_use_id: event.toolCallId,
        },
        context
      );
      const contexts = outcomes.flatMap((outcome) =>
        additionalContextsOf(outcome, false)
      );
      if (contexts.length > 0) contextsByToolCallId.set(event.toolCallId, contexts);
      const reasons = definedValues(outcomes.map(blockingReasonOf));
      return reasons.length > 0
        ? { block: true, reason: reasons.join("\n") }
        : undefined;
    });

    pi.on("tool_result", async (event, context) => {
      const toolName = toClaudeToolName(event.toolName);
      const responseText = event.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n");
      const outcomes = await dispatch(
        "PostToolUse",
        toolName,
        {
          tool_name: toolName,
          tool_input: toClaudeToolInput(event.toolName, event.input, context.cwd),
          tool_response: toClaudeToolResponse(event.toolName, responseText, event.isError),
          tool_use_id: event.toolCallId,
        },
        context
      );
      const replacement = definedValues(outcomes.map(replacementTextOf)).at(-1);
      const feedback = definedValues(outcomes.map(blockingReasonOf));
      const additionalTexts = [
        ...feedback,
        ...(contextsByToolCallId.get(event.toolCallId) ?? []),
      ];
      contextsByToolCallId.delete(event.toolCallId);
      if (replacement === undefined && additionalTexts.length === 0) return undefined;
      const baseContent =
        replacement === undefined
          ? event.content
          : [{ type: "text", text: replacement }];
      return {
        content: [
          ...baseContent,
          ...additionalTexts.map((text) => ({ type: "text", text })),
        ],
      };
    });

    pi.on("agent_before_settle", async (event, context) => {
      if (event.outcome !== "completed") return undefined;
      const outcomes = await dispatch(
        "Stop",
        undefined,
        { stop_hook_active: isStopHookActive },
        context
      );
      const reasons = definedValues(outcomes.map(blockingReasonOf));
      isStopHookActive = reasons.length > 0;
      if (reasons.length === 0) return undefined;
      return {
        continue: true,
        entries: [
          {
            type: "custom_message",
            customType: STOP_CUSTOM_TYPE,
            content: reasons.join("\n"),
            display: true,
          },
        ],
      };
    });
  };
