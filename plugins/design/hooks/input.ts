export const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const readList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const readFields = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const readTextList = (value: unknown) =>
  readList(value).map(readText).filter(Boolean);

export const listProblemUnless = (isFine: unknown, problem: string) =>
  isFine ? [] : [problem];

export const listUnknownValue = (
  label: string,
  value: string,
  knownValues: readonly string[]
) =>
  listProblemUnless(
    knownValues.includes(value),
    `${label} "${value}" is not one of ${knownValues.join(", ")}.`
  );
