import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { JSDOM } from "jsdom";
import {
  findClipboardImageItem,
  parseClipboardHtmlPreservingContent,
  performClipboardPaste,
  readClipboardPayload,
  sanitiseClipboardHtml,
  selectClipboardTranslation,
  type ClipboardInsertionAdapter,
  type ClipboardPayload,
} from "./clipboardTranslation.ts";
import { createMarkdownSchemaExtensions } from "./markdownExtensions.ts";
import {
  createProductionMarkdownManager,
  parseMarkdownPreservingContent,
} from "./markdownConversion.ts";

const richHtml = readFileSync(
  resolve(process.cwd(), "src/test-fixtures/gemini-rich-clipboard.html"),
  "utf8",
);
const flattenedText = readFileSync(
  resolve(process.cwd(), "src/test-fixtures/gemini-rich-clipboard.txt"),
  "utf8",
);

test("explicit Markdown beats meaningful HTML", () => {
  assert.deepEqual(
    selectClipboardTranslation({
      markdown: "## Explicit\n\n- one\n- two",
      html: "<h1>Rich</h1><p>Text</p>",
      text: "flattened",
    }),
    { kind: "markdown", value: "## Explicit\n\n- one\n- two" },
  );
});

test("image clipboard items remain available before text translation", () => {
  const image = { type: "image/png", marker: "image" };
  const items = [{ type: "text/plain", marker: "text" }, image];

  assert.equal(findClipboardImageItem(items), image);
});

test("meaningful Gemini HTML beats its flattened plain text", () => {
  assert.deepEqual(
    selectClipboardTranslation({
      markdown: "",
      html: richHtml,
      text: flattenedText,
    }),
    { kind: "html", value: richHtml },
  );
});

test("inline-only rich HTML beats its flattened plain text", () => {
  const html =
    '<strong>Bold</strong> and <a href="https://example.com">linked</a>';

  assert.deepEqual(
    selectClipboardTranslation({
      markdown: "",
      html,
      text: "Bold and linked",
    }),
    { kind: "html", value: html },
  );

  const dom = new JSDOM("<!doctype html><body></body>");
  const schema = getSchema(createMarkdownSchemaExtensions());
  const parsed = parseClipboardHtmlPreservingContent(
    schema,
    html,
    dom.window.document,
  );
  const serialised = JSON.stringify(parsed);

  assert.match(serialised, /"type":"bold"/);
  assert.match(serialised, /"type":"link"/);
});

test("known code-editor HTML wrapper does not override literal Markdown", () => {
  const markdown = "## Heading\n\n1. one\n2. two";
  assert.deepEqual(
    selectClipboardTranslation({
      markdown: "",
      html: `<div class="monaco-editor"><pre><code>${markdown}</code></pre></div>`,
      text: markdown,
    }),
    { kind: "markdown", value: markdown },
  );
});

for (const prose of [
  "The R&R process requires a response.",
  "A border-making account uses hyphens in ordinary prose.",
  "An *asterisk* can be rhetorical rather than structural.",
  "1. In 2024 the first report appeared.",
]) {
  test(`incidental punctuation remains plain text: ${prose}`, () => {
    assert.deepEqual(
      selectClipboardTranslation({ markdown: "", html: "", text: prose }),
      { kind: "text", value: prose },
    );
  });
}

test("line-classified Markdown is selected from text/plain", () => {
  const markdown = "## Heading\n\n1. one\n2. two\n\nParagraph.";
  assert.deepEqual(
    selectClipboardTranslation({ markdown: "", html: "", text: markdown }),
    { kind: "markdown", value: markdown },
  );
});

test("plain-text-only content is retained without concatenation", async () => {
  const calls: Array<[string, string]> = [];
  const adapter: ClipboardInsertionAdapter = {
    insertHtml: async (value) => {
      calls.push(["html", value]);
      return true;
    },
    insertMarkdown: async (value) => {
      calls.push(["markdown", value]);
      return true;
    },
    insertText: (value) => {
      calls.push(["text", value]);
    },
  };
  const text = "First line\n\nSecond line\nThird line";

  await performClipboardPaste(
    { markdown: "", html: "", text },
    adapter,
  );

  assert.deepEqual(calls, [["text", text]]);
});

