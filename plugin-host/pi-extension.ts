import { join } from "node:path";
import {
  createPluginHost,
  qualifyToolName,
  type Register,
} from "./engine";
import { callHostTool, listHostTools } from "./host-tools";

export type HostedPlugin = {
  pluginName: string;
  pluginRoot: string;
  storeFolder: string;
  register: Register;
};

type PiExtensionApi = { registerTool: (tool: any) => unknown };

export const startHostedPlugin = async ({
  pluginName,
  pluginRoot,
  storeFolder,
  register,
}: HostedPlugin) => {
  const host = createPluginHost({
    pluginName,
    pluginRoot,
    workingDirectory: process.cwd(),
    storePath: join(storeFolder, `${pluginName}.json`),
    register,
  });
  await host.start();
  return host;
};

export const createPiExtension =
  (plugin: HostedPlugin) => async (pi: PiExtensionApi) => {
    const host = await startHostedPlugin(plugin);
    for (const tool of listHostTools(host)) {
      pi.registerTool({
        name: qualifyToolName(host.pluginName, tool.name),
        label: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (
          _toolCallId: string,
          toolArguments: Record<string, any>
        ) => {
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
