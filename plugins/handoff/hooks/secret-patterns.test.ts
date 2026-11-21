import { expect, test } from "claude-code/testing";
import { findSecretKinds } from "./secret-patterns";

const SAMPLE_SECRETS: Record<string, string> = {
  "AWS access key": `AKIA${"A".repeat(16)}`,
  "GitHub token": `ghp_${"a".repeat(36)}`,
  "Slack token": `xoxb-${"1".repeat(12)}`,
  "private key": `-----BEGIN RSA ${"PRIVATE"} KEY-----`,
  "API key": `sk-${"a".repeat(24)}`,
  "password or token assignment": `password=${"x".repeat(16)}`,
};

test("each secret kind is found by name", () => {
  for (const [kind, secret] of Object.entries(SAMPLE_SECRETS)) {
    expect(findSecretKinds(`Ran it with ${secret} today`)).toEqual([kind]);
  }
});

test("ordinary notes and code references hold no secrets", () => {
  expect(
    findSecretKinds(
      "Ran pnpm test; the token refresh bug is in auth.ts and reads token=${process.env.TOKEN}"
    )
  ).toEqual([]);
});

test("environment style names ending in token or password are found", () => {
  expect(findSecretKinds(`GITHUB_TOKEN=${"x".repeat(16)}`)).toEqual([
    "password or token assignment",
  ]);
  expect(findSecretKinds(`DB_PASSWORD: ${"x".repeat(16)}`)).toEqual([
    "password or token assignment",
  ]);
});
