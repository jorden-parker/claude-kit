import { expect, test } from "claude-code/testing";
import { isContentPreserved, tidyNote } from "./tidy-format";

const tidy = (text: string, store = "brainstorm") => tidyNote(text, store).text;

test("CRLF line endings become LF", () => {
  expect(tidy("one\r\ntwo\r\n")).toBe("one\ntwo\n");
});

test("trailing spaces and tabs are removed", () => {
  expect(tidy("one \t\ntwo   \n\nthree\n")).toBe("one\ntwo\n\nthree\n");
});

test("a hard line break keeps exactly two spaces", () => {
  expect(tidy("one     \ntwo\n")).toBe("one  \ntwo\n");
  expect(tidy("one  \n\ntwo\n")).toBe("one\n\ntwo\n");
});

test("leading blank lines go and the file ends in one newline", () => {
  expect(tidy("\n\nbody\n\n\n")).toBe("body\n");
});

test("runs of blank lines become one", () => {
  expect(tidy("one\n\n\n\ntwo\n")).toBe("one\n\ntwo\n");
});

test("headings get one blank line before and after", () => {
  expect(tidy("text\n## Head\nmore\n")).toBe("text\n\n## Head\n\nmore\n");
  expect(tidy("# Head\ntext\n")).toBe("# Head\n\ntext\n");
  expect(tidy("text\n\n\n## Head\n")).toBe("text\n\n## Head\n");
});

test("star and plus bullets become dashes, indent kept", () => {
  expect(tidy("* one\n  + two\n- three\n")).toBe("- one\n  - two\n- three\n");
});

test("thematic breaks are kept", () => {
  expect(tidy("a\n\n* * *\n\n***\n")).toBe("a\n\n* * *\n\n***\n");
});

test("fenced code is never changed", () => {
  const fenced =
    "```\n* star  \n\n\n# not a heading\n\ttabbed\n```\n\n~~~\n+ plus \n~~~\n";
  expect(tidy(fenced)).toBe(fenced);
});

test("front matter loses blank lines and gets one blank line after", () => {
  expect(tidy("---\ntitle: A\n\nproject: b\n---\nbody\n")).toBe(
    "---\ntitle: A\nproject: b\n---\n\nbody\n"
  );
  expect(tidy("---\na: 1\n---\n\n\n\nbody\n")).toBe("---\na: 1\n---\n\nbody\n");
});

test("handoff front matter keys are reordered, unknown keys follow", () => {
  const text =
    "---\nfocus: f\nzzz: 1\ncwd: /x\ncreated: now\nproject: p\ntitle: t\naaa: 2\n---\n\nbody\n";
  expect(tidy(text, "handoffs")).toBe(
    "---\ntitle: t\nproject: p\ncreated: now\ncwd: /x\nfocus: f\nzzz: 1\naaa: 2\n---\n\nbody\n"
  );
});

test("project-note front matter keys are reordered", () => {
  const text =
    "---\nsource: s\ncategory: fact\ncreated: now\nproject: p\ntitle: t\n---\n\nbody\n";
  expect(tidy(text, "project-notes")).toBe(
    "---\ntitle: t\nproject: p\ncreated: now\ncategory: fact\nsource: s\n---\n\nbody\n"
  );
});

test("other stores keep their key order", () => {
  const text = "---\nstatus: a\nproject: p\n---\n\nbody\n";
  expect(tidy(text, "small-plans")).toBe(text);
});

test("a multi-line front matter value stops reordering", () => {
  const text =
    "---\ntitle: t\nproject: p\nfocus: a\n  continued\ncwd: /x\n---\n\nbody\n";
  expect(tidy(text, "handoffs")).toBe(text);
});

test("tidying twice gives the same text as once", () => {
  const messy =
    "\n---\nfocus: f\n\ntitle: t\n---\nintro  \n* a\n+ b\n## H\ntext\n\n\n```\nx  \n\n\n```\n# T\n* * *\n\n";
  const once = tidy(messy, "handoffs");
  expect(tidy(once, "handoffs")).toBe(once);
});

const problemsOf = (text: string, store: string, fileName = "") =>
  tidyNote(text, store, fileName).problems;

test("handoffs and project-notes report missing front matter and an H1", () => {
  for (const store of ["handoffs", "project-notes"]) {
    expect(problemsOf("# Title\n", store)).toEqual([
      "missing front matter",
      "H1 in the body, the title belongs in front matter",
    ]);
    expect(problemsOf("---\ntitle: t\n---\n\nbody\n", store)).toEqual([]);
  }
});

