import { expect, test } from "bun:test";
import { createPluginHost, type Register } from "./engine";
import { describePlugin } from "./host-tools";
import { answerRequest } from "./mcp-server";

const registerGreeter: Register = (registerHook) => {
  registerHook("session.start", async ($, event, next) => {
    await $.tool.register({
      name: "greet",
      description: "Greets someone.",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
      isDeferred: false,
    });
    await $.command.register({
      name: "hello",
      description: "Says hello",
      argumentHint: "[name]",
    });
    await $.command.register({ name: "bye", description: "Says goodbye" });
    return next(event);
  });
  registerHook(
    "tool.call",
    { tool: "mcp__greeter__greet" },
    async (_, event) =>
      event.name ? { result: `Hi ${event.name}` } : { deny: "Name someone." }
  );
  registerHook("command.run", { command: "hello" }, async ($, event) => {
    const reply = await $.model.complete({ prompt: "greet" });
    return { text: `Hello ${event.args}${reply.isAnswered ? reply.text : ""}` };
  });
};

const startGreeter = async () => {
  const host = createPluginHost({
    pluginName: "greeter",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerGreeter,
  });
  await host.start();
  return host;
};

const HELLO_TOOL = {
  name: "run_hello",
  description:
    "Runs the /hello command: Says hello. Its arguments: [name]. Do what the reply says.",
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "string",
        description:
          "The text the user typed after /hello, unchanged. Empty when there is none.",
      },
      modelReply: {
        type: "string",
        description:
          "Only when the command's own instructions ask for it: the text you wrote for the command to use.",
      },
    },
    required: ["args"],
  },
};

test("initialize answers with the tools capability and the plugin's name", async () => {
  const response = await answerRequest(await startGreeter(), {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  expect(response).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "greeter", version: "1.0.0" },
    },
  });
});

test("tools/list holds the plugin's tools, then one run tool per command", async () => {
  const response = await answerRequest(await startGreeter(), {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  expect(response?.result.tools).toEqual([
    {
      name: "greet",
      description: "Greets someone.",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
    },
    HELLO_TOOL,
    {
      ...HELLO_TOOL,
      name: "run_bye",
      description:
        "Runs the /bye command: Says goodbye. Do what the reply says.",
      inputSchema: {
        ...HELLO_TOOL.inputSchema,
        properties: {
          ...HELLO_TOOL.inputSchema.properties,
          args: {
            type: "string",
            description:
              "The text the user typed after /bye, unchanged. Empty when there is none.",
          },
        },
      },
    },
  ]);
});

test("tools/call runs a plugin tool and marks a denial as an error", async () => {
  const host = await startGreeter();
  const callGreet = (toolArguments: Record<string, unknown>) =>
    answerRequest(host, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "greet", arguments: toolArguments },
    });
  expect((await callGreet({ name: "Ada" }))?.result).toEqual({
    content: [{ type: "text", text: "Hi Ada" }],
    isError: false,
  });
  expect((await callGreet({}))?.result).toEqual({
    content: [{ type: "text", text: "Name someone." }],
    isError: true,
  });
});

test("tools/call on a run tool runs the command with its args and model reply", async () => {
  const response = await answerRequest(await startGreeter(), {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "run_hello", arguments: { args: "Ada", modelReply: "!" } },
  });
  expect(response?.result).toEqual({
    content: [{ type: "text", text: "Hello Ada!" }],
    isError: false,
  });
});

test("a notification gets no answer, ping gets an empty one, and an unknown method an error", async () => {
  const host = await startGreeter();
  expect(
    await answerRequest(host, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })
  ).toBeUndefined();
  expect(
    await answerRequest(host, { jsonrpc: "2.0", id: 5, method: "ping" })
  ).toEqual({ jsonrpc: "2.0", id: 5, result: {} });
  expect(
    await answerRequest(host, { jsonrpc: "2.0", id: 6, method: "resources/list" })
  ).toEqual({
    jsonrpc: "2.0",
    id: 6,
    error: { code: -32601, message: "Method not found: resources/list" },
  });
});

test("describePlugin lists the tools and the commands", async () => {
  expect(describePlugin(await startGreeter())).toEqual({
    name: "greeter",
    toolNames: ["greet", "run_hello", "run_bye"],
    commands: [
      {
        name: "hello",
        description: "Says hello",
        argumentHint: "[name]",
        toolName: "mcp__greeter__run_hello",
      },
      {
        name: "bye",
        description: "Says goodbye",
        toolName: "mcp__greeter__run_bye",
      },
    ],
  });
});
