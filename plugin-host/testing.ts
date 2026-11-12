import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { Outcome } from "./engine";

export const TARGET_NAMES = ["qwen", "pi"] as const;
export type TargetName = (typeof TARGET_NAMES)[number];

export type InstallOptions = {
  fakeCommands?: Record<string, string>;
  workingDirectory?: string;
};

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const STORE_FOLDER = "claude-kit-store";
const LOG_INVOCATION = `printf '%s\\n' "$(basename "$0") $*" >> "$FAKE_COMMAND_LOG"`;
const COPY_INSTALLED_EXTENSION = `if [ "$1 $2" = "extensions install" ]; then mkdir -p "$QWEN_HOME/extensions" && cp -R "$3" "$QWEN_HOME/extensions/$(basename "$3")"; fi`;
const BUILT_IN_FAKE_COMMANDS: Record<string, string> = {
  qwen: COPY_INSTALLED_EXTENSION,
  pi: "exit 0",
  open: LOG_INVOCATION,
  "xdg-open": LOG_INVOCATION,
};

const runFile = promisify(execFile);

const writeFakeCommands = async (
  binFolder: string,
  fakeCommands: Record<string, string>
) => {
  await mkdir(binFolder, { recursive: true });
  for (const [commandName, scriptBody] of Object.entries(fakeCommands)) {
    const scriptPath = join(binFolder, commandName);
    await writeFile(scriptPath, `#!/usr/bin/env bash\n${scriptBody}\n`);
    await chmod(scriptPath, 0o755);
  }
};

export const installPlugin = async (
  target: TargetName,
  pluginName: string,
  { fakeCommands = {}, workingDirectory }: InstallOptions = {}
) => {
  const sandboxFolder = await mkdtemp(join(tmpdir(), `plugin-host-${target}-`));
  const binFolder = join(sandboxFolder, "bin");
  const targetHome = join(sandboxFolder, "home");
  const projectFolder = workingDirectory ?? join(sandboxFolder, "project");
  const commandLogPath = join(sandboxFolder, "commands.log");
  await mkdir(projectFolder, { recursive: true });
  await mkdir(targetHome, { recursive: true });
  await writeFile(commandLogPath, "");
  await writeFakeCommands(binFolder, {
    ...BUILT_IN_FAKE_COMMANDS,
    ...fakeCommands,
  });

  const environment = {
    ...process.env,
    PATH: `${binFolder}:${process.env.PATH}`,
    QWEN_HOME: targetHome,
    PI_CODING_AGENT_DIR: targetHome,
    FAKE_COMMAND_LOG: commandLogPath,
  };
  await runFile(join(REPOSITORY_ROOT, `sync-${target}`), [pluginName], {
    env: environment,
  });

  return {
    target,
    pluginName,
    environment,
    workingDirectory: projectFolder,
    installedFolder: join(
      targetHome,
      target === "qwen" ? "extensions" : "claude-kit",
      pluginName
    ),
    storePath: join(targetHome, STORE_FOLDER, `${pluginName}.json`),
    readCommandLog: async () =>
      (await readFile(commandLogPath, "utf8")).split("\n").filter(Boolean),
  };
};

type InstalledPlugin = Awaited<ReturnType<typeof installPlugin>>;

type ToolClient = {
  listToolNames: () => Promise<string[]>;
  callTool: (
    toolName: string,
    toolArguments?: Record<string, unknown>
  ) => Promise<Outcome>;
  stop: () => Promise<void>;
};

const startMcpClient = async (installed: InstalledPlugin): Promise<ToolClient> => {
  const server = spawn(
    "node",
    [join(installed.installedFolder, "plugin-host-server.mjs")],
    {
      cwd: installed.workingDirectory,
      env: installed.environment,
      stdio: ["pipe", "pipe", "inherit"],
    }
  );
  const responseLines = createInterface({ input: server.stdout })[
    Symbol.asyncIterator
  ]();
  let latestRequestId = 0;
  const request = async (method: string, params?: Record<string, unknown>) => {
    latestRequestId += 1;
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: latestRequestId, method, params })}\n`
    );
    const { value: responseLine } = await responseLines.next();
    return JSON.parse(responseLine).result;
  };
  await request("initialize", { protocolVersion: "2025-06-18" });

  return {
    listToolNames: async () =>
      (await request("tools/list")).tools.map(
        (tool: { name: string }) => tool.name
      ),
    callTool: async (toolName, toolArguments = {}) => {
      const { content, isError } = await request("tools/call", {
        name: toolName,
        arguments: toolArguments,
      });
      return { text: content[0].text, isError };
    },
    stop: async () => {
      server.kill();
    },
  };
};

type RegisteredPiTool = {
  name: string;
  execute: (
    toolCallId: string,
    toolArguments: Record<string, unknown>
  ) => Promise<{ content: { text: string }[] }>;
};

const startPiClient = async (installed: InstalledPlugin): Promise<ToolClient> => {
  const earlierEnvironment = { ...process.env };
  const earlierWorkingDirectory = process.cwd();
  Object.assign(process.env, installed.environment);
  process.chdir(installed.workingDirectory);

  const registeredTools: RegisteredPiTool[] = [];
  const extensionPath = join(
    installed.installedFolder,
    "plugin-host-extension.js"
  );
  const { default: loadExtension } = await import(extensionPath);
  await loadExtension({
    registerTool: (tool: RegisteredPiTool) => registeredTools.push(tool),
  });
  const qualifiedPrefix = `mcp__${installed.pluginName}__`;

  return {
    listToolNames: async () =>
      registeredTools.map((tool) => tool.name.slice(qualifiedPrefix.length)),
    callTool: async (toolName, toolArguments = {}) => {
      const tool = registeredTools.find(
        (candidate) => candidate.name === `${qualifiedPrefix}${toolName}`
      );
      if (!tool) return { text: `No tool ${toolName}.`, isError: true };
      try {
        const { content } = await tool.execute("test-call", toolArguments);
        return { text: content[0]!.text, isError: false };
      } catch (error) {
        return { text: (error as Error).message, isError: true };
      }
    },
    stop: async () => {
      process.chdir(earlierWorkingDirectory);
      for (const variableName of Object.keys(process.env)) {
        if (!(variableName in earlierEnvironment)) {
          delete process.env[variableName];
        }
      }
      Object.assign(process.env, earlierEnvironment);
    },
  };
};

export const startPlugin = async (
  target: TargetName,
  pluginName: string,
  installOptions: InstallOptions = {}
) => {
  const installed = await installPlugin(target, pluginName, installOptions);
  const client =
    target === "qwen"
      ? await startMcpClient(installed)
      : await startPiClient(installed);
  return { ...installed, ...client };
};