test("an H1 inside a fence is not an H1", () => {
  expect(problemsOf("---\na: 1\n---\n\n```\n# x\n```\n", "handoffs")).toEqual(
    []
  );
});

test("brainstorm reports front matter and any H1 count other than one", () => {
  expect(problemsOf("# One\n", "brainstorm")).toEqual([]);
  expect(problemsOf("text\n", "brainstorm")).toEqual([
    "expected one H1, found 0",
  ]);
  expect(problemsOf("# A\n\n# B\n", "brainstorm")).toEqual([
    "expected one H1, found 2",
  ]);
  expect(problemsOf("---\na: 1\n---\n\n# One\n", "brainstorm")).toEqual([
    "has front matter",
  ]);
});

test("small-plans use the handoff checks, except the generated index", () => {
  expect(problemsOf("# Plans\n", "small-plans")).toHaveLength(2);
  expect(problemsOf("# Plans\n", "small-plans", "index.md")).toEqual([]);
  expect(problemsOf("---\nstatus: a\n---\n\n## Goal\n", "small-plans")).toEqual(
    []
  );
});

test("every store reports a bad file name", () => {
  expect(problemsOf("# One\n", "brainstorm", "Bad_Name.md")).toEqual([
    "file name does not match ^[a-z0-9]+([.-][a-z0-9]+)*\\.md$",
  ]);
  expect(problemsOf("# One\n", "brainstorm", "2026-01-01-ok.v2.md")).toEqual(
    []
  );
});

test("a tab outside fenced code is reported", () => {
  expect(problemsOf("# One\n\n\tindented\n", "brainstorm")).toEqual([
    "tab character outside fenced code",
  ]);
  expect(problemsOf("# One\n\n```\n\tindented\n```\n", "brainstorm")).toEqual(
    []
  );
});

test("an unclosed fence is left as it is and stays stable", () => {
  const unclosed = "# a\n\n```\ncode\n";
  expect(tidy(unclosed)).toBe(unclosed);
  expect(tidy(tidy(unclosed))).toBe(tidy(unclosed));
});

test("indented code is left as it is", () => {
  const indented = "para\n\n    * not bullet\n    code   \n\n\n    more\n";
  expect(tidy(indented)).toBe(indented);
  expect(tidy("para\n\n\n\ntext\n")).toBe("para\n\ntext\n");
  expect(tidy("a\n\t* tabbed\n")).toBe("a\n\t* tabbed\n");
});

test("HTML blocks are left as they are", () => {
  const preBlock = "<pre>\na\n\n\n# x\n</pre>\n";
  expect(tidy(preBlock)).toBe(preBlock);
  const commentBlock = "text\n\n<!--\n* a  \n\n\n-->\n";
  expect(tidy(commentBlock)).toBe(commentBlock);
  expect(tidy("<style>a {}</style>\n* a\n")).toBe("<style>a {}</style>\n- a\n");
});

test("a thematic break at the top is not front matter", () => {
  const rule = "---\n\nintro text\n\n---\n\nbody\n";
  expect(tidy(rule, "handoffs")).toBe(rule);
});

test("front matter with a block scalar keeps its blank line and order", () => {
  const text = "---\nfocus: f\nnote: |\n  a\n\n  b\ntitle: t\n---\nbody\n";
  expect(tidy(text, "handoffs")).toBe(
    "---\nfocus: f\nnote: |\n  a\n\n  b\ntitle: t\n---\n\nbody\n"
  );
});

test("the content guard accepts reformatting and rejects changed words", () => {
  expect(isContentPreserved("* b\n\n\na  \n", "a\n\n- b\n")).toBe(false);
  expect(isContentPreserved("* a\n\n\nb  \n", "- a\nb\n")).toBe(true);
  expect(isContentPreserved("a\nb\n", "a\nc\n")).toBe(false);
});

test("the content guard rejects reordered body lines and changed indentation", () => {
  expect(isContentPreserved("a\nb\n", "b\na\n")).toBe(false);
  expect(isContentPreserved("    code\n", "code\n")).toBe(false);
});

test("the content guard allows front matter keys to move but not body lines", () => {
  expect(
    isContentPreserved(
      "---\nb: 1\na: 2\n---\nx\n",
      "---\na: 2\nb: 1\n---\n\nx\n"
    )
  ).toBe(true);
  expect(isContentPreserved("---\nb: 1\n---\nx\n", "---\nb: 1\n---\ny\n")).toBe(
    false
  );
});

test("the content guard accepts a lone CR against its LF output", () => {
  expect(isContentPreserved("a\rb\r", "a\nb\n")).toBe(true);
});
