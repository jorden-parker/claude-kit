import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installPlugin, startPlugin, TARGET_NAMES } from "./testing";

const BRAINSTORM_TOOL_NAMES = [
  "render_brainstorm",
  "check_brainstorm_plan",
  "set_brainstorm_plan_status",
  "run_brainstorm",
];

for (const target of TARGET_NAMES) {
  test(`${target}: a plugin with tools is installed with its tools and run tools`, async () => {
    const plugin = await startPlugin(target, "brainstorm");
    try {
      expect(await plugin.listToolNames()).toEqual(BRAINSTORM_TOOL_NAMES);
      expect(await plugin.callTool("check_brainstorm_plan", { path: "none" }))
        .toMatchObject({ isError: false });
      expect(existsSync(join(plugin.installedFolder, "plugin-host-entry.ts")))
        .toBe(false);
      expect(existsSync(join(plugin.installedFolder, "portable-commands")))
        .toBe(false);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: a plugin whose commands are all hand-written prompts gets no bundle`, async () => {
    const { installedFolder } = await installPlugin(target, "prompt-optimizer");
    expect(
      ["plugin-host-server.mjs", "plugin-host-extension.js", ".mcp.json"].filter(
        (fileName) => existsSync(join(installedFolder, fileName))
      )
    ).toEqual([]);
  });
}

test("qwen: the MCP server is declared in .mcp.json and commands call the run tool with {{args}}", async () => {
  const { installedFolder } = await installPlugin("qwen", "brainstorm");
  expect(
    JSON.parse(await readFile(join(installedFolder, ".mcp.json"), "utf8"))
  ).toEqual({
    mcpServers: {
      brainstorm: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/plugin-host-server.mjs"],
      },
    },
  });
  const commandText = await readFile(
    join(installedFolder, "commands", "brainstorm.md"),
    "utf8"
  );
  expect(commandText).toStartWith('---\ndescription: "Brainstorm ideas');
  expect(commandText).toContain(
    'argument-hint: "[focus] | plan <picks> | build [runs]"'
  );
  expect(commandText).toContain("`mcp__brainstorm__run_brainstorm`");
  expect(commandText).toContain("<arguments>\n{{args}}\n</arguments>");
  expect(existsSync(join(installedFolder, "hooks", "hooks.json"))).toBe(false);
});

test("pi: the package manifest names the extension, skills and prompts, and prompts use $ARGUMENTS", async () => {
  const { installedFolder } = await installPlugin("pi", "brainstorm");
  expect(
    JSON.parse(await readFile(join(installedFolder, "package.json"), "utf8"))
  ).toEqual({
    name: "claude-kit-brainstorm",
    version: expect.any(String),
    keywords: ["pi-package"],
    pi: {
      extensions: ["./plugin-host-extension.js"],
      skills: ["./skills"],
      prompts: ["./prompts"],
    },
  });
  const promptText = await readFile(
    join(installedFolder, "prompts", "brainstorm.md"),
    "utf8"
  );
  expect(promptText).toContain("`mcp__brainstorm__run_brainstorm`");
  expect(promptText).toContain("<arguments>\n$ARGUMENTS\n</arguments>");
});

test("pi: a hand-written portable command becomes a prompt with pi's placeholder", async () => {
  const { installedFolder } = await installPlugin("pi", "prompt-optimizer");
  const promptText = await readFile(
    join(installedFolder, "prompts", "optimize.md"),
    "utf8"
  );
  expect(promptText).toContain("<draft>\n$ARGUMENTS\n</draft>");
  expect(
    JSON.parse(await readFile(join(installedFolder, "package.json"), "utf8")).pi
  ).toEqual({ prompts: ["./prompts"] });
});

const readOpenCodeConfig = async (targetHome: string) =>
  JSON.parse(await readFile(join(targetHome, "opencode.json"), "utf8"));

test("opencode: the MCP server is declared under mcp.servers in opencode.json", async () => {
  const { targetHome, installedFolder } = await installPlugin("opencode", "brainstorm");
  expect((await readOpenCodeConfig(targetHome)).mcp.servers.brainstorm).toEqual({
    type: "local",
    command: ["node", join(installedFolder, "plugin-host-server.mjs")],
  });
});

test("opencode 1.x: the MCP server is declared directly under mcp", async () => {
  const { targetHome, installedFolder } = await installPlugin("opencode", "brainstorm", {
    fakeCommands: { opencode: `[ "$1" = "--version" ] && echo 1.18.35; exit 0` },
  });
  expect((await readOpenCodeConfig(targetHome)).mcp.brainstorm).toEqual({
    type: "local",
    command: ["node", join(installedFolder, "plugin-host-server.mjs")],
    enabled: true,
  });
});

test("opencode: commands land in the config's commands folder and call tools by OpenCode's names", async () => {
  const { targetHome } = await installPlugin("opencode", "brainstorm");
  const commandText = await readFile(
    join(targetHome, "commands", "brainstorm.md"),
    "utf8"
  );
  expect(commandText).toContain("`brainstorm_run_brainstorm`");
  expect(commandText).not.toContain("mcp__");
  expect(commandText).toContain("<arguments>\n$ARGUMENTS\n</arguments>");
});

test("opencode: skills are copied whole and name tools by OpenCode's names", async () => {
  const { targetHome } = await installPlugin("opencode", "brainstorm");
  const skillText = await readFile(
    join(targetHome, "skills", "build-plans", "SKILL.md"),
    "utf8"
  );
  expect(skillText).not.toContain("mcp__brainstorm__");
});

test("opencode: agents become subagents without Claude-only model names and keep their tool limits", async () => {
  const { targetHome } = await installPlugin("opencode", "brainstorm");
  const agentText = await readFile(
    join(targetHome, "agents", "step-reader.md"),
    "utf8"
  );
  const frontmatter = agentText.split("---")[1]!;
  expect(frontmatter).toContain("mode: subagent");
  expect(frontmatter).toContain("description: ");
  expect(frontmatter).not.toMatch(/^(name|model|tools):/m);
  expect(frontmatter).toContain("permission:\n  edit: deny\n  bash: deny\n");
});

const readCrushFile = (targetHome: string, ...pathParts: string[]) =>
  readFile(join(targetHome, ...pathParts), "utf8");

const runCrushHook = async (
  installedFolder: string,
  workingDirectory: string,
  toolCall: Record<string, unknown>
) => {
  const hook = Bun.spawn(["node", join(installedFolder, "crush-hooks.mjs")], {
    cwd: workingDirectory,
    stdin: new Blob([
      JSON.stringify({
        event: "PreToolUse",
        session_id: "crush-session",
        cwd: workingDirectory,
        ...toolCall,
      }),
    ]),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: await hook.exited,
    stdout: await new Response(hook.stdout).text(),
    stderr: await new Response(hook.stderr).text(),
  };
};

test("crush: the MCP server is declared in a crushrc fragment that the user's crushrc sources", async () => {
  const { targetHome, installedFolder } = await installPlugin("crush", "brainstorm");
  const fragmentPath = join(targetHome, "claude-kit", "brainstorm.crushrc");
  const generatedPath = join(targetHome, "claude-kit", "crushrc");
  expect(await readFile(fragmentPath, "utf8")).toBe(
    `mcp add brainstorm --command node --args '${join(installedFolder, "plugin-host-server.mjs")}'\n`
  );
  expect(await readFile(generatedPath, "utf8")).toBe(`source '${fragmentPath}'\n`);
  expect(await readCrushFile(targetHome, "crushrc")).toBe(
    `if [ -f '${generatedPath}' ]; then source '${generatedPath}'; fi\n`
  );
});

test("crush: commands and skills are copied and call tools by Crush's names, and agents are left out", async () => {
  const { targetHome } = await installPlugin("crush", "brainstorm");
  const commandText = await readCrushFile(targetHome, "commands", "brainstorm.md");
  expect(commandText).toContain("`mcp_brainstorm_run_brainstorm`");
  expect(commandText).not.toContain("mcp__");
  expect(commandText).toContain("<arguments>\n$ARGUMENTS\n</arguments>");
  expect(
    await readCrushFile(targetHome, "skills", "build-plans", "SKILL.md")
  ).not.toContain("mcp__brainstorm__");
  expect(existsSync(join(targetHome, "agents"))).toBe(false);
});

test("crush: the hooks of portable-hooks/crush.json run before the tools they match", async () => {
  const { targetHome, installedFolder, workingDirectory } = await installPlugin(
    "crush",
    "guards"
  );
  expect(await readCrushFile(targetHome, "claude-kit", "guards.crushrc")).toBe(
    `hook add PreToolUse --matcher '^(bash|view)$' --command 'node "${join(installedFolder, "crush-hooks.mjs")}"' --name claude-kit-guards --timeout 605\n`
  );

  const denied = await runCrushHook(installedFolder, workingDirectory, {
    tool_name: "bash",
    tool_input: { command: "git log" },
  });
  expect(denied.exitCode).toBe(2);
  expect(denied.stderr).toContain("git log");

  const allowed = await runCrushHook(installedFolder, workingDirectory, {
    tool_name: "bash",
    tool_input: { command: "git status --short" },
  });
  expect(allowed).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("crush: a hook's advice reaches the model as context, and multiedit counts as an edit", async () => {
  const { installedFolder, workingDirectory } = await installPlugin("crush", "tdd");
  await Bun.write(join(workingDirectory, "package.json"), '{"scripts":{"test":"true"}}');
  await Bun.write(join(workingDirectory, "source.ts"), "export const one = 1;\n");

  const advised = await runCrushHook(installedFolder, workingDirectory, {
    tool_name: "multiedit",
    tool_input: {
      file_path: join(workingDirectory, "source.ts"),
      edits: [{ old_string: "1", new_string: "2" }],
    },
  });

  expect(advised.exitCode).toBe(0);
  expect(JSON.parse(advised.stdout).context.join("\n")).toContain("TDD reminder");
});

test("crush: rules and output styles are added as context files without frontmatter", async () => {
  const rules = await installPlugin("crush", "tdd");
  expect(await readCrushFile(rules.targetHome, "claude-kit", "tdd.crushrc")).toContain(
    `option context-path '${join(rules.installedFolder, "context", "tdd.md")}'\n`
  );

  const style = await installPlugin("crush", "adhd-style");
  expect(
    await readCrushFile(style.targetHome, "claude-kit", "adhd-style.crushrc")
  ).toBe(
    `option context-path '${join(style.installedFolder, "output-styles", "adhd.md")}'\n`
  );
  expect(
    await readFile(join(style.installedFolder, "output-styles", "adhd.md"), "utf8")
  ).not.toStartWith("---");
});

test("crush: syncing again keeps one source line and the user's own crushrc lines", async () => {
  const { targetHome, environment } = await installPlugin("crush", "brainstorm");
  const userConfigPath = join(targetHome, "crushrc");
  await Bun.write(
    userConfigPath,
    `option metrics false\n${await readFile(userConfigPath, "utf8")}`
  );

  await Bun.spawn([join(import.meta.dirname, "..", "sync-crush"), "handoff"], {
    env: environment,
    stdout: "ignore",
  }).exited;

  const generatedPath = join(targetHome, "claude-kit", "crushrc");
  expect(await readFile(userConfigPath, "utf8")).toBe(
    `option metrics false\nif [ -f '${generatedPath}' ]; then source '${generatedPath}'; fi\n`
  );
  expect(await readCrushFile(targetHome, "claude-kit", "crushrc")).toBe(
    ["brainstorm", "handoff"]
      .map((pluginName) => `source '${join(targetHome, "claude-kit", `${pluginName}.crushrc`)}'\n`)
      .join("")
  );
});
