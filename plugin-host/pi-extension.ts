import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPluginHost,
  NO_QUESTION_PROMPT_REASON,
  qualifyToolName,
  type AskQuestion,
  type CommandDefinition,
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

type PiCompletion = { value: string; label: string; description?: string };

type PiContext = {
  hasUI: boolean;
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    notify: (message: string, kind?: "info" | "warning" | "error") => unknown;
    setEditorText: (editorText: string) => unknown;
  };
};

type PiExtensionApi = {
  registerTool: (tool: any) => unknown;
  registerCommand: (
    commandName: string,
    options: {
      description: string;
      getArgumentCompletions: (
        argumentPrefix: string
      ) => Promise<PiCompletion[] | null>;
      handler: (args: string, piContext: PiContext) => Promise<void>;
    }
  ) => unknown;
  sendUserMessage: (message: string) => unknown;
};

const CANCELLED_QUESTION_REASON = "The user cancelled the question.";
const PROMPT_FOLDER = "prompts";
const PROMPT_ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n\s*/;

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

const describeCommand = ({ description, argumentHint }: CommandDefinition) =>
  argumentHint ? `${argumentHint} — ${description}` : description;

const completeArguments =
  (host: PluginHost, commandName: string) => async (argumentPrefix: string) => {
    const suggestions = await host.suggestCompletions(
      `/${commandName} ${argumentPrefix}`
    );
    return suggestions.length === 0
      ? null
      : suggestions.map(({ text, description }) => ({
          value: text,
          label: text,
          description,
        }));
  };

const readPromptTemplate = async (
  pluginRoot: string,
  commandName: string,
  args: string
) => {
  try {
    const template = await readFile(
      join(pluginRoot, PROMPT_FOLDER, `${commandName}.md`),
      "utf8"
    );
    return template
      .replace(FRONT_MATTER, "")
      .replaceAll(PROMPT_ARGUMENTS_PLACEHOLDER, args);
  } catch {
    return undefined;
  }
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

    const runCommand = async (
      commandName: string,
      args: string,
      piContext: PiContext
    ) => {
      latestContext = piContext;
      const outcome = await host.runCommandDirectly(commandName, args);
      if (!piContext.hasUI) {
        pi.sendUserMessage(outcome.text);
        return;
      }
      const promptTemplate = outcome.isModelReplyMissing
        ? await readPromptTemplate(plugin.pluginRoot, commandName, args)
        : undefined;
      if (promptTemplate) {
        pi.sendUserMessage(promptTemplate);
        return;
      }
      if (outcome.replyText)
        piContext.ui.notify(
          outcome.replyText,
          outcome.isError ? "error" : "info"
        );
      for (const filledPrompt of outcome.filledPrompts)
        piContext.ui.setEditorText(filledPrompt);
      for (const submittedPrompt of outcome.submittedPrompts)
        pi.sendUserMessage(submittedPrompt);
    };

    for (const command of host.commands) {
      pi.registerCommand(command.name, {
        description: describeCommand(command),
        getArgumentCompletions: completeArguments(host, command.name),
        handler: (args, piContext) => runCommand(command.name, args, piContext),
      });
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
