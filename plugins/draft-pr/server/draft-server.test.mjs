import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPostSteps,
  createDraftServer,
  readPostedUrl,
} from "./draft-server.mjs";

const SERVER_SCRIPT_PATH = fileURLToPath(
  new URL("./draft-server.mjs", import.meta.url)
);
const TOKEN = "0123456789abcdef";
const PAGE_HTML = "<!doctype html><title>Draft</title>";

const PR_DRAFT = {
  kind: "pr",
  cwd: "/repo",
  repository: "acme/notes",
  base: "main",
  head: "token-expiry",
  existingNumber: null,
};

const REVIEW_DRAFT = {
  kind: "review",
  cwd: "/repo",
  repository: "acme/notes",
  number: 42,
  headSha: "abc123",
  comments: [
    { path: "src/auth.ts", side: "RIGHT", line: 12 },
    { path: "src/auth.ts", side: "RIGHT", line: 20, startLine: 18 },
    { path: "", side: "RIGHT" },
  ],
};

test("a new PR is pushed, then created from the edited title and body", () => {
  const { steps, problem } = buildPostSteps(PR_DRAFT, {
    title: "Reject expired tokens",
    body: "## Summary\nDone.",
    isDraft: true,
  });

  assert.equal(problem, undefined);
  assert.deepEqual(steps, [
    {
      argv: ["git", "push", "--set-upstream", "origin", "token-expiry"],
      stdin: "",
    },
    {
      argv: [
        "gh",
        "pr",
        "create",
        "--title",
        "Reject expired tokens",
        "--body-file",
        "-",
        "--base",
        "main",
        "--head",
        "token-expiry",
        "--draft",
      ],
      stdin: "## Summary\nDone.",
    },
  ]);
});

test("a branch that already has a PR gets that PR edited, with no push", () => {
  const { steps } = buildPostSteps(
    { ...PR_DRAFT, existingNumber: 7 },
    { title: "Reject expired tokens", body: "Body", isDraft: false }
  );

  assert.deepEqual(steps, [
    {
      argv: [
        "gh",
        "pr",
        "edit",
        "7",
        "--title",
        "Reject expired tokens",
        "--body-file",
        "-",
      ],
      stdin: "Body",
    },
  ]);
});

test("a PR without a title is refused", () => {
  const { steps, problem } = buildPostSteps(PR_DRAFT, {
    title: "  ",
    body: "Body",
    isDraft: false,
  });

  assert.deepEqual(steps, []);
  assert.equal(problem, "The title is empty.");
});

test("a review posts its line comments at the positions the draft recorded", () => {
  const { steps } = buildPostSteps(REVIEW_DRAFT, {
    event: "REQUEST_CHANGES",
    summary: "Two things to fix.",
    comments: [
      { index: 1, body: "**issue (blocking):** Range comment." },
      { index: 0, body: "**nitpick:** Line comment." },
      { index: 2, body: "**note:** General comment." },
    ],
  });

  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].argv, [
    "gh",
    "api",
    "--method",
    "POST",
    "repos/acme/notes/pulls/42/reviews",
    "--input",
    "-",
  ]);
  assert.deepEqual(JSON.parse(steps[0].stdin), {
    commit_id: "abc123",
    event: "REQUEST_CHANGES",
    body: "Two things to fix.\n\n**note:** General comment.",
    comments: [
      {
        path: "src/auth.ts",
        side: "RIGHT",
        line: 20,
        start_line: 18,
        start_side: "RIGHT",
        body: "**issue (blocking):** Range comment.",
      },
      {
        path: "src/auth.ts",
        side: "RIGHT",
        line: 12,
        body: "**nitpick:** Line comment.",
      },
    ],
  });
});

test("a review on a GitHub Enterprise host names that host", () => {
  const { steps } = buildPostSteps(
    { ...REVIEW_DRAFT, host: "github.acme.dev" },
    { event: "COMMENT", summary: "Looks close.", comments: [] }
  );

  assert.deepEqual(steps[0].argv.slice(0, 4), [
    "gh",
    "api",
    "--hostname",
    "github.acme.dev",
  ]);
});

