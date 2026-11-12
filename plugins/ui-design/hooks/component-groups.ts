import {
  listProblemUnless,
  listUnknownValue,
  readFields,
  readList,
  readText,
} from "./input";

export const DISCREPANCY_ASPECTS = [
  "look",
  "behavior",
  "implementation",
] as const;

export type DiscrepancyAspect = (typeof DISCREPANCY_ASPECTS)[number];

export type GroupComponent = {
  name: string;
  path: string;
  usedIn: number;
  notes: string;
};

export type Discrepancy = { aspect: DiscrepancyAspect; detail: string };

export type ComponentGroup = {
  purpose: string;
  components: GroupComponent[];
  discrepancies: Discrepancy[];
  recommended: string;
  reasoning: string;
};

export type NumberedGroup = ComponentGroup & { number: number };

const MINIMUM_COMPONENTS = 2;

const readUseCount = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;

const readComponent = (rawComponent: unknown): GroupComponent => {
  const fields = readFields(rawComponent);
  return {
    name: readText(fields.name),
    path: readText(fields.path),
    usedIn: readUseCount(fields.usedIn),
    notes: readText(fields.notes),
  };
};

const readDiscrepancy = (rawDiscrepancy: unknown): Discrepancy => {
  const fields = readFields(rawDiscrepancy);
  return {
    aspect: readText(fields.aspect) as DiscrepancyAspect,
    detail: readText(fields.detail),
  };
};

export const readComponentGroups = (rawGroups: unknown): ComponentGroup[] =>
  readList(rawGroups).map((rawGroup) => {
    const fields = readFields(rawGroup);
    return {
      purpose: readText(fields.purpose),
      components: readList(fields.components).map(readComponent),
      discrepancies: readList(fields.discrepancies).map(readDiscrepancy),
      recommended: readText(fields.recommended),
      reasoning: readText(fields.reasoning),
    };
  });

const isSameComponent = (first: GroupComponent, second: GroupComponent) =>
  first.name === second.name && first.path === second.path;

const checkComponents = (
  components: GroupComponent[],
  hasFile: (filePath: string) => boolean
) => [
  ...components.flatMap((component, componentIndex) => {
    const label = component.name
      ? `component "${component.name}"`
      : `component ${componentIndex + 1}`;
    return [
      ...listProblemUnless(component.name, `${label} needs a name.`),
      ...listProblemUnless(
        hasFile(component.path),
        `${label}: path "${component.path}" does not exist.`
      ),
    ];
  }),
  ...components
    .filter(
      (component, componentIndex) =>
        components.findIndex((earlierComponent) =>
          isSameComponent(earlierComponent, component)
        ) < componentIndex
    )
    .map(
      (component) => `${component.name} at ${component.path} is listed twice.`
    ),
];

const checkDiscrepancies = (discrepancies: Discrepancy[]) =>
  discrepancies.flatMap((discrepancy, discrepancyIndex) => [
    ...listUnknownValue("aspect", discrepancy.aspect, DISCREPANCY_ASPECTS),
    ...listProblemUnless(
      discrepancy.detail,
      `discrepancy ${discrepancyIndex + 1} needs a detail.`
    ),
  ]);

export const checkComponentGroups = (
  groups: ComponentGroup[],
  hasFile: (filePath: string) => boolean
) =>
  groups.flatMap((group, groupIndex) =>
    [
      ...listProblemUnless(
        group.purpose && group.reasoning,
        "needs a purpose and a reasoning."
      ),
      ...listProblemUnless(
        group.components.length >= MINIMUM_COMPONENTS,
        `needs at least two components, and has ${group.components.length}.`
      ),
      ...checkComponents(group.components, hasFile),
      ...checkDiscrepancies(group.discrepancies),
      ...listProblemUnless(
        group.components.some(
          (component) => component.name === group.recommended
        ),
        `recommended "${group.recommended}" is not the name of one of its components.`
      ),
    ].map((problem) => `Group ${groupIndex + 1}: ${problem}`)
  );
