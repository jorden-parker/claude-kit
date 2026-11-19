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

type InstalledFolder = {
  folderName: string;
  isEntryWanted: (path: string) => boolean;
};

const STAGING_FOLDER = "claude-kit";
const CLAUDE_TOOL_NAME_PATTERN = /mcp__([A-Za-z0-9-]+)__/g;
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n+/;

const isMarkdownFile = (path: string) => path.endsWith(".md");

export const SKILL_FOLDER: InstalledFolder = {
  folderName: "skills",
  isEntryWanted: (path) => statSync(path).isDirectory(),
};
export const COMMAND_FOLDER: InstalledFolder = {
  folderName: "commands",
  isEntryWanted: isMarkdownFile,
};
export const AGENT_FOLDER: InstalledFolder = {
  folderName: "agents",
  isEntryWanted: isMarkdownFile,
};

export const composeStagingPath = (configFolder: string, ...pathParts: string[]) =>
  join(configFolder, STAGING_FOLDER, ...pathParts);

const composeManifestPath = (configFolder: string, pluginName: string) =>
  composeStagingPath(configFolder, `${pluginName}.files`);

export const readManifest = (configFolder: string, pluginName: string) => {
  const path = composeManifestPath(configFolder, pluginName);
  return existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean)
    : [];
};

export const writeManifest = (
  configFolder: string,
  pluginName: string,
  manifestEntries: string[]
) =>
  writeFileSync(
    composeManifestPath(configFolder, pluginName),
    `${manifestEntries.join("\n")}\n`
  );

const resolveInsideConfig = (configFolder: string, entry: string) => {
  const path = resolve(configFolder, entry);
  if (!path.startsWith(resolve(configFolder) + sep)) {
    throw new Error(`${entry} in the manifest points outside ${configFolder}.`);
  }
  return path;
};

export const listMarkdownFiles = (folder: string): string[] =>
  !existsSync(folder)
    ? []
    : readdirSync(folder, { recursive: true, encoding: "utf8" })
        .map((entry) => join(folder, entry))
        .filter((path) => isMarkdownFile(path) && statSync(path).isFile());

const rewriteMarkdownFiles = (
  folder: string,
  rewriteText: (text: string) => string
) => {
  for (const path of listMarkdownFiles(folder)) {
    writeFileSync(path, rewriteText(readFileSync(path, "utf8")));
  }
};

export const renameClaudeToolNames = (
  stagedFolder: string,
  installedFolders: InstalledFolder[],
  toolPrefixReplacement: string
) => {
  for (const { folderName } of installedFolders) {
    rewriteMarkdownFiles(join(stagedFolder, folderName), (text) =>
      text.replace(CLAUDE_TOOL_NAME_PATTERN, toolPrefixReplacement)
    );
  }
};

export const stripFrontmatter = (folder: string) =>
  rewriteMarkdownFiles(folder, (text) => text.replace(FRONTMATTER_PATTERN, ""));

export const listInstallablePaths = (
  configFolder: string,
  stagedFolder: string,
  installedFolders: InstalledFolder[],
  oldPaths: string[]
) => {
  const newPaths = installedFolders.flatMap(({ folderName, isEntryWanted }) => {
    const folder = join(stagedFolder, folderName);
    return existsSync(folder)
      ? readdirSync(folder)
          .filter((entryName) => isEntryWanted(join(folder, entryName)))
          .map((entryName) => join(folderName, entryName))
      : [];
  });
  const clashingPaths = newPaths.filter(
    (entry) => existsSync(join(configFolder, entry)) && !oldPaths.includes(entry)
  );
  if (clashingPaths.length > 0) {
    throw new Error(
      `${clashingPaths.join(", ")} already exist in ${configFolder} and were not installed by this script. Move them away and sync again.`
    );
  }
  return newPaths;
};

const removeInstalledPaths = (configFolder: string, installedPaths: string[]) => {
  for (const entry of installedPaths) {
    rmSync(resolveInsideConfig(configFolder, entry), { recursive: true, force: true });
  }
};

export const swapInstalledPaths = (
  configFolder: string,
  stagedFolder: string,
  oldPaths: string[],
  newPaths: string[]
) => {
  removeInstalledPaths(configFolder, oldPaths);
  for (const entry of newPaths) {
    cpSync(join(stagedFolder, entry), join(configFolder, entry), { recursive: true });
  }
};

export const removeInstalledPlugin = (
  configFolder: string,
  pluginName: string,
  installedPaths: string[]
) => {
  removeInstalledPaths(configFolder, installedPaths);
  rmSync(composeStagingPath(configFolder, pluginName), { recursive: true, force: true });
  rmSync(composeManifestPath(configFolder, pluginName), { force: true });
};

export const runInstallerCommandLine = (
  installPlugin: (
    configFolder: string,
    pluginName: string,
    stagedFolder: string,
    ...installOptions: string[]
  ) => void,
  removePlugin: (configFolder: string, pluginName: string) => void
) => {
  const [action, configFolder = "", pluginName = "", stagedFolder = "", ...installOptions] =
    process.argv.slice(2);
  try {
    if (action === "install") {
      installPlugin(configFolder, pluginName, resolve(stagedFolder), ...installOptions);
    } else if (action === "remove") {
      removePlugin(configFolder, pluginName);
    } else {
      throw new Error(`Unknown action ${action}: use install or remove.`);
    }
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
};
