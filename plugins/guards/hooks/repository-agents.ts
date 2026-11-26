export const REPOSITORY_AGENT_TYPES: readonly string[] = [
  "brainstorm:plan-reviewer",
  "brainstorm:step-implementer",
  "brainstorm:step-reader",
  "guards:context-scout",
  "guards:generalist",
  "guards:planner",
  "guards:reviewer",
  "guards:web-researcher",
  "guards:worker",
  "handoff:recap",
  "prompt-optimizer:rewriter",
  "small-plans:small-plan-implementer",
  "small-plans:small-plan-reviewer",
];

type SpawnDecision = { deny: string } | { model?: string };

export function isRepositoryAgent(agentType: string | undefined): boolean {
  return agentType !== undefined && REPOSITORY_AGENT_TYPES.includes(agentType);
}

export function describeBlockedAgent(agentType: string | undefined): string {
  const blocked =
    agentType === undefined
      ? "A call with no subagent_type is denied"
      : `The agent type "${agentType}" is denied`;
  return `${blocked}; only this repository's agents run: ${REPOSITORY_AGENT_TYPES.join(", ")}. Use guards:context-scout for lookups, guards:worker for edits and checks, guards:web-researcher for the web, guards:generalist for anything else.`;
}

export function parseSavedModels(text: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(([, model]) => typeof model === "string")
  );
}

export function resolveSpawn(
  agentType: string,
  savedModels: Record<string, string>
): SpawnDecision {
  if (!isRepositoryAgent(agentType)) {
    return { deny: describeBlockedAgent(agentType) };
  }
  const model = Object.hasOwn(savedModels, agentType)
    ? savedModels[agentType]
    : undefined;
  return model ? { model } : {};
}
