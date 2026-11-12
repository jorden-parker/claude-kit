import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

type OpenCodeConfig = { mcp?: Record<string, any> };

const STAGING_FOLDER = "claude-kit";
const BUNDLE_NAME = "plugin-host-server.mjs";
const MCP_ENTRY_PREFIX = "mcp ";
const CLAUDE_TOOL_NAME_PATTERN = /mcp__([A-Za-z0-9-]+)__/g;
const EDIT_TOOL_NAMES = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const CLAUDE_ONLY_AGENT_KEYS = ["name", "model", "tools"];
const INSTALLED_FOLDERS = [
  { folderName: "skills", isEntryWanted: (path: string) => statSync(path).isDirectory() },
  { folderName: "commands", isEntryWanted: (path: string) => path.endsWith(".md") },
  { folderName: "agents", isEntryWanted: (path: string) => path.endsWith(".md") },
];

const composeManifestPath = (configFolder: string, pluginName: string) =>
  join(configFolder, STAGING_FOLDER, `${pluginName}.files`);

const readManifest = (configFolder: string, pluginName: string) => {
  const path = composeManifestPath(configFolder, pluginName);
  return existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean)
    : [];
};

const resolveInsideConfig = (configFolder: string, entry: string) => {
  const path = resolve(configFolder, entry);
  if (!path.startsWith(resolve(configFolder) + sep)) {
    throw new Error(`${entry} in the manifest points outside ${configFolder}.`);
  }
  return path;
};

const listMarkdownFiles = (folder: string): string[] =>
  !existsSync(folder)
    ? []
    : readdirSync(folder, { recursive: true, encoding: "utf8" })
        .map((entry) => join(folder, entry))
        .filter((path) => path.endsWith(".md") && statSync(path).isFile());

const renameClaudeToolNames = (stagedFolder: string) => {
  for (const { folderName } of INSTALLED_FOLDERS) {
    for (const path of listMarkdownFiles(join(stagedFolder, folderName))) {
      const text = readFileSync(path, "utf8");
      writeFileSync(path, text.replace(CLAUDE_TOOL_NAME_PATTERN, "$1_"));
    }
  }
};

const composePermissionLines = (toolList: string) => {
  const toolNames = toolList.split(",").map((toolName) => toolName.trim());
  const deniedPermissions = [
    ...(EDIT_TOOL_NAMES.some((toolName) => toolNames.includes(toolName)) ? [] : ["edit"]),
    ...(toolNames.includes("Bash") ? [] : ["bash"]),
    ...(toolNames.includes("WebFetch") ? [] : ["webfetch"]),
  ];
  return deniedPermissions.length === 0
    ? []
    : ["permission:", ...deniedPermissions.map((permission) => `  ${permission}: deny`)];
};

export const convertAgent = (agentText: string) => {
  const [, frontmatter, ...bodyParts] = agentText.split(/^---$/m);
  if (frontmatter === undefined) return agentText;
  const frontmatterLines = frontmatter.split("\n").filter(Boolean);
  const toolList = frontmatterLines
    .find((line) => line.startsWith("tools:"))
    ?.slice("tools:".length);
  const keptLines = frontmatterLines.filter(
    (line) => !CLAUDE_ONLY_AGENT_KEYS.some((key) => line.startsWith(`${key}:`))
  );
  return [
    "---",
    ...keptLines,
    "mode: subagent",
    ...(toolList === undefined ? [] : composePermissionLines(toolList)),
    `---${bodyParts.join("---")}`,
  ].join("\n");
};

const convertAgents = (stagedFolder: string) => {
  for (const path of listMarkdownFiles(join(stagedFolder, "agents"))) {
    writeFileSync(path, convertAgent(readFileSync(path, "utf8")));
  }
};

const listInstalledEntries = (stagedFolder: string) =>
  INSTALLED_FOLDERS.flatMap(({ folderName, isEntryWanted }) => {
    const folder = join(stagedFolder, folderName);
    return existsSync(folder)
      ? readdirSync(folder)
          .filter((entryName) => isEntryWanted(join(folder, entryName)))
          .map((entryName) => join(folderName, entryName))
      : [];
  });

const findConfigPath = (configFolder: string) => {
  const jsonPath = join(configFolder, "opencode.json");
  const jsoncPath = join(configFolder, "opencode.jsonc");
  return !existsSync(jsonPath) && existsSync(jsoncPath) ? jsoncPath : jsonPath;
};

