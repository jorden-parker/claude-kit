import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CommandHook = { type: string; command: string; timeout?: number };

type HookGroup = { matcher?: string; hooks?: CommandHook[] };

export type HooksFile = { hooks?: Record<string, HookGroup[]> };

export type HookOutcome = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export const DEFAULT_TIMEOUT_SECONDS = 60;
const PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";

export const readHooksFile = (hooksFilePath: string): HooksFile =>
  JSON.parse(readFileSync(hooksFilePath, "utf8"));

export const doesMatcherMatch = (
  matcher: string | undefined,
  toolName: string | undefined
) =>
  !matcher ||
  matcher === "*" ||
  (toolName !== undefined && new RegExp(`^(?:${matcher})$`).test(toolName));

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

export const definedValues = <Value>(values: (Value | undefined)[]) =>
  values.filter((value): value is Value => value !== undefined);

export const blockingReasonOf = (outcome: HookOutcome): string | undefined => {
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

export const additionalContextsOf = (
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

export const replacementTextOf = (outcome: HookOutcome): string | undefined => {
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

export const hookCommandsOf = (
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
        CLAUDE_KIT_HOOK_BRIDGE: "1",
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

export const runCommandHooks = (
  hookCommands: CommandHook[],
  pluginRoot: string,
  workingDirectory: string,
  input: Record<string, unknown>
) =>
  Promise.all(
    hookCommands.map((hook) =>
      runCommandHook(
        hook.command,
        pluginRoot,
        workingDirectory,
        hook.timeout ?? DEFAULT_TIMEOUT_SECONDS,
        input
      )
    )
  );

type HookEvent = {
  hooksFile: HooksFile;
  pluginRoot: string;
  eventName: string;
  toolName?: string;
  sessionId: string;
  workingDirectory: string;
  readTranscriptLines: () => string[] | Promise<string[]>;
  payload: Record<string, unknown>;
};

export const runEventHooks = async ({
  hooksFile,
  pluginRoot,
  eventName,
  toolName,
  sessionId,
  workingDirectory,
  readTranscriptLines,
  payload,
}: HookEvent): Promise<HookOutcome[]> => {
  const hookCommands = hookCommandsOf(hooksFile, eventName, toolName);
  if (hookCommands.length === 0) return [];
  const transcriptFolder = await mkdtemp(join(tmpdir(), "hooks-transcript-"));
  try {
    const transcriptPath = join(transcriptFolder, "transcript.jsonl");
    const transcriptLines = await readTranscriptLines();
    await writeFile(
      transcriptPath,
      transcriptLines.map((line) => `${line}\n`).join("")
    );
    return await runCommandHooks(hookCommands, pluginRoot, workingDirectory, {
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd: workingDirectory,
      hook_event_name: eventName,
      ...payload,
    });
  } finally {
    await rm(transcriptFolder, { recursive: true, force: true });
  }
};

export const composeUserTranscriptLine = (messageId: string, content: unknown) =>
  JSON.stringify({
    type: "user",
    uuid: messageId,
    message: { role: "user", content },
  });

export const composeToolUseTranscriptLine = (
  messageId: string,
  toolUses: { id: string; name: string; input: Record<string, any> }[]
) =>
  JSON.stringify({
    type: "assistant",
    uuid: messageId,
    message: {
      role: "assistant",
      content: toolUses.map((toolUse) => ({ type: "tool_use", ...toolUse })),
    },
  });
