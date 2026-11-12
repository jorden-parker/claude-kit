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
    toolArguments: Record<string, unknown>
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
