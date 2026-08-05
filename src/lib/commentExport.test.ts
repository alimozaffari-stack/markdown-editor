import assert from "node:assert/strict";
import test from "node:test";
import { serializeComments } from "../services/pdf.ts";

test("serializeComments formats empty comments list with fallback message", () => {
  const result = serializeComments([], "My Note", "note-123");
  assert.match(result, /# Comments on: My Note/);
  assert.match(result, /Document ID: note-123/);
  assert.match(result, /_No comments present for this document._/);
});

test("serializeComments formats comments list into structured markdown", () => {
  const comments = [
    { id: "c1", text: "First comment note", timestamp: 1700000000 },
    { id: "c2", text: "Second comment note", timestamp: 1700003600 },
  ];
  const result = serializeComments(comments, "Architecture Spec", "arch-1");

  assert.match(result, /# Comments on: Architecture Spec/);
  assert.match(result, /Document ID: arch-1/);
  assert.match(result, /### Comment #1/);
  assert.match(result, /\*\*Text:\*\*\s+First comment note/);
  assert.match(result, /### Comment #2/);
  assert.match(result, /\*\*Text:\*\*\s+Second comment note/);
});
