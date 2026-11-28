import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginHost, type Register } from "./engine";

const registerSamplePlugin: Register = (on) => {
  on("session.start", async ($, event, next) => {
    await $.tool.register({
      name: "save_page",
      description: "Saves a page.",
      inputSchema: { type: "object", properties: {} },
    });
    await $.command.register({
      name: "sample",
      description: "Runs the sample.",
      argumentHint: "[focus]",
    });
    return next(event);
  });

  on("tool.call", { tool: "mcp__sample__save_page" }, async ($, event) => {
    if (!event.title) return { deny: "The page needs a title." };
    const pagePath = `${await $.session.cwd()}/pages/${event.title}.txt`;
    await $.fs.write(pagePath, `${$.plugin.root}`);
    await $.store.set("lastPage", pagePath);
    const entries = await $.fs.list(`${await $.session.cwd()}/pages`);
    return { result: `Saved ${entries.map((entry) => entry.name).join(",")}` };
  });

  on("tool.call", async ($, event, next) => {
    if (event.tool === "mcp__sample__unknown_verb") return $.voice.speak();
    return next(event);
  });

  on("command.run", { command: "sample" }, async ($, event) => {
    if (event.args === "recap") {
      const reply = await $.model.complete({ prompt: "recap" });
      const messages = await $.session.messages();
      await $.prompt.fill({ text: reply.text, mode: "replace" });
      return { text: `Filled from ${messages.length} message` };
    }
    if (event.args === "last") {
      return { text: String(await $.store.get("lastPage")) };
    }
    $.clock.after(0, () => void $.prompt.submit({ text: "Study the code." }));
    $.ui.toast("Working…");
    return { text: `Started ${event.args}` };
  });
};

const startSampleHost = async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "plugin-host-engine-"));
  const host = createPluginHost({
    pluginName: "sample",
    pluginRoot: "/plugin-root",
    workingDirectory: sandbox,
    storePath: join(sandbox, "store", "sample.json"),
    register: registerSamplePlugin,
  });
  await host.start();
  return { host, sandbox };
};

test("session.start collects the tools and commands the plugin registers", async () => {
  const { host } = await startSampleHost();
  expect(host.tools.map((tool) => tool.name)).toEqual(["save_page"]);
  expect(host.commands).toEqual([
    {
      name: "sample",
      description: "Runs the sample.",
      argumentHint: "[focus]",
    },
  ]);
});

test("a tool call reaches the hook filtered on its qualified name and uses the real file system and store", async () => {
  const { host, sandbox } = await startSampleHost();
  const outcome = await host.callTool("save_page", { title: "home" });
  expect(outcome).toEqual({ text: "Saved home.txt", isError: false });
  expect(await readFile(join(sandbox, "pages", "home.txt"), "utf8")).toBe(
    "/plugin-root"
  );
  expect(
    JSON.parse(await readFile(join(sandbox, "store", "sample.json"), "utf8"))
  ).toEqual({ lastPage: join(sandbox, "pages", "home.txt") });
});

test("a denied tool call is an error outcome", async () => {
  const { host } = await startSampleHost();
  expect(await host.callTool("save_page", {})).toEqual({
    text: "The page needs a title.",
    isError: true,
  });
});

test("a tool no hook answers, and an engine verb only Claude Code has, are error outcomes", async () => {
  const { host } = await startSampleHost();
  expect(await host.callTool("missing", {})).toEqual({
    text: "No hook answered mcp__sample__missing.",
    isError: true,
  });
  expect(await host.callTool("unknown_verb", {})).toEqual({
    text: "voice.speak is not available outside Claude Code.",
    isError: true,
  });
});

test("a command's submitted prompt comes back as instructions to carry out", async () => {
  const { host } = await startSampleHost();
  const outcome = await host.runCommand("sample", "the login flow");
  expect(outcome.isError).toBe(false);
  expect(outcome.text).toBe(
    "Started the login flow\n\nNow carry out these instructions:\n\nStudy the code."
  );
});

test("the caller's model reply answers model.complete, and a filled prompt comes back as text to show", async () => {
  const { host } = await startSampleHost();
  const outcome = await host.runCommand("sample", "recap", "The recap.");
  expect(outcome.text).toBe(
    "Filled from 1 message\n\nShow the user this text, word for word, as the prompt to send next:\n\nThe recap."
  );
});

