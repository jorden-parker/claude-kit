import { join } from "node:path";
import {
  createPluginHost,
  NO_QUESTION_PROMPT_REASON,
  qualifyToolName,
  type AskQuestion,
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

type PiExtensionApi = { registerTool: (tool: any) => unknown };

type PiContext = {
  hasUI: boolean;
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
  };
};

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
