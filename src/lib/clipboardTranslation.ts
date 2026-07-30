import type { JSONContent } from "@tiptap/core";
import {
  DOMParser as ProseMirrorDOMParser,
  type Schema,
} from "@tiptap/pm/model";

export interface ClipboardPayload {
  html: string;
  markdown: string;
  text: string;
}

export type ClipboardTranslation =
  | { kind: "html"; value: string }
  | { kind: "markdown"; value: string }
  | { kind: "text"; value: string };

export interface ClipboardItemLike {
  types: readonly string[];
  getType: (type: string) => Promise<Blob>;
}

export interface ClipboardDataItemLike {
  type: string;
}

export interface ClipboardReaderLike {
  read?: () => Promise<ClipboardItemLike[]>;
  readText: () => Promise<string>;
}

export interface ClipboardInsertionAdapter {
  insertHtml: (html: string) => boolean | Promise<boolean>;
  insertMarkdown: (markdown: string) => boolean | Promise<boolean>;
  insertText: (text: string) => void | Promise<void>;
}

export interface ClipboardPasteOptions {
  exact?: boolean;
  document?: Document;
  onFallback?: (reason: string) => void;
}

export interface ClipboardPasteResult {
  translation: ClipboardTranslation;
  fellBackToText: boolean;
}

export function findClipboardImageItem<T extends ClipboardDataItemLike>(
  items: readonly T[],
): T | undefined {
  return items.find((item) => item.type.startsWith("image/"));
}

const blockHtmlPattern =
  /<(?:article|blockquote|div|h[1-6]|hr|li|ol|p|pre|table|tbody|td|th|thead|tr|ul)\b/i;
const codeEditorWrapperPattern =
  /\b(?:ace_editor|CodeMirror|cm-editor|monaco-editor)\b/i;

function decodeBasicHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function normaliseComparableText(value: string): string {
  return decodeBasicHtml(value).replace(/\s+/g, " ").trim();
}

function visibleHtmlText(html: string): string {
  return normaliseComparableText(
    html
      .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(?:article|blockquote|div|h[1-6]|li|ol|p|pre|table|td|th|tr|ul)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

export function isHighConfidenceMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return false;

  const headings = nonEmptyLines.filter((line) =>
    /^\s{0,3}#{1,6}\s+\S/.test(line),
  ).length;
  const unorderedItems = nonEmptyLines.filter((line) =>
    /^\s{0,3}[-+*]\s+\S/.test(line),
  ).length;
  const orderedItems = nonEmptyLines.filter((line) =>
    /^\s{0,3}\d+[.)]\s+\S/.test(line),
  ).length;
  const blockQuotes = nonEmptyLines.filter((line) =>
    /^\s{0,3}>\s+\S/.test(line),
  ).length;
  const fences = nonEmptyLines.filter((line) =>
    /^\s{0,3}(?:```|~~~)/.test(line),
  ).length;
  const tableDivider = lines.some((line) =>
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
  );
  const frontmatter =
    nonEmptyLines[0]?.trim() === "---" &&
    nonEmptyLines.slice(1).some((line) => line.trim() === "---");

  if (headings > 0 || tableDivider || frontmatter || fences >= 2) return true;
  if (unorderedItems >= 2 || orderedItems >= 2 || blockQuotes >= 2) return true;

  const inlineMarkdown = [
    ...text.matchAll(/\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~/g),
    ...text.matchAll(/!?\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)/g),
    ...text.matchAll(/`[^`\n]+`/g),
  ].length;
  return inlineMarkdown >= 2;
}

function isCodeEditorHtmlWrapper(html: string, text: string): boolean {
  if (codeEditorWrapperPattern.test(html)) return true;
  const withoutPreCode = html
    .replace(/<\/?(?:pre|code)\b[^>]*>/gi, "")
    .trim();
  const containsOnlyPreCode =
    /<pre\b/i.test(html) &&
    /<code\b/i.test(html) &&
    !/<(?:h[1-6]|p|li|ol|ul|table|blockquote|hr)\b/i.test(withoutPreCode);
  return (
    containsOnlyPreCode &&
    isHighConfidenceMarkdown(text) &&
    visibleHtmlText(html) === normaliseComparableText(text)
  );
}

function isMeaningfulHtml(html: string): boolean {
  return blockHtmlPattern.test(html) && visibleHtmlText(html).length > 0;
}

export function selectClipboardTranslation(
  payload: ClipboardPayload,
): ClipboardTranslation {
  if (payload.markdown.trim()) {
    return { kind: "markdown", value: payload.markdown };
  }

  if (
    payload.html.trim() &&
    isCodeEditorHtmlWrapper(payload.html, payload.text) &&
    isHighConfidenceMarkdown(payload.text)
  ) {
    return { kind: "markdown", value: payload.text };
  }

  if (payload.html.trim() && isMeaningfulHtml(payload.html)) {
    return { kind: "html", value: payload.html };
  }

  if (isHighConfidenceMarkdown(payload.text)) {
    return { kind: "markdown", value: payload.text };
  }

  return { kind: "text", value: payload.text };
}

async function readClipboardType(
  items: ClipboardItemLike[],
  type: string,
): Promise<string> {
  for (const item of items) {
    if (!item.types.includes(type)) continue;
    const blob = await item.getType(type);
    const value = await blob.text();
    if (value) return value;
  }
  return "";
}

export async function readClipboardPayload(
  clipboard: ClipboardReaderLike,
): Promise<ClipboardPayload> {
  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      const [markdown, html, text] = await Promise.all([
        readClipboardType(items, "text/markdown"),
        readClipboardType(items, "text/html"),
        readClipboardType(items, "text/plain"),
      ]);
      if (markdown || html || text) return { markdown, html, text };
    } catch {
      // WebView permission and API support vary; readText is the defined fallback.
    }
  }

  return {
    markdown: "",
    html: "",
    text: await clipboard.readText(),
  };
}

