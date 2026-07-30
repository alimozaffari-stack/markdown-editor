import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeEditedContentIntoSource,
  parseNoteAnnotations,
} from "./noteAnnotations.ts";

const annotatedSource = [
  "# Title",
  "",
  "Before[^1]",
  "",
  "[^1]: Exact  footnote",
  "After",
  "",
  "<!-- SCRATCH_COMMENTS",
  JSON.stringify(
    [{ id: "comment-1", text: "Retain me", timestamp: 1 }],
    null,
    2,
  ),
  "-->",
].join("\r\n");

test("annotation parsing retains the original source outside the visual body", () => {
  const parsed = parseNoteAnnotations(annotatedSource);

  assert.deepEqual(parsed.footnotes, [
    { id: "1", text: "Exact  footnote" },
  ]);
  assert.deepEqual(parsed.comments, [
    { id: "comment-1", text: "Retain me", timestamp: 1 },
  ]);
  assert.equal(
    mergeEditedContentIntoSource(
      annotatedSource,
      parsed.cleanContent,
      parsed.cleanContent,
    ),
    annotatedSource,
  );
});

test("a body edit preserves footnote and comment byte ranges in place", () => {
  const parsed = parseNoteAnnotations(annotatedSource);
  const edited = parsed.cleanContent.replace("Before", "Before revised ✓");
  const merged = mergeEditedContentIntoSource(
    annotatedSource,
    parsed.cleanContent,
    edited,
  );

  assert.equal(
    merged,
    annotatedSource.replace("Before", "Before revised ✓"),
  );
  assert.ok(merged.includes("[^1]: Exact  footnote\r\nAfter"));
  const reparsed = parseNoteAnnotations(annotatedSource);
  assert.ok(merged.endsWith(reparsed.segments[reparsed.segments.length - 1].text));
});

test("content spanning an annotation can change without deleting the annotation", () => {
  const parsed = parseNoteAnnotations(annotatedSource);
  const edited = parsed.cleanContent.replace(
    "Before[^1]\r\n\r\nAfter",
    "Replacement body",
  );
  const merged = mergeEditedContentIntoSource(
    annotatedSource,
    parsed.cleanContent,
    edited,
  );

  assert.ok(merged.includes("Replacement body"));
  assert.ok(merged.includes("[^1]: Exact  footnote\r\n"));
  assert.ok(merged.includes("<!-- SCRATCH_COMMENTS\r\n"));
});

test("a boundary insertion stays after the hidden annotation", () => {
  const source = "Before\n[^1]: note\nAfter\n";
  const parsed = parseNoteAnnotations(source);
  const edited = parsed.cleanContent.replace(
    "After",
    "# Inserted heading\nAfter",
  );

  assert.equal(
    mergeEditedContentIntoSource(source, parsed.cleanContent, edited),
    "Before\n[^1]: note\n# Inserted heading\nAfter\n",
  );
});
