import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { PluginDescription } from "./host-tools";

type TargetName = "qwen" | "pi" | "opencode";

type Target = {
  bundleName: string;
  starterName: string;
  startStatement: string;
  commandFolder: string;
  argumentsPlaceholder: string;
  hostsCommandHooks: boolean;
  writeManifest: (staged: StagedPlugin) => void;
};

type StagedPlugin = {
  pluginName: string;
  pluginVersion: string;
  stagedFolder: string;
  hasBundle: boolean;
  hasHookBundle: boolean;
  target: Target;
};

type HooksFile = { modules?: string[]; hooks?: unknown };

const HOST_FOLDER = import.meta.dirname;
const PORTABLE_COMMAND_FOLDER = "portable-commands";
const PORTABLE_ARGUMENTS_PLACEHOLDER = "{{args}}";
const ENTRY_NAME = "plugin-host-entry.ts";
const DESCRIBE_BUNDLE_NAME = "plugin-host-describe.mjs";
const PI_HOOK_BUNDLE_NAME = "pi-hooks-extension.js";

const writeJson = (filePath: string, content: unknown) =>
  writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`);

const readJson = (filePath: string) =>
  JSON.parse(readFileSync(filePath, "utf8"));

const listExistingFolders = (stagedFolder: string, folderNames: string[]) =>
  folderNames.filter((folderName) =>
    existsSync(join(stagedFolder, folderName))
  );

const TARGETS: Record<TargetName, Target> = {
  qwen: {
    bundleName: "plugin-host-server.mjs",
    starterName: "serveQwenPlugin",
    startStatement: "await serveQwenPlugin(plugin);",
    commandFolder: "commands",
    argumentsPlaceholder: "{{args}}",
    hostsCommandHooks: false,
    writeManifest: ({ pluginName, stagedFolder, hasBundle, target }) => {
      if (!hasBundle) return;
      writeJson(join(stagedFolder, ".mcp.json"), {
        mcpServers: {
          [pluginName]: {
            command: "node",
            args: [`\${CLAUDE_PLUGIN_ROOT}/${target.bundleName}`],
          },
        },
      });
    },
  },
  pi: {
    bundleName: "plugin-host-extension.js",
    starterName: "createPiPluginExtension",
    startStatement: "export default createPiPluginExtension(plugin);",
    commandFolder: "prompts",
    argumentsPlaceholder: "$ARGUMENTS",
    hostsCommandHooks: true,
    writeManifest: ({
      pluginName,
      pluginVersion,
      stagedFolder,
      hasBundle,
      hasHookBundle,
      target,
    }) => {
      const [skillFolder] = listExistingFolders(stagedFolder, ["skills"]);
      const [promptFolder] = listExistingFolders(stagedFolder, [
        target.commandFolder,
      ]);
      const extensionPaths = [
        ...(hasBundle ? [`./${target.bundleName}`] : []),
        ...(hasHookBundle ? [`./${PI_HOOK_BUNDLE_NAME}`] : []),
      ];
      writeJson(join(stagedFolder, "package.json"), {
        name: `claude-kit-${pluginName}`,
        version: pluginVersion,
        keywords: ["pi-package"],
        pi: {
          ...(extensionPaths.length > 0 ? { extensions: extensionPaths } : {}),
          ...(skillFolder ? { skills: [`./${skillFolder}`] } : {}),
          ...(promptFolder ? { prompts: [`./${promptFolder}`] } : {}),
        },
      });
    },
  },
  opencode: {
    bundleName: "plugin-host-server.mjs",
    starterName: "serveOpenCodePlugin",
    startStatement: "await serveOpenCodePlugin(plugin);",
    commandFolder: "commands",
    argumentsPlaceholder: "$ARGUMENTS",
    hostsCommandHooks: false,
    writeManifest: () => {},
  },
};

const buildEntry = async (
  pluginName: string,
  entryLines: string[],
  stagedFolder: string,
  bundleName: string
) => {
  const entryPath = join(stagedFolder, ENTRY_NAME);
  writeFileSync(entryPath, entryLines.join("\n"));
  try {
    const bundle = await Bun.build({
      entrypoints: [entryPath],
      target: "node",
      format: "esm",
      outdir: stagedFolder,
      naming: bundleName,
      jsx: { runtime: "classic", factory: "h", fragment: "Fragment" },
    });
    if (!bundle.success) {
      throw new Error(
        `Could not bundle ${pluginName}: ${bundle.logs.join("\n")}`
      );
    }
  } finally {
    rmSync(entryPath);
  }
};

const bundlePlugin = (
  pluginName: string,
  hooksModulePath: string,
  stagedFolder: string,
  bundleName: string,
  starterName: string,
  startStatement: string
) =>
  buildEntry(
    pluginName,
    [
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { register } from ${JSON.stringify(hooksModulePath)};`,
      `import { ${starterName} } from ${JSON.stringify(join(HOST_FOLDER, "targets.ts"))};`,
      `const plugin = { pluginName: ${JSON.stringify(pluginName)}, pluginRoot: dirname(fileURLToPath(import.meta.url)), register };`,
      startStatement,
      "",
    ],
    stagedFolder,
    bundleName
  );

