import { expect, test } from "claude-code/testing";
import { findHardcodedValues, normalizeLiteral } from "./hardcoded-values";

test("hex colors and color functions are found, with every line that uses them", () => {
  const sourceText = [
    ".card{color:#FFF;border:1px solid rgb(0 0 0 / 0.1)}",
    ".note{background:#fff}",
    ".link{color:oklch(0.55 0.2 262)}",
    ".old{color:hsla(0, 0%, 0%, .5);fill:#12345678}",
  ].join("\n");

  expect(findHardcodedValues(sourceText, ["color"])).toEqual([
    { kind: "color", value: "#FFF", lines: [1, 2] },
    { kind: "color", value: "rgb(0 0 0 / 0.1)", lines: [1] },
    { kind: "color", value: "oklch(0.55 0.2 262)", lines: [3] },
    { kind: "color", value: "hsla(0, 0%, 0%, .5)", lines: [4] },
    { kind: "color", value: "#12345678", lines: [4] },
  ]);
});

test("a value used twice on one line lists that line once", () => {
  const foundValues = findHardcodedValues(".card{color:#111;background:#111}", [
    "color",
  ]);

  expect(foundValues).toEqual([{ kind: "color", value: "#111", lines: [1] }]);
});

test("anything that goes through a variable is not a literal", () => {
  const sourceText = [
    ".card{color:var(--foreground);background:rgb(var(--primary) / 0.5)}",
    ".card{font-family:var(--font-sans);font-size:var(--text-sm);padding:var(--space-2)}",
    '<p className="text-[var(--muted)] p-[var(--space-2)]">',
  ].join("\n");

  expect(findHardcodedValues(sourceText)).toEqual([]);
});

test("text that only looks like a color is left alone", () => {
  const sourceText = [
    '<a href="#section">&#8212; see #header-nav</a>',
    "const anchor = '#topbar';",
  ].join("\n");

  expect(findHardcodedValues(sourceText, ["color"])).toEqual([]);
});

test("font families are found in CSS, in inline styles and in style objects", () => {
  const sourceText = [
    '.title{font-family:"Inter", sans-serif;color:var(--foreground)}',
    '<p style="font-family: Georgia">',
    'const titleStyle = { fontFamily: "Inter, sans-serif", fontWeight: 600 };',
    ".inherits{font-family:inherit}",
  ].join("\n");

  expect(findHardcodedValues(sourceText, ["font"])).toEqual([
    { kind: "font", value: '"Inter", sans-serif', lines: [1, 3] },
    { kind: "font", value: "Georgia", lines: [2] },
  ]);
});

test("font sizes are found in CSS and in style objects, relative sizes are not", () => {
  const sourceText = [
    ".title{font-size:13px}",
    'const titleStyle = { fontSize: "1.25rem", lineHeight: 1.2 };',
    "const captionStyle = { fontSize: 11 };",
    ".relative{font-size:1em}.keyword{font-size:inherit}.percent{font-size:100%}",
  ].join("\n");

  expect(findHardcodedValues(sourceText, ["text-size"])).toEqual([
    { kind: "text-size", value: "13px", lines: [1] },
    { kind: "text-size", value: "1.25rem", lines: [2] },
    { kind: "text-size", value: "11", lines: [3] },
  ]);
});

test("Tailwind arbitrary values count by what their utility sets", () => {
  const sourceText = [
    '<p className="text-[13px] hover:bg-[#fff] p-[7px] -mt-[0.5rem] gap-x-[6px]">',
    '<p className="font-[Georgia] font-[600] w-[320px] grid-cols-[1fr_2fr] text-[#111]">',
  ].join("\n");

  expect(findHardcodedValues(sourceText)).toEqual([
    { kind: "color", value: "#fff", lines: [1] },
    { kind: "text-size", value: "13px", lines: [1] },
    { kind: "space", value: "7px", lines: [1] },
    { kind: "space", value: "0.5rem", lines: [1] },
    { kind: "space", value: "6px", lines: [1] },
    { kind: "color", value: "#111", lines: [2] },
    { kind: "font", value: "Georgia", lines: [2] },
  ]);
});

test("px and rem literals are found in spacing declarations only", () => {
  const sourceText = [
    ".card{padding:8px 16px;margin-top:1.5rem;width:320px;border-radius:6px}",
    'const stackStyle = { rowGap: "12px", paddingLeft: "8px", width: "200px" };',
    ".flush{margin:0;inset:0 auto;gap:2em}",
  ].join("\n");

  expect(findHardcodedValues(sourceText, ["space"])).toEqual([
    { kind: "space", value: "8px", lines: [1, 2] },
    { kind: "space", value: "16px", lines: [1] },
    { kind: "space", value: "1.5rem", lines: [1] },
    { kind: "space", value: "12px", lines: [2] },
  ]);
});

test("only the wanted kinds are searched", () => {
  const sourceText = ".card{color:#111;font-family:Georgia;padding:8px}";

  expect(
    findHardcodedValues(sourceText, ["color", "font"]).map(
      (foundValue) => foundValue.kind
    )
  ).toEqual(["color", "font"]);
});

test("normalizing ignores case, quotes, spacing and short hex", () => {
  expect(normalizeLiteral("#FFF")).toBe("#ffffff");
  expect(normalizeLiteral("#abcd")).toBe("#aabbccdd");
  expect(normalizeLiteral("#2563EB")).toBe("#2563eb");
  expect(normalizeLiteral('"Inter",  sans-serif')).toBe("inter,sans-serif");
  expect(normalizeLiteral("Inter, sans-serif")).toBe("inter,sans-serif");
});
