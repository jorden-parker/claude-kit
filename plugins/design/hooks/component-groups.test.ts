import { expect, test } from "claude-code/testing";
import { checkComponentGroups, readComponentGroups } from "./component-groups";

const FILTER_GROUP = {
  purpose: "Filtering and selecting results",
  components: [
    {
      name: "FilterBar",
      path: "src/ui/filter-bar.tsx",
      usedIn: 12,
      notes: "Chips with a clear-all action.",
    },
    {
      name: "ResultFilter",
      path: "src/search/result-filter.tsx",
      usedIn: 2,
      notes: "A dropdown, no keyboard support.",
    },
  ],
  discrepancies: [
    { aspect: "look", detail: "Chips in one, a dropdown in the other." },
    { aspect: "behavior", detail: "Only FilterBar can clear every filter." },
  ],
  recommended: "FilterBar",
  reasoning: "It is used six times as often and is keyboard accessible.",
};

const EXISTING_PATHS = [
  "src/ui/filter-bar.tsx",
  "src/search/result-filter.tsx",
];

const hasFile = (filePath: string) => EXISTING_PATHS.includes(filePath);

const checkRawGroups = (rawGroups: unknown) =>
  checkComponentGroups(readComponentGroups(rawGroups), hasFile);

test("a well-formed group is read as it is and has no problems", () => {
  expect(readComponentGroups([FILTER_GROUP])).toEqual([FILTER_GROUP]);
  expect(checkRawGroups([FILTER_GROUP])).toEqual([]);
});

test("no groups is not a problem", () => {
  expect(readComponentGroups(undefined)).toEqual([]);
  expect(checkRawGroups(undefined)).toEqual([]);
});

test("a use count that is not a whole number counts as zero", () => {
  const [group] = readComponentGroups([
    {
      ...FILTER_GROUP,
      components: [
        { ...FILTER_GROUP.components[0], usedIn: "many" },
        { ...FILTER_GROUP.components[1], usedIn: -3 },
      ],
    },
  ]);

  expect(group?.components.map((component) => component.usedIn)).toEqual([
    0, 0,
  ]);
});

test("a group needs a purpose and a reasoning", () => {
  expect(
    checkRawGroups([{ ...FILTER_GROUP, purpose: " ", reasoning: "" }])
  ).toEqual(["Group 1: needs a purpose and a reasoning."]);
});

test("a group needs at least two components", () => {
  expect(
    checkRawGroups([
      FILTER_GROUP,
      { ...FILTER_GROUP, components: [FILTER_GROUP.components[0]] },
    ])
  ).toEqual(["Group 2: needs at least two components, and has 1."]);
});

test("a component needs a name and a path that exists", () => {
  expect(
    checkRawGroups([
      {
        ...FILTER_GROUP,
        components: [
          ...FILTER_GROUP.components,
          { name: "", path: "src/ui/filter-bar.tsx", usedIn: 1, notes: "" },
          { name: "Ghost", path: "src/ui/ghost.tsx", usedIn: 1, notes: "" },
          { name: "Pathless", usedIn: 1, notes: "" },
        ],
      },
    ])
  ).toEqual([
    "Group 1: component 3 needs a name.",
    'Group 1: component "Ghost": path "src/ui/ghost.tsx" does not exist.',
    'Group 1: component "Pathless": path "" does not exist.',
  ]);
});

test("a discrepancy needs a known aspect and a detail", () => {
  expect(
    checkRawGroups([
      {
        ...FILTER_GROUP,
        discrepancies: [
          { aspect: "style", detail: "Different radius." },
          { aspect: "look", detail: "" },
        ],
      },
    ])
  ).toEqual([
    'Group 1: aspect "style" is not one of look, behavior, implementation.',
    "Group 1: discrepancy 2 needs a detail.",
  ]);
});

test("the recommended component is one of the group's own", () => {
  expect(
    checkRawGroups([{ ...FILTER_GROUP, recommended: "SearchBox" }])
  ).toEqual([
    'Group 1: recommended "SearchBox" is not the name of one of its components.',
  ]);
});

test("one component cannot be listed twice", () => {
  expect(
    checkRawGroups([
      {
        ...FILTER_GROUP,
        components: [
          ...FILTER_GROUP.components,
          { ...FILTER_GROUP.components[0], notes: "Again." },
        ],
      },
    ])
  ).toEqual(["Group 1: FilterBar at src/ui/filter-bar.tsx is listed twice."]);
});

test("every problem of every group is listed", () => {
  expect(
    checkRawGroups([
      { ...FILTER_GROUP, purpose: "", recommended: "Nobody" },
      { ...FILTER_GROUP, components: [] },
    ])
  ).toEqual([
    "Group 1: needs a purpose and a reasoning.",
    'Group 1: recommended "Nobody" is not the name of one of its components.',
    "Group 2: needs at least two components, and has 0.",
    'Group 2: recommended "FilterBar" is not the name of one of its components.',
  ]);
});
