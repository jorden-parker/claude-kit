import { join, resolve } from "node:path";
import {
  additionalContextsOf,
  blockingReasonOf,
  composeToolUseTranscriptLine,
  composeUserTranscriptLine,
  definedValues,
  readHooksFile,
  replacementTextOf,
  runEventHooks,
  type HookOutcome,
} from "./command-hooks";

type ClaudeToolCall = { name: string; input: Record<string, any> };

type ToolInput = Record<string, any>;

type TextPart = { type: "text"; text: string };

type ToolResult = {
  output?: any;
  content?: { type: string; text?: string }[];
  metadata?: Record<string, any>;
};

type ToolEvent = {
  tool: string;
  sessionID: string;
  id: string;
  input: unknown;
  status?: string;
  result?: ToolResult;
  error?: unknown;
};

type ModelCallEvent = { sessionID: string; system: unknown[] };

type IdleEvent = {
  sessionID: string;
  background?: { kind: string; sessionID?: string }[];
};

type StoredMessage = {
  id: string;
  type: string;
  text?: string;
  content?: {
    type: string;
    id: string;
    name: string;
    state?: { input?: unknown };
  }[];
};

type RegisterHook<Event> = (
  hookName: string,
  runHook: (event: Event) => Promise<void>
) => Promise<unknown>;

type OpenCodeContext = {
  location?: { directory?: string };
  tool: { hook: RegisterHook<any> };
  session: {
    hook: RegisterHook<any>;
    get: (input: { sessionID: string }) => Promise<{
      location?: { directory?: string };
      parentID?: string | null;
    }>;
    context: (input: { sessionID: string }) => Promise<StoredMessage[]>;
    synthetic: (input: { sessionID: string; text: string }) => Promise<unknown>;
  };
};

type Session = {
  directory: string;
  isSubagent: boolean;
  isStopHookActive: boolean;
  startContexts?: Promise<string[]>;
};

const ADDED_FILE_MARKER = "*** Add File: ";
const UPDATED_FILE_MARKER = "*** Update File: ";
const SECTION_END_MARKERS = ["*** Delete File: ", "*** End Patch"];
const ADDED_LINE_MARKER = "+";
const REMOVED_LINE_MARKER = "-";
const SHELL_TOOL_NAME = "shell";

const toPatchCalls = (patchText: string, toAbsolutePath: (path: string) => string) => {
  const sections: {
    toolName: string;
    filePath: string;
    addedLines: string[];
    removedLines: string[];
  }[] = [];
  let isInsideSection = false;
  for (const line of patchText.split("\n")) {
    const fileMarker = [ADDED_FILE_MARKER, UPDATED_FILE_MARKER].find((marker) =>
      line.startsWith(marker)
    );
    if (fileMarker) {
      sections.push({
        toolName: fileMarker === ADDED_FILE_MARKER ? "Write" : "Edit",
        filePath: toAbsolutePath(line.slice(fileMarker.length).trim()),
        addedLines: [],
        removedLines: [],
      });
      isInsideSection = true;
    } else if (SECTION_END_MARKERS.some((marker) => line.startsWith(marker))) {
      isInsideSection = false;
    } else if (isInsideSection && line.startsWith(ADDED_LINE_MARKER)) {
      sections.at(-1)!.addedLines.push(line.slice(1));
    } else if (isInsideSection && line.startsWith(REMOVED_LINE_MARKER)) {
      sections.at(-1)!.removedLines.push(line.slice(1));
    }
  }
  return sections.map(
    ({ toolName, filePath, addedLines, removedLines }): ClaudeToolCall =>
      toolName === "Write"
        ? {
            name: toolName,
            input: { file_path: filePath, content: addedLines.join("\n") },
          }
        : {
            name: toolName,
            input: {
              file_path: filePath,
              old_string: removedLines.join("\n"),
              new_string: addedLines.join("\n"),
            },
          }
  );
};

const TOOL_CONVERTERS: Record<
  string,
  (input: ToolInput, toAbsolutePath: (path: string) => string) => ClaudeToolCall[]