function isSafeUrl(value: string, attributeName: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return true;
  }
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (attributeName === "href") {
    return scheme === "http" || scheme === "https" || scheme === "mailto";
  }
  return scheme === "http" || scheme === "https";
}

export function sanitiseClipboardHtml(
  html: string,
  ownerDocument: Document,
): string {
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;
  template.content
    .querySelectorAll(
      "script, style, iframe, object, embed, link, meta, form, input, button",
    )
    .forEach((element) => element.remove());

  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        name === "srcset"
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        !isSafeUrl(attribute.value, name === "href" ? "href" : "src")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return template.innerHTML;
}

function collectDomTextFragments(node: Node, output: string[]): void {
  if (node.nodeType === 3) {
    const text = normaliseComparableText(node.nodeValue ?? "");
    if (text) output.push(text);
    return;
  }

  if (node.nodeType !== 1 && node.nodeType !== 11) return;
  if (node.nodeType === 1) {
    const element = node as Element;
    if (element.tagName.toLowerCase() === "img") {
      const alt = normaliseComparableText(element.getAttribute("alt") ?? "");
      if (alt) output.push(alt);
    }
  }

  for (const child of node.childNodes) {
    collectDomTextFragments(child, output);
  }
}

function collectJsonTextFragments(
  node: JSONContent,
  output: string[],
): void {
  if (node.text) {
    const text = normaliseComparableText(node.text);
    if (text) output.push(text);
  } else if (node.type === "image") {
    const alt = normaliseComparableText(String(node.attrs?.alt ?? ""));
    if (alt) output.push(alt);
  }

  for (const child of node.content ?? []) {
    collectJsonTextFragments(child, output);
  }
}

export function parseClipboardHtmlPreservingContent(
  schema: Schema,
  html: string,
  ownerDocument: Document,
): JSONContent {
  const container = ownerDocument.createElement("div");
  container.innerHTML = sanitiseClipboardHtml(html, ownerDocument);

  const expected: string[] = [];
  collectDomTextFragments(container, expected);

  const parsed = ProseMirrorDOMParser.fromSchema(schema)
    .parse(container)
    .toJSON() as JSONContent;
  const actual: string[] = [];
  collectJsonTextFragments(parsed, actual);
  const actualSequence = normaliseComparableText(actual.join(" "));

  let cursor = 0;
  for (const fragment of expected) {
    const position = actualSequence.indexOf(fragment, cursor);
    if (position === -1) {
      const excerpt =
        fragment.length > 120 ? `${fragment.slice(0, 117)}…` : fragment;
      throw new Error(
        `HTML conversion failed its preservation check near: ${excerpt}`,
      );
    }
    cursor = position + fragment.length;
  }

  return parsed;
}

function literalClipboardText(payload: ClipboardPayload): string {
  if (payload.markdown) return payload.markdown;
  if (payload.text) return payload.text;
  return visibleHtmlText(payload.html);
}

export async function performClipboardPaste(
  payload: ClipboardPayload,
  adapter: ClipboardInsertionAdapter,
  options: ClipboardPasteOptions = {},
): Promise<ClipboardPasteResult> {
  if (options.exact) {
    const literal = literalClipboardText(payload);
    await adapter.insertText(literal);
    return {
      translation: { kind: "text", value: literal },
      fellBackToText: false,
    };
  }

  const translation = selectClipboardTranslation(payload);
  try {
    let inserted = true;
    if (translation.kind === "html") {
      const documentForSanitising =
        options.document ??
        (typeof document === "undefined" ? undefined : document);
      const safeHtml = documentForSanitising
        ? sanitiseClipboardHtml(translation.value, documentForSanitising)
        : translation.value;
      inserted = await adapter.insertHtml(safeHtml);
    } else if (translation.kind === "markdown") {
      inserted = await adapter.insertMarkdown(translation.value);
    } else {
      await adapter.insertText(translation.value);
    }

    if (inserted) {
      return { translation, fellBackToText: false };
    }
    throw new Error(`${translation.kind} conversion was not preserved`);
  } catch (error) {
    const literal =
      translation.kind === "html"
        ? payload.text || visibleHtmlText(payload.html)
        : literalClipboardText(payload);
    await adapter.insertText(literal);
    const reason =
      error instanceof Error ? error.message : "Clipboard conversion failed";
    options.onFallback?.(reason);
    return {
      translation: { kind: "text", value: literal },
      fellBackToText: true,
    };
  }
}
