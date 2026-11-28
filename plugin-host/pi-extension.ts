import { join } from "node:path";
import {
  createPluginHost,
  NO_QUESTION_PROMPT_REASON,
  qualifyToolName,
  type AskQuestion,
  type PluginHost,
  type Register,
} from "./engine";
import { callHostTool, listHostTools } from "./host-tools";

export type HostedPlugin = {
  pluginName: string;
  pluginRoot: string;
  storeFolder: string;
  register: Register;
  askQuestion?: AskQuestion;
};

type PiSuggestions = {
  items: { value: string; label: string; description?: string }[];
  prefix: string;
};

type PiAutocompleteProvider = {
  triggerCharacters?: string[];
  getSuggestions: (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: unknown
  ) => Promise<PiSuggestions | null>;
  applyCompletion: (...completionArguments: any[]) => unknown;
  shouldTriggerFileCompletion?: (...cursorPosition: any[]) => boolean;
};

type PiContext = {
  hasUI: boolean;
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    addAutocompleteProvider?: (
      wrapProvider: (current: PiAutocompleteProvider) => PiAutocompleteProvider
    ) => unknown;
  };
};

type PiExtensionApi = {
  registerTool: (tool: any) => unknown;
  on: (
    eventName: "session_start",
    handler: (event: unknown, piContext: PiContext) => unknown
  ) => unknown;
};

const LAST_WORD = /\S*$/;

const suggestCommandArguments =
  (host: PluginHost) =>
  (current: PiAutocompleteProvider): PiAutocompleteProvider => ({
    triggerCharacters: current.triggerCharacters,
    getSuggestions: async (lines, cursorLine, cursorCol, options) => {
      const typedText = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const isCommandArgument =
        cursorLine === 0 &&
        host.commands.some(({ name }) => typedText.startsWith(`/${name} `));
      const suggestions = isCommandArgument
        ? await host.suggestCompletions(typedText)
        : [];
      if (suggestions.length === 0)
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      return {
        items: suggestions.map(({ text, description }) => ({
          value: text,
          label: text,
          description,
        })),
        prefix: typedText.slice(typedText.search(LAST_WORD)),
      };
    },
    applyCompletion: (...completionArguments) =>
      current.applyCompletion(...completionArguments),
    shouldTriggerFileCompletion: (...cursorPosition) =>
      current.shouldTriggerFileCompletion?.(...cursorPosition) ?? true,
  });

const CANCELLED_QUESTION_REASON = "The user cancelled the question.";

export const startHostedPlugin = async ({
  pluginName,
  pluginRoot,
  storeFolder,
  register,
  askQuestion,
}: HostedPlugin) => {
  const host = createPluginHost({
    pluginName,
    pluginRoot,
    workingDirectory: process.cwd(),
    storePath: join(storeFolder, `${pluginName}.json`),
    register,
    askQuestion,
  });
  await host.start();
  return host;
};

export const createPiExtension =
  (plugin: HostedPlugin) => async (pi: PiExtensionApi) => {
    let latestContext: PiContext | undefined;
    const askInSelectDialog: AskQuestion = async (
      question,
      { header, options }
    ) => {
      if (!latestContext?.hasUI) throw new Error(NO_QUESTION_PROMPT_REASON);
      const answer = await latestContext.ui.select(
        `${header}: ${question}`,
        options
      );
      if (answer === undefined) throw new Error(CANCELLED_QUESTION_REASON);
      return answer;
    };
    const host = await startHostedPlugin({
      ...plugin,
      askQuestion: plugin.askQuestion ?? askInSelectDialog,
    });
    if (host.commands.length > 0) {
      pi.on("session_start", (_event, piContext) =>
        piContext.ui.addAutocompleteProvider?.(suggestCommandArguments(host))
      );
    }
    for (const tool of listHostTools(host)) {
      pi.registerTool({
        name: qualifyToolName(host.pluginName, tool.name),
        label: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (
          _toolCallId: string,
          toolArguments: Record<string, any>,
          _abortSignal?: AbortSignal,
          _onUpdate?: unknown,
          piContext?: PiContext
        ) => {
          latestContext = piContext;
          const outcome = await callHostTool(host, tool.name, toolArguments);
          if (outcome.isError) throw new Error(outcome.text);
          return {
            content: [{ type: "text", text: outcome.text }],
            details: undefined,
          };
        },
      });
    }
  };
