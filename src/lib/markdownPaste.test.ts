import assert from "node:assert/strict";
import test from "node:test";
import { prepareMarkdownPaste } from "./markdownPaste.ts";

const preservationFixtures = [
  {
    name: "a pipe table with deliberate trailing whitespace",
    markdown: "| Term | Definition |  \n| --- | --- |  \n| Border | A relation |  ",
  },
  {
    name: "YAML front matter",
    markdown: "---\ntitle: 'A: title'\ntags:\n  - heritage\n---\n",
  },
  {
    name: "citation and link syntax",
    markdown: "See [Smith 2024](https://doi.org/10.0000/example).  ",
  },
  {
    name: "an intentionally unclosed code fence",
    markdown: "```python\nprint('do not add a closing fence')\n",
  },
  {
    name: "a Mermaid fence",
    markdown: "```mermaid\ngraph TD\n  A[Source] --> B[Claim]\n```  ",
  },
  {
    name: "mathematics",
    markdown: "$$\nE = mc^2\n$$\n",
  },
  {
    name: "footnotes",
    markdown: "A proposition.[^1]\n\n[^1]: A qualifying note.\n",
  },
  {
    name: "multiple deliberate blank lines",
    markdown: "First paragraph.\n\n\nSecond paragraph.\n",
  },
];

for (const fixture of preservationFixtures) {
  test(`normal paste preserves ${fixture.name}`, () => {
    assert.equal(prepareMarkdownPaste(fixture.markdown), fixture.markdown);
  });
}
