import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

type CommandHook = { type: string; command: string; timeout?: number };

type HookGroup = { matcher?: string; hooks?: CommandHook[] };

type HooksFile = { hooks?: Record<string, HookGroup[]> };

type HookOutcome = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
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
const DEFAULT_TIMEOUT_SECONDS = 60;
const PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
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

export const doesMatcherMatch = (
  matcher: string | undefined,
  toolName: string | undefined
) =>
  !matcher ||
  matcher === "*" ||
  (toolName !== undefined && new RegExp(`^(?:${matcher})$`).test(toolName));

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

const parseJsonObject = (text: string): Record<string, any> | undefined => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const definedValues = <Value>(values: (Value | undefined)[]) =>
  values.filter((value): value is Value => value !== undefined);

const blockingReasonOf = (outcome: HookOutcome): string | undefined => {
  const output = parseJsonObject(outcome.stdout);
  if (outcome.exitCode === 2) {
    return outcome.stderr.trim() || `Blocked by ${outcome.command}.`;
  }
  if (output?.decision === "block") {
    return output.reason ?? `Blocked by ${outcome.command}.`;
  }
  if (output?.hookSpecificOutput?.permissionDecision === "deny") {
    return (
      output.hookSpecificOutput.permissionDecisionReason ??
      `Denied by ${outcome.command}.`
    );
  }
  return undefined;
};

const additionalContextsOf = (
  outcome: HookOutcome,
  isPlainStdoutContext: boolean
): string[] => {
  const output = parseJsonObject(outcome.stdout);
  if (output) {
    const additionalContext = output.hookSpecificOutput?.additionalContext;
    return typeof additionalContext === "string" && additionalContext.trim()
      ? [additionalContext.trim()]
      : [];
  }
  const plainText = outcome.stdout.trim();
  return isPlainStdoutContext && plainText ? [plainText] : [];
};

const replacementTextOf = (outcome: HookOutcome): string | undefined => {
  const updatedToolOutput =
    parseJsonObject(outcome.stdout)?.hookSpecificOutput?.updatedToolOutput;
  if (typeof updatedToolOutput === "string") return updatedToolOutput;
  if (updatedToolOutput && typeof updatedToolOutput === "object") {
    return [updatedToolOutput.stdout, updatedToolOutput.stderr]
      .filter((text) => typeof text === "string" && text.length > 0)
      .join("\n");
  }
  return undefined;
};

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

const hookCommandsOf = (
  hooksFile: HooksFile,
  eventName: string,
  toolName: string | undefined
) =>
  (hooksFile.hooks?.[eventName] ?? [])
    .filter((group) => doesMatcherMatch(group.matcher, toolName))
    .flatMap((group) => group.hooks ?? [])
    .filter((hook) => hook.type === "command");

const runCommandHook = (
  command: string,
  pluginRoot: string,
  workingDirectory: string,
  timeoutSeconds: number,
  input: Record<string, unknown>
) =>
  new Promise<HookOutcome>((resolveOutcome) => {
    const child = spawn("bash", ["-c", command.replaceAll(PLUGIN_ROOT_PLACEHOLDER, pluginRoot)], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        CLAUDE_PROJECT_DIR: workingDirectory,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.on("error", () => {});
    const timer = setTimeout(() => child.kill(), timeoutSeconds * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveOutcome({ command, exitCode: 1, stdout, stderr: error.message });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveOutcome({ command, exitCode, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(input));
  });

export const createPiHookExtension =
  ({ pluginRoot }: { pluginRoot: string }) =>
  (pi: PiHookApi) => {
    const hooksFile: HooksFile = JSON.parse(
      readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")
    );
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
        return await Promise.all(
          hookCommands.map((hook) =>
            runCommandHook(
              hook.command,
              pluginRoot,
              context.cwd,
              hook.timeout ?? DEFAULT_TIMEOUT_SECONDS,
              input
            )
          )
        );
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