> = {
  [SHELL_TOOL_NAME]: (input) => [{ name: "Bash", input }],
  read: (input, toAbsolutePath) => [
    { name: "Read", input: { ...input, file_path: toAbsolutePath(input.path) } },
  ],
  write: (input, toAbsolutePath) => [
    { name: "Write", input: { ...input, file_path: toAbsolutePath(input.path) } },
  ],
  edit: (input, toAbsolutePath) => [
    {
      name: "Edit",
      input: {
        ...input,
        file_path: toAbsolutePath(input.path),
        old_string: input.oldString,
        new_string: input.newString,
        replace_all: input.replaceAll,
      },
    },
  ],
  patch: (input, toAbsolutePath) =>
    toPatchCalls(String(input.patchText ?? ""), toAbsolutePath),
  grep: (input) => [{ name: "Grep", input: { ...input, glob: input.include } }],
  glob: (input) => [{ name: "Glob", input }],
  subagent: (input) => [
    { name: "Agent", input: { ...input, subagent_type: input.agent } },
  ],
};

export const toClaudeToolCalls = (
  toolName: string,
  input: ToolInput,
  workingDirectory: string
): ClaudeToolCall[] =>
  TOOL_CONVERTERS[toolName]?.(input, (path) =>
    resolve(workingDirectory, String(path ?? ""))
  ) ?? [{ name: toolName, input }];

const isToolInput = (input: unknown): input is ToolInput =>
  typeof input === "object" && input !== null;

export const toTranscriptLines = (
  storedMessages: StoredMessage[],
  workingDirectory: string
): string[] =>
  storedMessages.flatMap((storedMessage) => {
    if (storedMessage.type === "user") {
      return [composeUserTranscriptLine(storedMessage.id, storedMessage.text ?? "")];
    }
    if (storedMessage.type !== "assistant") return [];
    const toolUses = (storedMessage.content ?? []).flatMap((part) => {
      const input = part.state?.input;
      return part.type === "tool" && isToolInput(input)
        ? toClaudeToolCalls(part.name, input, workingDirectory).map(
            (toolCall) => ({ id: part.id, ...toolCall })
          )
        : [];
    });
    return toolUses.length > 0
      ? [composeToolUseTranscriptLine(storedMessage.id, toolUses)]
      : [];
  });

const textPartsOf = (result: ToolResult): TextPart[] => {
  const textParts = (result.content ?? []).filter(
    (part): part is TextPart => part.type === "text" && typeof part.text === "string"
  );
  if ((result.content ?? []).length > 0 || result.output === undefined) return textParts;
  return [
    {
      type: "text",
      text: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
    },
  ];
};

const toClaudeToolResponse = ({ tool, status, result, error }: ToolEvent) => {
  const isCompleted = status === "completed";
  const responseText = isCompleted
    ? textPartsOf(result ?? {}).map((part) => part.text).join("\n")
    : String((error as Error | undefined)?.message ?? error ?? "");
  if (tool !== SHELL_TOOL_NAME) return { text: responseText, is_error: !isCompleted };
  const metadata = result?.metadata ?? {};
  return {
    stdout: responseText,
    stderr: "",
    exit_code: result?.output?.exitCode ?? metadata.exit ?? (isCompleted ? null : 1),
    interrupted: Boolean(metadata.timeout || metadata.killed || metadata.signal),
  };
};

