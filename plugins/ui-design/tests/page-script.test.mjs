import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_SCRIPT } from "../hooks/page-script.ts";

const dispatch = (element, type, key = "", pointer = {}) => {
  const event = {
    key,
    ...pointer,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };
  (element.listeners[type] ?? []).forEach((listener) => listener(event));
  return event;
};

const readDataset = (attributes) =>
  Object.fromEntries(
    Object.entries(attributes)
      .filter(([name]) => name.startsWith("data-"))
      .map(([name, value]) => [
        name
          .slice("data-".length)
          .replace(/-([a-z])/g, (dashedLetter) =>
            dashedLetter.slice(1).toUpperCase()
          ),
        value,
      ])
  );

const ATTRIBUTE_SELECTOR = /^\[([\w-]+)(?:=(\w+))?\]$/;

const matchesSelector = (element, selector) => {
  const attributeSelector = ATTRIBUTE_SELECTOR.exec(selector);
  if (!attributeSelector) return element.tagName === selector;
  const [, name, expectedValue] = attributeSelector;
  const actualValue = element.attributes[name];
  return expectedValue === undefined
    ? actualValue !== undefined
    : actualValue === expectedValue;
};

const createElement = (tagName, attributes = {}, properties = {}) => {
  const element = {
    tagName,
    id: attributes.id ?? "",
    textContent: properties.textContent ?? "",
    hidden: properties.hidden ?? false,
    tabIndex: properties.tabIndex ?? 0,
    srcdoc: properties.srcdoc ?? "",
    dataset: readDataset(attributes),
    attributes: { ...attributes },
    listeners: {},
    focused: false,
    capturedPointerId: undefined,
    style: {
      properties: {},
      setProperty: (name, value) => {
        element.style.properties[name] = value;
      },
    },
    setPointerCapture: (pointerId) => {
      element.capturedPointerId = pointerId;
    },
    getAttribute: (name) => element.attributes[name] ?? null,
    setAttribute: (name, value) => {
      element.attributes[name] = value;
    },
    addEventListener: (type, listener) => {
      element.listeners[type] = [...(element.listeners[type] ?? []), listener];
    },
    focus: () => {
      element.focused = true;
    },
    click: () => {
      dispatch(element, "click");
    },
  };
  return element;
};

const pressKey = (element, key) => dispatch(element, "keydown", key);

const buildPage = (clipboard) => {
  const tabA = createElement(
    "button",
    {
      role: "tab",
      id: "tab-a",
      "aria-controls": "panel-a",
      "aria-selected": "true",
    },
    { textContent: "A · Single card", tabIndex: 0 }
  );
  const tabB = createElement(
    "button",
    {
      role: "tab",
      id: "tab-b",
      "aria-controls": "panel-b",
      "aria-selected": "false",
    },
    { textContent: "B · Two columns", tabIndex: -1 }
  );
  const tabC = createElement(
    "button",
    {
      role: "tab",
      id: "tab-c",
      "aria-controls": "panel-c",
      "aria-selected": "false",
    },
    { textContent: "C · List", tabIndex: -1 }
  );
  const panelA = createElement("section", { role: "tabpanel", id: "panel-a" });
  const panelB = createElement(
    "section",
    { role: "tabpanel", id: "panel-b" },
    { hidden: true }
  );
  const panelC = createElement(
    "section",
    { role: "tabpanel", id: "panel-c" },
    { hidden: true }
  );
  const desktopButton = createElement(
    "button",
    { "data-width": "desktop", "aria-pressed": "true" },
    { textContent: "Desktop" }
  );
  const mobileButton = createElement(
    "button",
    { "data-width": "mobile", "aria-pressed": "false" },
    { textContent: "Mobile" }
  );
  const darkButton = createElement("button", {
    id: "toggle-dark",
    "aria-pressed": "false",
  });
  const frame = createElement(
    "iframe",
    {},
    {
      srcdoc:
        '<!doctype html><html data-theme="light"><head></head><body>A</body></html>',
    }
  );
  const command = createElement(
    "code",
    { id: "command-a" },
    { textContent: "/ui-design apply A" }
  );
  const copyButton = createElement("button", { "data-copies": "command-a" });
  const status = createElement("p", { id: "copy-status" });
  const body = createElement("body", { "data-frame-width": "desktop" });
  const resizerA = createElement("div", {
    "data-resizer": "",
    "aria-valuenow": "640",
  });
  const resizerB = createElement("div", {
    "data-resizer": "",
    "aria-valuenow": "640",
  });

  const elements = [
    tabA,
    tabB,
    tabC,
    panelA,
    panelB,
    panelC,
    desktopButton,
    mobileButton,
    darkButton,
    frame,
    command,
    copyButton,
    status,
    resizerA,
    resizerB,
  ];
  const selection = {
    ranges: [],
    removeAllRanges: () => {
      selection.ranges = [];
    },
    addRange: (range) => {
      selection.ranges.push(range);
    },
  };
  const document = {
    body,
    querySelectorAll: (selector) =>
      elements.filter((element) => matchesSelector(element, selector)),
    getElementById: (elementId) =>
      elements.find((element) => element.id === elementId) ?? null,
    createRange: () => {
      const range = {
        node: undefined,
        selectNodeContents: (node) => {
          range.node = node;
        },
      };
      return range;
    },
  };
  const window = { getSelection: () => selection };
  const navigator = clipboard ? { clipboard } : {};

  new Function("document", "window", "navigator", PAGE_SCRIPT)(
    document,
    window,
    navigator
  );

  return {
    tabA,
    tabB,
    tabC,
    panelA,
    panelB,
    panelC,
    desktopButton,
    mobileButton,
    darkButton,
    frame,
    copyButton,
    status,
    body,
    selection,
    resizerA,
    resizerB,
  };
};

