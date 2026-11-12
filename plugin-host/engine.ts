import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PluginEvent = Record<string, any>;
export type Next = (event: PluginEvent) => Promise<any>;
export type Hook = (engine: any, event: any, next: Next) => unknown;
export type HookFilter = Record<string, unknown>;
export type RegisterHook = (
  eventName: string,
  filterOrHook: HookFilter | Hook,
  hook?: Hook
) => void;
export type Register = (registerHook: RegisterHook, options: Record<string, unknown>) => unknown;

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type CommandDefinition = {
  name: string;
  description: string;
  argumentHint?: string;
};

export type Outcome = { text: string; isError: boolean };

export type PluginHostSettings = {
  pluginName: string;
  pluginRoot: string;
  workingDirectory: string;
  storePath: string;
  register: Register;
  options?: Record<string, unknown>;
};

type RegisteredHook = { eventName: string; filter: HookFilter; hook: Hook };

type Turn = {
  modelReply: string | undefined;
  submittedPrompts: string[];
  filledPrompts: string[];
  scheduledWork: Promise<unknown>[];
};

const CALLER_MESSAGE =
  "The conversation is with the caller, which writes any model reply itself.";
const NO_MODEL_REPLY_REASON = "no model reply was passed to the command";
const FILLED_PROMPT_LEAD =
  "Show the user this text, word for word, as the prompt to send next:";
const NO_COMMANDS_AT_START =
  "process.run is not available while a plugin starts outside Claude Code.";
const SUBMITTED_PROMPT_LEAD = "Now carry out these instructions:";

const startTurn = (modelReply?: string): Turn => ({
  modelReply,
  submittedPrompts: [],
  filledPrompts: [],
  scheduledWork: [],
});

const matchesFilter = (filter: HookFilter, event: PluginEvent) =>
  Object.entries(filter).every(([key, expected]) =>
    expected instanceof RegExp
      ? expected.test(String(event[key] ?? ""))
      : event[key] === expected
  );

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const stringifyResult = (result: unknown) =>
  typeof result === "string" ? result : JSON.stringify(result, null, 2);

const readReplyText = (reply: { result?: unknown; text?: unknown }) =>
  stringifyResult(reply.result ?? reply.text ?? "");

const refuseUnknownVerbs = (nounName: string, verbs: Record<string, unknown>) =>
  new Proxy(verbs, {
    get: (knownVerbs, verbName) =>
      typeof verbName !== "string" || verbName in knownVerbs
        ? knownVerbs[verbName as string]
        : () => {
            throw new Error(
              `${nounName}.${verbName} is not available outside Claude Code.`
            );
          },
  });

const runHostCommand = (argv: string[], timeoutMs: number | undefined) =>
  new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const [executable = "", ...commandArguments] = argv;
      execFile(
        executable,
        commandArguments,
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") return reject(error);
          resolve({ exitCode: error ? Number(error.code) : 0, stdout, stderr });
        }
      );
    }
  );

export const qualifyToolName = (pluginName: string, toolName: string) =>
  `mcp__${pluginName}__${toolName}`;

