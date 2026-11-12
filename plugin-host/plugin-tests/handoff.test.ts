import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installPlugin, startPlugin, TARGET_NAMES, type TargetName } from "../testing";

const COMMAND_PATH_BY_TARGET: Record<TargetName, string> = {
  qwen: join("commands", "handoff.md"),
  pi: join("prompts", "handoff.md"),
};

const ARGUMENTS_PLACEHOLDER_BY_TARGET: Record<TargetName, string> = {
  qwen: "{{args}}",
  pi: "$ARGUMENTS",
};

const readStoredHandoffs = async (storePath: string) =>
  JSON.parse(await readFile(storePath, "utf8")).handoffs;

for (const target of TARGET_NAMES) {
  test(`${target}: the handoff bundle is installed and run_handoff is listed`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      expect(await plugin.listToolNames()).toContain("run_handoff");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: the installed command calls run_handoff with its arguments placeholder`, async () => {
    const { installedFolder } = await installPlugin(target, "handoff");
    const commandText = await readFile(
      join(installedFolder, COMMAND_PATH_BY_TARGET[target]),
      "utf8"
    );
    expect(commandText).toContain("`mcp__handoff__run_handoff`");
    expect(commandText).toContain(ARGUMENTS_PLACEHOLDER_BY_TARGET[target]);
  });

  test(`${target}: a recap with the model reply is stored and returned to show`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "",
        modelReply: "Goal: ship the parser",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Goal: ship the parser");
      expect(await readStoredHandoffs(plugin.storePath)).toMatchObject([
        { handoffId: 1, recap: "Goal: ship the parser" },
      ]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: --save stores the handoff with its focus and does not return it`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "--save parser",
        modelReply: "Goal: save only",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Saved as handoff #1");
      expect(outcome.text).not.toContain("Goal: save only");
      expect(await readStoredHandoffs(plugin.storePath)).toMatchObject([
        { handoffId: 1, focus: "parser", recap: "Goal: save only" },
      ]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: --new is sent as --save, so the handoff survives and the reply says how to resume`, async () => {
    const { installedFolder } = await installPlugin(target, "handoff");
    const commandText = await readFile(
      join(installedFolder, COMMAND_PATH_BY_TARGET[target]),
      "utf8"
    );
    expect(commandText).toContain("`--new` is replaced by `--save`");
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "--save",
        modelReply: "Goal: continue later",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Run /handoff --resume 1 to continue it in a new session.");
      expect(await readStoredHandoffs(plugin.storePath)).toMatchObject([
        { handoffId: 1, recap: "Goal: continue later" },
      ]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: --each stores one handoff per plan split by the separator`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "--each",
        modelReply:
          "Parser plan\nGoal: faster parsing\n---handoff---\nDocs plan\nGoal: fix the README",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Saved 2 handoffs, one per suggested plan:");
      expect(await readStoredHandoffs(plugin.storePath)).toMatchObject([
        { handoffId: 1, recap: "Parser plan\nGoal: faster parsing" },
        { handoffId: 2, recap: "Docs plan\nGoal: fix the README" },
      ]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: --list shows the stored handoffs`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      await plugin.callTool("run_handoff", { args: "--save", modelReply: "Goal: listed" });
      const outcome = await plugin.callTool("run_handoff", { args: "--list" });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("#1");
      expect(outcome.text).toContain("Goal: listed");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: --resume <id> returns the stored recap to continue with`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      await plugin.callTool("run_handoff", { args: "--save", modelReply: "Goal: resume me" });
      const outcome = await plugin.callTool("run_handoff", { args: "--resume 1" });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Goal: resume me");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: --resume with an unknown id says no handoff has that id`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", { args: "--resume 99" });
      expect(outcome.text).toContain("No handoff #99");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: a recap call without a modelReply stores nothing and says why`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", { args: "" });
      expect(outcome.text).toContain("no model reply was passed");
      expect(existsSync(plugin.storePath)).toBe(false);
    } finally {
      await plugin.stop();
    }
  });
}
