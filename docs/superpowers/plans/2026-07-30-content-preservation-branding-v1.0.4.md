# Markdown Editor v1.0.4 Content Preservation and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver v1.0.4 with source-aware rich paste, lossless no-operation document handling, validated atomic saves, recoverable failures and authoritative internal/package branding.

**Architecture:** A shared production Markdown boundary validates all conversions; a source-aware clipboard service serves keyboard and context-menu entry points; a document session admits only user edits to one save path; and a Rust byte-storage service enforces snapshot, conflict, encoding, recovery and atomic-replacement invariants. UI components orchestrate these services without owning preservation policy.

**Tech Stack:** React 19, TypeScript 5.8, Tiptap 3.29.2, ProseMirror, Node test runner with jsdom, Tauri v2 and Rust.

## Global Constraints

- Use fixture SHA-256 `7e703a1e06b8761f0c1d0694d0edffbcd116a99187682fa04273c170bdac7cc7`; the former `317b…e9fe` gate is obsolete.
- Use logo SHA-256 `d691f79514008edc3bbfcb5eec50592fae725a6f31c6f6c674a62a19edbfc38f`.
- Keep editing and clipboard conversion local, offline-first and Tauri-based.
- Preserve compatible `.scratch/settings.json` and `SCRATCH_COMMENTS` records.
- Source mode promises exact delivered paste and source authority; visual mode promises semantic preservation, not byte identity after edits.
- A clean document never reaches a filesystem write boundary.
- Windows is the release gate; unsigned macOS must not fail this release.
- Do not undertake unrelated refactoring.

---

### Task 1: Canonical fixtures and failing production-parser regressions