test("context clipboard read uses rich flavours when available", async () => {
  const blobs = new Map([
    ["text/markdown", new Blob(["## Explicit"])],
    ["text/html", new Blob(["<h2>Explicit</h2>"])],
    ["text/plain", new Blob(["Explicit"])],
  ]);
  const payload = await readClipboardPayload({
    read: async () => [
      {
        types: [...blobs.keys()],
        getType: async (type) => {
          const blob = blobs.get(type);
          if (!blob) throw new Error(`Missing ${type}`);
          return blob;
        },
      },
    ],
    readText: async () => "fallback",
  });

  assert.deepEqual(payload, {
    markdown: "## Explicit",
    html: "<h2>Explicit</h2>",
    text: "Explicit",
  });
});

test("context clipboard read falls back to readText when rich read is denied", async () => {
  const payload = await readClipboardPayload({
    read: async () => {
      throw new Error("denied");
    },
    readText: async () => "Fallback\n\ntext",
  });

  assert.deepEqual(payload, {
    markdown: "",
    html: "",
    text: "Fallback\n\ntext",
  });
});

test("Paste exactly bypasses conversion and retains delivered source", async () => {
  const calls: Array<[string, string]> = [];
  const adapter: ClipboardInsertionAdapter = {
    insertHtml: async (value) => {
      calls.push(["html", value]);
      return true;
    },
    insertMarkdown: async (value) => {
      calls.push(["markdown", value]);
      return true;
    },
    insertText: (value) => {
      calls.push(["text", value]);
    },
  };
  const markdown = "## Literal\n\n- keep *all* punctuation\r\n";

  await performClipboardPaste(
    { markdown, html: "<h2>Literal</h2>", text: "Literal" },
    adapter,
    { exact: true },
  );

  assert.deepEqual(calls, [["text", markdown]]);
});

test("conversion failure inserts the complete literal fallback once", async () => {
  const calls: Array<[string, string]> = [];
  const adapter: ClipboardInsertionAdapter = {
    insertHtml: async () => {
      throw new Error("preservation failure");
    },
    insertMarkdown: async () => false,
    insertText: (value) => {
      calls.push(["text", value]);
    },
  };
  const payload: ClipboardPayload = {
    markdown: "",
    html: richHtml,
    text: flattenedText,
  };

  const result = await performClipboardPaste(payload, adapter);

  assert.equal(result.fellBackToText, true);
  assert.deepEqual(calls, [["text", flattenedText]]);
});

test("explicit Markdown conversion failure retains the complete Markdown flavour", async () => {
  const calls: Array<[string, string]> = [];
  const adapter: ClipboardInsertionAdapter = {
    insertHtml: async () => true,
    insertMarkdown: async () => false,
    insertText: (value) => {
      calls.push(["text", value]);
    },
  };
  const markdown = "## Exact fallback\r\n\r\n- first\r\n- second\r\n";

  const result = await performClipboardPaste(
    { markdown, html: "<h2>Exact fallback</h2>", text: "" },
    adapter,
  );

  assert.equal(result.fellBackToText, true);
  assert.deepEqual(calls, [["text", markdown]]);
});

test("HTML sanitisation removes active content and unsafe URL schemes", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const unsafe =
    '<h2 onclick="steal()">Safe heading</h2><script>alert(1)</script>' +
    '<a href="javascript:alert(2)" onmouseover="steal()">Link</a>' +
    '<img src="javascript:alert(3)" onerror="steal()">';

  const sanitised = sanitiseClipboardHtml(unsafe, dom.window.document);

  assert.match(sanitised, /Safe heading/);
  assert.match(sanitised, />Link</);
  assert.doesNotMatch(
    sanitised,
    /script|onclick|onmouseover|onerror|javascript:/i,
  );
});

test("Gemini rich HTML preserves hierarchy through Markdown save and reload", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const schema = getSchema(createMarkdownSchemaExtensions());
  const manager = createProductionMarkdownManager();

  const parsed = parseClipboardHtmlPreservingContent(
    schema,
    richHtml,
    dom.window.document,
  );
  const markdown = manager.serialize(parsed);
  const reloaded = parseMarkdownPreservingContent(manager, markdown);
  const types = (reloaded.content ?? []).map((node) => node.type);
  const visible = JSON.stringify(reloaded);

  assert.deepEqual(types, [
    "heading",
    "paragraph",
    "horizontalRule",
    "heading",
    "orderedList",
    "heading",
    "bulletList",
    "codeBlock",
  ]);
  for (const text of [
    "Heritage–Border Research Workflow",
    "This workflow preserves",
    "evidence",
    "Phase A: Source review",
    "Map the source corpus.",
    "Verify quotations and locators.",
    "Phase B: Analysis",
    "Compare claims.",
    "Retain methodological cautions.",
    "Module_08_Book_Chapter_Contribution",
    "Verified chapter",
  ]) {
    assert.match(visible, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
