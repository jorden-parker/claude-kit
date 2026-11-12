import {
  qualifyToolName,
  type CommandDefinition,
  type PluginHost,
} from "./engine";

const RUN_TOOL_PREFIX = "run_";

const nameRunTool = (commandName: string) =>
  `${RUN_TOOL_PREFIX}${commandName}`;

const describeRunTool = (command: CommandDefinition) => ({
  name: nameRunTool(command.name),
  description: [
    `Runs the /${command.name} command: ${command.description.replace(/\.$/, "")}.`,
    command.argumentHint ? `Its arguments: ${command.argumentHint}.` : "",
    "Do what the reply says.",
  ]
    .filter((sentence) => sentence)
    .join(" "),
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "string",
        description: `The text the user typed after /${command.name}, unchanged. Empty when there is none.`,
      },
      modelReply: {
        type: "string",
        description:
          "Only when the command's own instructions ask for it: the text you wrote for the command to use.",
      },
    },
    required: ["args"],
  },
});

export const listHostTools = (host: PluginHost) => [
  ...host.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
  ...host.commands.map(describeRunTool),
];

export const describePlugin = (host: PluginHost) => ({
  name: host.pluginName,
  toolNames: listHostTools(host).map((tool) => tool.name),
  commands: host.commands.map((command) => ({
    ...command,
    toolName: qualifyToolName(host.pluginName, nameRunTool(command.name)),
  })),
});

export type PluginDescription = ReturnType<typeof describePlugin>;

export const callHostTool = (
  host: PluginHost,
  toolName: string,
  toolArguments: Record<string, any>
) => {
  const command = host.commands.find(
    (candidate) => nameRunTool(candidate.name) === toolName
  );
  return command
    ? host.runCommand(
        command.name,
        String(toolArguments.args ?? ""),
        typeof toolArguments.modelReply === "string"
          ? toolArguments.modelReply
          : undefined
      )
    : host.callTool(toolName, toolArguments);
};
