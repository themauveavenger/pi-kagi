import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import extension from "../src/index.ts";

/**
 * Mock theme whose `fg`/`bg`/`bold` wrap text in visible marker tags. Tests
 * strip the tags back out to compare the plain text, while still being able
 * to assert which colors were applied.
 */
const testTheme = {
  fg: (color: string, text: string) => `<fg:${color}>${text}</fg>`,
  bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
  bold: (text: string) => `<b>${text}</b>`,
} as unknown as Theme;

function plain(component: Component, width = 200): string {
  return component.render(width).join("\n").replace(/<\/?[^>]+>/g, "");
}

type ToolDefinitionAny = Parameters<ExtensionAPI["registerTool"]>[0];

function captureRegistrations(): { tools: ToolDefinitionAny[]; pi: ExtensionAPI } {
  const tools: ToolDefinitionAny[] = [];
  const pi = {
    registerTool(definition: ToolDefinitionAny) {
      tools.push(definition);
    },
    on() {},
    registerCommand() {},
    appendEntry() {},
  } as unknown as ExtensionAPI;
  return { tools, pi };
}

function findTool(name: string): ToolDefinition {
  const { tools, pi } = captureRegistrations();
  extension(pi);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} was not registered`);
  return tool as ToolDefinition;
}

test("kagi_search renderResult (expanded) shows the formatted result text", () => {
  const tool = findTool("kagi_search");
  assert.ok(tool.renderResult, "kagi_search needs renderResult");

  const result = {
    content: [{ type: "text" as const, text: "1. [Example](https://example.com)\n   snippet line" }],
    details: {},
  };

  // Only `args` is read by the renderer under test; the rest is fill.
  const ctx = { args: { query: "example", limit: 10, offset: 1 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: true, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  assert.ok(
    text.includes("1. [Example](https://example.com)"),
    `expected result body in expanded view, got: ${text}`,
  );
});

test("kagi_search renderResult (collapsed) hides the query (renderCall already shows it)", () => {
  const tool = findTool("kagi_search");
  assert.ok(tool.renderResult, "kagi_search needs renderResult");

  const result = {
    content: [{ type: "text" as const, text: "1. [Example](https://example.com)\n   snippet line" }],
    details: {},
  };
  const ctx = { args: { query: "openai 5.6 release", limit: 10, offset: 1 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  // renderCall already displays the query; collapsed renderResult must not duplicate it.
  assert.ok(!text.includes("openai 5.6 release"), `query must not appear in collapsed result, got: ${text}`);
  assert.ok(
    !text.includes("https://example.com"),
    `result body must not appear in collapsed view, got: ${text}`,
  );
});

test("kagi_search renderResult (collapsed) shows 'from cache' when the result was cached", () => {
  const tool = findTool("kagi_search");
  assert.ok(tool.renderResult, "kagi_search needs renderResult");

  const cached = "Showing results 1–3 of 3 for \"x\". (from cache)";
  const result = { content: [{ type: "text" as const, text: cached }], details: {} };
  const ctx = { args: { query: "x", limit: 10, offset: 1 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("from cache"), `expected 'from cache' in collapsed view, got: ${text}`);
  // Query must not leak from the collapsed result (renderCall already shows it).
  assert.ok(!text.includes('"x"'), `query must not appear in collapsed result, got: ${text}`);
});

test("kagi_search renderResult (collapsed) shows limit/offset when non-default", () => {
  const tool = findTool("kagi_search");
  assert.ok(tool.renderResult, "kagi_search needs renderResult");

  const result = { content: [{ type: "text" as const, text: "..." }], details: {} };
  const ctx = { args: { query: "x", limit: 5, offset: 11 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("offset=11"), `expected offset annotation, got: ${text}`);
  assert.ok(text.includes("limit=5"), `expected limit annotation, got: ${text}`);
  // Query must not leak from the collapsed result (renderCall already shows it).
  assert.ok(!text.includes("\"x\""), `query must not appear in collapsed result, got: ${text}`);
});

test("kagi_search renderCall shows the tool name and query while running", () => {
  const tool = findTool("kagi_search");
  assert.ok(tool.renderCall, "kagi_search needs renderCall");

  const args = { query: "openai 5.6 release", limit: 10, offset: 1 } as Parameters<
    NonNullable<ToolDefinition["renderCall"]>
  >[0];
  const ctx = { args } as Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
  const component = tool.renderCall!(args, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("kagi_search"), `expected tool name in renderCall, got: ${text}`);
  assert.ok(text.includes("openai 5.6 release"), `expected query in renderCall, got: ${text}`);
});

test("kagi_extract renderResult (expanded) shows the formatted result text", () => {
  const tool = findTool("kagi_extract");
  assert.ok(tool.renderResult, "kagi_extract needs renderResult");

  const result = {
    content: [{ type: "text" as const, text: "# https://example.com — 12 lines\n\nbody line" }],
    details: {},
  };
  const ctx = { args: { url: "https://example.com", limit: 250, offset: 1 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: true, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("https://example.com"), `expected page body in expanded view, got: ${text}`);
  assert.ok(text.includes("body line"), `expected page body in expanded view, got: ${text}`);
});

test("kagi_extract renderResult (collapsed) hides the URL (renderCall already shows it)", () => {
  const tool = findTool("kagi_extract");
  assert.ok(tool.renderResult, "kagi_extract needs renderResult");

  const result = {
    content: [{ type: "text" as const, text: "# https://example.com — 12 lines\n\nbody line" }],
    details: {},
  };
  const ctx = { args: { url: "https://example.com/page", limit: 250, offset: 1 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  // renderCall already displays the URL; collapsed renderResult must not duplicate it.
  assert.ok(!text.includes("https://example.com/page"), `URL must not appear in collapsed result, got: ${text}`);
  // Collapsed: the page body should be hidden.
  assert.ok(!text.includes("body line"), `page body must not appear in collapsed view, got: ${text}`);
});

test("kagi_extract renderResult (collapsed) shows 'from cache' when the page was cached", () => {
  const tool = findTool("kagi_extract");
  assert.ok(tool.renderResult, "kagi_extract needs renderResult");

  const cached = "# https://example.com — 12 lines (from cache)";
  const result = { content: [{ type: "text" as const, text: cached }], details: {} };
  const ctx = { args: { url: "https://example.com", limit: 250, offset: 1 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("from cache"), `expected 'from cache' in collapsed view, got: ${text}`);
  // URL must not leak from the collapsed result (renderCall already shows it).
  assert.ok(!text.includes("https://example.com"), `URL must not appear in collapsed result, got: ${text}`);
});

test("kagi_extract renderResult (collapsed) shows limit/offset when non-default", () => {
  const tool = findTool("kagi_extract");
  assert.ok(tool.renderResult, "kagi_extract needs renderResult");

  const result = { content: [{ type: "text" as const, text: "..." }], details: {} };
  const ctx = { args: { url: "https://example.com", limit: 50, offset: 11 } } as Parameters<
    NonNullable<ToolDefinition["renderResult"]>
  >[3];
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("offset=11"), `expected offset annotation, got: ${text}`);
  assert.ok(text.includes("limit=50"), `expected limit annotation, got: ${text}`);
  // URL must not leak from the collapsed result (renderCall already shows it).
  assert.ok(!text.includes("https://example.com"), `URL must not appear in collapsed result, got: ${text}`);
});

test("kagi_extract renderCall shows the tool name and URL while running", () => {
  const tool = findTool("kagi_extract");
  assert.ok(tool.renderCall, "kagi_extract needs renderCall");

  const args = { url: "https://example.com/page", limit: 250, offset: 1 } as Parameters<
    NonNullable<ToolDefinition["renderCall"]>
  >[0];
  const ctx = { args } as Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
  const component = tool.renderCall!(args, testTheme, ctx);

  const text = plain(component);
  assert.ok(text.includes("kagi_extract"), `expected tool name in renderCall, got: ${text}`);
  assert.ok(text.includes("https://example.com/page"), `expected URL in renderCall, got: ${text}`);
});
