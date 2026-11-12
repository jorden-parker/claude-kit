import { createInterface } from "node:readline";
import { type PluginHost } from "./engine";
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

const FALLBACK_PROTOCOL_VERSION = "2024-11-05";
const METHOD_NOT_FOUND = -32601;

type MethodAnswer = (
  host: PluginHost,
  params: Record<string, any>
) => unknown;

const METHOD_ANSWERS: Record<string, MethodAnswer> = {
  initialize: (host, params) => ({
    protocolVersion: params.protocolVersion ?? FALLBACK_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: host.pluginName, version: "1.0.0" },
  }),
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
  request: RpcRequest
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
    result: await answerMethod(host, request.params ?? {}),
  };
};

export const serveMcp = async (host: PluginHost) => {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const response = await answerRequest(host, JSON.parse(line));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
};
