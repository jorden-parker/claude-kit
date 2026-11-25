import { createInterface } from "node:readline";
import {
  NO_QUESTION_PROMPT_REASON,
  type AskQuestion,
  type PluginHost,
} from "./engine";
import { callHostTool, listHostTools } from "./host-tools";

export type RpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, any>;
};

export type RpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: { code: number; message: string };
};

export type McpConnection = {
  isElicitationSupported: boolean;
  askQuestion: AskQuestion;
  receiveReply: (reply: RpcResponse) => void;
};

const FALLBACK_PROTOCOL_VERSION = "2024-11-05";
const METHOD_NOT_FOUND = -32601;
const NOT_ANSWERED_REASONS: Record<string, string> = {
  decline: "The user declined the question.",
  cancel: "The user cancelled the question.",
};

export const createMcpConnection = (
  write: (line: string) => void = (line) => process.stdout.write(line)
): McpConnection => {
  const pendingReplies = new Map<number | string, (reply: RpcResponse) => void>();
  let lastRequestId = 0;
  const connection: McpConnection = {
    isElicitationSupported: false,
    askQuestion: async (question, { header, options }) => {
      if (!connection.isElicitationSupported) {
        throw new Error(NO_QUESTION_PROMPT_REASON);
      }
      const requestId = ++lastRequestId;
      const reply = await new Promise<RpcResponse>((resolve) => {
        pendingReplies.set(requestId, resolve);
        write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method: "elicitation/create",
            params: {
              message: question,
              requestedSchema: {
                type: "object",
                properties: {
                  choice: { type: "string", title: header, enum: options },
                },
                required: ["choice"],
              },
            },
          })}\n`
        );
      });
      if (reply.error) {
        throw new Error(`The question could not be asked: ${reply.error.message}`);
      }
      const action = reply.result?.action;
      if (action !== "accept") {
        throw new Error(NOT_ANSWERED_REASONS[action] ?? "The user did not answer the question.");
      }
      const choice = reply.result?.content?.choice;
      if (!options.includes(choice)) {
        throw new Error("The client answered with an option that was not offered.");
      }
      return choice;
    },
    receiveReply: (reply) => {
      const resolve = pendingReplies.get(reply.id);
      pendingReplies.delete(reply.id);
      resolve?.(reply);
    },
  };
  return connection;
};

type MethodAnswer = (
  host: PluginHost,
  params: Record<string, any>,
  connection: McpConnection
) => unknown;

const METHOD_ANSWERS: Record<string, MethodAnswer> = {
  initialize: (host, params, connection) => {
    connection.isElicitationSupported = params.capabilities?.elicitation !== undefined;
    return {
      protocolVersion: params.protocolVersion ?? FALLBACK_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: host.pluginName, version: "1.0.0" },
    };
  },
  ping: () => ({}),
  "tools/list": (host) => ({ tools: listHostTools(host) }),
  "tools/call": async (host, params) => {
    const { text, isError } = await callHostTool(
      host,
      String(params.name ?? ""),
      params.arguments ?? {}
    );
    return { content: [{ type: "text", text }], isError };
  },
};

export const answerRequest = async (
  host: PluginHost,
  request: RpcRequest,
  connection: McpConnection = createMcpConnection()
): Promise<RpcResponse | undefined> => {
  if (request.id === undefined) return undefined;
  const answerMethod = METHOD_ANSWERS[request.method];
  if (!answerMethod) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: METHOD_NOT_FOUND,
        message: `Method not found: ${request.method}`,
      },
    };
  }
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: await answerMethod(host, request.params ?? {}, connection),
  };
};

export const serveMcp = async (
  host: PluginHost,
  connection: McpConnection = createMcpConnection()
) => {
  const answers: Promise<void>[] = [];
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === undefined) {
      connection.receiveReply(message);
      continue;
    }
    answers.push(
      answerRequest(host, message, connection).then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
    );
  }
  await Promise.all(answers);
};
