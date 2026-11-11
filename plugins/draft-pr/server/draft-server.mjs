#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const LOOPBACK_ADDRESS = "127.0.0.1";
const IDLE_SHUTDOWN_MILLISECONDS = 2 * 60 * 60 * 1000;
const LAUNCH_TIMEOUT_MILLISECONDS = 5000;
const COMMAND_TIMEOUT_MILLISECONDS = 120000;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const SERVE_FLAG = "--serve";
const DEFAULT_HOST = "github.com";
const PENDING_EVENT = "PENDING";
const APPROVE_EVENT = "APPROVE";
const REVIEW_EVENTS = [
  "COMMENT",
  APPROVE_EVENT,
  "REQUEST_CHANGES",
  PENDING_EVENT,
];
const URL_PATTERN = /https?:\/\/\S+/g;
const PULL_REQUEST_NUMBER_PATTERN = /\/pull\/(\d+)/;

const readText = (value) => (typeof value === "string" ? value : "");

const buildPullRequestSteps = (draft, payload) => {
  const title = readText(payload.title).trim();
  const body = readText(payload.body);
  if (!title) return { steps: [], problem: "The title is empty." };
  if (draft.existingNumber) {
    return {
      steps: [
        {
          argv: [
            "gh",
            "pr",
            "edit",
            String(draft.existingNumber),
            "--title",
            title,
            "--body-file",
            "-",
          ],
          stdin: body,
        },
      ],
    };
  }
  const draftFlags = payload.isDraft === true ? ["--draft"] : [];
  return {
    steps: [
      {
        argv: ["git", "push", "--set-upstream", "origin", draft.head],
        stdin: "",
      },
      {
        argv: [
          "gh",
          "pr",
          "create",
          "--title",
          title,
          "--body-file",
          "-",
          "--base",
          draft.base,
          "--head",
          draft.head,
          ...draftFlags,
        ],
        stdin: body,
      },
    ],
  };
};

const buildLineComment = (position, body) => ({
  path: position.path,
  side: position.side,
  line: position.line,
  ...(position.startLine
    ? { start_line: position.startLine, start_side: position.side }
    : {}),
  body,
});

const buildReviewSteps = (draft, payload) => {
  const event = readText(payload.event);
  if (!REVIEW_EVENTS.includes(event)) {
    return { steps: [], problem: `Unknown review event: ${event}.` };
  }
  const postedComments = Array.isArray(payload.comments)
    ? payload.comments
    : [];
  const unknownComment = postedComments.find(
    (postedComment) => !draft.comments[postedComment.index]
  );
  if (unknownComment) {
    return {
      steps: [],
      problem: `The draft has no comment ${unknownComment.index}.`,
    };
  }
  const positionedComments = postedComments.map((postedComment) => ({
    position: draft.comments[postedComment.index],
    body: readText(postedComment.body),
  }));
  const lineComments = positionedComments
    .filter(({ position }) => position.path)
    .map(({ position, body }) => buildLineComment(position, body));
  const generalCommentBodies = positionedComments
    .filter(({ position }) => !position.path)
    .map(({ body }) => body);
  const reviewBody = [readText(payload.summary).trim(), ...generalCommentBodies]
    .filter(Boolean)
    .join("\n\n");
  if (!reviewBody && !lineComments.length && event !== APPROVE_EVENT) {
    return {
      steps: [],
      problem: "The review has no summary and no comments.",
    };
  }
  const review = {
    commit_id: draft.headSha,
    ...(event === PENDING_EVENT ? {} : { event }),
    body: reviewBody,
    comments: lineComments,
  };
  const hostFlags =
    draft.host && draft.host !== DEFAULT_HOST ? ["--hostname", draft.host] : [];
  return {
    steps: [
      {
        argv: [
          "gh",
          "api",
          ...hostFlags,
          "--method",
          "POST",
          `repos/${draft.repository}/pulls/${draft.number}/reviews`,
          "--input",
          "-",
        ],
        stdin: JSON.stringify(review),
      },
    ],
  };
};

export const buildPostSteps = (draft, payload) =>
  draft.kind === "review"
    ? buildReviewSteps(draft, payload)
    : buildPullRequestSteps(draft, payload);

const readReviewUrl = (commandOutput) => {
  try {
    return readText(JSON.parse(commandOutput).html_url);
  } catch {
    return "";
  }
};

export const readPostedUrl = (kind, commandOutput) =>
  kind === "review"
    ? readReviewUrl(commandOutput)
    : (commandOutput.match(URL_PATTERN)?.at(-1) ?? "");

const rememberPost = (draft, postedUrl) => {
  if (draft.kind === "review") {
    draft.isPosted = true;
    return;
  }
  const numberMatch = PULL_REQUEST_NUMBER_PATTERN.exec(postedUrl);
  if (numberMatch) draft.existingNumber = Number(numberMatch[1]);
};

const describeFailedStep = (step, { exitCode, stdout, stderr }) =>
  (stderr || stdout).trim() || `${step.argv[0]} exited with code ${exitCode}.`;

