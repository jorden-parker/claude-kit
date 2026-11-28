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
  })({
    registerTool: (tool: RegisteredPiTool) => registeredTools.push(tool),
    on: () => undefined,
  });
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
  })({
    registerTool: (tool: RegisteredPiTool) => registeredTools.push(tool),
    on: () => undefined,
  });
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

const PICK_SUGGESTIONS = [
  { text: "alpha", description: "The first plan" },
  { text: "beta", description: "The second plan" },
];

const registerCompleter: Register = (registerHook) => {
  registerHook("session.start", async ($, event, next) => {
    await $.command.register({ name: "pick", description: "Picks a plan" });
    return next(event);
  });
  registerHook("prompt.autocomplete", async (_engine, event, next) => {
    const isFirstPickArgument =
      event.text.startsWith("/pick ") && event.start === "/pick ".length;
    if (!isFirstPickArgument) return next(event);
    const { suggestions } = await next(event);
    return {
      suggestions: [
        ...suggestions,
        ...PICK_SUGGESTIONS.filter((suggestion) =>
          suggestion.text.startsWith(event.token)
        ),
      ],
    };
  });
};

const EDITOR_SUGGESTIONS = { items: [{ value: "file.ts", label: "file.ts" }], prefix: "fi" };
const APPLIED_COMPLETION = { lines: ["/pick beta"], cursorLine: 0, cursorCol: 10 };

const editorProvider = {
  triggerCharacters: ["@"],
  getSuggestions: async () => EDITOR_SUGGESTIONS,
  applyCompletion: () => APPLIED_COMPLETION,
  shouldTriggerFileCompletion: () => false,
};

type PiProvider = typeof editorProvider & {
  getSuggestions: (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: unknown
  ) => Promise<unknown>;
  applyCompletion: (...completionArguments: unknown[]) => unknown;
};

const startSession = async (register: Register) => {
  const sessionStartHandlers: ((event: unknown, piContext: unknown) => unknown)[] = [];
  const providerFactories: ((current: typeof editorProvider) => PiProvider)[] = [];
  await createPiExtension({
    pluginName: "completer",
    pluginRoot: "/plugin-root",
    storeFolder: await mkdtemp(join(tmpdir(), "plugin-host-pi-")),
    register,
  })({
    registerTool: () => undefined,
    on: (eventName: string, handler: (event: unknown, piContext: unknown) => unknown) => {
      if (eventName === "session_start") sessionStartHandlers.push(handler);
    },
  });
  for (const handler of sessionStartHandlers) {
    await handler(
      { reason: "startup" },
      {
        hasUI: true,
        ui: {
          select: async () => undefined,
          addAutocompleteProvider: (
            factory: (current: typeof editorProvider) => PiProvider
          ) => providerFactories.push(factory),
        },
      }
    );
  }
  return providerFactories;
};

const suggestAt = (provider: PiProvider, typedText: string) =>
  provider.getSuggestions([typedText], 0, typedText.length, {});

test("a command's subcommands are suggested in pi's editor after the command name", async () => {
  const [wrapProvider] = await startSession(registerCompleter);
  const provider = wrapProvider!(editorProvider);
  expect(await suggestAt(provider, "/pick ")).toEqual({
    items: [
      { value: "alpha", label: "alpha", description: "The first plan" },
      { value: "beta", label: "beta", description: "The second plan" },
    ],
    prefix: "",
  });
  expect(await suggestAt(provider, "/pick be")).toEqual({
    items: [{ value: "beta", label: "beta", description: "The second plan" }],
    prefix: "be",
  });
});

test("pi's own suggestions are kept wherever the plugin suggests nothing", async () => {
  const [wrapProvider] = await startSession(registerCompleter);
  const provider = wrapProvider!(editorProvider);
  expect(await suggestAt(provider, "/pick zz")).toBe(EDITOR_SUGGESTIONS);
  expect(await suggestAt(provider, "/pick alpha be")).toBe(EDITOR_SUGGESTIONS);
  expect(await suggestAt(provider, "/other ")).toBe(EDITOR_SUGGESTIONS);
  expect(await provider.getSuggestions(["notes", "/pick "], 1, 6, {})).toBe(
    EDITOR_SUGGESTIONS
  );
  expect(provider.applyCompletion(["/pick be"], 0, 8, {}, "be")).toBe(
    APPLIED_COMPLETION
  );
  expect(provider.shouldTriggerFileCompletion()).toBe(false);
  expect(provider.triggerCharacters).toEqual(["@"]);
});

test("a plugin with no command adds no suggestions to pi's editor", async () => {
  expect(await startSession(() => undefined)).toEqual([]);
});
