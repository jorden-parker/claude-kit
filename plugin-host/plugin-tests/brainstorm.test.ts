import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlugin, TARGET_NAMES } from "../testing";

const BRAINSTORM_FOLDER = join(".claude", "brainstorm");
const PLANS_FOLDER = join(BRAINSTORM_FOLDER, "plans");
const RUN_FOLDER_NAME = "plan-2026-11-09-1200";
const PLAN_FOLDER_NAME = "01-replay";

const SAMPLE_BRAINSTORM = {
  project: "acme-cli",
  summary: "A CLI that syncs notes to the cloud.",
  ideas: [
    {
      title: "Replay mode for bug reports",
      category: "creative",
      priority: "later",
      effort: "large",
      why: "Users could attach a replayable session instead of a screenshot.",
      nextStep: "Sketch the event log format in a spike branch.",
    },
    {
      title: "Stop logging the API token",
      category: "security",
      priority: "now",
      effort: "small",
      why: "auth.ts prints the bearer token on every request.",
      nextStep: "Delete the console.log in auth.ts line 42.",
      files: ["src/auth.ts"],
    },
  ],
};

const CLEAN_INDEX = [
  "# Plans: Replay mode",
  "",
  "- Ideas: #2 Replay mode for bug reports",
  "- Written against: abc1234 on main",
  "",
  "## Plans",
  "",
  "| Order | Plan | Status | Kind | Depends on | Ideas |",
  "| ----- | ---- | ------ | ---- | ---------- | ----- |",
  "| 1 | [Add the replay test](01-replay/plan.md) | pending | change | none | #2 |",
  "",
  "## Dropped",
  "",
  "None.",
].join("\n");

const CLEAN_PLAN = [
  "# Plan: Add the replay test",
  "",
  "- Status: pending",
  "- Ideas: #2 Replay mode for bug reports",
  "- Kind: change",
  "- Depends on: none",
  "",
  "## Goal",
  "",
  "Bug reports can carry a replay.",
  "",
  "## Context",
  "",
  "- TypeScript. Test command: `pnpm test`.",
  "",
  "## Steps",
  "",
  "- [ ] [step-01](step-01.md): Add the replay test",
  "",
  "## Done criteria",
  "",
  "- `pnpm test`: expect exit 0",
  "",
  "## Out of scope",
  "",
  "Everything else.",
].join("\n");

const CLEAN_STEP = [
  "# Step 01: Add the replay test",
  "",
  "- Plan: 01-replay",
  "- Kind: test",
  "- Depends on: none",
  "",
  "## Context",
  "",
  "- TypeScript. Test command: `pnpm test`.",
  "",
  "## Edits",
  "",
  "### Edit 1",
  "",
  "- File: `src/replay.test.ts`",
  "- Action: create",
  "",
  "Contents:",
  "",
  "```ts",
  "export {};",
  "```",
  "",
  "## Check",
  "",
  "- Run: `pnpm test src/replay.test.ts`",
  "- Expect: exit non-zero, output contains `replay`",
].join("\n");

const writeRunFolder = async (projectFolder: string) => {
  const runFolder = join(projectFolder, PLANS_FOLDER, RUN_FOLDER_NAME);
  await mkdir(join(runFolder, PLAN_FOLDER_NAME), { recursive: true });
  await writeFile(join(runFolder, "index.md"), CLEAN_INDEX);
  await writeFile(join(runFolder, PLAN_FOLDER_NAME, "plan.md"), CLEAN_PLAN);
  await writeFile(join(runFolder, PLAN_FOLDER_NAME, "step-01.md"), CLEAN_STEP);
  return runFolder;
};

const withPlugin = async (
  target: (typeof TARGET_NAMES)[number],
  runTest: (plugin: Awaited<ReturnType<typeof startPlugin>>, projectFolder: string) => Promise<void>
) => {
  const projectFolder = await realpath(
    await mkdtemp(join(tmpdir(), "brainstorm-project-"))
  );
  const plugin = await startPlugin(target, "brainstorm", {
    workingDirectory: projectFolder,
  });
  try {
    await runTest(plugin, projectFolder);
  } finally {
    await plugin.stop();
    await rm(projectFolder, { recursive: true, force: true });
  }
};

const listBrainstormFiles = async (projectFolder: string) =>
  (await readdir(join(projectFolder, BRAINSTORM_FOLDER))).sort();

const renderSample = (
  plugin: Awaited<ReturnType<typeof startPlugin>>
) => plugin.callTool("render_brainstorm", SAMPLE_BRAINSTORM);

