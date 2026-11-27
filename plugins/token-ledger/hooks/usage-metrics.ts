export type Rates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
export type RequestUsage = {
  agentType?: string;
  requestedModel?: string;
  resolvedModel: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  estimatedCost?: number;
};
export type TaskMetrics = {
  task: number;
  workerCalls: number;
  resumedWorkers: number;
  hookDenials: number;
  requests: RequestUsage[];
  workers?: {
    toolUseId?: string;
    requestedModel?: string;
    agentType?: string;
    resume?: string;
  }[];
};

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

export function parseRates(text: string | undefined): Record<string, Rates> {
  try {
    const parsed = JSON.parse(text ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        const rates = value as Rates;
        return (
          rates &&
          [rates.input, rates.output, rates.cacheRead, rates.cacheWrite].every(
            (value) => count(value) !== undefined
          )
        );
      })
    ) as Record<string, Rates>;
  } catch {
    return {};
  }
}

export function normalizeUsage(
  message: any,
  rates: Record<string, Rates> = {}
): RequestUsage {
  const usage = message.usage ?? {};
  const openaiShape =
    usage.input_tokens_details !== undefined ||
    usage.prompt_tokens !== undefined;
  const cacheRead = count(
    usage.cache_read_input_tokens ??
      usage.cacheReadInputTokens ??
      usage.input_tokens_details?.cached_tokens ??
      usage.prompt_tokens_details?.cached_tokens
  );
  const cacheWrite = count(
    usage.cache_creation_input_tokens ??
      usage.cacheWriteInputTokens ??
      usage.input_tokens_details?.cache_write_tokens
  );
  const totalInput = count(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens
  );
  const input =
    totalInput === undefined
      ? undefined
      : openaiShape
        ? Math.max(0, totalInput - (cacheRead ?? 0) - (cacheWrite ?? 0))
        : totalInput;
  const result: RequestUsage = {
    requestedModel: message.requested_model,
    resolvedModel: message.model ?? "unknown",
    input,
    output: count(
      usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens
    ),
    cacheRead,
    cacheWrite,
    reasoning: count(
      usage.output_tokens_details?.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        usage.reasoning_tokens
    ),
  };
  const price = rates[result.resolvedModel];
  if (
    price &&
    result.input !== undefined &&
    result.output !== undefined &&
    cacheRead !== undefined &&
    cacheWrite !== undefined
  ) {
    result.estimatedCost =
      (result.input * price.input +
        result.output * price.output +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite) /
      1_000_000;
  }
  return result;
}

export function taskMetrics(
  transcript: string,
  rates: Record<string, Rates> = {}
): TaskMetrics[] {
  const tasks: TaskMetrics[] = [];
  const requests = new Map<string, { task: TaskMetrics; message: any }>();
  const seenToolIds = new Set<string>();
  let current: TaskMetrics | undefined;
  for (const line of transcript.split("\n")) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message) continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    if (
      entry.type === "user" &&
      !entry.isMeta &&
      (typeof message.content === "string" ||
        (blocks.some((block: any) => block.type === "text") &&
          !blocks.some((block: any) => block.type === "tool_result")))
    )
      current = undefined;
    if (!current) {
      current = {
        task: tasks.length + 1,
        workerCalls: 0,
        resumedWorkers: 0,
        hookDenials: 0,
        requests: [],
      };
      tasks.push(current);
    }
    for (const block of blocks) {
      if (block.type === "tool_use" && typeof block.id === "string") {
        if (seenToolIds.has(block.id)) continue;
        seenToolIds.add(block.id);
      }
      if (block.type === "tool_use" && ["Agent", "Task"].includes(block.name)) {
        current.workerCalls++;
        (current.workers ??= []).push({
          toolUseId: block.id,
          requestedModel: block.input?.model,
          agentType: block.input?.subagent_type,
          resume: block.input?.resume,
        });
        if (block.input?.resume) current.resumedWorkers++;
      }
      if (
        block.type === "tool_result" &&
        block.is_error &&
        /hook|denied|blocked/i.test(JSON.stringify(block.content))
      )
        current.hookDenials++;
    }
    if (message.id && message.usage)
      requests.set(message.id, { task: current, message });
  }
  for (const { task, message } of requests.values())
    task.requests.push(normalizeUsage(message, rates));
  return tasks;
}
