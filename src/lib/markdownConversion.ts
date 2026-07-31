import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { createMarkdownSchemaExtensions } from "./markdownExtensions.ts";

type TokenRecord = Record<string, unknown>;

const semanticAttributeNames = new Set([
  "alt",
  "checked",
  "colspan",
  "colwidth",
  "href",
  "label",
  "language",
  "latex",
  "level",
  "noteTitle",
  "rowspan",
  "src",
  "start",
  "title",
]);

export function createProductionMarkdownManager(): MarkdownManager {
  return new MarkdownManager({
    extensions: createMarkdownSchemaExtensions(),
  });
}

function normaliseText(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTokenText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTokenText(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  const token = value as TokenRecord;
  const type = typeof token.type === "string" ? token.type : "";
  if (type === "space" || type === "hr" || type === "def") return;

  const nestedKeys = ["tokens", "items", "header", "rows", "cells"];
  let hasNestedText = false;
  for (const key of nestedKeys) {
    const nested = token[key];
    if (Array.isArray(nested) && nested.length > 0) {
      const lengthBefore = output.length;
      collectTokenText(nested, output);
      hasNestedText ||= output.length > lengthBefore;
    }
  }

  if (!hasNestedText && typeof token.text === "string") {
    const text = normaliseText(token.text);
    if (text) output.push(text);
  }

  if (
    (type === "link" || type === "image") &&
    typeof token.href === "string"
  ) {
    const href = normaliseText(token.href);
    if (href) output.push(href);
  }

  if (type === "code" && typeof token.lang === "string") {
    const language = normaliseText(token.lang);
    if (language) output.push(language);
  }
  if (type === "blockMath" && typeof token.latex === "string") {
    const latex = normaliseText(token.latex);
    if (latex) output.push(latex);
  }
}

function collectDocumentText(node: JSONContent, output: string[]): void {
  if (node.text) {
    const text = normaliseText(node.text);
    if (text) output.push(text);
  } else if (node.type === "image") {
    const alt = normaliseText(String(node.attrs?.alt ?? ""));
    const src = normaliseText(String(node.attrs?.src ?? ""));
    if (alt) output.push(alt);
    if (src) output.push(src);
  } else if (node.type === "footnoteReference") {
    const label = normaliseText(String(node.attrs?.label ?? ""));
    if (label) output.push(label);
  } else if (node.type === "wikilink") {
    const noteTitle = normaliseText(String(node.attrs?.noteTitle ?? ""));
    if (noteTitle) output.push(noteTitle);
  } else if (node.type === "blockMath") {
    const latex = normaliseText(String(node.attrs?.latex ?? ""));
    if (latex) output.push(latex);
  } else {
    for (const child of node.content ?? []) {
      collectDocumentText(child, output);
    }
  }

  if (node.type === "codeBlock") {
    const language = normaliseText(String(node.attrs?.language ?? ""));
    if (language) output.push(language);
  }

  for (const mark of node.marks ?? []) {
    if (mark.type === "link") {
      const href = normaliseText(String(mark.attrs?.href ?? ""));
      if (href) output.push(href);
    }
  }
}

function assertSourcePreserved(
  manager: MarkdownManager,
  markdown: string,
  document: JSONContent,
): void {
  const expected: string[] = [];
  collectTokenText(manager.instance.lexer(markdown), expected);

  const actual: string[] = [];
  collectDocumentText(document, actual);
  const actualSequence = normaliseText(actual.join(" "));

  let cursor = 0;
  for (const fragment of expected) {
    const position = actualSequence.indexOf(fragment, cursor);
    if (position === -1) {
      const excerpt =
        fragment.length > 120 ? `${fragment.slice(0, 117)}…` : fragment;
      throw new Error(
        `Markdown conversion failed its preservation check near: ${excerpt}`,
      );
    }
    cursor = position + fragment.length;
  }
}

export function parseMarkdownPreservingContent(
  manager: MarkdownManager,
  markdown: string,
): JSONContent {
  const parsed = manager.parse(markdown);
  assertSourcePreserved(manager, markdown, parsed);
  return parsed;
}

export interface MarkdownRoundTripResult {
  ok: boolean;
  reason?: string;
}

function canonicalAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!attributes) return undefined;
  const entries = Object.entries(attributes)
    .filter(
      ([name, value]) =>
        semanticAttributeNames.has(name) && value !== null && value !== undefined,
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function canonicalDocumentNode(node: JSONContent): JSONContent {
  const canonical: JSONContent = { type: node.type };
  const normalisedAttrs = node.attrs ? { ...node.attrs } : undefined;
  if (node.type === "orderedList" && normalisedAttrs?.start === 1) {
    delete normalisedAttrs.start;
  }
  const attrs = canonicalAttributes(normalisedAttrs);
  if (attrs) canonical.attrs = attrs;
  if (node.text !== undefined) canonical.text = node.text;
  if (node.marks?.length) {
    canonical.marks = node.marks
      .map((mark) => {
        const canonicalMark: NonNullable<JSONContent["marks"]>[number] = {
          type: mark.type,
        };
        const markAttrs = canonicalAttributes(mark.attrs);
        if (markAttrs) canonicalMark.attrs = markAttrs;
        return canonicalMark;
      })
      .sort((left, right) => left.type.localeCompare(right.type));
  }
  const meaningfulContent = node.content?.filter(
    (child) =>
      !(
        child.type === "paragraph" &&
        !child.text &&
        !canonicalAttributes(child.attrs) &&
        (!child.content || child.content.length === 0)
      ),
  );
  if (meaningfulContent?.length) {
    canonical.content = meaningfulContent.map(canonicalDocumentNode);
  }
  return canonical;
}

export function validateMarkdownRoundTrip(
  manager: MarkdownManager,
  intended: JSONContent,
  markdown: string,
): MarkdownRoundTripResult {
  try {
    const reparsed = parseMarkdownPreservingContent(manager, markdown);
    const expected = canonicalDocumentNode(intended);
    const actual = canonicalDocumentNode(reparsed);
    if (JSON.stringify(expected) === JSON.stringify(actual)) {
      return { ok: true };
    }

    const expectedText: string[] = [];
    const actualText: string[] = [];
    collectDocumentText(intended, expectedText);
    collectDocumentText(reparsed, actualText);
    const expectedSequence = normaliseText(expectedText.join(" "));
    const actualSequence = normaliseText(actualText.join(" "));
    const missingFragment = expectedText.find((fragment) => {
      const norm = normaliseText(fragment);
      if (!norm) return false;
      if (actualSequence.includes(norm)) return false;
      const subChunks = norm
        .split(/(?:[\r\n]+|[.!?:]\s+|\s{2,})/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3);
      if (subChunks.length > 0) {
        return subChunks.some((sub) => !actualSequence.includes(sub));
      }
      return true;
    });

    return {
      ok: false,
      reason: missingFragment
        ? `Round-trip validation lost intended content near: ${missingFragment}`
        : `Round-trip validation changed the intended document (${expectedSequence.length} → ${actualSequence.length} visible characters)`,
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "Markdown round-trip validation failed",
    };
  }
}