**Files:**
- Create: `src/test-fixtures/gemini-master-workflow-crlf.txt`
- Create: `src/test-fixtures/gemini-rich-clipboard.html`
- Create: `src/test-fixtures/gemini-rich-clipboard.txt`
- Create: `src/test-fixtures/noop/*.md`
- Create: `src/lib/markdownConversion.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the two authoritative uploaded files.
- Produces: immutable fixtures and failing tests against `createProductionMarkdownManager()`.

- [ ] **Step 1: Copy the canonical text fixture byte-for-byte and verify it**

Run:

```bash
sha256sum src/test-fixtures/gemini-master-workflow-crlf.txt
wc -c src/test-fixtures/gemini-master-workflow-crlf.txt
file src/test-fixtures/gemini-master-workflow-crlf.txt
```

Expected: hash `7e703a…7cc7`, 14,425 bytes and CRLF.

- [ ] **Step 2: Add parser tests for the minimal and full regressions**

The tests call the production manager, parse–serialise–parse the minimal sample,
and assert B/C and every work-order marker remain non-empty and ordered.

- [ ] **Step 3: Run the focused tests and record RED**

Run:

```bash
node --test src/lib/markdownConversion.test.ts
```

Expected: failure because the production manager boundary is absent and the
current split Tiptap graph loses later content.

### Task 2: Align Tiptap and establish one production Markdown boundary

**Files:**
- Create: `src/lib/markdownExtensions.ts`
- Create: `src/lib/markdownConversion.ts`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: `createMarkdownSchemaExtensions()`,
  `createProductionMarkdownManager()`, `parseMarkdownPreservingContent()` and
  `validateMarkdownRoundTrip()`.
- Consumes: the same schema extensions as the live visual editor.

- [ ] **Step 1: Pin every direct `@tiptap/*` dependency to `3.29.2`**

Regenerate both lockfiles from the same `package.json`.

- [ ] **Step 2: Implement the extension factory and conversion checks**

`parseMarkdownPreservingContent()` returns either the complete parsed JSON or a
failure naming lost text/empty blocks. `validateMarkdownRoundTrip()` compares a
canonical semantic projection of the intended and reparsed documents.

- [ ] **Step 3: Route the editor's Markdown manager through the shared schema**

Keep React-only node views and interaction extensions in `Editor.tsx`; share
all Markdown-relevant nodes and marks.

- [ ] **Step 4: Run focused and lockfile checks and record GREEN**

Run:

```bash
npm ci
node --test src/lib/markdownConversion.test.ts
npm ls --all
bun install --frozen-lockfile
```

Expected: parser regressions pass and all installed Tiptap packages resolve to
3.29.2.

### Task 3: Source-aware clipboard translation and fail-safe insertion

**Files:**
- Create: `src/lib/clipboardTranslation.ts`
- Create: `src/lib/clipboardTranslation.test.ts`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `ClipboardPayload`, `ClipboardTranslation`,
  `selectClipboardTranslation()`, `readClipboardPayload()` and
  `performClipboardPaste()`.
- Consumes: a small insertion adapter implemented by `Editor.tsx`.

- [ ] **Step 1: Add failing source-selection and parity tests**

Cover explicit Markdown, Gemini HTML, code-editor wrappers, incidental `R&R`,
hyphens, asterisks and numbered prose, plain text, `readText()` fallback,
source exactness and keyboard/context parity.

- [ ] **Step 2: Add failing sanitisation and preservation tests**

Use the paired HTML/plain fixtures. Assert scripts, event attributes and
`javascript:` URLs disappear; forced parser loss inserts the full literal text.

- [ ] **Step 3: Implement line-aware selection and rich clipboard reading**

Use `navigator.clipboard.read()` when available and `readText()` only as the
fallback.

- [ ] **Step 4: Implement one insertion path**

Keyboard and context menu supply the same payload. Images remain first.
`Paste exactly` calls the literal insertion adapter. HTML/Markdown failures
fall back without partial insertion.

- [ ] **Step 5: Run the focused clipboard suite**

Run:

```bash
node --test src/lib/clipboardTranslation.test.ts
```

Expected: every source, safety and parity case passes.

### Task 4: Failing document-session and no-operation tests

**Files:**
- Create: `src/lib/documentLifecycle.ts`
- Create: `src/lib/documentLifecycle.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `DocumentSession`, `DocumentSnapshot`,
  `DocumentSaveRequest` and `DocumentSaveFailure`.
- Consumes: editor transaction origin, source input and backend save results.

- [ ] **Step 1: Add failing dirty-state tests**

Assert hydration, focus, selection, mode switching, workspace switching,
watcher refresh and timer expiry cannot make a session saveable. Assert one
user visual/source edit can.

- [ ] **Step 2: Add failing source-authority tests**

Assert preservation mode supplies the original source, blocks visual
serialisation and retains exact inserted characters and line breaks.

- [ ] **Step 3: Implement the minimal state machine**

Programme-driven changes execute inside a scoped guard. `takeSaveRequest()`
returns `null` unless dirty and returns the same request shape for autosave and
explicit save.

- [ ] **Step 4: Run RED/GREEN document-session tests**

Run:

```bash
node --test src/lib/documentLifecycle.test.ts
```

Expected: all origin, clean-state and source-authority tests pass.

### Task 5: Lossless Rust snapshot, conflict, atomic save and recovery

**Files:**
- Create: `src-tauri/src/document.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Produces: serialisable `DocumentSnapshot` and structured `SaveFailure`.
- Consumes: target path, candidate text, baseline hash, encoding, BOM and line
  ending.

- [ ] **Step 1: Add failing Rust unit tests**

Use real temporary files for UTF-8 LF/CRLF, UTF-8 BOM and Unicode syntax.
Inject validation, temporary-write and replacement failures. Assert original
hashes remain unchanged, drafts remain and conflicts reject overwrite.

- [ ] **Step 2: Implement byte-first load and explicit decode/encode**

Return hash, revision, encoding, BOM and line-ending metadata without writing.

- [ ] **Step 3: Implement validated atomic replacement**

Persist a draft, write/flush/validate a sibling temporary file, keep a prior
version, recheck the baseline and replace atomically with the platform-specific
operation.

- [ ] **Step 4: Route managed and direct-file commands through the service**

No existing-file save may omit its baseline. New-note creation obtains a
snapshot before later edits.

- [ ] **Step 5: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml document::
```

Expected: byte, conflict and injected-failure cases pass.

### Task 6: Integrate the single document lifecycle into React

**Files:**
- Modify: `src/types/note.ts`
- Modify: `src/services/notes.ts`
- Modify: `src/services/files.ts`
- Modify: `src/context/NotesContext.tsx`
- Modify: `src/components/preview/PreviewApp.tsx`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/lib/shortcuts.ts`

**Interfaces:**
- Consumes: `DocumentSession` and Rust snapshots.
- Produces: one validated save request path for visual autosave, source
  autosave and `Ctrl/Cmd+S`.

- [ ] **Step 1: Carry snapshots through managed and external-file state**

Keep the original lossless source alongside the visual content until save
success.

- [ ] **Step 2: Replace loading flags with scoped programme-origin guards**

Every hydration, reload and mode-transition `setContent` call is guarded.
User toolbar, keyboard and textarea changes remain user-originated.

- [ ] **Step 3: Unify autosave and explicit save**

Both request a candidate from the session, validate visual round trips and call
the same snapshot-aware backend service. A clean session performs no invoke.

- [ ] **Step 4: Add preservation and conflict UI**

Add `Preserve source formatting` to the document context menu, persist it in
compatible settings and display its state. A conflict retains the draft and
offers reload without silent overwrite.

- [ ] **Step 5: Run document and full frontend tests**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: lifecycle, paste, syntax and existing tests pass.

### Task 7: Authoritative internal and package branding

**Files:**
- Replace: `app-icon.png`
- Create: `public/markdown-editor-logo.png`
- Replace: `docs/app-icon.png`
- Modify: `src/components/layout/FolderPicker.tsx`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `index.html`
- Modify: `src/lib/assetIntegrity.test.ts`
- Regenerate: `src-tauri/icons/*`
- Delete after reference check: `public/folders-dark.png`,
  `public/note-dark.png`

**Interfaces:**
- Consumes: authorised source PNG.
- Produces: semantic internal images, favicon and complete Tauri icon family.

- [ ] **Step 1: Add failing branding assertions**

Assert canonical/runtime hashes, semantic image references, valid icon
signatures, installer configuration and absence of old production references.

- [ ] **Step 2: Copy the canonical assets and regenerate icons**

Run:

```bash
npm run tauri icon app-icon.png
```

- [ ] **Step 3: Replace CSS masks with `<img>` elements**

Use meaningful alternative text, preserved aspect ratio and theme-neutral
layout.

- [ ] **Step 4: Inspect both states in light and dark themes**

Capture browser/runtime screenshots where feasible and verify the full-colour
black rounded-square MD cat is visible.

### Task 8: Version, documentation and workflows

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bun.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Produces: consistent v1.0.4 metadata, accurate British-English documentation
  and Windows/Linux release gates.

- [ ] **Step 1: Set every applicable package record to 1.0.4**

- [ ] **Step 2: Rewrite the stale release section and installation guidance**

Document rich paste, `Paste exactly`, preservation mode, plain-text limits,
no-op hashes, atomic saves, conflicts and recovery without claiming visual-mode
byte identity.

- [ ] **Step 3: Run tests before build in CI and release**

Retain mandatory Windows and Linux. Remove unsigned macOS. Add substantive
v1.0.4 release notes.

### Task 9: Fresh local verification and production build

**Files:**
- Modify only evidence-driven repairs.

- [ ] **Step 1: Run the complete prescribed sequence**

```bash
npm ci
npm test
npm run lint
npm run build
npm ls --all
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tauri build
git diff --check
```

- [ ] **Step 2: Inspect the complete diff**

Reject secrets, unrelated edits, stale artwork references, contradictory
lockfiles and untested generated files.

- [ ] **Step 3: Map every definition-of-done item to fresh evidence**

Classify unavailable platform-specific interaction evidence as partial, not
confirmed.

### Task 10: GitHub PR, merge and v1.0.4 release

**Files:**
- No unverified source changes.

- [ ] **Step 1: Commit scoped changes and push without force**

- [ ] **Step 2: Open the PR with root causes, architecture and verification**

- [ ] **Step 3: Monitor and repair required CI until green**

Read complete failing logs and repeat focused then full verification for every
repair.

- [ ] **Step 4: Merge normally and confirm green `main`**

- [ ] **Step 5: Tag the exact merge commit once and monitor release jobs**

- [ ] **Step 6: Verify published Windows assets**

Require non-zero:

```text
Markdown.Editor_1.0.4_x64-setup.exe
Markdown.Editor_1.0.4_x64_en-US.msi
```

Download both, record size and SHA-256, verify embedded/file version 1.0.4 and
inspect installer/application icon resources against the authorised design.