const postDraft = async (draft, payload, runCommand) => {
  if (draft.kind === "review" && draft.isPosted) {
    return { isPosted: false, problem: "This review was already posted." };
  }
  const { steps, problem } = buildPostSteps(draft, payload);
  if (problem) return { isPosted: false, problem };
  let lastOutput = "";
  for (const step of steps) {
    const commandResult = await runCommand(step.argv, step.stdin, draft.cwd);
    if (commandResult.exitCode !== 0) {
      return {
        isPosted: false,
        problem: describeFailedStep(step, commandResult),
      };
    }
    lastOutput = commandResult.stdout;
  }
  const postedUrl = readPostedUrl(draft.kind, lastOutput);
  rememberPost(draft, postedUrl);
  return { isPosted: true, url: postedUrl };
};

const readRequestJson = (request) =>
  new Promise((resolve, reject) => {
    let requestText = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestText += chunk;
      if (requestText.length > MAX_REQUEST_BYTES) {
        reject(new Error("The request is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(requestText || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const sendJson = (response, statusCode, answer) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(answer));
};

const sendEmpty = (response, statusCode) => {
  response.writeHead(statusCode, { "Cache-Control": "no-store" });
  response.end();
};

const isOwnOrigin = (request) => {
  const ownHost = `${LOOPBACK_ADDRESS}:${request.socket.localPort}`;
  const { host, origin } = request.headers;
  return (
    host === ownHost && (origin === undefined || origin === `http://${ownHost}`)
  );
};

export const createDraftServer = ({
  draft,
  pagePath,
  token,
  runCommand,
  onRequest = () => {},
}) => {
  let isPosting = false;

  const answerPost = async (request, response) => {
    if (isPosting) {
      sendJson(response, 409, {
        isPosted: false,
        problem: "A post is already running.",
      });
      return;
    }
    isPosting = true;
    try {
      const payload = await readRequestJson(request);
      sendJson(response, 200, await postDraft(draft, payload, runCommand));
    } catch (error) {
      sendJson(response, 400, {
        isPosted: false,
        problem: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isPosting = false;
    }
  };

  const answerPage = async (response) => {
    try {
      const pageHtml = await readFile(pagePath, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(pageHtml);
    } catch {
      sendEmpty(response, 404);
    }
  };

  return createServer((request, response) => {
    onRequest();
    if (!isOwnOrigin(request)) {
      sendEmpty(response, 403);
      return;
    }
    const route = `${request.method} ${request.url}`;
    if (route === `GET /${token}/`) {
      void answerPage(response);
      return;
    }
    if (route === `POST /${token}/ping`) {
      request.resume();
      sendEmpty(response, 204);
      return;
    }
    if (route === `POST /${token}/post`) {
      void answerPost(request, response);
      return;
    }
    request.resume();
    sendEmpty(response, 404);
  });
};

const runHostCommand = (argv, stdin, cwd) =>
  new Promise((resolve) => {
    const [executable, ...commandArguments] = argv;
    const child = spawn(executable, commandArguments, {
      cwd,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: COMMAND_TIMEOUT_MILLISECONDS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", () => {
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${executable} is not installed, or not on the PATH.`,
      });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });

const serveDraft = async (draftPath) => {
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  const token = randomBytes(16).toString("hex");
  let idleTimer;
  const restartIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => process.exit(0), IDLE_SHUTDOWN_MILLISECONDS);
  };
  const draftServer = createDraftServer({
    draft,
    pagePath: draftPath.replace(/\.json$/, ".html"),
    token,
    runCommand: runHostCommand,
    onRequest: restartIdleTimer,
  });
  process.stdout.on("error", () => {});
  draftServer.listen(0, LOOPBACK_ADDRESS, () => {
    restartIdleTimer();
    const { port } = draftServer.address();
    const announcement = {
      url: `http://${LOOPBACK_ADDRESS}:${port}/${token}/`,
      pid: process.pid,
    };
    process.stdout.write(`${JSON.stringify(announcement)}\n`);
  });
};

const launchDetachedServer = (scriptPath, draftPath) => {
  const detachedServer = spawn(
    process.execPath,
    [scriptPath, SERVE_FLAG, draftPath],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] }
  );
  const failLaunch = () => {
    detachedServer.kill();
    process.exit(1);
  };
  const launchTimer = setTimeout(failLaunch, LAUNCH_TIMEOUT_MILLISECONDS);
  let announcement = "";
  detachedServer.on("error", failLaunch);
  detachedServer.on("exit", failLaunch);
  detachedServer.stdout.on("data", (chunk) => {
    announcement += chunk;
    if (!announcement.includes("\n")) return;
    clearTimeout(launchTimer);
    detachedServer.removeListener("exit", failLaunch);
    detachedServer.stdout.destroy();
    detachedServer.unref();
    process.stdout.write(`${announcement.split("\n")[0]}\n`, () =>
      process.exit(0)
    );
  });
};

const isRunDirectly = () => {
  try {
    return (
      realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
};

if (isRunDirectly()) {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === SERVE_FLAG) {
    await serveDraft(commandArguments[1] ?? "");
  } else {
    launchDetachedServer(process.argv[1] ?? "", commandArguments[0] ?? "");
  }
}
