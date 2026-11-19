import { beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlugin, startPlugin, TARGET_NAMES, type TargetName } from "../testing";

const COMMAND_PATH_BY_TARGET: Record<TargetName, string> = {
  qwen: join("commands", "handoff.md"),
  pi: join("prompts", "handoff.md"),
  opencode: join("commands", "handoff.md"),
};

const ARGUMENTS_PLACEHOLDER_BY_TARGET: Record<TargetName, string> = {
  qwen: "{{args}}",
  pi: "$ARGUMENTS",
  opencode: "$ARGUMENTS",
};

const RUN_TOOL_NAME_BY_TARGET: Record<TargetName, string> = {
  qwen: "mcp__handoff__run_handoff",
  pi: "mcp__handoff__run_handoff",
  opencode: "handoff_run_handoff",
};

let handoffsRoot = "";

beforeEach(async () => {
  handoffsRoot = await mkdtemp(join(tmpdir(), "handoffs-"));
  process.env.HANDOFFS_DIR = handoffsRoot;
});

const readSavedHandoffs = async () => {
  const [projectName] = await readdir(handoffsRoot);
  if (!projectName) return [];
  const projectFolder = join(handoffsRoot, projectName);
  return Promise.all(
    (await readdir(projectFolder))
      .sort()
      .map((fileName) => readFile(join(projectFolder, fileName), "utf8"))
  );
};

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
    expect(commandText).toContain(`\`${RUN_TOOL_NAME_BY_TARGET[target]}\``);
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
      const [savedHandoff] = await readSavedHandoffs();
      expect(savedHandoff).toContain("title: Goal: ship the parser");
      expect(savedHandoff).toEndWith("\n\nGoal: ship the parser\n");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: save stores the handoff with its focus and does not return it`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "save parser",
        modelReply: "Goal: save only",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Saved as handoff #1");
      expect(outcome.text).not.toContain("Goal: save only");
      const [savedHandoff] = await readSavedHandoffs();
      expect(savedHandoff).toContain("focus: parser");
      expect(savedHandoff).toEndWith("\n\nGoal: save only\n");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: new is sent as save, so the handoff survives and the reply says how to resume`, async () => {
    const { installedFolder } = await installPlugin(target, "handoff");
    const commandText = await readFile(
      join(installedFolder, COMMAND_PATH_BY_TARGET[target]),
      "utf8"
    );
    expect(commandText).toContain("a first word of `new` is replaced by `save`");
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "save",
        modelReply: "Goal: continue later",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Run /handoff resume 1 to continue it in a new session.");
      expect((await readSavedHandoffs())[0]).toEndWith(
        "\n\nGoal: continue later\n"
      );
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: each stores one handoff per plan split by the separator`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", {
        args: "each",
        modelReply:
          "Parser plan\nGoal: faster parsing\n---handoff---\nDocs plan\nGoal: fix the README",
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Saved 2 handoffs, one per suggested plan:");
      const savedHandoffs = await readSavedHandoffs();
      expect(savedHandoffs).toHaveLength(2);
      expect(savedHandoffs[0]).toEndWith("\n\nParser plan\nGoal: faster parsing\n");
      expect(savedHandoffs[1]).toEndWith("\n\nDocs plan\nGoal: fix the README\n");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: list shows the stored handoffs`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      await plugin.callTool("run_handoff", { args: "save", modelReply: "Goal: listed" });
      const outcome = await plugin.callTool("run_handoff", { args: "list" });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("#1");
      expect(outcome.text).toContain("Goal: listed");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: resume <id> returns the stored recap to continue with`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      await plugin.callTool("run_handoff", { args: "save", modelReply: "Goal: resume me" });
      const outcome = await plugin.callTool("run_handoff", { args: "resume 1" });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Goal: resume me");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: resume without an id returns the latest saved recap`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      await plugin.callTool("run_handoff", { args: "save", modelReply: "Goal: older" });
      await plugin.callTool("run_handoff", { args: "save", modelReply: "Goal: latest" });
      const outcome = await plugin.callTool("run_handoff", { args: "resume" });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Goal: latest");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: resume with an unknown id says no handoff has that id`, async () => {
    const plugin = await startPlugin(target, "handoff");
    try {
      const outcome = await plugin.callTool("run_handoff", { args: "resume 99" });
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
      expect(await readSavedHandoffs()).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });
}
