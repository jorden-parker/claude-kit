import { expect, test } from "claude-code/testing";
import {
  renderDraftPage,
  type PullRequestDraft,
  type ReviewDraft,
} from "./draft-page";

const PULL_REQUEST_DRAFT: PullRequestDraft = {
  kind: "pr",
  draftId: "pr-2026-11-11-1200",
  cwd: "/repo",
  repository: "acme/notes",
  base: "main",
  head: "token-expiry",
  title: 'Reject "expired" tokens <fast>',
  body: "## Summary\n\nStops </script><script>alert(1)</script> early.\n\n## Test plan\n\n- [x] Ran it",
  isDraft: false,
  existingNumber: null,
  existingUrl: "",
  templatePath: ".github/pull_request_template.md",
  templateHeadings: ["## Summary", "## Test plan"],
};

const REVIEW_DRAFT: ReviewDraft = {
  kind: "review",
  draftId: "review-42-2026-11-11-1200",
  cwd: "/repo",
  repository: "acme/notes",
  host: "github.com",
  number: 42,
  title: "Reject expired tokens",
  url: "https://github.com/acme/notes/pull/42",
  author: "octocat",
  base: "main",
  head: "token-expiry",
  headSha: "abc123",
  summary: "Close. Two things before merging.",
  event: "COMMENT",
  comments: [
    {
      path: "src/auth.ts",
      side: "RIGHT",
      line: 12,
      startLine: null,
      label: "issue",
      decorations: ["blocking", "security"],
      subject: "The token is logged <in full>.",
      discussion: "Drop the `console.log`.",
      context: [
        {
          marker: "+",
          leftNumber: undefined,
          rightNumber: 12,
          hunkIndex: 0,
          text: "console.log(`<b>${token}</b>`);",
        },
      ],
    },
    {
      path: "src/auth.ts",
      side: "RIGHT",
      line: 20,
      startLine: 18,
      label: "suggestion",
      decorations: ["non-blocking"],
      subject: "Extract the retry loop.",
      discussion: "",
      context: [],
    },
    {
      path: "",
      side: "RIGHT",
      line: null,
      startLine: null,
      label: "praise",
      decorations: [],
      subject: "Clear commit history.",
      discussion: "",
      context: [],
    },
  ],
};

const countOccurrences = (text: string, searchedText: string) =>
  text.split(searchedText).length - 1;

const readEmbeddedDraft = (pageHtml: string) => {
  const embeddedMatch =
    /<script type="application\/json" id="draft-data">([\s\S]*?)<\/script>/.exec(
      pageHtml
    );
  return JSON.parse(embeddedMatch?.[1] ?? "null") as Record<string, unknown>;
};

test("the PR page holds the title and body in editable fields, HTML-escaped", () => {
  const pageHtml = renderDraftPage(PULL_REQUEST_DRAFT);

  expect(pageHtml).toContain(
    '<input id="pr-title" type="text" value="Reject &quot;expired&quot; tokens &lt;fast&gt;"'
  );
  expect(pageHtml).toContain('<textarea id="pr-body"');
  expect(pageHtml).toContain(
    "Stops &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; early."
  );
  expect(pageHtml).not.toContain("<script>alert(1)</script>");
});

test("the PR page has a post button, a copy button and a preview", () => {
  const pageHtml = renderDraftPage(PULL_REQUEST_DRAFT);

  expect(pageHtml).toContain('id="post-draft"');
  expect(pageHtml).toContain("Post to GitHub");
  expect(pageHtml).toContain('id="copy-body"');
  expect(pageHtml).toContain('id="copy-title"');
  expect(pageHtml).toContain('id="pr-preview"');
  expect(pageHtml).toContain('data-view="write"');
  expect(pageHtml).toContain('data-view="preview"');
  expect(pageHtml).toContain('data-view="split"');
});

test("the PR page lists the template and its sections", () => {
  const pageHtml = renderDraftPage(PULL_REQUEST_DRAFT);

  expect(pageHtml).toContain(".github/pull_request_template.md");
  expect(pageHtml).toContain('data-heading="## Summary"');
  expect(pageHtml).toContain('data-heading="## Test plan"');
});

