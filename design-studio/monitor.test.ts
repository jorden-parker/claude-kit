import { expect, test } from "bun:test";
import { startMonitor } from "./monitor";
import { readCallCounts } from "./tools";

test("the monitor serves its page, replays earlier events to a late viewer and streams new ones", async () => {
  const monitor = startMonitor();
  try {
    const page = await (await fetch(monitor.url)).text();
    expect(page).toContain("<title>Design Studio</title>");

    monitor.emit({ kind: "failed", message: "earlier" });
    const eventStream = (await fetch(`${monitor.url}events`)).body!.getReader();
    const decoder = new TextDecoder();
    const readEvent = async () =>
      JSON.parse(
        decoder.decode((await eventStream.read()).value).replace(/^data: /, "")
      );
    expect(await readEvent()).toMatchObject({ kind: "failed", message: "earlier" });

    monitor.emit({ kind: "done", resultLine: "Opened.", pagePath: "/page.html" });
    const liveEvent = await readEvent();
    expect(liveEvent).toMatchObject({ kind: "done", pagePath: "/page.html" });
    expect(liveEvent.at).toBeGreaterThan(0);

    await monitor.stop();
    expect((await eventStream.read()).done).toBe(true);
  } finally {
    await monitor.stop();
  }
});

const readEvents = async (streamUrl: string, count: number) => {
  const reader = (await fetch(streamUrl)).body!.getReader();
  const decoder = new TextDecoder();
  const events: Record<string, unknown>[] = [];
  let buffered = "";
  while (events.length < count) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    const messages = buffered.split("\n\n");
    buffered = messages.pop()!;
    for (const message of messages) events.push(JSON.parse(message.replace(/^data: /, "")));
  }
  await reader.cancel();
  return events;
};

test("the served page has a live preview pane that renders stylesheet and preview events", async () => {
  const monitor = startMonitor();
  try {
    const page = await (await fetch(monitor.url)).text();
    expect(page).toContain('<section id="preview-panel" aria-labelledby="preview-title">');
    expect(page).toContain('<h2 id="preview-title">Live preview</h2>');
    expect(page).toMatch(/<iframe id="preview" title="[^"]+" sandbox="allow-same-origin"/);
    expect(page).not.toContain("allow-scripts");
    expect(page).toMatch(/^\s+stylesheet: /m);
    expect(page).toMatch(/^\s+preview: /m);
  } finally {
    await monitor.stop();
  }
});

test("a late viewer gets the stylesheet and every preview event in order", async () => {
  const monitor = startMonitor();
  try {
    monitor.emit({ kind: "stylesheet", css: "body { color: red; }" });
    monitor.emit({ kind: "preview", callId: "call-1", html: "<p>one</p>" });
    monitor.emit({ kind: "preview", callId: "call-1", html: "<p>two</p>" });
    const received = await readEvents(`${monitor.url}events`, 3);
    expect(received.map((event) => event.kind)).toEqual(["stylesheet", "preview", "preview"]);
    expect(received[2]).toMatchObject({ callId: "call-1", html: "<p>two</p>" });
  } finally {
    await monitor.stop();
  }
});

test("readCallCounts turns Ollama's counters into tokens, speed and seconds", () => {
  expect(
    readCallCounts({
      prompt_eval_count: 900,
      eval_count: 200,
      eval_duration: 4_000_000_000,
      total_duration: 6_500_000_000,
      first_token_seconds: 0.8,
    })
  ).toEqual({
    promptTokens: 900,
    outputTokens: 200,
    tokensPerSecond: 50,
    firstTokenSeconds: 0.8,
    seconds: 6.5,
  });
  expect(readCallCounts({}).tokensPerSecond).toBe(0);
});
