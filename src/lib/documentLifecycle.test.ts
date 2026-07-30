import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  DocumentSession,
  toSourceEditorText,
  type DocumentProgrammaticEvent,
  type DocumentSnapshot,
} from "./documentLifecycle.ts";

function snapshot(content = "# Original\r\n\r\nExact source\r\n"): DocumentSnapshot {
  return {
    content,
    hash: "baseline-hash",
    revision: 7,
    encoding: "utf-8",
    bom: "none",
    lineEnding: "crlf",
  };
}

for (const event of [
  "hydrate",
  "focus",
  "selection",
  "mode-switch",
  "workspace-switch",
  "watcher-refresh",
  "timer-expiry",
] satisfies DocumentProgrammaticEvent[]) {
  test(`${event} cannot make a clean document saveable`, () => {
    const session = new DocumentSession(snapshot());

    session.noteProgrammaticEvent(event);

    assert.equal(session.takeSaveRequest("autosave"), null);
    assert.equal(session.isDirty, false);
  });
}

test("programme-driven editor updates stay clean inside the scoped guard", () => {
  const session = new DocumentSession(snapshot());

  session.runProgrammatic(() => {
    session.recordVisualEdit("# Normalised\n\nExact source\n");
    session.recordSourceEdit("# Normalised\n\nExact source\n");
    session.setMode("source");
  });

  assert.equal(session.takeSaveRequest("explicit"), null);
});

test("one user visual edit produces a snapshot-aware save request", () => {
  const session = new DocumentSession(snapshot());

  session.recordVisualEdit("# Original\n\nChanged in visual mode\n");

  assert.deepEqual(session.takeSaveRequest("autosave"), {
    content: "# Original\n\nChanged in visual mode\n",
    baselineHash: "baseline-hash",
    revision: 7,
    encoding: "utf-8",
    bom: "none",
    lineEnding: "crlf",
    authority: "visual",
    reason: "autosave",
  });
});

test("one user source edit retains its exact characters and line breaks", () => {
  const session = new DocumentSession(snapshot());
  const edited = "# Original\r\n\r\nExact  source\r\n\r\n<!-- retained -->\r\n";

  session.setMode("source");
  session.recordSourceEdit(edited);

  assert.equal(session.takeSaveRequest("explicit")?.content, edited);
});

test("a CRLF source-editor edit changes only the intended raw source range", () => {
  const original = "# Alpha\r\n\r\nBefore\r\nAfter\r\n";
  const session = new DocumentSession(snapshot(original));

  assert.equal(toSourceEditorText(original), "# Alpha\n\nBefore\nAfter\n");
  session.setMode("source");
  session.recordSourceEditorEdit("# Alpha\n\nBefore edited\nAfter\n");

  assert.deepEqual(session.takeSaveRequest("explicit"), {
    content: "# Alpha\r\n\r\nBefore edited\r\nAfter\r\n",
    baselineHash: "baseline-hash",
    revision: 7,
    encoding: "utf-8",
    bom: "none",
    lineEnding: "crlf",
    authority: "source",
    reason: "explicit",
  });
});

test("opening a CRLF document in an LF-only textarea remains a no-operation", () => {
  const original = "# Alpha\r\n\r\nUnchanged\r\n";
  const session = new DocumentSession(snapshot(original));

  session.setMode("source");
  session.recordSourceEditorEdit(toSourceEditorText(original));

  assert.equal(session.currentSourceContent, original);
  assert.equal(session.isDirty, false);
  assert.equal(session.takeSaveRequest("autosave"), null);
});

test("Paste exactly retains delivered source line endings inside a CRLF document", () => {
  const original = "Alpha\r\nOmega\r\n";
  const session = new DocumentSession(snapshot(original));
  const delivered = "One\r\nTwo\n";

  const insertion = session.insertExactSourceText(6, 6, delivered);

  assert.deepEqual(insertion, {
    editorContent: "Alpha\nOne\nTwo\nOmega\n",
    cursor: 14,
    changed: true,
  });
  assert.equal(
    session.takeSaveRequest("explicit")?.content,
    "Alpha\r\nOne\r\nTwo\nOmega\r\n",
  );
});

test("autosave and explicit save use the same candidate contract", () => {
  const autosave = new DocumentSession(snapshot());
  const explicit = new DocumentSession(snapshot());
  const edited = "# Original\r\n\r\nUser change\r\n";
  autosave.recordSourceEdit(edited);
  explicit.recordSourceEdit(edited);

  const autosaveRequest = autosave.takeSaveRequest("autosave");
  const explicitRequest = explicit.takeSaveRequest("explicit");

  assert.deepEqual(
    { ...autosaveRequest, reason: "same" },
    { ...explicitRequest, reason: "same" },
  );
});

test("preservation mode keeps source authority and blocks visual serialisation", () => {
  const original = "# Original\r\n\r\nExact  source\r\n";
  const session = new DocumentSession(snapshot(original));
  session.setPreserveSourceFormatting(true);

  const accepted = session.recordVisualEdit("# Original\n\nNormalised source\n");

  assert.equal(accepted, false);
  assert.equal(session.takeSaveRequest("autosave"), null);

  const edited = `${original}\r\nTrailing spaces stay  \r\n`;
  session.setMode("source");
  session.recordSourceEdit(edited);
  const request = session.takeSaveRequest("explicit");

  assert.equal(request?.authority, "source");
  assert.equal(request?.content, edited);
});