test("the PR page says when the project has no template", () => {
  const pageHtml = renderDraftPage({ ...PULL_REQUEST_DRAFT, templatePath: "" });

  expect(pageHtml).toContain("No PR template in this project");
});

test("the PR page of a branch with an open PR offers to update it", () => {
  const pageHtml = renderDraftPage({
    ...PULL_REQUEST_DRAFT,
    existingNumber: 7,
    existingUrl: "https://github.com/acme/notes/pull/7",
  });

  expect(pageHtml).toContain("Update #7 on GitHub");
  expect(pageHtml).not.toContain('id="pr-is-draft"');
});

test("the draft is embedded as data that cannot close its script tag", () => {
  const pageHtml = renderDraftPage(PULL_REQUEST_DRAFT);

  expect(readEmbeddedDraft(pageHtml)).toEqual(
    JSON.parse(JSON.stringify(PULL_REQUEST_DRAFT))
  );
  expect(countOccurrences(pageHtml, "</script>")).toBe(2);
});

test("a page loads nothing from outside itself", () => {
  const pages = [
    renderDraftPage(PULL_REQUEST_DRAFT),
    renderDraftPage(REVIEW_DRAFT),
  ];

  for (const pageHtml of pages) {
    expect(pageHtml).not.toContain("<link");
    expect(pageHtml).not.toContain(" src=");
    expect(pageHtml).not.toContain("@import");
    expect(pageHtml).toContain("default-src 'none'");
  }
});

test("the review page has one card per comment, each with its own copy button", () => {
  const pageHtml = renderDraftPage(REVIEW_DRAFT);

  expect(countOccurrences(pageHtml, '<article class="comment"')).toBe(3);
  expect(countOccurrences(pageHtml, 'data-action="copy-comment"')).toBe(3);
  expect(pageHtml).toContain('data-index="0"');
  expect(pageHtml).toContain('data-index="2"');
  expect(pageHtml.toLowerCase()).not.toContain("copy all");
});

test("the review page has a post button, a summary and the review events", () => {
  const pageHtml = renderDraftPage(REVIEW_DRAFT);

  expect(pageHtml).toContain('id="post-draft"');
  expect(pageHtml).toContain("Post to GitHub");
  expect(pageHtml).toContain('<textarea id="review-summary"');
  expect(pageHtml).toContain("Close. Two things before merging.");
  expect(pageHtml).toContain('name="review-event" value="COMMENT" checked');
  expect(pageHtml).toContain('name="review-event" value="APPROVE"');
  expect(pageHtml).toContain('name="review-event" value="REQUEST_CHANGES"');
  expect(pageHtml).toContain('name="review-event" value="PENDING"');
});

test("a comment card shows its label, decorations, text and place, HTML-escaped", () => {
  const pageHtml = renderDraftPage(REVIEW_DRAFT);

  expect(pageHtml).toContain('<option value="issue" selected>issue</option>');
  expect(pageHtml).toContain('data-decoration="blocking" aria-pressed="true"');
  expect(pageHtml).toContain('data-decoration="security" aria-pressed="true"');
  expect(pageHtml).toContain('data-decoration="if-minor" aria-pressed="false"');
  expect(pageHtml).toContain('value="The token is logged &lt;in full&gt;."');
  expect(pageHtml).toContain("Drop the `console.log`.");
  expect(pageHtml).toContain("console.log(`&lt;b&gt;${token}&lt;/b&gt;`);");
  expect(pageHtml).toContain("L12");
  expect(pageHtml).toContain("L18–20");
});

test("the review page groups comments by file, general comments first", () => {
  const pageHtml = renderDraftPage(REVIEW_DRAFT);

  expect(countOccurrences(pageHtml, '<section class="file-group"')).toBe(2);
  expect(pageHtml.indexOf("General")).toBeLessThan(
    pageHtml.indexOf('<code class="file-path">src/auth.ts</code>')
  );
});

test("the review page offers a filter for each label in use", () => {
  const pageHtml = renderDraftPage(REVIEW_DRAFT);

  expect(pageHtml).toContain('data-filter="all"');
  expect(pageHtml).toContain('data-filter="issue"');
  expect(pageHtml).toContain('data-filter="suggestion"');
  expect(pageHtml).toContain('data-filter="praise"');
  expect(pageHtml).not.toContain('data-filter="nitpick"');
});