test("without a model reply model.complete is not answered, and the conversation still counts as one message", async () => {
  const registerModelProbe: Register = (on) => {
    on("command.run", { command: "probe" }, async ($) => {
      const reply = await $.model.complete({ prompt: "anything" });
      const messages = await $.session.messages();
      return { text: `${reply.isAnswered} ${reply.reason} ${messages.length}` };
    });
  };
  const host = createPluginHost({
    pluginName: "probe",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerModelProbe,
  });
  await host.start();
  expect((await host.runCommand("probe", "")).text).toBe(
    "false no model reply was passed to the command 1"
  );
});

test("the store outlives the host", async () => {
  const { host, sandbox } = await startSampleHost();
  await host.callTool("save_page", { title: "home" });
  const laterHost = createPluginHost({
    pluginName: "sample",
    pluginRoot: "/plugin-root",
    workingDirectory: sandbox,
    storePath: join(sandbox, "store", "sample.json"),
    register: registerSamplePlugin,
  });
  await laterHost.start();
  expect((await laterHost.runCommand("sample", "last")).text).toBe(
    join(sandbox, "pages", "home.txt")
  );
});

test("the plugin cannot run host commands while it starts, only when a tool or command asks", async () => {
  const startOutcomes: string[] = [];
  const registerInstaller: Register = (registerHook) => {
    registerHook("session.start", async ($, event, next) => {
      await $.process.run(["true"]).then(
        () => startOutcomes.push("ran"),
        (error: Error) => startOutcomes.push(error.message)
      );
      return next(event);
    });
    registerHook("command.run", { command: "check" }, async ($) => {
      const { exitCode } = await $.process.run(["true"]);
      return { text: `exit ${exitCode}` };
    });
  };
  const host = createPluginHost({
    pluginName: "installer",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerInstaller,
  });
  await host.start();
  expect(startOutcomes).toEqual([
    "process.run is not available while a plugin starts outside Claude Code.",
  ]);
  expect((await host.runCommand("check", "")).text).toBe("exit 0");
});

const registerPicker: Register = (registerHook) => {
  registerHook("command.run", { command: "pick" }, async (engine) => {
    const answer = await engine.ui.ask("Which plan?", {
      header: "Plans",
      options: ["Alpha", "Beta"],
    });
    return { text: `chose ${answer}` };
  });
};

test("ui.ask hands the question and options to the asker and returns the chosen label", async () => {
  const askedQuestions: unknown[] = [];
  const host = createPluginHost({
    pluginName: "picker",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerPicker,
    askQuestion: async (question, choices) => {
      askedQuestions.push({ question, choices });
      return "Beta";
    },
  });
  await host.start();
  expect(await host.runCommand("pick", "")).toEqual({
    text: "chose Beta",
    isError: false,
  });
  expect(askedQuestions).toEqual([
    {
      question: "Which plan?",
      choices: { header: "Plans", options: ["Alpha", "Beta"] },
    },
  ]);
});

test("ui.ask is an error outcome outside Claude Code when no asker was given", async () => {
  const host = createPluginHost({
    pluginName: "picker",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerPicker,
  });
  await host.start();
  expect(await host.runCommand("pick", "")).toEqual({
    text: "no question prompt outside Claude Code",
    isError: true,
  });
});

test("clock.every returns a timer that can be cancelled, and ui.place reports no card outside Claude Code", async () => {
  const registerCardProbe: Register = (on) => {
    on("command.run", { command: "card" }, async ($) => {
      const timer = $.clock.every(1000, () => undefined);
      const placed = await $.ui.place({ id: "card-1" });
      timer.cancel();
      return { result: `${typeof timer.cancel}; ${placed.reason}` };
    });
  };
  const host = createPluginHost({
    pluginName: "card",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerCardProbe,
  });
  await host.start();
  expect(await host.runCommand("card", "")).toEqual({
    text: "function; no card surface outside Claude Code",
    isError: false,
  });
});

const PICK_SUGGESTIONS = [
  { text: "alpha", description: "The first plan" },
  { text: "beta", description: "The second plan" },
];

