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
