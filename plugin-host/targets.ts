import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describePlugin } from "./host-tools";
import { createMcpConnection, serveMcp } from "./mcp-server";
import {
  createPiExtension,
  startHostedPlugin,
  type HostedPlugin,
} from "./pi-extension";

export { runCrushHooks } from "./crush-hooks";
export { createOpenCodeHookPlugin } from "./opencode-hooks";
export { createPiHookExtension } from "./pi-hooks";

type BundledPlugin = Omit<HostedPlugin, "storeFolder">;

const STORE_FOLDER = "claude-kit-store";

const findQwenStoreFolder = () =>
  join(process.env.QWEN_HOME ?? join(homedir(), ".qwen"), STORE_FOLDER);

const findPiStoreFolder = () =>
  join(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
    STORE_FOLDER
  );

export const serveQwenPlugin = async (plugin: BundledPlugin) => {
  const connection = createMcpConnection();
  return serveMcp(
    await startHostedPlugin({
      ...plugin,
      storeFolder: findQwenStoreFolder(),
      askQuestion: connection.askQuestion,
    }),
    connection
  );
};

export const serveOpenCodePlugin = async (plugin: BundledPlugin) => {
  const connection = createMcpConnection();
  return serveMcp(
    await startHostedPlugin({
      ...plugin,
      storeFolder: join(plugin.pluginRoot, "..", "..", STORE_FOLDER),
      askQuestion: connection.askQuestion,
    }),
    connection
  );
};

export const createPiPluginExtension = (plugin: BundledPlugin) =>
  createPiExtension({ ...plugin, storeFolder: findPiStoreFolder() });

export const printPluginDescription = async (plugin: BundledPlugin) => {
  const host = await startHostedPlugin({
    ...plugin,
    storeFolder: await mkdtemp(join(tmpdir(), "plugin-host-describe-")),
  });
  process.stdout.write(`${JSON.stringify(describePlugin(host))}\n`);
};