test("returning source content to its baseline becomes a no-operation", () => {
  const initial = snapshot();
  const session = new DocumentSession(initial);

  session.recordSourceEdit(`${initial.content}temporary`);
  session.recordSourceEdit(initial.content);

  assert.equal(session.takeSaveRequest("autosave"), null);
  assert.equal(session.isDirty, false);
});

test("a successful save replaces the baseline and clears dirty state", () => {
  const session = new DocumentSession(snapshot());
  session.recordSourceEdit("# Saved\r\n");
  const request = session.takeSaveRequest("explicit");
  assert.ok(request);

  session.markSaved({
    ...snapshot("# Saved\r\n"),
    hash: "saved-hash",
    revision: 8,
  }, request);

  assert.equal(session.isDirty, false);
  assert.equal(session.takeSaveRequest("explicit"), null);
  assert.equal(session.currentSnapshot.hash, "saved-hash");
});

test("an edit made while saving is rebased onto the saved snapshot", () => {
  const session = new DocumentSession(snapshot());
  session.recordSourceEdit("# First edit\r\n");
  const firstRequest = session.takeSaveRequest("autosave");
  assert.ok(firstRequest);

  session.recordSourceEdit("# Second edit\r\n");
  session.markSaved(
    {
      ...snapshot("# First edit\r\n"),
      hash: "first-save-hash",
      revision: 8,
    },
    firstRequest,
  );

  assert.equal(session.currentSourceContent, "# Second edit\r\n");
  assert.equal(session.isDirty, true);
  assert.deepEqual(session.takeSaveRequest("autosave"), {
    content: "# Second edit\r\n",
    baselineHash: "first-save-hash",
    revision: 8,
    encoding: "utf-8",
    bom: "none",
    lineEnding: "crlf",
    authority: "source",
    reason: "autosave",
  });
});

test("a compatibility-metadata save rebases a pending body edit", () => {
  const session = new DocumentSession(snapshot());
  session.recordSourceEdit("# Pending body edit\r\n");

  session.rebaseSnapshot({
    ...snapshot(),
    sourceContent:
      "# Original\r\n\r\nExact source\r\n\r\n[^1]: Added metadata\r\n",
    hash: "metadata-save-hash",
    revision: 8,
  });

  assert.equal(session.isDirty, true);
  assert.deepEqual(session.takeSaveRequest("autosave"), {
    content: "# Pending body edit\r\n",
    contentBaseline: "# Original\r\n\r\nExact source\r\n",
    sourceBaseline:
      "# Original\r\n\r\nExact source\r\n\r\n[^1]: Added metadata\r\n",
    baselineHash: "metadata-save-hash",
    revision: 8,
    encoding: "utf-8",
    bom: "none",
    lineEnding: "crlf",
    authority: "source",
    reason: "autosave",
  });
});

test("the non-Gemini no-operation corpus never reaches the write boundary", () => {
  const syntax = [
    "# Unicode – α and العربية",
    "",
    "1. Ordered",
    "   - Nested",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "A [link](https://example.com) and a footnote.[^1]",
    "",
    "[^1]: Exact note.",
    "",
    "> Block quote",
    "",
    "```typescript",
    "const exact = true;",
    "```",
    "",
    "```mermaid",
    "graph TD",
    "  A --> B",
    "```",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "<!-- compatibility comment -->",
    "",
    "[[Linked Note]]",
    "",
    "",
    "Intentional blank line above.",
  ];
  const corpus = [
    {
      name: "UTF-8 LF",
      content: syntax.join("\n"),
      bytes: Buffer.from(syntax.join("\n"), "utf8"),
      bom: "none" as const,
      lineEnding: "lf" as const,
    },
    {
      name: "UTF-8 CRLF",
      content: syntax.join("\r\n"),
      bytes: Buffer.from(syntax.join("\r\n"), "utf8"),
      bom: "none" as const,
      lineEnding: "crlf" as const,
    },
    {
      name: "UTF-8 BOM",
      content: syntax.join("\n"),
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(syntax.join("\n"), "utf8"),
      ]),
      bom: "utf-8" as const,
      lineEnding: "lf" as const,
    },
  ];

  for (const fixture of corpus) {
    const initialHash = createHash("sha256")
      .update(fixture.bytes)
      .digest("hex");
    const session = new DocumentSession({
      content: fixture.content,
      hash: initialHash,
      revision: 1,
      encoding: "utf-8",
      bom: fixture.bom,
      lineEnding: fixture.lineEnding,
    });
    let writes = 0;
    const tryPersist = () => {
      if (session.takeSaveRequest("autosave")) writes += 1;
    };

    session.noteProgrammaticEvent("focus");
    session.noteProgrammaticEvent("selection");
    session.noteProgrammaticEvent("workspace-switch");
    session.runProgrammatic(() => {
      session.setMode("source");
      session.recordSourceEdit(fixture.content);
      session.setMode("visual");
      session.recordVisualEdit(fixture.content);
      session.setMode("source");
    });
    session.noteProgrammaticEvent("watcher-refresh");
    session.noteProgrammaticEvent("timer-expiry");
    tryPersist();

    assert.equal(writes, 0, fixture.name);
    assert.equal(session.isDirty, false, fixture.name);
    assert.equal(session.currentSnapshot.hash, initialHash, fixture.name);
    assert.equal(
      createHash("sha256").update(fixture.bytes).digest("hex"),
      initialHash,
      fixture.name,
    );
  }
});
