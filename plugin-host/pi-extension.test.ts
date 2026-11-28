import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    registerCommand: () => undefined,
    sendUserMessage: () => undefined,
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
    registerCommand: () => undefined,
    sendUserMessage: () => undefined,
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

const registerCommands: Register = (registerHook) => {
  registerHook("session.start", async ($, event, next) => {
    await $.command.register({
      name: "pick",
      description: "Picks a plan",
      argumentHint: "[alpha|beta]",
    });
    await $.command.register({ name: "recap", description: "Writes a recap" });
    await $.command.register({ name: "refuse", description: "Refuses" });
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
  registerHook("command.run", { command: "pick" }, async ($, event) => {
    const answer = await $.ui.ask("Which plan?", {
      header: "Plans",
      options: ["Alpha", "Beta"],
    });
    await $.prompt.fill({ text: `Draft for ${answer}` });
    await $.prompt.submit({ text: `Build ${answer} ${event.args}` });
    return { text: `chose ${answer}` };
  });
  registerHook("command.run", { command: "recap" }, async ($) => {
    const reply = await $.model.complete({ prompt: "Recap" });
    return { text: reply.isAnswered ? reply.text : "No recap." };
  });
  registerHook("command.run", { command: "refuse" }, () => ({
    deny: "Not here.",
  }));
};

type RegisteredPiCommand = {
  name: string;
  description: string;
  getArgumentCompletions: (argumentPrefix: string) => Promise<unknown>;
  handler: (args: string, piContext: unknown) => Promise<void>;
};

const loadCommands = async (pluginRoot = "/plugin-root") => {
  const registeredCommands: RegisteredPiCommand[] = [];
  const sentMessages: string[] = [];
  await createPiExtension({
    pluginName: "completer",
    pluginRoot,
    storeFolder: await mkdtemp(join(tmpdir(), "plugin-host-pi-")),
    register: registerCommands,
  })({
    registerTool: () => undefined,
    registerCommand: (
      name: string,
      options: Omit<RegisteredPiCommand, "name">
    ) => registeredCommands.push({ name, ...options }),
    sendUserMessage: (message: string) => sentMessages.push(message),
  });
  const findCommand = (commandName: string) =>
    registeredCommands.find((command) => command.name === commandName)!;
  return { registeredCommands, sentMessages, findCommand };
};

const createPiContext = (hasUI = true) => {
  const shown = {
    dialogs: [] as { title: string; options: string[] }[],
    notifications: [] as { message: string; kind?: string }[],
    editorTexts: [] as string[],
  };
  const piContext = {
    hasUI,
    ui: {
      select: async (title: string, options: string[]) => {
        shown.dialogs.push({ title, options });
        return "Beta";
      },
      notify: (message: string, kind?: string) =>
        shown.notifications.push({ message, kind }),
      setEditorText: (editorText: string) => shown.editorTexts.push(editorText),
    },
  };
  return { piContext, shown };
};

test("each command is registered as a pi command, with its argument hint before its description", async () => {
  const { registeredCommands } = await loadCommands();
  expect(
    registeredCommands.map(({ name, description }) => ({ name, description }))
  ).toEqual([
    { name: "pick", description: "[alpha|beta] — Picks a plan" },
    { name: "recap", description: "Writes a recap" },
    { name: "refuse", description: "Refuses" },
  ]);
});

test("a pi command completes its first argument from the plugin's autocomplete hook", async () => {
  const { findCommand } = await loadCommands();
  const pickCommand = findCommand("pick");
  expect(await pickCommand.getArgumentCompletions("")).toEqual([
    { value: "alpha", label: "alpha", description: "The first plan" },
    { value: "beta", label: "beta", description: "The second plan" },
  ]);
  expect(await pickCommand.getArgumentCompletions("be")).toEqual([
    { value: "beta", label: "beta", description: "The second plan" },
  ]);
  expect(await pickCommand.getArgumentCompletions("alpha be")).toBeNull();
  expect(await findCommand("recap").getArgumentCompletions("")).toBeNull();
});

test("a pi command runs at once: it asks in pi's dialog, shows the reply, fills the editor and sends the submitted prompt", async () => {
  const { findCommand, sentMessages } = await loadCommands();
  const { piContext, shown } = createPiContext();
  await findCommand("pick").handler("now", piContext);
  expect(shown).toEqual({
    dialogs: [{ title: "Plans: Which plan?", options: ["Alpha", "Beta"] }],
    notifications: [{ message: "chose Beta", kind: "info" }],
    editorTexts: ["Draft for Beta"],
  });
  expect(sentMessages).toEqual(["Build Beta now"]);
});

test("a pi command whose hook refuses shows the reason as an error", async () => {
  const { findCommand, sentMessages } = await loadCommands();
  const { piContext, shown } = createPiContext();
  await findCommand("refuse").handler("", piContext);
  expect(shown.notifications).toEqual([{ message: "Not here.", kind: "error" }]);
  expect(sentMessages).toEqual([]);
});

test("a pi command that needs the model's own words sends its prompt template instead", async () => {
  const pluginRoot = await mkdtemp(join(tmpdir(), "plugin-host-pi-root-"));
  await mkdir(join(pluginRoot, "prompts"));
  await writeFile(
    join(pluginRoot, "prompts", "recap.md"),
    '---\ndescription: "Writes a recap"\n---\n\nWrite the recap, then call the tool.\n\n<arguments>\n$ARGUMENTS\n</arguments>\n'
  );
  const { findCommand, sentMessages } = await loadCommands(pluginRoot);
  const { piContext, shown } = createPiContext();
  await findCommand("recap").handler("the parser", piContext);
  expect(sentMessages).toEqual([
    "Write the recap, then call the tool.\n\n<arguments>\nthe parser\n</arguments>\n",
  ]);
  expect(shown.notifications).toEqual([]);
});

test("a pi command that needs the model but has no prompt template shows its reply", async () => {
  const { findCommand, sentMessages } = await loadCommands();
  const { piContext, shown } = createPiContext();
  await findCommand("recap").handler("", piContext);
  expect(shown.notifications).toEqual([{ message: "No recap.", kind: "info" }]);
  expect(sentMessages).toEqual([]);
});

test("a pi command run where pi has no dialogs hands its whole reply to the model", async () => {
  const { findCommand, sentMessages } = await loadCommands();
  const { piContext, shown } = createPiContext(false);
  await findCommand("refuse").handler("", piContext);
  expect(sentMessages).toEqual(["Not here."]);
  expect(shown.notifications).toEqual([]);
});