for (const target of TARGET_NAMES) {
  test(`${target}: render_brainstorm saves the page, its data and a gitignore, then opens the page`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const outcome = await renderSample(plugin);

      expect(outcome.isError).toBe(false);
      const files = await listBrainstormFiles(projectFolder);
      const stampedNames = files.filter((name) => name !== ".gitignore");
      expect(stampedNames).toHaveLength(2);
      const pageName = stampedNames.find((name) => name.endsWith(".html"));
      const dataName = stampedNames.find((name) => name.endsWith(".json"));
      expect(pageName).toMatch(/^brainstorm-\d{4}-\d{2}-\d{2}-\d{4}\.html$/);
      expect(dataName).toBe(pageName!.replace(/\.html$/, ".json"));
      expect(await readFile(join(projectFolder, BRAINSTORM_FOLDER, ".gitignore"), "utf8")).toBe("*\n");

      const pagePath = join(projectFolder, BRAINSTORM_FOLDER, pageName!);
      expect(outcome.text).toBe(`Opened ${pagePath} in the browser.`);
      expect(await readFile(pagePath, "utf8")).toStartWith("<!doctype html>");
      const savedBrainstorm = JSON.parse(
        await readFile(join(projectFolder, BRAINSTORM_FOLDER, dataName!), "utf8")
      );
      expect(savedBrainstorm.project).toBe("acme-cli");
      expect(savedBrainstorm.ideas.map((idea: { title: string }) => idea.title)).toEqual([
        "Stop logging the API token",
        "Replay mode for bug reports",
      ]);
      expect(savedBrainstorm.ideas.map((idea: { number: number }) => idea.number)).toEqual([1, 2]);
      expect(
        (await plugin.readCommandLog()).some((line) => line === `open ${pagePath}`)
      ).toBe(true);
    });
  });

  test(`${target}: render_brainstorm refuses a brainstorm with no ideas and writes nothing`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const outcome = await plugin.callTool("render_brainstorm", {
        ...SAMPLE_BRAINSTORM,
        ideas: [],
      });

      expect(outcome).toEqual({
        text: "The brainstorm needs at least one idea with a title and a nextStep.",
        isError: true,
      });
      expect(existsSync(join(projectFolder, BRAINSTORM_FOLDER))).toBe(false);
      expect(await plugin.readCommandLog()).toEqual([]);
    });
  });

  test(`${target}: check_brainstorm_plan answers OK for a clean run folder and writes nothing`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const runFolder = await writeRunFolder(projectFolder);

      const outcome = await plugin.callTool("check_brainstorm_plan", {
        path: runFolder,
      });

      expect(outcome).toEqual({ text: "OK", isError: false });
      expect(await readFile(join(runFolder, "index.md"), "utf8")).toBe(CLEAN_INDEX);
    });
  });

  test(`${target}: check_brainstorm_plan reports a run folder with no index.md as a problem, not a denial`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const runFolder = await writeRunFolder(projectFolder);
      await rm(join(runFolder, "index.md"));

      const outcome = await plugin.callTool("check_brainstorm_plan", {
        path: join(PLANS_FOLDER, RUN_FOLDER_NAME),
      });

      expect(outcome).toEqual({ text: "index.md: missing", isError: false });
    });
  });

  test(`${target}: set_brainstorm_plan_status writes the status to plan.md and index.md`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const runFolder = await writeRunFolder(projectFolder);

      const outcome = await plugin.callTool("set_brainstorm_plan_status", {
        path: join(runFolder, PLAN_FOLDER_NAME),
        status: "in-progress",
      });

      expect(outcome).toEqual({
        text: "01-replay: in-progress",
        isError: false,
      });
      expect(
        await readFile(join(runFolder, PLAN_FOLDER_NAME, "plan.md"), "utf8")
      ).toBe(CLEAN_PLAN.replace("- Status: pending", "- Status: in-progress"));
      expect(await readFile(join(runFolder, "index.md"), "utf8")).toBe(
        CLEAN_INDEX.replace("| pending |", "| in-progress |")
      );
    });
  });

  test(`${target}: set_brainstorm_plan_status denies an unknown status and leaves both files alone`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const runFolder = await writeRunFolder(projectFolder);

      const outcome = await plugin.callTool("set_brainstorm_plan_status", {
        path: join(runFolder, PLAN_FOLDER_NAME),
        status: "finished",
      });

      expect(outcome.isError).toBe(true);
      expect(
        await readFile(join(runFolder, PLAN_FOLDER_NAME, "plan.md"), "utf8")
      ).toBe(CLEAN_PLAN);
      expect(await readFile(join(runFolder, "index.md"), "utf8")).toBe(CLEAN_INDEX);
    });
  });

  test(`${target}: set_brainstorm_plan_status denies a plan folder the index does not list`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      const runFolder = await writeRunFolder(projectFolder);
      await mkdir(join(runFolder, "02-extra"));
      await writeFile(join(runFolder, "02-extra", "plan.md"), CLEAN_PLAN);

      const outcome = await plugin.callTool("set_brainstorm_plan_status", {
        path: join(runFolder, "02-extra"),
        status: "done",
      });

      expect(outcome.isError).toBe(true);
      expect(await readFile(join(runFolder, "index.md"), "utf8")).toBe(CLEAN_INDEX);
    });
  });

  test(`${target}: run_brainstorm with no arguments submits the brainstorm instructions`, async () => {
    await withPlugin(target, async (plugin) => {
      const outcome = await plugin.callTool("run_brainstorm", { args: "" });

      expect(outcome.isError).toBe(false);
      expect(outcome.text).toStartWith("Brainstorming improvements for this project…");
      expect(outcome.text).toContain("Now carry out these instructions:");
      expect(outcome.text).toContain("Brainstorm improvements for the project in the current working directory.");
      expect(outcome.text).toContain("mcp__brainstorm__render_brainstorm tool");
      expect(outcome.text).not.toContain("<focus>");
    });
  });

  test(`${target}: run_brainstorm with a focus centres the brainstorm on it`, async () => {
    await withPlugin(target, async (plugin) => {
      const outcome = await plugin.callTool("run_brainstorm", { args: "security" });

      expect(outcome.text).toContain("<focus>\nsecurity\n</focus>");
      expect(outcome.text).toContain("Now carry out these instructions:");
    });
  });

  test(`${target}: run_brainstorm plan with no saved brainstorm points at /brainstorm`, async () => {
    await withPlugin(target, async (plugin) => {
      const outcome = await plugin.callTool("run_brainstorm", { args: "plan" });

      expect(outcome).toEqual({
        text: "No saved brainstorm in this project yet. Run /brainstorm first.",
        isError: false,
      });
    });
  });

  test(`${target}: run_brainstorm plan with no picks lists the ideas of the newest brainstorm`, async () => {
    await withPlugin(target, async (plugin) => {
      await renderSample(plugin);

      const outcome = await plugin.callTool("run_brainstorm", { args: "plan" });

      expect(outcome.isError).toBe(false);
      expect(outcome.text).toContain("Ideas from the newest brainstorm of acme-cli:");
      expect(outcome.text).toContain("1. Stop logging the API token · Security · S · under an hour");
      expect(outcome.text).toContain("2. Replay mode for bug reports · Creative · L · a project");
      expect(outcome.text).not.toContain("Now carry out these instructions:");
    });
  });

  test(`${target}: run_brainstorm plan with picks submits a planning turn that names the run folder`, async () => {
    await withPlugin(target, async (plugin, projectFolder) => {
      await renderSample(plugin);

      const outcome = await plugin.callTool("run_brainstorm", { args: "plan 2" });

      expect(outcome.isError).toBe(false);
      const runFolderPattern = join(projectFolder, PLANS_FOLDER)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const acknowledgement = new RegExp(
        `^Planning #2 Replay mode for bug reports into the run folder (${runFolderPattern}/plan-\\d{4}-\\d{2}-\\d{2}-\\d{4})…`
      );
      const match = outcome.text.match(acknowledgement);
      expect(match).not.toBeNull();
      const runFolder = match![1];
      expect(outcome.text).toContain("Now carry out these instructions:");
      expect(outcome.text).toContain("Write an implementation plan for these ideas");
      expect(outcome.text).toContain("Do not implement anything.");
      expect(outcome.text).toContain(`Write the plan as a run folder at ${runFolder}.`);
      expect(outcome.text).toContain('<idea number="2">');
      expect(outcome.text).not.toContain('<idea number="1">');
    });
  });

  test(`${target}: run_brainstorm plan with an unknown pick says which pick is unknown and submits nothing`, async () => {
    await withPlugin(target, async (plugin) => {
      await renderSample(plugin);

      const outcome = await plugin.callTool("run_brainstorm", { args: "plan 9" });

      expect(outcome.isError).toBe(false);
      expect(outcome.text).toStartWith("The newest brainstorm has no idea 9.");
      expect(outcome.text).toContain("Pick numbers from 1 to 2");
      expect(outcome.text).not.toContain("Now carry out these instructions:");
    });
  });

  test(`${target}: run_brainstorm build hands the build to the build-plans skill`, async () => {
    await withPlugin(target, async (plugin) => {
      const outcome = await plugin.callTool("run_brainstorm", { args: "build" });

      expect(outcome.text).toStartWith(
        "Building the newest run with small-model implementers and a strong reviewer…"
      );
      expect(outcome.text).toContain("Now carry out these instructions:");
      expect(outcome.text).toContain("Load the brainstorm:build-plans skill");
      expect(outcome.text).toContain("The user named no run, so build the newest run.");
    });
  });

  test(`${target}: run_brainstorm build with named runs passes them to the skill as written`, async () => {
    await withPlugin(target, async (plugin) => {
      const outcome = await plugin.callTool("run_brainstorm", {
        args: "build plan-2026-11-09-1200",
      });

      expect(outcome.text).toStartWith(
        "Building plan-2026-11-09-1200 with small-model implementers and a strong reviewer…"
      );
      expect(outcome.text).toContain("<runs>\nplan-2026-11-09-1200\n</runs>");
    });
  });
}
