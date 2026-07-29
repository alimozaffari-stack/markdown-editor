# Markdown Editor Independence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release Markdown Editor as an independent application whose normal editing paths preserve Markdown and whose visual prose uses British-English platform correction.

**Architecture:** A small pure paste-preparation module becomes the explicit seam for normal text paste.  The editor calls it in both native and context-menu paths, while repair remains a separately previewed transformation.  Product identity and updater changes stay in manifest, Tauri and public-copy surfaces.

**Tech Stack:** React 19, TypeScript, Vite, TipTap, Tauri v2, Rust.

## Global Constraints

- Normal paste must preserve source Markdown exactly.
- The visual editor uses `en-GB`; source and code entry opt out.
- Existing Scratch folder metadata stays readable and excluded from note discovery.
- No upstream update channel, polling configuration or updater runtime remains.
- Publish only after fresh frontend and Rust validation.

---

### Task 1: Markdown preservation seam and regression fixtures

**Files:**
- Create: `src/lib/markdownPaste.ts`
- Create: `src/lib/markdownPaste.test.ts`
- Modify: `package.json`
- Modify: `src/components/editor/Editor.tsx`

**Interfaces:**
- Produces: `prepareMarkdownPaste(text: string): string`
- Consumes: raw clipboard text in the native and context-menu paste paths.

- [ ] **Step 1: Write failing fixtures**

```ts
expect(prepareMarkdownPaste("```mermaid\\ngraph TD\\n```  ")).toBe(
  "```mermaid\\ngraph TD\\n```  ",
);
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npm test -- markdownPaste.test.ts`

Expected: failure because the module is absent.

- [ ] **Step 3: Implement the normal-paste seam and route both paste paths through it**

```ts
export function prepareMarkdownPaste(text: string): string {
  return text;
}
```

- [ ] **Step 4: Run focused fixtures**

Run: `npm test -- markdownPaste.test.ts`

Expected: pass, including deliberate whitespace.

### Task 2: Explicit formatting preview and language boundary

**Files:**
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/components/editor/CodeBlockView.tsx`
- Modify: `src/components/editor/BlockMathEditor.tsx`
- Modify: `index.html`

**Interfaces:**
- Consumes: `repairMarkdownText(markdown)` only after an explicit context-menu action.
- Produces: a preview state containing immutable original/proposed Markdown.

- [ ] **Step 1: Write a failing test for the pure normal-paste boundary**

```ts
expect(prepareMarkdownPaste("[citation](https://doi.org/x)  ")).toBe(
  "[citation](https://doi.org/x)  ",
);
```

- [ ] **Step 2: Verify the test fails if the normal-paste seam trims or repairs input**

Run: `npm test -- markdownPaste.test.ts`

Expected: failure after a deliberate local mutation; restore the production implementation before continuing.

- [ ] **Step 3: Add preview-before-apply repair and source/code language attributes**

```tsx
<textarea lang="en-GB" spellCheck={false} autoCorrect="off" />
<EditorContent lang="en-GB" spellCheck />
```

- [ ] **Step 4: Run tests and TypeScript build**

Run: `npm test && npm run build`

Expected: pass.

### Task 3: Independent product identity and upstream isolation

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `README.md`
- Modify: `metadata.json`
- Modify: `.github/workflows/release.yml`
- Modify: all user-visible product-copy surfaces identified by repository search.

**Interfaces:**
- Produces: product name `Markdown Editor`, identifier `au.com.alimozaffari.markdown-editor`, independent GitHub links, no updater plugin.
- Consumes: legacy `.scratch/settings.json` without changing or indexing it.

- [ ] **Step 1: Add identity assertions to the existing build checks**

Run: `npm run build && cargo check --manifest-path src-tauri/Cargo.toml`

Expected: currently no assertion exists; record the baseline.

- [ ] **Step 2: Rename public identifiers and remove updater runtime initialisation**

```json
{ "productName": "Markdown Editor", "identifier": "au.com.alimozaffari.markdown-editor" }
```

- [ ] **Step 3: Retain legacy settings compatibility and re-run checks**

Run: `npm run build && cargo check --manifest-path src-tauri/Cargo.toml`

Expected: pass.

### Task 4: Verification and independent publication

**Files:**
- Modify: only task-related files.

- [ ] **Step 1: Run focused fixtures, frontend build, Cargo check, Clippy and diff validation**

Run: `npm test && npm run build && (cd src-tauri && cargo check && cargo clippy -- -D warnings) && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 2: Create `alimozaffari-stack/markdown-editor`, push the verified branch and confirm remote identity**

Run: use the connected GitHub app; `scratch` stays unarchived until this succeeds.

- [ ] **Step 3: Archive `alimozaffari-stack/scratch` after the new repository is visible**

Expected: old repository becomes read-only; no source data is deleted.
