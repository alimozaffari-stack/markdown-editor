import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { JSONContent } from "@tiptap/core";
import {
  createProductionMarkdownManager,
  parseMarkdownPreservingContent,
  validateMarkdownRoundTrip,
} from "./markdownConversion.ts";

const canonicalFixturePath = resolve(
  process.cwd(),
  "src/test-fixtures/gemini-master-workflow-crlf.txt",
);

function nodeText(node: JSONContent): string {
  if (node.text) return node.text;
  if (node.type === "footnoteReference") return String(node.attrs?.label ?? "");
  if (node.type === "wikilink") return String(node.attrs?.noteTitle ?? "");
  if (node.type === "blockMath") return String(node.attrs?.latex ?? "");
  return (node.content ?? []).map(nodeText).join("");
}

function documentText(document: JSONContent): string {
  return (document.content ?? []).map(nodeText).join("\n");
}

function assertInOrder(haystack: string, needles: string[]): void {
  let previous = -1;
  for (const needle of needles) {
    const position = haystack.indexOf(needle, previous + 1);
    assert.notEqual(position, -1, `missing ${needle}`);
    assert.ok(position > previous, `${needle} is out of order`);
    previous = position;
  }
}

test("canonical Gemini plain-text fixture retains its authoritative bytes", () => {
  const bytes = readFileSync(canonicalFixturePath);
  const logicalLines = bytes.toString("ascii").split("\r\n");

  assert.equal(bytes.length, 14_425);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "7e703a1e06b8761f0c1d0694d0edffbcd116a99187682fa04273c170bdac7cc7",
  );
  assert.equal(logicalLines.length, 147);
  assert.equal(bytes.includes(Buffer.from("\n")), true);
  assert.equal(
    bytes.toString("ascii").replaceAll("\r\n", "").includes("\n"),
    false,
    "fixture contains a non-CRLF line ending",
  );
  assert.equal(Math.max(...logicalLines.map((line) => line.length)), 1_233);
});

test("production parser retains B and C after an ordered list", () => {
  const manager = createProductionMarkdownManager();
  const input = "A\n---\n1. one\n2. two\n\nB\n---\nC";

  const parsed = parseMarkdownPreservingContent(manager, input);
  const serialised = manager.serialize(parsed);
  const reparsed = parseMarkdownPreservingContent(manager, serialised);

  assertInOrder(documentText(parsed), ["A", "one", "two", "B", "C"]);
  assertInOrder(documentText(reparsed), ["A", "one", "two", "B", "C"]);

  const emptyTextBlocks = (reparsed.content ?? []).filter(
    (node) =>
      (node.type === "heading" || node.type === "paragraph") &&
      nodeText(node).length === 0,
  );
  assert.deepEqual(emptyTextBlocks, []);
});

test("production parser retains every required section of the full fixture", () => {
  const manager = createProductionMarkdownManager();
  const source = readFileSync(canonicalFixturePath, "ascii");
  const parsed = parseMarkdownPreservingContent(manager, source);
  const serialised = manager.serialize(parsed);
  const reparsed = parseMarkdownPreservingContent(manager, serialised);
  const output = documentText(reparsed);

  const emptyTextBlocks = (reparsed.content ?? []).filter(
    (node) =>
      (node.type === "heading" || node.type === "paragraph") &&
      nodeText(node).length === 0,
  );
  assert.deepEqual(emptyTextBlocks, []);

  assertInOrder(output, [
    "Master Academic Workflow & Deep-Research Prompt Engine",
    "Strategic Key Additions",
    "PHASE A: DEEP-DIVE RESEARCH & NORMATIVE BENCHMARKING",
    "PHASE B: STEP-BY-STEP OPERATIONAL WORKFLOW",
    "PHASE C: METHODOLOGICAL & THEORETICAL JUSTIFICATION",
    "PHASE D: COMPETENCY & PROGRAMMATIC INTEGRATION MATRIX",
    "MODULE 1: HISTORIOGRAPHICAL & SYSTEMATIC LITERATURE REVIEW",
    "MODULE 2: JOURNAL ARTICLE PREPARATION, TARGETING, & R&R STRATEGY",
    "MODULE 3: JOURNAL PEER REVIEW EXECUTION (REVIEWER ROLE)",
    "MODULE 4: GRANT FUNDING STRATEGY & APPLICATION",
    "MODULE 5: BOOK MONOGRAPH & EDITED VOLUME DEVELOPMENT",
    "MODULE 6: FIELDWORK, ARCHIVAL, & SPATIAL DATA PROTOCOL",
    "MODULE 7: PUBLIC IMPACT, POLICY BRIEF, & CURATORIAL STRATEGY",
    "MODULE 8: SCHOLARLY BOOK CHAPTER CONTRIBUTION",
    "EXECUTION FORMAT REQUIREMENT",
    "Part III: Programmatic Data Schema & Deployment Example",
    '"workflow_module": "Module_08_Book_Chapter_Contribution"',
    '"output_artifact"',
    "Part IV: Invoking Deep Research vs. Standard Mode",
    "MODE: PROGRAMMATIC_PLUG",
  ]);

  assert.ok(output.includes("Programmatic Plug & Skill Translation Schema"));
  for (const boundaryText of [
    "Master Academic Workflow & Deep-Research Prompt Engine",
    "three-tiered architecture",
    "Strategic Key Additions",
    "immediate translation into university courses",
    "Part III: Programmatic Data Schema & Deployment Example",
    "standardized programmatic schema",
    "Part IV: Invoking Deep Research vs. Standard Mode",
    "MODE: WORKFLOW_ONLY",
  ]) {
    assert.ok(
      output.includes(boundaryText),
      `logical-line boundary content was omitted: ${boundaryText}`,
    );
  }
  assert.ok(
    output.endsWith(
      "for integration into Python scripts, university syllabi, or AI agent pipelines.",
    ),
  );
});

