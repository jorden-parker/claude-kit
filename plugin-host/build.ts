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

type TargetName = "qwen" | "pi";

type Target = {
  bundleName: string;
  starterName: string;
  startStatement: string;
  commandFolder: string;
  argumentsPlaceholder: string;
  writeManifest: (staged: StagedPlugin) => void;
};

type StagedPlugin = {
  pluginName: string;
  pluginVersion: string;
  stagedFolder: string;
  hasBundle: boolean;
  target: Target;
};

const HOST_FOLDER = import.meta.dirname;
const PORTABLE_COMMAND_FOLDER = "portable-commands";
const PORTABLE_ARGUMENTS_PLACEHOLDER = "{{args}}";
const ENTRY_NAME = "plugin-host-entry.ts";
const DESCRIBE_BUNDLE_NAME = "plugin-host-describe.mjs";

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
    writeManifest: ({
      pluginName,
      pluginVersion,
      stagedFolder,
      hasBundle,
      target,
    }) => {
      const [skillFolder] = listExistingFolders(stagedFolder, ["skills"]);
      const [promptFolder] = listExistingFolders(stagedFolder, [
        target.commandFolder,
      ]);
      writeJson(join(stagedFolder, "package.json"), {
        name: `claude-kit-${pluginName}`,
        version: pluginVersion,
        keywords: ["pi-package"],
        pi: {
          ...(hasBundle ? { extensions: [`./${target.bundleName}`] } : {}),
          ...(skillFolder ? { skills: [`./${skillFolder}`] } : {}),
          ...(promptFolder ? { prompts: [`./${promptFolder}`] } : {}),
        },
      });
    },
  },
};

const bundlePlugin = async (
  pluginName: string,
  hooksModulePath: string,
  stagedFolder: string,
  bundleName: string,
  starterName: string,
  startStatement: string
) => {
  const entryPath = join(stagedFolder, ENTRY_NAME);
  writeFileSync(
    entryPath,
    [
      `import { dirname } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { register } from ${JSON.stringify(hooksModulePath)};`,
      `import { ${starterName} } from ${JSON.stringify(join(HOST_FOLDER, "targets.ts"))};`,
      `const plugin = { pluginName: ${JSON.stringify(pluginName)}, pluginRoot: dirname(fileURLToPath(import.meta.url)), register };`,
      startStatement,
      "",
    ].join("\n")
  );
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
  if (!target) throw new Error(`Unknown target ${targetName}: use qwen or pi.`);
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
  const hooksFilePath = join(pluginFolder, "hooks", "hooks.json");
  const [hooksModule] = readJson(hooksFilePath).modules;
  const hooksModulePath = resolve(pluginFolder, "hooks", hooksModule);

  const description = await describeStagedPlugin(
    pluginName,
    hooksModulePath,
    stagedFolder
  );
  const { portableTexts, generatedCommands } = stageCommands(
    pluginFolder,
    stagedFolder,
    description,
    target
  );
  const hasBundle =
    description.toolNames.length > description.commands.length ||
    generatedCommands.length > 0 ||
    mentionsPluginTools(portableTexts, pluginName);

  if (hasBundle) {
    await bundlePlugin(
      pluginName,
      hooksModulePath,
      stagedFolder,
      target.bundleName,
      target.starterName,
      target.startStatement
    );
  }
  rmSync(join(stagedFolder, "hooks", "hooks.json"), { force: true });
  target.writeManifest({
    pluginName,
    pluginVersion,
    stagedFolder,
    hasBundle,
    target,
  });
};

const [targetName = "", pluginFolder = "", stagedFolder = ""] =
  process.argv.slice(2);
await stagePlugin(targetName, resolve(pluginFolder), resolve(stagedFolder));
