import { expect, test } from "bun:test";
import { createPluginHost, type Register } from "./engine";
import { describePlugin } from "./host-tools";
import { answerRequest, createMcpConnection, type McpConnection } from "./mcp-server";

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

const registerPicker: Register = (registerHook) => {
  registerHook("command.run", { command: "pick" }, async (engine) => {
    const answer = await engine.ui.ask("Which plan?", {
      header: "Plans",
      options: ["Alpha", "Beta"],
    });
    return { text: `chose ${answer}` };
  });
};

const startPicker = (connection: McpConnection) =>
  createPluginHost({
    pluginName: "picker",
    pluginRoot: "/plugin-root",
    workingDirectory: "/",
    storePath: "/nonexistent/store.json",
    register: registerPicker,
    askQuestion: connection.askQuestion,
  });

const initialize = (connection: McpConnection, capabilities: Record<string, unknown>) =>
  answerRequest(
    startPicker(connection),
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities },
    },
    connection
  );

test("ui.ask sends an elicitation form to a client that declares elicitation and returns the accepted choice", async () => {
  const sent: any[] = [];
  const connection = createMcpConnection((line) => sent.push(JSON.parse(line)));
  const host = startPicker(connection);
  await host.start();
  await answerRequest(
    host,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } },
    },
    connection
  );
  const outcome = host.runCommand("pick", "");
  while (sent.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent[0]).toEqual({
    jsonrpc: "2.0",
    id: sent[0].id,
    method: "elicitation/create",
    params: {
      message: "Which plan?",
      requestedSchema: {
        type: "object",
        properties: {
          choice: { type: "string", title: "Plans", enum: ["Alpha", "Beta"] },
        },
        required: ["choice"],
      },
    },
  });
  connection.receiveReply({
    jsonrpc: "2.0",
    id: sent[0].id,
    result: { action: "accept", content: { choice: "Beta" } },
  });
  expect(await outcome).toEqual({ text: "chose Beta", isError: false });
});

test("ui.ask rejects when the user declines or cancels the elicitation", async () => {
  const sent: any[] = [];
  const connection = createMcpConnection((line) => sent.push(JSON.parse(line)));
  await initialize(connection, { elicitation: {} });
  const declined = connection.askQuestion("Which plan?", { header: "Plans", options: ["Alpha"] });
  connection.receiveReply({ jsonrpc: "2.0", id: sent[0].id, result: { action: "decline" } });
  await expect(declined).rejects.toThrow("The user declined the question.");
  const cancelled = connection.askQuestion("Which plan?", { header: "Plans", options: ["Alpha"] });
  connection.receiveReply({ jsonrpc: "2.0", id: sent[1].id, result: { action: "cancel" } });
  await expect(cancelled).rejects.toThrow("The user cancelled the question.");
});

test("ui.ask rejects when the client answers with an error or an option that was not offered", async () => {
  const sent: any[] = [];
  const connection = createMcpConnection((line) => sent.push(JSON.parse(line)));
  await initialize(connection, { elicitation: {} });
  const failed = connection.askQuestion("Which plan?", { header: "Plans", options: ["Alpha"] });
  connection.receiveReply({ jsonrpc: "2.0", id: sent[0].id, error: { code: -32000, message: "boom" } });
  await expect(failed).rejects.toThrow("The question could not be asked: boom");
  const invented = connection.askQuestion("Which plan?", { header: "Plans", options: ["Alpha"] });
  connection.receiveReply({
    jsonrpc: "2.0",
    id: sent[1].id,
    result: { action: "accept", content: { choice: "Gamma" } },
  });
  await expect(invented).rejects.toThrow("The client answered with an option that was not offered.");
});

test("a client without elicitation leaves ui.ask rejecting and sends no form", async () => {
  const sent: any[] = [];
  const connection = createMcpConnection((line) => sent.push(JSON.parse(line)));
  await initialize(connection, { roots: {} });
  await expect(
    connection.askQuestion("Which plan?", { header: "Plans", options: ["Alpha"] })
  ).rejects.toThrow("no question prompt outside Claude Code");
  expect(sent).toEqual([]);
});