test("production round trip retains the existing Markdown syntax corpus", () => {
  const manager = createProductionMarkdownManager();
  const source = [
    "# Unicode – α and العربية",
    "",
    "> A block quote with [a link](https://example.com).",
    "",
    "1. Ordered",
    "   - Nested bullet",
    "   - Second bullet",
    "2. Ordered again",
    "",
    "| Term | Meaning |",
    "| --- | --- |",
    "| Border | Relation |",
    "",
    "A footnote reference.[^1]",
    "",
    "[^1]: A qualifying note.",
    "",
    "```typescript",
    "const exact = true;",
    "```",
    "",
    "```mermaid",
    "graph TD",
    "  A[Source] --> B[Claim]",
    "```",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "<!-- retained compatibility comment -->",
    "",
    "[[Linked Note]]",
    "",
    "",
    "Deliberate blank-line boundary.",
  ].join("\r\n");

  const parsed = parseMarkdownPreservingContent(manager, source);
  const serialised = manager.serialize(parsed);
  const reloaded = parseMarkdownPreservingContent(manager, serialised);
  const visible = documentText(reloaded);

  assertInOrder(visible, [
    "Unicode – α and العربية",
    "A block quote",
    "Ordered",
    "Nested bullet",
    "Second bullet",
    "Ordered again",
    "Term",
    "Border",
    "A footnote reference.",
    "A qualifying note.",
    "const exact = true;",
    "graph TD",
    "E = mc^2",
    "retained compatibility comment",
    "Linked Note",
    "Deliberate blank-line boundary.",
  ]);
});

test("conversion rejects a parser result that loses visible source text", () => {
  const productionManager = createProductionMarkdownManager();
  const lossyManager = {
    instance: productionManager.instance,
    parse: () => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    }),
  } as unknown as ReturnType<typeof createProductionMarkdownManager>;

  assert.throws(
    () => parseMarkdownPreservingContent(lossyManager, "Alpha\n\nBeta"),
    /Beta|preserv/i,
  );
});

test("visual save validation rejects a candidate that differs from intended state", () => {
  const manager = createProductionMarkdownManager();
  const intended: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Alpha" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Beta" }],
      },
    ],
  };

  const result = validateMarkdownRoundTrip(manager, intended, "## Alpha");

  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /Beta|intended|round.trip/i);
});

test("visual save tolerates normalisation of an empty paragraph without losing blocks", () => {
  const manager = createProductionMarkdownManager();
  const intended: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Gemini heading" }],
      },
      { type: "paragraph", attrs: { dir: "ltr" } },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Retained paragraph" }],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Retained item" }],
              },
            ],
          },
        ],
      },
    ],
  };
  const markdown = manager.serialize(intended);

  assert.deepEqual(validateMarkdownRoundTrip(manager, intended, markdown), {
    ok: true,
  });
});

test("an intentional deletion to an empty document remains valid", () => {
  const manager = createProductionMarkdownManager();
  const intended = manager.parse("");

  assert.deepEqual(validateMarkdownRoundTrip(manager, intended, ""), {
    ok: true,
  });
});
