import { expect, test } from "claude-code/testing";
import { parseDiff, readCommentContext } from "./diff-lines";

const DIFF_TEXT = [
  "diff --git a/src/auth.ts b/src/auth.ts",
  "index 1111111..2222222 100644",
  "--- a/src/auth.ts",
  "+++ b/src/auth.ts",
  "@@ -10,5 +10,6 @@ export const login = () => {",
  " const token = readToken();",
  "-console.log(token);",
  "+--- token is no longer logged",
  "+audit(token.id);",
  " if (!token) return;",
  " refresh(token);",
  " return token;",
  "@@ -40,3 +41,3 @@",
  " const later = 1;",
  "-const stale = 2;",
  "+const fresh = 2;",
  " export {};",
  "\\ No newline at end of file",
  "diff --git a/old name.md b/new name.md",
  "similarity index 90%",
  "rename from old name.md",
  "rename to new name.md",
  "--- a/old name.md",
  "+++ b/new name.md\t",
  "@@ -1 +1 @@",
  "-# Old",
  "+# New",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-first",
  "-second",
].join("\n");

test("parses each changed file with its old and new line numbers", () => {
  const fileDiffs = parseDiff(DIFF_TEXT);

  expect(fileDiffs.map((fileDiff) => fileDiff.path)).toEqual([
    "src/auth.ts",
    "new name.md",
    "gone.ts",
  ]);
  expect(fileDiffs[0]?.lines.slice(0, 4)).toEqual([
    {
      marker: " ",
      leftNumber: 10,
      rightNumber: 10,
      hunkIndex: 0,
      text: "const token = readToken();",
    },
    {
      marker: "-",
      leftNumber: 11,
      rightNumber: undefined,
      hunkIndex: 0,
      text: "console.log(token);",
    },
    {
      marker: "+",
      leftNumber: undefined,
      rightNumber: 11,
      hunkIndex: 0,
      text: "--- token is no longer logged",
    },
    {
      marker: "+",
      leftNumber: undefined,
      rightNumber: 12,
      hunkIndex: 0,
      text: "audit(token.id);",
    },
  ]);
});

test("numbers the second hunk from its own header", () => {
  const authLines = parseDiff(DIFF_TEXT)[0]?.lines ?? [];

  expect(authLines.at(-1)).toEqual({
    marker: " ",
    leftNumber: 42,
    rightNumber: 43,
    hunkIndex: 1,
    text: "export {};",
  });
});

test("the context of a new-side line is the hunk lines leading up to it", () => {
  const contextLines = readCommentContext(parseDiff(DIFF_TEXT), {
    path: "src/auth.ts",
    side: "RIGHT",
    line: 13,
  });

  expect(contextLines?.map((contextLine) => contextLine.text)).toEqual([
    "const token = readToken();",
    "console.log(token);",
    "--- token is no longer logged",
    "audit(token.id);",
    "if (!token) return;",
  ]);
});

test("the context does not reach back into an earlier hunk", () => {
  const contextLines = readCommentContext(parseDiff(DIFF_TEXT), {
    path: "src/auth.ts",
    side: "RIGHT",
    line: 41,
  });

  expect(contextLines?.map((contextLine) => contextLine.text)).toEqual([
    "const later = 1;",
  ]);
});

test("a removed line is found on the old side only", () => {
  const fileDiffs = parseDiff(DIFF_TEXT);
  const removedLine = { path: "src/auth.ts", line: 41 };

  expect(
    readCommentContext(fileDiffs, { ...removedLine, side: "LEFT" })?.at(-1)
      ?.text
  ).toBe("const stale = 2;");
  expect(
    readCommentContext(fileDiffs, { path: "gone.ts", side: "RIGHT", line: 1 })
  ).toBeUndefined();
});

test("a line range starts its context at the range's first line", () => {
  const contextLines = readCommentContext(parseDiff(DIFF_TEXT), {
    path: "src/auth.ts",
    side: "RIGHT",
    startLine: 11,
    line: 13,
  });

  expect(contextLines?.map((contextLine) => contextLine.rightNumber)).toEqual([
    11, 12, 13,
  ]);
});

test("a line outside the diff, an unknown file and a range across hunks have no context", () => {
  const fileDiffs = parseDiff(DIFF_TEXT);

  expect(
    readCommentContext(fileDiffs, {
      path: "src/auth.ts",
      side: "RIGHT",
      line: 30,
    })
  ).toBeUndefined();
  expect(
    readCommentContext(fileDiffs, {
      path: "missing.ts",
      side: "RIGHT",
      line: 1,
    })
  ).toBeUndefined();
  expect(
    readCommentContext(fileDiffs, {
      path: "src/auth.ts",
      side: "RIGHT",
      startLine: 14,
      line: 42,
    })
  ).toBeUndefined();
});