test("a pending review is posted without an event", () => {
  const { steps } = buildPostSteps(REVIEW_DRAFT, {
    event: "PENDING",
    summary: "",
    comments: [{ index: 0, body: "**nitpick:** Line comment." }],
  });

  assert.equal("event" in JSON.parse(steps[0].stdin), false);
});

test("a review with an unknown event, an unknown comment or nothing to say is refused", () => {
  const readProblem = (payload) =>
    buildPostSteps(REVIEW_DRAFT, payload).problem;

  assert.equal(
    readProblem({ event: "MERGE", summary: "Hello", comments: [] }),
    "Unknown review event: MERGE."
  );
  assert.equal(
    readProblem({
      event: "COMMENT",
      summary: "",
      comments: [{ index: 9, body: "**note:** Lost." }],
    }),
    "The draft has no comment 9."
  );
  assert.equal(
    readProblem({ event: "COMMENT", summary: " ", comments: [] }),
    "The review has no summary and no comments."
  );
});

test("the posted URL is read from gh's output", () => {
  assert.equal(
    readPostedUrl(
      "pr",
      "Creating pull request\nhttps://github.com/acme/notes/pull/8\n"
    ),
    "https://github.com/acme/notes/pull/8"
  );
  assert.equal(
    readPostedUrl(
      "review",
      JSON.stringify({
        html_url: "https://github.com/acme/notes/pull/42#pullrequestreview-1",
      })
    ),
    "https://github.com/acme/notes/pull/42#pullrequestreview-1"
  );
  assert.equal(readPostedUrl("review", "not json"), "");
});