const registerCompleter: Register = (registerHook) => {
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

const startCompleter = async (register: Register) => {
  const host = createPluginHost({
    pluginName: "completer",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register,
  });
  await host.start();
  return host;
};

test("suggestCompletions asks the prompt.autocomplete hooks about the word being typed", async () => {
  const host = await startCompleter(registerCompleter);
  expect(await host.suggestCompletions("/pick ")).toEqual(PICK_SUGGESTIONS);
  expect(await host.suggestCompletions("/pick be")).toEqual([
    PICK_SUGGESTIONS[1]!,
  ]);
  expect(await host.suggestCompletions("/pick alpha be")).toEqual([]);
  expect(await host.suggestCompletions("/other ")).toEqual([]);
});

test("suggestCompletions is empty for a plugin with no autocomplete hook or a failing one", async () => {
  expect(await (await startCompleter(() => undefined)).suggestCompletions("/pick ")).toEqual([]);
  const failingHost = await startCompleter((registerHook) => {
    registerHook("prompt.autocomplete", () => {
      throw new Error("broken hook");
    });
  });
  expect(await failingHost.suggestCompletions("/pick ")).toEqual([]);
});

test("session.root is the folder the host started in, as session.cwd is", async () => {
  const host = createPluginHost({
    pluginName: "locator",
    pluginRoot: "/plugin-root",
    workingDirectory: "/projects/notes-app",
    storePath: "/nonexistent/store.json",
    register: (registerHook) => {
      registerHook("command.run", { command: "locate" }, async (engine) => ({
        text: `${await engine.session.root()} ${await engine.session.cwd()}`,
      }));
    },
  });
  await host.start();
  expect(await host.runCommand("locate", "")).toEqual({
    text: "/projects/notes-app /projects/notes-app",
    isError: false,
  });
});

const startToolServer = async (register: Register) => {
  const host = createPluginHost({
    pluginName: "server",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register,
  });
  await host.start();
  return host;
};

test("a tool served at tool.run answers the call when no tool.call hook does", async () => {
  const host = await startToolServer((registerHook) => {
    registerHook("tool.run", { tool: "mcp__server__greet" }, (_engine, event) => ({
      result: `Hello ${event.name}`,
    }));
  });
  expect(await host.callTool("greet", { name: "Ada" })).toEqual({
    text: "Hello Ada",
    isError: false,
  });
});

test("a tool.call hook that answers keeps the call from reaching tool.run", async () => {
  const host = await startToolServer((registerHook) => {
    registerHook("tool.call", { tool: "mcp__server__greet" }, () => ({
      deny: "Not now.",
    }));
    registerHook("tool.run", { tool: "mcp__server__greet" }, () => ({
      result: "Hello",
    }));
  });
  expect(await host.callTool("greet", {})).toEqual({
    text: "Not now.",
    isError: true,
  });
});

test("fs.exists tells a file or folder that is there from one that is not", async () => {
  const host = createPluginHost({
    pluginName: "finder",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: (registerHook) => {
      registerHook("command.run", { command: "find" }, async (engine, event) => ({
        text: String(await engine.fs.exists(event.args)),
      }));
    },
  });
  await host.start();
  expect((await host.runCommand("find", import.meta.dir)).text).toBe("true");
  expect((await host.runCommand("find", import.meta.path)).text).toBe("true");
  expect(
    (await host.runCommand("find", `${import.meta.dir}/no-such-file`)).text
  ).toBe("false");
});

const startDirectHost = async (register: Register) => {
  const host = createPluginHost({
    pluginName: "direct",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register,
  });
  await host.start();
  return host;
};

test("runCommandDirectly keeps the reply, the filled prompt and the submitted prompts apart", async () => {
  const host = await startDirectHost((registerHook) => {
    registerHook("command.run", { command: "build" }, async (engine, event) => {
      await engine.prompt.fill({ text: `Draft for ${event.args}` });
      await engine.prompt.submit({ text: "Build the parser." });
      return { text: "Building…" };
    });
  });
  expect(await host.runCommandDirectly("build", "the parser")).toEqual({
    text: "Building…\n\nShow the user this text, word for word, as the prompt to send next:\n\nDraft for the parser\n\nNow carry out these instructions:\n\nBuild the parser.",
    isError: false,
    replyText: "Building…",
    filledPrompts: ["Draft for the parser"],
    submittedPrompts: ["Build the parser."],
    isModelReplyMissing: false,
  });
});

test("runCommandDirectly says when the command asked the model and no reply was passed", async () => {
  const host = await startDirectHost((registerHook) => {
    registerHook("command.run", { command: "recap" }, async (engine) => {
      const reply = await engine.model.complete({ prompt: "Recap" });
      return { text: reply.isAnswered ? reply.text : "No recap." };
    });
    registerHook("command.run", { command: "refuse" }, () => ({
      deny: "Not here.",
    }));
  });
  expect(await host.runCommandDirectly("recap", "")).toMatchObject({
    replyText: "No recap.",
    isModelReplyMissing: true,
  });
  expect(await host.runCommandDirectly("refuse", "")).toMatchObject({
    replyText: "Not here.",
    isError: true,
    isModelReplyMissing: false,
  });
  expect(await host.runCommand("recap", "", "The recap")).toEqual({
    text: "The recap",
    isError: false,
  });
});
