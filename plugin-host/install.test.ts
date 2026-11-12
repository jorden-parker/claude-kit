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