const startTestServer = async (testContext, draft, commandResults = []) => {
  const pageFolder = await mkdtemp(join(tmpdir(), "draft-pr-test-"));
  const pagePath = join(pageFolder, "draft.html");
  await writeFile(pagePath, PAGE_HTML);
  const ranSteps = [];
  const pendingResults = [...commandResults];
  const draftServer = createDraftServer({
    draft: { ...draft },
    pagePath,
    token: TOKEN,
    runCommand: async (argv, stdin, cwd) => {
      ranSteps.push({ argv, stdin, cwd });
      return pendingResults.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  await new Promise((resolve) => draftServer.listen(0, "127.0.0.1", resolve));
  testContext.after(() => draftServer.close());
  const origin = `http://127.0.0.1:${draftServer.address().port}`;
  const postJson = (path, payload, headers = {}) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
  return { origin, postJson, ranSteps };
};

test("the server serves the page under its token only", async (testContext) => {
  const { origin } = await startTestServer(testContext, PR_DRAFT);

  const pageResponse = await fetch(`${origin}/${TOKEN}/`);
  const strangerResponse = await fetch(`${origin}/wrong-token/`);

  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type"), /text\/html/);
  assert.equal(await pageResponse.text(), PAGE_HTML);
  assert.equal(strangerResponse.status, 404);
});

test("posting runs the steps in the project and answers with the PR's URL", async (testContext) => {
  const { postJson, ranSteps } = await startTestServer(testContext, PR_DRAFT, [
    { exitCode: 0, stdout: "", stderr: "" },
    {
      exitCode: 0,
      stdout: "https://github.com/acme/notes/pull/8\n",
      stderr: "",
    },
  ]);

  const postResponse = await postJson(`/${TOKEN}/post`, {
    title: "Reject expired tokens",
    body: "Body",
    isDraft: false,
  });

  assert.deepEqual(await postResponse.json(), {
    isPosted: true,
    url: "https://github.com/acme/notes/pull/8",
  });
  assert.deepEqual(
    ranSteps.map((step) => [step.argv[0], step.argv[1], step.cwd]),
    [
      ["git", "push", "/repo"],
      ["gh", "pr", "/repo"],
    ]
  );
});

test("after a PR is created, posting again edits it", async (testContext) => {
  const { postJson, ranSteps } = await startTestServer(testContext, PR_DRAFT, [
    { exitCode: 0, stdout: "", stderr: "" },
    {
      exitCode: 0,
      stdout: "https://github.com/acme/notes/pull/8\n",
      stderr: "",
    },
    {
      exitCode: 0,
      stdout: "https://github.com/acme/notes/pull/8\n",
      stderr: "",
    },
  ]);
  const payload = {
    title: "Reject expired tokens",
    body: "Body",
    isDraft: false,
  };

  await postJson(`/${TOKEN}/post`, payload);
  await postJson(`/${TOKEN}/post`, payload);

  assert.deepEqual(ranSteps.at(-1).argv.slice(0, 4), ["gh", "pr", "edit", "8"]);
});

test("a failing step stops the post and its error is the problem", async (testContext) => {
  const { postJson, ranSteps } = await startTestServer(testContext, PR_DRAFT, [
    { exitCode: 1, stdout: "", stderr: "fatal: no remote named origin\n" },
  ]);

  const postResponse = await postJson(`/${TOKEN}/post`, {
    title: "Reject expired tokens",
    body: "Body",
    isDraft: false,
  });

  assert.deepEqual(await postResponse.json(), {
    isPosted: false,
    problem: "fatal: no remote named origin",
  });
  assert.equal(ranSteps.length, 1);
});

test("a review is posted once; a second post is refused", async (testContext) => {
  const { postJson, ranSteps } = await startTestServer(
    testContext,
    REVIEW_DRAFT,
    [
      {
        exitCode: 0,
        stdout: JSON.stringify({
          html_url: "https://github.com/acme/notes/pull/42#r1",
        }),
        stderr: "",
      },
    ]
  );
  const payload = { event: "COMMENT", summary: "Looks close.", comments: [] };

  const firstResponse = await postJson(`/${TOKEN}/post`, payload);
  const secondResponse = await postJson(`/${TOKEN}/post`, payload);

  assert.deepEqual(await firstResponse.json(), {
    isPosted: true,
    url: "https://github.com/acme/notes/pull/42#r1",
  });
  assert.deepEqual(await secondResponse.json(), {
    isPosted: false,
    problem: "This review was already posted.",
  });
  assert.equal(ranSteps.length, 1);
});

test("a post from another origin or without the token runs nothing", async (testContext) => {
  const { postJson, ranSteps } = await startTestServer(testContext, PR_DRAFT);
  const payload = {
    title: "Reject expired tokens",
    body: "Body",
    isDraft: false,
  };

  const foreignResponse = await postJson(`/${TOKEN}/post`, payload, {
    Origin: "https://evil.example",
  });
  const strangerResponse = await postJson("/wrong-token/post", payload);

  assert.equal(foreignResponse.status, 403);
  assert.equal(strangerResponse.status, 404);
  assert.deepEqual(ranSteps, []);
});

test("the page's ping is answered with no content", async (testContext) => {
  const { postJson } = await startTestServer(testContext, PR_DRAFT);

  const pingResponse = await postJson(`/${TOKEN}/ping`, {});

  assert.equal(pingResponse.status, 204);
});

const runLauncher = (draftPath) =>
  new Promise((resolve, reject) => {
    const launcher = spawn(process.execPath, [SERVER_SCRIPT_PATH, draftPath], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let launcherOutput = "";
    launcher.stdout.on("data", (chunk) => {
      launcherOutput += chunk;
    });
    launcher.on("error", reject);
    launcher.on("close", (exitCode) => resolve({ exitCode, launcherOutput }));
  });

test("the launcher starts a detached server and prints where it listens", async (testContext) => {
  const draftFolder = await mkdtemp(join(tmpdir(), "draft-pr-launch-"));
  const draftPath = join(draftFolder, "pr-2026-11-11-1200.json");
  await writeFile(draftPath, JSON.stringify(PR_DRAFT));
  await writeFile(join(draftFolder, "pr-2026-11-11-1200.html"), PAGE_HTML);

  const { exitCode, launcherOutput } = await runLauncher(draftPath);
  const { url, pid } = JSON.parse(launcherOutput);
  testContext.after(() => process.kill(pid));

  assert.equal(exitCode, 0);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
  assert.equal(await (await fetch(url)).text(), PAGE_HTML);
});

test("the launcher fails when the draft file is missing", async () => {
  const { exitCode } = await runLauncher(join(tmpdir(), "no-such-draft.json"));

  assert.equal(exitCode, 1);
});
