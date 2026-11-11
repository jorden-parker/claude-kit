import { expect, test } from "claude-code/testing";
import {
  COMMENT_LABELS,
  formatConventionalComment,
  readConventionalComment,
} from "./conventional-comment";

test("formats label, decorations, subject and discussion", () => {
  const formattedComment = formatConventionalComment({
    label: "suggestion",
    decorations: ["non-blocking", "test"],
    subject: "Cover the empty list.",
    discussion: "The loop is skipped when `ideas` is empty.",
  });

  expect(formattedComment).toBe(
    "**suggestion (non-blocking, test):** Cover the empty list.\n\nThe loop is skipped when `ideas` is empty."
  );
});

test("formats a comment with neither decorations nor discussion on one line", () => {
  const formattedComment = formatConventionalComment({
    label: "praise",
    decorations: [],
    subject: "Clear naming throughout.",
    discussion: "",
  });

  expect(formattedComment).toBe("**praise:** Clear naming throughout.");
});

test("the labels are the Conventional Comments labels", () => {
  expect(Object.keys(COMMENT_LABELS)).toEqual([
    "praise",
    "nitpick",
    "suggestion",
    "issue",
    "todo",
    "question",
    "thought",
    "chore",
    "note",
    "typo",
    "polish",
    "quibble",
  ]);
});

test("reads a well-formed comment and trims its text", () => {
  const commentReading = readConventionalComment({
    label: "Issue",
    decorations: ["blocking"],
    subject: "  The token is logged.  ",
    discussion: " Remove the log line. ",
  });

  expect(commentReading).toEqual({
    comment: {
      label: "issue",
      decorations: ["blocking"],
      subject: "The token is logged.",
      discussion: "Remove the log line.",
    },
    problems: [],
  });
});

test("a comment without decorations or discussion reads as empty ones", () => {
  const commentReading = readConventionalComment({
    label: "question",
    subject: "Is the retry needed?",
  });

  expect(commentReading.comment).toEqual({
    label: "question",
    decorations: [],
    subject: "Is the retry needed?",
    discussion: "",
  });
});

test("names an unknown label, a missing subject and clashing decorations", () => {
  const commentReading = readConventionalComment({
    label: "bug",
    decorations: ["blocking", "non-blocking", "Not Valid"],
    subject: " ",
  });

  expect(commentReading.comment).toBeUndefined();
  expect(commentReading.problems).toEqual([
    'label "bug" is not one of praise, nitpick, suggestion, issue, todo, question, thought, chore, note, typo, polish, quibble',
    "subject is empty",
    "decorations hold both blocking and non-blocking",
    'decoration "Not Valid" must be lowercase words joined by hyphens',
  ]);
});