export const createPluginHost = ({
  pluginName,
  pluginRoot,
  workingDirectory,
  storePath,
  register,
  options = {},
}: PluginHostSettings) => {
  const hooks: RegisteredHook[] = [];
  const tools: ToolDefinition[] = [];
  const commands: CommandDefinition[] = [];
  const sessionId = randomUUID();
  let turn = startTurn();
  let isStarting = false;
  let earlierCalls: Promise<unknown> = Promise.resolve();

  const readStore = async (): Promise<Record<string, unknown>> => {
    try {
      return JSON.parse(await readFile(storePath, "utf8"));
    } catch {
      return {};
    }
  };

  const writeStore = async (stored: Record<string, unknown>) => {
    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify(stored, null, 2)}\n`);
  };

  const nouns: Record<string, Record<string, unknown>> = {
    session: {
      cwd: async () => workingDirectory,
      id: async () => sessionId,
      messages: async () => [{ role: "user", text: CALLER_MESSAGE }],
    },
    clock: {
      now: async () => Date.now(),
      after: (_delayMs: number, callback: () => unknown) => {
        turn.scheduledWork.push(Promise.resolve().then(callback));
      },
    },
    fs: {
      read: (filePath: string) => readFile(filePath, "utf8"),
      write: async (filePath: string, text: string) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, text);
      },
      list: async (folder: string) =>
        (await readdir(folder, { withFileTypes: true })).map((entry) => ({
          name: entry.name,
          kind: entry.isFile() ? "file" : entry.isDirectory() ? "dir" : "other",
        })),
    },
    process: {
      run: async (argv: string[], runOptions: { timeoutMs?: number } = {}) => {
        if (isStarting) throw new Error(NO_COMMANDS_AT_START);
        return runHostCommand(argv, runOptions.timeoutMs);
      },
    },
    store: {
      get: async (key: string) => (await readStore())[key],
      set: async (key: string, value: unknown) =>
        writeStore({ ...(await readStore()), [key]: value }),
      delete: async (key: string) => {
        const { [key]: _removed, ...kept } = await readStore();
        await writeStore(kept);
      },
    },
    tool: {
      register: async (definition: ToolDefinition) => {
        tools.push(definition);
      },
    },
    command: {
      register: async (definition: CommandDefinition) => {
        commands.push(definition);
      },
    },
    prompt: {
      submit: async ({ text }: { text: string }) => {
        turn.submittedPrompts.push(text);
      },
      fill: async ({ text }: { text: string }) => {
        turn.filledPrompts.push(text);
        return { isFilled: true };
      },
    },
    model: {
      complete: async () =>
        turn.modelReply === undefined
          ? { isAnswered: false, reason: NO_MODEL_REPLY_REASON }
          : { isAnswered: true, text: turn.modelReply },
    },
    ui: {
      toast: () => undefined,
      open: () => undefined,
      invalidate: () => undefined,
      selection: async () => undefined,
      copy: async () => ({
        isCopied: false,
        reason: "no clipboard outside Claude Code",
      }),
    },
  };

  const engine: any = new Proxy(
    { plugin: { root: pluginRoot } } as Record<string, unknown>,
    {
      get: (fixedNouns, nounName) =>
        typeof nounName !== "string" || nounName in fixedNouns
          ? fixedNouns[nounName as string]
          : refuseUnknownVerbs(nounName, nouns[nounName] ?? {}),
    }
  );

  const registerHook: RegisterHook = (eventName, filterOrHook, hook) => {
    hooks.push(
      typeof filterOrHook === "function"
        ? { eventName, filter: {}, hook: filterOrHook }
        : { eventName, filter: filterOrHook, hook: hook! }
    );
  };

  const dispatch = (eventName: string, event: PluginEvent) => {
    const matchingHooks = hooks.filter(
      (registered) =>
        registered.eventName === eventName &&
        matchesFilter(registered.filter, event)
    );
    const runFrom =
      (hookIndex: number): Next =>
      async (currentEvent) =>
        hookIndex < matchingHooks.length
          ? matchingHooks[hookIndex]!.hook(
              engine,
              currentEvent,
              runFrom(hookIndex + 1)
            )
          : undefined;
    return runFrom(0)(event);
  };

  const finishScheduledWork = async () => {
    while (turn.scheduledWork.length) {
      await Promise.all(turn.scheduledWork.splice(0));
    }
  };

  const describeTurn = (replyText: string) =>
    [
      replyText,
      ...turn.filledPrompts.map(
        (filledPrompt) => `${FILLED_PROMPT_LEAD}\n\n${filledPrompt}`
      ),
      ...turn.submittedPrompts.map(
        (submittedPrompt) => `${SUBMITTED_PROMPT_LEAD}\n\n${submittedPrompt}`
      ),
    ]
      .filter((section) => section)
      .join("\n\n");

  const describeReply = (reply: any, unansweredText: string): Outcome => {
    if (reply == null) return { text: unansweredText, isError: true };
    if (reply.deny !== undefined) {
      return { text: stringifyResult(reply.deny), isError: true };
    }
    return { text: describeTurn(readReplyText(reply)), isError: false };
  };

  const runTurn = (
    eventName: string,
    event: PluginEvent,
    unansweredText: string,
    modelReply?: string
  ): Promise<Outcome> => {
    const outcome = earlierCalls.then(async () => {
      turn = startTurn(modelReply);
      try {
        const reply = await dispatch(eventName, event);
        await finishScheduledWork();
        return describeReply(reply, unansweredText);
      } catch (error) {
        return { text: describeError(error), isError: true };
      }
    });
    earlierCalls = outcome;
    return outcome;
  };

  return {
    pluginName,
    tools,
    commands,
    start: async () => {
      isStarting = true;
      try {
        await register(registerHook, options);
        await dispatch("session.start", { source: "startup" });
        await finishScheduledWork();
      } finally {
        isStarting = false;
      }
    },
    callTool: (toolName: string, input: PluginEvent) =>
      runTurn(
        "tool.call",
        { ...input, tool: qualifyToolName(pluginName, toolName) },
        `No hook answered ${qualifyToolName(pluginName, toolName)}.`
      ),
    runCommand: (commandName: string, args: string, modelReply?: string) =>
      runTurn(
        "command.run",
        {
          command: commandName,
          args,
          origin: { kind: "composer" },
          presentation: { isFullscreen: false, columns: 80 },
        },
        `No hook answered /${commandName}.`,
        modelReply
      ),
  };
};

export type PluginHost = ReturnType<typeof createPluginHost>;