const bundleHookExtension = (pluginName: string, stagedFolder: string) =>
  buildEntry(
    pluginName,
    [
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { createPiHookExtension } from ${JSON.stringify(join(HOST_FOLDER, "targets.ts"))};`,
      `export default createPiHookExtension({ pluginRoot: dirname(fileURLToPath(import.meta.url)) });`,
      "",
    ],
    stagedFolder,
    PI_HOOK_BUNDLE_NAME
  );

const describeStagedPlugin = async (
  pluginName: string,
  hooksModulePath: string,
  stagedFolder: string
): Promise<PluginDescription> => {
  await bundlePlugin(
    pluginName,
    hooksModulePath,
    stagedFolder,
    DESCRIBE_BUNDLE_NAME,
    "printPluginDescription",
    "await printPluginDescription(plugin);"
  );
  const describeBundlePath = join(stagedFolder, DESCRIBE_BUNDLE_NAME);
  try {
    return JSON.parse(execFileSync("node", [describeBundlePath]).toString());
  } finally {
    rmSync(describeBundlePath);
  }
};

const composeRunToolCommand = (
  command: PluginDescription["commands"][number],
  argumentsPlaceholder: string
) =>
  [
    "---",
    `description: ${JSON.stringify(command.description)}`,
    ...(command.argumentHint
      ? [`argument-hint: ${JSON.stringify(command.argumentHint)}`]
      : []),
    "---",
    "",
    `Call the \`${command.toolName}\` tool once, with \`args\` set to the exact text inside the <arguments> tags below, or an empty string when there is none. Then do what the tool's reply says: show its text to the user, and carry out any instructions it gives.`,
    "",
    "<arguments>",
    argumentsPlaceholder,
    "</arguments>",
    "",
  ].join("\n");

const stageCommands = (
  pluginFolder: string,
  stagedFolder: string,
  description: PluginDescription,
  target: Target
) => {
  const portableFolder = join(pluginFolder, PORTABLE_COMMAND_FOLDER);
  const portableFileNames = existsSync(portableFolder)
    ? readdirSync(portableFolder).filter((fileName) => fileName.endsWith(".md"))
    : [];
  const portableTexts = portableFileNames.map((fileName) =>
    readFileSync(join(portableFolder, fileName), "utf8")
  );
  const generatedCommands = description.commands.filter(
    (command) => !portableFileNames.includes(`${command.name}.md`)
  );
  rmSync(join(stagedFolder, PORTABLE_COMMAND_FOLDER), {
    recursive: true,
    force: true,
  });
  if (portableFileNames.length + generatedCommands.length === 0) {
    return { portableTexts, generatedCommands };
  }

  const commandFolder = join(stagedFolder, target.commandFolder);
  mkdirSync(commandFolder, { recursive: true });
  portableFileNames.forEach((fileName, fileIndex) =>
    writeFileSync(
      join(commandFolder, fileName),
      portableTexts[fileIndex]!.replaceAll(
        PORTABLE_ARGUMENTS_PLACEHOLDER,
        target.argumentsPlaceholder
      )
    )
  );
  for (const command of generatedCommands) {
    writeFileSync(
      join(commandFolder, `${command.name}.md`),
      composeRunToolCommand(command, target.argumentsPlaceholder)
    );
  }
  return { portableTexts, generatedCommands };
};

const findTarget = (targetName: string) => {
  const target = TARGETS[targetName as TargetName];
  if (!target) throw new Error(`Unknown target ${targetName}: use qwen, pi or opencode.`);
  return target;
};

const mentionsPluginTools = (portableTexts: string[], pluginName: string) =>
  portableTexts.some((portableText) =>
    portableText.includes(`mcp__${pluginName}__`)
  );

const stagePlugin = async (
  targetName: string,
  pluginFolder: string,
  stagedFolder: string
) => {
  const target = findTarget(targetName);
  const { name: pluginName, version: pluginVersion } = readJson(
    join(pluginFolder, ".claude-plugin", "plugin.json")
  );
  const hooksFile: HooksFile = readJson(
    join(pluginFolder, "hooks", "hooks.json")
  );
  const [hooksModule] = hooksFile.modules ?? [];
  const hooksModulePath = hooksModule
    ? resolve(pluginFolder, "hooks", hooksModule)
    : undefined;
  const hasCommandHooks =
    target.hostsCommandHooks && hooksFile.hooks !== undefined;

  const description: PluginDescription = hooksModulePath
    ? await describeStagedPlugin(pluginName, hooksModulePath, stagedFolder)
    : { name: pluginName, toolNames: [], commands: [] };
  const { portableTexts, generatedCommands } = stageCommands(
    pluginFolder,
    stagedFolder,
    description,
    target
  );
  const hasBundle =
    hooksModulePath !== undefined &&
    (description.toolNames.length > description.commands.length ||
      generatedCommands.length > 0 ||
      mentionsPluginTools(portableTexts, pluginName));

  if (hooksModulePath !== undefined && hasBundle) {
    await bundlePlugin(
      pluginName,
      hooksModulePath,
      stagedFolder,
      target.bundleName,
      target.starterName,
      target.startStatement
    );
  }
  if (hasCommandHooks) {
    await bundleHookExtension(pluginName, stagedFolder);
  } else {
    rmSync(join(stagedFolder, "hooks", "hooks.json"), { force: true });
  }
  target.writeManifest({
    pluginName,
    pluginVersion,
    stagedFolder,
    hasBundle,
    hasHookBundle: hasCommandHooks,
    target,
  });
};

const [targetName = "", pluginFolder = "", stagedFolder = ""] =
  process.argv.slice(2);
await stagePlugin(targetName, resolve(pluginFolder), resolve(stagedFolder));
