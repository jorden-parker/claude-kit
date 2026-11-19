import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readHooksFile } from "./command-hooks";
import { CRUSH_HOOKS_PATH, describeCrushHooks } from "./crush-hooks";
import {
  COMMAND_FOLDER,
  SKILL_FOLDER,
  composeStagingPath,
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

const SERVER_BUNDLE_NAME = "plugin-host-server.mjs";
const HOOK_BUNDLE_NAME = "crush-hooks.mjs";
const CRUSH_TOOL_PREFIX = "mcp_$1_";
const INSTALLED_FOLDERS = [SKILL_FOLDER, COMMAND_FOLDER];
const CONTEXT_FOLDERS = ["context", "output-styles"];
const FRONTMATTER_FREE_FOLDERS = ["commands", "output-styles"];
const FRAGMENT_EXTENSION = ".crushrc";
const USER_CONFIG_NAME = "crushrc";

const quoteShellWord = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

const composeSourceLine = (path: string) => `source ${quoteShellWord(path)}\n`;

const composeGuardedSourceLine = (path: string) =>
  `if [ -f ${quoteShellWord(path)} ]; then source ${quoteShellWord(path)}; fi\n`;

const composeServerLines = (pluginName: string, stagedFolder: string) => {
  const bundlePath = join(stagedFolder, SERVER_BUNDLE_NAME);
  return existsSync(bundlePath)
    ? [`mcp add ${pluginName} --command node --args ${quoteShellWord(bundlePath)}`]
    : [];
};

const composeHookLines = (pluginName: string, stagedFolder: string) => {
  const bundlePath = join(stagedFolder, HOOK_BUNDLE_NAME);
  if (!existsSync(bundlePath)) return [];
  const { matcher, timeoutSeconds } = describeCrushHooks(
    readHooksFile(join(stagedFolder, CRUSH_HOOKS_PATH))
  );
  return [
    [
      "hook add PreToolUse",
      ...(matcher === undefined ? [] : [`--matcher ${quoteShellWord(matcher)}`]),
      `--command ${quoteShellWord(`node ${JSON.stringify(bundlePath)}`)}`,
      `--name claude-kit-${pluginName}`,
      `--timeout ${timeoutSeconds}`,
    ].join(" "),
  ];
};

const composeContextLines = (stagedFolder: string) =>
  CONTEXT_FOLDERS.flatMap((folderName) =>
    listMarkdownFiles(join(stagedFolder, folderName))
  ).map((contextPath) => `option context-path ${quoteShellWord(contextPath)}`);

const composeFragmentPath = (configFolder: string, pluginName: string) =>
  composeStagingPath(configFolder, `${pluginName}${FRAGMENT_EXTENSION}`);

const linkFragments = (configFolder: string) => {
  const stagingRoot = composeStagingPath(configFolder);
  const generatedConfigPath = join(stagingRoot, USER_CONFIG_NAME);
  writeFileSync(
    generatedConfigPath,
    readdirSync(stagingRoot)
      .filter((fileName) => fileName.endsWith(FRAGMENT_EXTENSION))
      .sort()
      .map((fileName) => composeSourceLine(join(stagingRoot, fileName)))
      .join("")
  );
  const userConfigPath = join(configFolder, USER_CONFIG_NAME);
  const userConfig = existsSync(userConfigPath)
    ? readFileSync(userConfigPath, "utf8")
    : "";
  const sourceLine = composeGuardedSourceLine(generatedConfigPath);
  if (userConfig.includes(sourceLine)) return;
  const separator = userConfig === "" || userConfig.endsWith("\n") ? "" : "\n";
  writeFileSync(userConfigPath, `${userConfig}${separator}${sourceLine}`);
};

export const installPlugin = (
  configFolder: string,
  pluginName: string,
  stagedFolder: string
) => {
  const oldPaths = readManifest(configFolder, pluginName);
  renameClaudeToolNames(stagedFolder, INSTALLED_FOLDERS, CRUSH_TOOL_PREFIX);
  for (const folderName of FRONTMATTER_FREE_FOLDERS) {
    stripFrontmatter(join(stagedFolder, folderName));
  }
  const newPaths = listInstallablePaths(
    configFolder,
    stagedFolder,
    INSTALLED_FOLDERS,
    oldPaths
  );
  swapInstalledPaths(configFolder, stagedFolder, oldPaths, newPaths);
  writeManifest(configFolder, pluginName, newPaths);
  const fragmentLines = [
    ...composeServerLines(pluginName, stagedFolder),
    ...composeHookLines(pluginName, stagedFolder),
    ...composeContextLines(stagedFolder),
  ];
  const fragmentPath = composeFragmentPath(configFolder, pluginName);
  if (fragmentLines.length > 0) {
    writeFileSync(fragmentPath, `${fragmentLines.join("\n")}\n`);
  } else {
    rmSync(fragmentPath, { force: true });
  }
  linkFragments(configFolder);
};

export const removePlugin = (configFolder: string, pluginName: string) => {
  removeInstalledPlugin(
    configFolder,
    pluginName,
    readManifest(configFolder, pluginName)
  );
  rmSync(composeFragmentPath(configFolder, pluginName), { force: true });
  linkFragments(configFolder);
};

if (import.meta.main) runInstallerCommandLine(installPlugin, removePlugin);
