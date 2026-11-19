import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_FOLDER,
  COMMAND_FOLDER,
  SKILL_FOLDER,
  listInstallablePaths,
  listMarkdownFiles,
  readManifest,
  removeInstalledPlugin,
  renameClaudeToolNames,
  runInstallerCommandLine,
  stripFrontmatter,
  swapInstalledPaths,
  writeManifest,
} from "./installed-files";

type OpenCodeConfig = { mcp?: Record<string, any>; instructions?: string[] };

const BUNDLE_NAME = "plugin-host-server.mjs";
const MCP_ENTRY_PREFIX = "mcp ";
const INSTRUCTION_ENTRY_PREFIX = "instruction ";
const CONFIG_ENTRY_PREFIXES = [MCP_ENTRY_PREFIX, INSTRUCTION_ENTRY_PREFIX];
const INSTRUCTION_FOLDER = "output-styles";
const OPENCODE_TOOL_PREFIX = "$1_";
const EDIT_TOOL_NAMES = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const CLAUDE_ONLY_AGENT_KEYS = ["name", "model", "tools"];
const HOOK_PLUGIN_FOLDER = {
  folderName: "plugins",
  isEntryWanted: (path: string) => path.endsWith(".js"),
};
const MINIMUM_HOOK_PLUGIN_MAJOR_VERSION = 2;
const INSTALLED_FOLDERS = [
  SKILL_FOLDER,
  COMMAND_FOLDER,
  AGENT_FOLDER,
  HOOK_PLUGIN_FOLDER,
];

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

const findConfigPath = (configFolder: string) => {
  const jsonPath = join(configFolder, "opencode.json");
  const jsoncPath = join(configFolder, "opencode.jsonc");
  return !existsSync(jsonPath) && existsSync(jsoncPath) ? jsoncPath : jsonPath;
};

const readConfig = (configPath: string): OpenCodeConfig => {
  if (configPath.endsWith(".jsonc")) {
    throw new Error(
      `${configPath} may hold comments, so it is not rewritten. Rename it to opencode.json, or add the MCP server and instructions by hand.`
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

const removeInstructions = (config: OpenCodeConfig, instructionPaths: string[]) => {
  const keptPaths = (config.instructions ?? []).filter(
    (instructionPath) => !instructionPaths.includes(instructionPath)
  );
  if (keptPaths.length > 0) config.instructions = keptPaths;
  else delete config.instructions;
};

const addInstructions = (config: OpenCodeConfig, instructionPaths: string[]) => {
  if (instructionPaths.length === 0) return;
  config.instructions = [...(config.instructions ?? []), ...instructionPaths];
};

const listPrefixedEntries = (manifestEntries: string[], entryPrefix: string) =>
  manifestEntries
    .filter((entry) => entry.startsWith(entryPrefix))
    .map((entry) => entry.slice(entryPrefix.length));

const listManifestPaths = (manifestEntries: string[]) =>
  manifestEntries.filter(
    (entry) => !CONFIG_ENTRY_PREFIXES.some((entryPrefix) => entry.startsWith(entryPrefix))
  );

const updateConfig = (
  configFolder: string,
  oldEntries: string[],
  addNewEntries?: (config: OpenCodeConfig) => void
) => {
  const oldServerNames = listPrefixedEntries(oldEntries, MCP_ENTRY_PREFIX);
  const oldInstructionPaths = listPrefixedEntries(oldEntries, INSTRUCTION_ENTRY_PREFIX);
  if (
    oldServerNames.length + oldInstructionPaths.length === 0 &&
    addNewEntries === undefined
  ) {
    return;
  }
  const configPath = findConfigPath(configFolder);
  const config = readConfig(configPath);
  removeMcpServers(config, oldServerNames);
  removeInstructions(config, oldInstructionPaths);
  addNewEntries?.(config);
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
  renameClaudeToolNames(stagedFolder, INSTALLED_FOLDERS, OPENCODE_TOOL_PREFIX);
  convertAgents(stagedFolder);
  if (majorVersion < MINIMUM_HOOK_PLUGIN_MAJOR_VERSION) {
    rmSync(join(stagedFolder, HOOK_PLUGIN_FOLDER.folderName), {
      recursive: true,
      force: true,
    });
  }
  const newPaths = listInstallablePaths(
    configFolder,
    stagedFolder,
    INSTALLED_FOLDERS,
    oldPaths
  );
  const bundlePath = join(stagedFolder, BUNDLE_NAME);
  const hasBundle = existsSync(bundlePath);
  const instructionFolder = join(stagedFolder, INSTRUCTION_FOLDER);
  const instructionPaths = listMarkdownFiles(instructionFolder);
  stripFrontmatter(instructionFolder);
  updateConfig(
    configFolder,
    oldEntries,
    hasBundle || instructionPaths.length > 0
      ? (config) => {
          if (hasBundle) addMcpServer(config, pluginName, bundlePath, majorVersion);
          addInstructions(config, instructionPaths);
        }
      : undefined
  );
  swapInstalledPaths(configFolder, stagedFolder, oldPaths, newPaths);
  writeManifest(configFolder, pluginName, [
    ...newPaths,
    ...(hasBundle ? [`${MCP_ENTRY_PREFIX}${pluginName}`] : []),
    ...instructionPaths.map(
      (instructionPath) => `${INSTRUCTION_ENTRY_PREFIX}${instructionPath}`
    ),
  ]);
};

export const removePlugin = (configFolder: string, pluginName: string) => {
  const oldEntries = readManifest(configFolder, pluginName);
  updateConfig(configFolder, oldEntries);
  removeInstalledPlugin(configFolder, pluginName, listManifestPaths(oldEntries));
};

if (import.meta.main) {
  runInstallerCommandLine(
    (configFolder, pluginName, stagedFolder, majorVersion = "2") =>
      installPlugin(configFolder, pluginName, stagedFolder, Number(majorVersion)),
    removePlugin
  );
}