const recordingClipboard = () => {
  const clipboard = {
    writes: [],
    writeText: (text) => {
      clipboard.writes.push(text);
      return Promise.resolve();
    },
  };
  return clipboard;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("clicking a tab selects it and shows only its panel", () => {
  const page = buildPage();

  page.tabB.click();

  assert.equal(page.tabB.getAttribute("aria-selected"), "true");
  assert.equal(page.tabA.getAttribute("aria-selected"), "false");
  assert.equal(page.tabB.tabIndex, 0);
  assert.equal(page.tabA.tabIndex, -1);
  assert.equal(page.panelB.hidden, false);
  assert.equal(page.panelA.hidden, true);
  assert.equal(page.panelC.hidden, true);
});

test("arrow keys, Home and End move between tabs and wrap at both ends", () => {
  const page = buildPage();

  const rightFromA = pressKey(page.tabA, "ArrowRight");
  assert.equal(page.tabB.getAttribute("aria-selected"), "true");
  assert.equal(page.tabB.focused, true);
  assert.equal(rightFromA.defaultPrevented, true);

  pressKey(page.tabB, "ArrowRight");
  assert.equal(page.tabC.getAttribute("aria-selected"), "true");

  pressKey(page.tabC, "ArrowRight");
  assert.equal(page.tabA.getAttribute("aria-selected"), "true");
  assert.equal(page.panelA.hidden, false);

  pressKey(page.tabA, "ArrowLeft");
  assert.equal(page.tabC.getAttribute("aria-selected"), "true");

  pressKey(page.tabC, "Home");
  assert.equal(page.tabA.getAttribute("aria-selected"), "true");

  pressKey(page.tabA, "End");
  assert.equal(page.tabC.getAttribute("aria-selected"), "true");
  assert.equal(page.panelC.hidden, false);
});

test("keys other than the tab keys leave the tabs alone", () => {
  const page = buildPage();

  const enterEvent = pressKey(page.tabA, "Enter");

  assert.equal(enterEvent.defaultPrevented, false);
  assert.equal(page.tabA.getAttribute("aria-selected"), "true");
  assert.equal(page.tabB.focused, false);
});

test("the width toggle sets the body's frame width and presses one button", () => {
  const page = buildPage();

  page.mobileButton.click();

  assert.equal(page.body.dataset.frameWidth, "mobile");
  assert.equal(page.mobileButton.getAttribute("aria-pressed"), "true");
  assert.equal(page.desktopButton.getAttribute("aria-pressed"), "false");

  page.desktopButton.click();

  assert.equal(page.body.dataset.frameWidth, "desktop");
  assert.equal(page.desktopButton.getAttribute("aria-pressed"), "true");
  assert.equal(page.mobileButton.getAttribute("aria-pressed"), "false");
});

test("the dark toggle switches each frame's theme root and presses", () => {
  const page = buildPage();

  page.darkButton.click();

  assert.equal(page.darkButton.getAttribute("aria-pressed"), "true");
  assert.ok(page.frame.srcdoc.includes('<html data-theme="dark">'));
  assert.ok(!page.frame.srcdoc.includes('data-theme="light"'));

  page.darkButton.click();

  assert.equal(page.darkButton.getAttribute("aria-pressed"), "false");
  assert.ok(page.frame.srcdoc.includes('<html data-theme="light">'));
});

test("the copy button copies the command it names and says so", async () => {
  const clipboard = recordingClipboard();
  const page = buildPage(clipboard);

  page.copyButton.click();
  await settle();

  assert.deepEqual(clipboard.writes, ["/ui-design apply A"]);
  assert.equal(
    page.status.textContent,
    "Copied /ui-design apply A. Paste it in the session."
  );
});

test("when the clipboard refuses, the command is selected instead", async () => {
  const clipboard = {
    writes: [],
    writeText: () => Promise.reject(new Error("denied")),
  };
  const page = buildPage(clipboard);

  page.copyButton.click();
  await settle();

  assert.equal(page.selection.ranges.length, 1);
  assert.equal(page.selection.ranges[0].node.textContent, "/ui-design apply A");
  assert.equal(
    page.status.textContent,
    "Could not copy. The command is selected: press Cmd/Ctrl+C."
  );
});

test("without a clipboard API, the command is selected at once", () => {
  const page = buildPage();

  page.copyButton.click();

  assert.equal(page.selection.ranges[0].node.textContent, "/ui-design apply A");
  assert.equal(
    page.status.textContent,
    "Could not copy. The command is selected: press Cmd/Ctrl+C."
  );
});

const drag = (resizer, fromY, toY) => {
  dispatch(resizer, "pointerdown", "", { clientY: fromY, pointerId: 7 });
  dispatch(resizer, "pointermove", "", { clientY: toY, pointerId: 7 });
};

const readStageHeight = (page) => page.body.style.properties["--stage-height"];

test("dragging a resizer sets every stage's height and keeps the pointer", () => {
  const page = buildPage();

  drag(page.resizerA, 500, 580);

  assert.equal(page.resizerA.capturedPointerId, 7);
  assert.equal(page.body.dataset.resizing, "true");
  assert.equal(readStageHeight(page), "720px");
  assert.equal(page.resizerA.getAttribute("aria-valuenow"), "720");
  assert.equal(page.resizerB.getAttribute("aria-valuenow"), "720");

  dispatch(page.resizerA, "pointerup", "", { clientY: 580, pointerId: 7 });
  dispatch(page.resizerA, "pointermove", "", { clientY: 900, pointerId: 7 });

  assert.equal(page.body.dataset.resizing, undefined);
  assert.equal(readStageHeight(page), "720px");
});

test("the height stops at its floor and ceiling and marks the edge", () => {
  const page = buildPage();

  drag(page.resizerA, 500, -2000);

  assert.equal(readStageHeight(page), "240px");
  assert.equal(page.resizerA.dataset.edge, "min");

  dispatch(page.resizerA, "pointermove", "", { clientY: 5000, pointerId: 7 });

  assert.equal(readStageHeight(page), "1600px");
  assert.equal(page.resizerB.dataset.edge, "max");

  dispatch(page.resizerA, "pointermove", "", { clientY: 600, pointerId: 7 });

  assert.equal(page.resizerA.dataset.edge, "");
});

test("arrow keys, Home and End resize from the keyboard", () => {
  const page = buildPage();

  const downEvent = pressKey(page.resizerA, "ArrowDown");
  assert.equal(downEvent.defaultPrevented, true);
  assert.equal(readStageHeight(page), "680px");

  pressKey(page.resizerA, "ArrowUp");
  pressKey(page.resizerA, "ArrowUp");
  assert.equal(readStageHeight(page), "600px");

  pressKey(page.resizerA, "End");
  assert.equal(readStageHeight(page), "1600px");

  pressKey(page.resizerA, "Home");
  assert.equal(readStageHeight(page), "240px");

  assert.equal(pressKey(page.resizerA, "Tab").defaultPrevented, false);
});

test("double-clicking a resizer puts the height back", () => {
  const page = buildPage();

  pressKey(page.resizerA, "End");
  dispatch(page.resizerA, "dblclick");

  assert.equal(readStageHeight(page), "640px");
  assert.equal(page.resizerB.getAttribute("aria-valuenow"), "640");
});