const readConfig = (configPath: string): OpenCodeConfig => {
  if (configPath.endsWith(".jsonc")) {
    throw new Error(
      `${configPath} may hold comments, so it is not rewritten. Rename it to opencode.json, or add the MCP server by hand.`
    );
  }
  return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
};

const removeMcpServers = (config: OpenCodeConfig, serverNames: string[]) => {
  for (const serverName of serverNames) {
    delete config.mcp?.servers?.[serverName];
    delete config.mcp?.[serverName];
  }
};

const addMcpServer = (
  config: OpenCodeConfig,
  serverName: string,
  bundlePath: string,
  majorVersion: number
) => {
  const command = ["node", bundlePath];
  config.mcp ??= {};
  if (majorVersion >= 2) {
    config.mcp.servers ??= {};
    config.mcp.servers[serverName] = { type: "local", command };
  } else {
    config.mcp[serverName] = { type: "local", command, enabled: true };
  }
};

const listManifestServerNames = (manifestEntries: string[]) =>
  manifestEntries
    .filter((entry) => entry.startsWith(MCP_ENTRY_PREFIX))
    .map((entry) => entry.slice(MCP_ENTRY_PREFIX.length));

const listManifestPaths = (manifestEntries: string[]) =>
  manifestEntries.filter((entry) => !entry.startsWith(MCP_ENTRY_PREFIX));

const updateConfig = (
  configFolder: string,
  oldServerNames: string[],
  addServer?: (config: OpenCodeConfig) => void
) => {
  if (oldServerNames.length === 0 && addServer === undefined) return;
  const configPath = findConfigPath(configFolder);
  const config = readConfig(configPath);
  removeMcpServers(config, oldServerNames);
  addServer?.(config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

export const installPlugin = (
  configFolder: string,
  pluginName: string,
  stagedFolder: string,
  majorVersion: number
) => {
  const oldEntries = readManifest(configFolder, pluginName);
  const oldPaths = listManifestPaths(oldEntries);
  renameClaudeToolNames(stagedFolder);
  convertAgents(stagedFolder);
  const newPaths = listInstalledEntries(stagedFolder);
  const clashingPaths = newPaths.filter(
    (entry) => existsSync(join(configFolder, entry)) && !oldPaths.includes(entry)
  );
  if (clashingPaths.length > 0) {
    throw new Error(
      `${clashingPaths.join(", ")} already exist in ${configFolder} and were not installed by this script. Move them away and sync again.`
    );
  }
  const bundlePath = join(stagedFolder, BUNDLE_NAME);
  const hasBundle = existsSync(bundlePath);
  updateConfig(
    configFolder,
    listManifestServerNames(oldEntries),
    hasBundle
      ? (config) => addMcpServer(config, pluginName, bundlePath, majorVersion)
      : undefined
  );
  for (const entry of oldPaths) {
    rmSync(resolveInsideConfig(configFolder, entry), { recursive: true, force: true });
  }
  for (const entry of newPaths) {
    cpSync(join(stagedFolder, entry), join(configFolder, entry), { recursive: true });
  }
  const newEntries = [...newPaths, ...(hasBundle ? [`${MCP_ENTRY_PREFIX}${pluginName}`] : [])];
  writeFileSync(composeManifestPath(configFolder, pluginName), `${newEntries.join("\n")}\n`);
};

export const removePlugin = (configFolder: string, pluginName: string) => {
  const oldEntries = readManifest(configFolder, pluginName);
  updateConfig(configFolder, listManifestServerNames(oldEntries));
  for (const entry of listManifestPaths(oldEntries)) {
    rmSync(resolveInsideConfig(configFolder, entry), { recursive: true, force: true });
  }
  rmSync(join(configFolder, STAGING_FOLDER, pluginName), { recursive: true, force: true });
  rmSync(composeManifestPath(configFolder, pluginName), { force: true });
};

const runCommandLine = ([action, configFolder = "", pluginName = "", stagedFolder = "", majorVersion = "2"]: string[]) => {
  if (action === "install") {
    installPlugin(configFolder, pluginName, resolve(stagedFolder), Number(majorVersion));
  } else if (action === "remove") {
    removePlugin(configFolder, pluginName);
  } else {
    throw new Error(`Unknown action ${action}: use install or remove.`);
  }
};

if (import.meta.main) {
  try {
    runCommandLine(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
}
