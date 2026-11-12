import { expect, test } from "claude-code/testing";
import {
  hasDarkValues,
  readTheme,
  readTokenSource,
  readTokens,
  renderThemeCss,
  type ThemeToken,
} from "./theme";

const LIGHT_ONLY_TOKENS: ThemeToken[] = [
  {
    name: "colors.Primary 500",
    kind: "color",
    value: "#0f62fe",
    source: "tailwind.config.ts:12",
    isInferred: false,
  },
  {
    name: "--radius-md",
    kind: "radius",
    value: "8px",
    source: "src/app/globals.css:9",
    isInferred: false,
  },
];

const DARK_TOKEN: ThemeToken = {
  name: "surface",
  kind: "color",
  value: "#ffffff",
  darkValue: "#0b0b0c",
  source: "src/app/globals.css:4",
  isInferred: false,
};

test("each token becomes a CSS variable named by its slug", () => {
  expect(renderThemeCss(LIGHT_ONLY_TOKENS)).toBe(
    ":root{--colors-primary-500:#0f62fe;--radius-md:8px}"
  );
});

test("a theme without dark values gets no dark block", () => {
  expect(hasDarkValues(LIGHT_ONLY_TOKENS)).toBe(false);
  expect(renderThemeCss(LIGHT_ONLY_TOKENS)).not.toContain("data-theme");
});

test("dark values go in a block that a dark-rooted document turns on", () => {
  const tokens = [...LIGHT_ONLY_TOKENS, DARK_TOKEN];

  expect(hasDarkValues(tokens)).toBe(true);
  expect(renderThemeCss(tokens)).toBe(
    ":root{--colors-primary-500:#0f62fe;--radius-md:8px;--surface:#ffffff}" +
      ':root[data-theme="dark"]{color-scheme:dark;--surface:#0b0b0c}'
  );
});

test("a value cannot close its declaration, its block or the style tag", () => {
  const hostileToken: ThemeToken = {
    ...DARK_TOKEN,
    value: "red;}</style><b>{",
  };

  expect(renderThemeCss([hostileToken])).toContain("--surface:red/styleb}");
});

test("a color keeps the slash before its alpha", () => {
  const shadowToken: ThemeToken = {
    ...DARK_TOKEN,
    value: "oklch(0.2 0.01 250 / 12%)",
    darkValue: undefined,
  };

  expect(renderThemeCss([shadowToken])).toBe(
    ":root{--surface:oklch(0.2 0.01 250 / 12%)}"
  );
});

test("a font value keeps its quotes and commas", () => {
  const fontToken: ThemeToken = {
    name: "font-sans",
    kind: "font",
    value: '"Inter", system-ui, sans-serif',
    source: "tailwind.config.ts:20",
    isInferred: false,
  };

  expect(renderThemeCss([fontToken])).toBe(
    ':root{--font-sans:"Inter", system-ui, sans-serif}'
  );
});

test("a token source splits into its path and line", () => {
  expect(readTokenSource("./src/app/globals.css:12")).toEqual({
    path: "src/app/globals.css",
    line: 12,
  });
  expect(readTokenSource("src/app/globals.css")).toBeUndefined();
  expect(readTokenSource("globals.css:top")).toBeUndefined();
});

const RAW_THEME = {
  tokens: [
    {
      name: "surface",
      kind: "color",
      value: " #ffffff ",
      darkValue: "#0b0b0c",
      source: "src/app/globals.css:4",
    },
    {
      name: "radius-md",
      kind: "radius",
      value: "8px",
      source: "src/app/globals.css:9",
      isInferred: true,
    },
  ],
  stack: { framework: "Next.js", styling: "Tailwind v4" },
  components: [
    { name: "Button", path: "src/ui/button.tsx", variants: ["primary", 7] },
    { path: "src/ui/nameless.tsx" },
  ],
  inconsistencies: ["Five near-identical grays", ""],
};

test("a raw theme is read into the theme shape, with defaults for what is missing", () => {
  expect(readTheme(RAW_THEME)).toEqual({
    problems: [],
    theme: {
      tokens: [
        {
          name: "surface",
          kind: "color",
          value: "#ffffff",
          darkValue: "#0b0b0c",
          source: "src/app/globals.css:4",
          isInferred: false,
        },
        {
          name: "radius-md",
          kind: "radius",
          value: "8px",
          source: "src/app/globals.css:9",
          isInferred: true,
        },
      ],
      stack: {
        framework: "Next.js",
        styling: "Tailwind v4",
        darkMode: "",
        iconSet: "",
      },
      components: [
        { name: "Button", path: "src/ui/button.tsx", variants: ["primary"] },
      ],
      inconsistencies: ["Five near-identical grays"],
    },
  });
});

test("a theme without tokens is a problem", () => {
  expect(readTheme({}).problems).toEqual([
    "The theme needs at least one token.",
  ]);
  expect(readTheme({ tokens: "none" }).problems).toEqual([
    "The theme needs at least one token.",
  ]);
});

test("every broken token is named with everything wrong with it", () => {
  const { problems } = readTheme({
    tokens: [
      { name: "primary", kind: "colour", value: "#2563eb", source: "a.css:1" },
      { name: "ring", kind: "color", value: "#2563eb", source: "globals.css" },
      { kind: "space", source: "a.css:2" },
    ],
  });

  expect(problems).toEqual([
    'Token "primary": kind "colour" is not one of color, font, text-size, space, radius, shadow.',
    'Token "ring": source "globals.css" must be path:line, such as src/app/globals.css:12.',
    "Token 3: needs a name and a value.",
  ]);
});

test("proposed tokens need no source", () => {
  expect(
    readTokens(
      [{ name: "accent-soft", kind: "color", value: "#e8f0ff" }],
      false
    )
  ).toEqual({
    problems: [],
    tokens: [
      {
        name: "accent-soft",
        kind: "color",
        value: "#e8f0ff",
        source: "proposed",
        isInferred: false,
      },
    ],
  });
  expect(readTokens(undefined, false)).toEqual({ problems: [], tokens: [] });
});