export const createOpenCodeHookPlugin = ({
  pluginName,
  pluginRoot,
}: {
  pluginName: string;
  pluginRoot: string;
}) => ({
  id: `claude-kit-${pluginName}-hooks`,
  setup: async (openCode: OpenCodeContext) => {
    const hooksFile = readHooksFile(join(pluginRoot, "hooks", "hooks.json"));
    const sessions = new Map<string, Session>();
    const contextsByCallId = new Map<string, string[]>();

    const findSession = async (sessionId: string) => {
      const knownSession = sessions.get(sessionId);
      if (knownSession) return knownSession;
      const sessionRecord = await openCode.session.get({ sessionID: sessionId });
      const session: Session = {
        directory:
          sessionRecord.location?.directory ??
          openCode.location?.directory ??
          process.cwd(),
        isSubagent: Boolean(sessionRecord.parentID),
        isStopHookActive: false,
      };
      sessions.set(sessionId, session);
      return session;
    };

    const dispatch = async (
      eventName: string,
      toolName: string | undefined,
      sessionId: string,
      payload: Record<string, unknown>
    ): Promise<HookOutcome[]> => {
      const { directory } = await findSession(sessionId);
      return runEventHooks({
        hooksFile,
        pluginRoot,
        eventName,
        toolName,
        sessionId,
        workingDirectory: directory,
        readTranscriptLines: async () =>
          toTranscriptLines(
            await openCode.session.context({ sessionID: sessionId }),
            directory
          ),
        payload,
      });
    };

    const dispatchToolEvent = async (
      eventName: string,
      event: ToolEvent,
      extraPayload: Record<string, unknown> = {}
    ) => {
      const { directory } = await findSession(event.sessionID);
      const toolCalls = toClaudeToolCalls(
        event.tool,
        isToolInput(event.input) ? event.input : {},
        directory
      );
      const outcomeGroups = await Promise.all(
        toolCalls.map((toolCall) =>
          dispatch(eventName, toolCall.name, event.sessionID, {
            tool_name: toolCall.name,
            tool_input: toolCall.input,
            tool_use_id: event.id,
            ...extraPayload,
          })
        )
      );
      return outcomeGroups.flat();
    };

    const runSafely = async <Result>(
      fallback: Result,
      runBridge: () => Promise<Result>
    ) => {
      try {
        return await runBridge();
      } catch (error) {
        console.error(`claude-kit ${pluginName} hooks: ${(error as Error).message}`);
        return fallback;
      }
    };

    await openCode.tool.hook("execute.before", async (event: ToolEvent) => {
      const reasons = await runSafely<string[]>([], async () => {
        const outcomes = await dispatchToolEvent("PreToolUse", event);
        const blockingReasons = definedValues(outcomes.map(blockingReasonOf));
        const contexts = outcomes.flatMap((outcome) =>
          additionalContextsOf(outcome, false)
        );
        if (blockingReasons.length === 0 && contexts.length > 0) {
          contextsByCallId.set(event.id, contexts);
        }
        return blockingReasons;
      });
      if (reasons.length > 0) throw new Error(reasons.join("\n"));
    });

    await openCode.tool.hook("execute.after", (event: ToolEvent) =>
      runSafely(undefined, async () => {
        const outcomes = await dispatchToolEvent("PostToolUse", event, {
          tool_response: toClaudeToolResponse(event),
        });
        const pendingContexts = contextsByCallId.get(event.id) ?? [];
        contextsByCallId.delete(event.id);
        if (event.status !== "completed" || !event.result) return;
        const replacement = definedValues(outcomes.map(replacementTextOf)).at(-1);
        const additionalTexts = [
          ...definedValues(outcomes.map(blockingReasonOf)),
          ...pendingContexts,
        ];
        if (replacement === undefined && additionalTexts.length === 0) return;
        event.result.content = [
          ...(replacement === undefined
            ? textPartsOf(event.result)
            : [{ type: "text", text: replacement }]),
          ...additionalTexts.map((text) => ({ type: "text", text })),
        ];
      })
    );

    await openCode.session.hook("context", async (event: ModelCallEvent) => {
      const startContexts = await runSafely<string[]>([], async () => {
        const session = await findSession(event.sessionID);
        if (session.isSubagent) return [];
        session.startContexts ??= dispatch("SessionStart", undefined, event.sessionID, {
          source: "startup",
        }).then((outcomes) =>
          outcomes.flatMap((outcome) => additionalContextsOf(outcome, true))
        );
        return session.startContexts;
      });
      for (const text of startContexts) event.system.push({ type: "text", text });
    });

    await runSafely(undefined, async () => {
      await openCode.session.hook("experimental.idle", (event: IdleEvent) =>
        runSafely(undefined, async () => {
          const session = await findSession(event.sessionID);
          const isWaitingForSubagent = (event.background ?? []).some(
            (work) => work.kind === "subagent" && work.sessionID === event.sessionID
          );
          if (session.isSubagent || isWaitingForSubagent) return;
          const outcomes = await dispatch("Stop", undefined, event.sessionID, {
            stop_hook_active: session.isStopHookActive,
          });
          const reasons = definedValues(outcomes.map(blockingReasonOf));
          session.isStopHookActive = reasons.length > 0;
          if (reasons.length === 0) return;
          await openCode.session.synthetic({
            sessionID: event.sessionID,
            text: reasons.join("\n"),
          });
        })
      );
    });
  },
});
