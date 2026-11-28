import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Register } from "./engine";
import { createPiExtension } from "./pi-extension";

const registerCounter: Register = (registerHook) => {
  registerHook("session.start", async ($, event, next) => {
    await $.tool.register({
      name: "count",
      description: "Counts up.",
      inputSchema: { type: "object", properties: { by: { type: "number" } } },
    });
    await $.command.register({ name: "reset", description: "Resets" });
    return next(event);
  });
  registerHook(
    "tool.call",
    { tool: "mcp__counter__count" },
    async ($, event) => {
      if (typeof event.by !== "number") return { deny: "Say by how much." };
      const total = Number((await $.store.get("total")) ?? 0) + event.by;
      await $.store.set("total", total);
      return { result: `Total ${total}` };
    }
  );
  registerHook("command.run", { command: "reset" }, async ($) => {
    await $.store.delete("total");
    return { text: "Reset." };
  });
};

type RegisteredPiTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    toolArguments: Record<string, unknown>,
    abortSignal?: AbortSignal,
    onUpdate?: unknown,
    piContext?: unknown
  ) => Promise<unknown>;
};

const loadCounter = async () => {
  const storeFolder = await mkdtemp(join(tmpdir(), "plugin-host-pi-"));
  const registeredTools: RegisteredPiTool[] = [];
  await createPiExtension({
    pluginName: "counter",
    pluginRoot: "/plugin-root",
    storeFolder,
    register: registerCounter,
  })({ registerTool: (tool: RegisteredPiTool) => registeredTools.push(tool) });
  return { registeredTools, storeFolder };
};

test("each tool and each command's run tool is registered under its mcp-qualified name", async () => {
  const { registeredTools } = await loadCounter();
  expect(
    registeredTools.map(({ name, label, description, parameters }) => ({
      name,
      label,
      description,
      parameters,
    }))
  ).toEqual([
    {
      name: "mcp__counter__count",
      label: "count",
      description: "Counts up.",
      parameters: { type: "object", properties: { by: { type: "number" } } },
    },
    {
      name: "mcp__counter__run_reset",
      label: "run_reset",
      description: "Runs the /reset command: Resets. Do what the reply says.",
      parameters: expect.objectContaining({ required: ["args"] }),
    },
  ]);
});

test("executing a tool answers with text content and keeps the store under the store folder", async () => {
  const { registeredTools, storeFolder } = await loadCounter();
  const [countTool, resetTool] = registeredTools;
  expect(await countTool!.execute("call-1", { by: 2 })).toEqual({
    content: [{ type: "text", text: "Total 2" }],
    details: undefined,
  });
  expect(
    JSON.parse(await readFile(join(storeFolder, "counter.json"), "utf8"))
  ).toEqual({ total: 2 });
  expect(await resetTool!.execute("call-2", { args: "" })).toEqual({
    content: [{ type: "text", text: "Reset." }],
    details: undefined,
  });
});

test("a denied tool call throws, which pi reports as a failed tool result", async () => {
  const { registeredTools } = await loadCounter();
  expect(registeredTools[0]!.execute("call-1", {})).rejects.toThrow(
    "Say by how much."
  );
});

const registerPicker: Register = (registerHook) => {
  registerHook("session.start", async ($, event, next) => {
    await $.command.register({ name: "pick", description: "Picks a plan" });
    return next(event);
  });
  registerHook("command.run", { command: "pick" }, async ($) => {
    const answer = await $.ui.ask("Which plan?", {
      header: "Plans",
      options: ["Alpha", "Beta"],
    });
    return { text: `chose ${answer}` };
  });
};

const loadPickTool = async () => {
  const registeredTools: RegisteredPiTool[] = [];
  await createPiExtension({
    pluginName: "picker",
    pluginRoot: "/plugin-root",
    storeFolder: await mkdtemp(join(tmpdir(), "plugin-host-pi-")),
    register: registerPicker,
  })({ registerTool: (tool: RegisteredPiTool) => registeredTools.push(tool) });
  return registeredTools[0]!;
};

const runPick = (pickTool: RegisteredPiTool, piContext: unknown) =>
  pickTool.execute("call-1", { args: "" }, undefined, undefined, piContext);

test("a question is asked in pi's select dialog and the picked option is the answer", async () => {
  const shownDialogs: { title: string; options: string[] }[] = [];
  const piContext = {
    hasUI: true,
    ui: {
      select: async (title: string, options: string[]) => {
        shownDialogs.push({ title, options });
        return "Beta";
      },
    },
  };
  expect(await runPick(await loadPickTool(), piContext)).toEqual({
    content: [{ type: "text", text: "chose Beta" }],
    details: undefined,
  });
  expect(shownDialogs).toEqual([
    { title: "Plans: Which plan?", options: ["Alpha", "Beta"] },
  ]);
});

test("a dismissed select dialog fails the tool call", async () => {
  const piContext = { hasUI: true, ui: { select: async () => undefined } };
  expect(runPick(await loadPickTool(), piContext)).rejects.toThrow(
    "The user cancelled the question."
  );
});

test("a question fails the tool call when pi has no dialogs", async () => {
  const piContext = { hasUI: false, ui: { select: async () => "Beta" } };
  expect(runPick(await loadPickTool(), piContext)).rejects.toThrow(
    "no question prompt outside Claude Code"
  );
});
