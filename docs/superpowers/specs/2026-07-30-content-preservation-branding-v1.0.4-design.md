# Markdown Editor v1.0.4 Content Preservation and Branding Design

## Decision record

The user-approved master work order dated 30 July 2026 is the controlling
specification. It supersedes the former 14,550-byte fixture gate.

The authoritative inputs are:

- `Pasted text (2).txt`: 14,425 bytes, CRLF, SHA-256
  `7e703a1e06b8761f0c1d0694d0edffbcd116a99187682fa04273c170bdac7cc7`;
- `Markdown Editor Logo.png`: 1,254 × 1,254 px, 8-bit RGB PNG, SHA-256
  `d691f79514008edc3bbfcb5eec50592fae725a6f31c6f6c674a62a19edbfc38f`.

Preflight confirmed that `main` is
`002a337a10f7d6c434295e1f1e4967c3b0310ac1`, v1.0.4 is unused, v1.0.3 is
the latest published release and no pull request is open. The release version
therefore remains v1.0.4.

## Confirmed failure mechanisms

### Clipboard and Markdown parsing

The keyboard paste handler reads only `text/plain`. A global regular
expression then promotes the complete payload to Markdown when any Markdown
marker occurs, discarding recoverable `text/html`.

The locked Tiptap dependency graph is split between 3.20.0 and 3.29.0. With
the current production extension set, the minimal ordered-list sample produces
an empty heading and paragraph for B and C. The 14,425-byte fixture produces 17
empty text-bearing top-level nodes, serialises to 10,713 characters and loses
the required later markers.

### Ordinary-file mutation

Source-to-visual switching calls `setContent` while the editor is outside its
hydration guard. Tiptap's `onUpdate` callback consequently schedules a save of
normalised Markdown even though the user made no content edit.

The backend then uses `fs::write` directly. It has no load hash, revision
check, encoding/BOM record, atomic replacement, prior-version copy or recovery
draft. The managed-note layer also removes footnote definitions and comments,
normalises CRLF to LF and trims the remaining text before a later save.

These are separate defects. Dependency alignment repairs the parser but cannot
make the document lifecycle lossless.

## Architecture

### Production Markdown boundary

A pure extension factory will define the Markdown-relevant production schema
once. Both the visual editor and tests will consume it. A focused conversion
module will own Markdown parsing, serialisation, semantic projection and
round-trip validation.

Conversion is accepted only when the parsed result retains the source's
meaningful text in order and does not create unexplained empty text-bearing
blocks. A visual save is accepted only when serialising and reparsing produces
the intended current editor document after removal of ephemeral UI attributes.

### Source-aware clipboard boundary

A clipboard module will expose:

```ts
export interface ClipboardPayload {
  html: string;
  markdown: string;
  text: string;
}

export type ClipboardTranslation =
  | { kind: "html"; value: string }
  | { kind: "markdown"; value: string }
  | { kind: "text"; value: string };
```

Selection order is image/file, explicit Markdown, meaningful HTML,
high-confidence line-classified Markdown and literal text. Code-editor HTML
wrappers do not displace explicit/literal Markdown. Keyboard and context-menu
paste call the same selector and insertion service.

HTML is sanitised before the configured ProseMirror schema parses it. Scripts,
active elements, event attributes and unsafe URL schemes are removed. If HTML
or Markdown conversion throws or loses meaningful text, the complete plain
text is inserted literally and a concise notice is shown.

`Paste exactly` bypasses rich/Markdown conversion. Source mode replaces the
textarea selection exactly. Visual mode inserts literal text blocks.

### Document session boundary

A `DocumentSession` owns the loaded snapshot, edit origin, dirty state, mode,
external-change state and per-document source-preservation flag.

Only a user-originated document transaction or source-textarea input marks a
session dirty. Hydration, focus, selection, mode switching, workspace
switching, watcher refresh and programme-driven `setContent` calls are
explicitly non-user operations.

Autosave and `Ctrl/Cmd+S` both request one validated candidate from the
session. A clean session returns no candidate and cannot reach the filesystem.
When source preservation is enabled, source mode remains authoritative and the
visual serialiser is unavailable for that document.

### Lossless storage boundary

Rust will read bytes before decoding and return a `DocumentSnapshot` containing
the on-disk SHA-256, revision, encoding, BOM state and line-ending convention.
UTF-8 and BOM-signalled UTF-16 are decoded explicitly; unsupported encodings
fail visibly rather than being rewritten.

Every existing-file save supplies the load/save baseline hash. The storage
service:

1. records a recovery draft;
2. rejects an external-hash conflict;
3. encodes the candidate using the original encoding, BOM and line endings;
4. writes and flushes a sibling temporary file;
5. validates the temporary bytes;
6. retains a prior-version copy in application storage;
7. rechecks the target hash; and
8. atomically replaces the target, using a Windows replace operation on
   Windows and `rename` on Unix.

Validation, temporary-write and replacement failures leave the target bytes
unchanged and retain the draft path in a structured error.

### Per-document preservation setting

Compatible `.scratch/settings.json` data gains one optional list of managed
note IDs for which source formatting is authoritative. Missing fields retain
the existing defaults. A rename transfers the setting to the new ID.

### Branding and release

The authorised PNG becomes the root canonical image and the runtime image.
The welcome and empty-note states use semantic `<img>` elements. Tauri
regenerates the complete icon family from the same source. Obsolete Scratch
artwork is removed only after reference checks pass.

All package versions become 1.0.4. CI runs tests before building. The release
matrix retains mandatory Windows and existing Linux packages, omits unsigned
macOS, and publishes substantive v1.0.4 notes.

## Verification design

TypeScript integration tests use the production Markdown extension factory and
a DOM test environment. Rust unit tests exercise real files and injected
failure points at the atomic-storage boundary. Checked-in fixtures cover the
authoritative CRLF payload, paired Gemini HTML/plain clipboard data and a
non-Gemini byte-preservation corpus.

The final evidence chain is:

`requirement → public seam → focused red/green test → full frontend/Rust suite
→ production Tauri build → GitHub CI → published Windows installer inspection`.

Windows resource inspection is completed against the generated GitHub
artifacts. Locally unavailable interactive WebView2 behaviour is not inferred
from a Vite build.
