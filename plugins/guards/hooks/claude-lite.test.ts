import { expect, test } from "bun:test";
import { isClaudeLiteSession } from "./claude-lite.ts";

test.each([
  "http://127.0.0.1:11434",
  "http://localhost:8435",
  "http://127.0.0.1:8435/v1",
])("recognizes a claude-lite loopback address %s", (baseAddress) => {
  expect(isClaudeLiteSession(baseAddress)).toBe(true);
});

test.each([
  undefined,
  "",
  "not an address",
  "https://api.anthropic.com",
  "http://127.0.0.1:3000",
  "https://example.com:11434",
])("does not recognize %p as a claude-lite session", (baseAddress) => {
  expect(isClaudeLiteSession(baseAddress)).toBe(false);
});
