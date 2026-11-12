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
