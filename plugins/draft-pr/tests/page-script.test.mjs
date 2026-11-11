import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_SCRIPT } from "../hooks/page-script.ts";

const RENDERERS_START = "var TICK";
const RENDERERS_END = "function loadSavedState";
const LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"';

const renderersSource = PAGE_SCRIPT.slice(
  PAGE_SCRIPT.indexOf(RENDERERS_START),
  PAGE_SCRIPT.indexOf(RENDERERS_END)
);
const renderMarkdown = new Function(
  `${renderersSource}; return renderMarkdown;`
)();

const renderLink = (url, label) =>
  `<a href="${url}" ${LINK_ATTRIBUTES}>${label}</a>`;

test("a link whose URL holds a second URL stays one link", () => {
  const nestedUrl =
    "https://b.example/(https://c.example/onmouseover=document.body.id='pwned'//";

  assert.equal(
    renderMarkdown(`[x](${nestedUrl})`),
    `<p>${renderLink(nestedUrl, "x")}</p>`
  );
});

test("a link glued to a bare URL does not end up inside that URL's link", () => {
  const gluedUrl = "https://b.example/onmouseover=document.body.id='pwned'//";

  assert.equal(
    renderMarkdown(`https://a.example/[x](${gluedUrl})`),
    `<p>${renderLink("https://a.example/", "https://a.example/")}${renderLink(gluedUrl, "x")}</p>`
  );
});

test("a code span inside a link label is still rendered", () => {
  assert.equal(
    renderMarkdown("[`run`](https://a.example)"),
    `<p>${renderLink("https://a.example", "<code>run</code>")}</p>`
  );
});
