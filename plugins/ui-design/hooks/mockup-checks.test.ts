import { expect, test } from "claude-code/testing";
import {
  listMarkupProblems,
  listNewTokenProblems,
  listRawCssProblems,
} from "./mockup-checks";
import type { ThemeToken } from "./theme";

const buildNewToken = (name: string, value: string): ThemeToken => ({
  name,
  kind: "color",
  value,
  source: "",
  isInferred: false,
});

test("a css literal color or font is refused, and a token variable is not", () => {
  expect(
    listRawCssProblems(
      ".page{color:#FFF;background:rgb(0 0 0);font-family:Georgia}"
    )
  ).toEqual([
    "raw color #FFF in its css. Use var(--token).",
    "raw color rgb(0 0 0) in its css. Use var(--token).",
    "raw font Georgia in its css. Use var(--token).",
  ]);
  expect(
    listRawCssProblems(
      ".page{color:var(--primary);font-family:var(--font-sans)}"
    )
  ).toEqual([]);
});

test("a named color in css, an inline style or an SVG attribute is refused", () => {
  expect(listRawCssProblems(".page{color:white}")).toEqual([
    "raw color white in its css. Use var(--token).",
  ]);
  expect(
    listMarkupProblems('<main style="background: rebeccapurple">Body</main>')
  ).toEqual([
    "raw color rebeccapurple in its html style attributes. Use var(--token).",
  ]);
  expect(listMarkupProblems('<svg><rect fill="red"/></svg>')).toEqual([
    "raw color red in its html color attributes. Use var(--token).",
  ]);
});

test("a style element in the markup is refused", () => {
  expect(
    listMarkupProblems(
      '<STYLE media="screen">main{color:red}</STYLE><main>Body</main>'
    )
  ).toEqual(["a <style> element in its html. Styles belong in css."]);
});

test("a raw font or color in an inline style attribute is refused", () => {
  expect(
    listMarkupProblems(
      "<main style=\"color:#111; font-family: 'Arial'\">Body</main>"
    )
  ).toEqual([
    "raw color #111 in its html style attributes. Use var(--token).",
    "raw font 'Arial' in its html style attributes. Use var(--token).",
  ]);
});

test("a raw color in an SVG color attribute is refused, and a themed one is not", () => {
  expect(
    listMarkupProblems(
      '<svg color="#111"><rect fill="#2563eb" stroke=\'rgb(0 0 0)\'/></svg>'
    )
  ).toEqual([
    "raw color #111 in its html color attributes. Use var(--token).",
    "raw color #2563eb in its html color attributes. Use var(--token).",
    "raw color rgb(0 0 0) in its html color attributes. Use var(--token).",
  ]);
  expect(
    listMarkupProblems(
      '<svg><path fill="currentColor" stroke="var(--primary)" stop-color="none"/></svg>'
    )
  ).toEqual([]);
});

test("text that only looks like markup is not read as markup", () => {
  expect(
    listMarkupProblems(
      '<main><h1>Order #1234</h1><p>Set fill="#fff" or style="color:#000" on the icon.</p></main>'
    )
  ).toEqual([]);
});

test("new tokens are refused above three, and their own problems are listed after", () => {
  const fourTokens = ["a", "b", "c", "d"].map((name) =>
    buildNewToken(name, "#e8f0ff")
  );

  expect(listNewTokenProblems(fourTokens, ['Token "d": broken.'])).toEqual([
    "at most three newTokens, and it has 4.",
    'Token "d": broken.',
  ]);
  expect(listNewTokenProblems(fourTokens.slice(0, 3), [])).toEqual([]);
});
