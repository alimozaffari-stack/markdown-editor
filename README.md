# Markdown Editor

<img src="docs/app-icon.png" alt="Markdown Editor" width="128" height="128" style="border-radius: 22px; margin-bottom: 8px;">

Markdown Editor is an independently maintained, offline-first desktop Markdown
application for Windows and Linux. It stores managed notes as plain Markdown
files that remain under your control.

**This repository is the authoritative source and release location for
Markdown Editor.** It is independent from the upstream Scratch project. Its
releases, support and roadmap are maintained here.

[Download v1.0.4](https://github.com/alimozaffari-stack/markdown-editor/releases/tag/v1.0.4) · [All releases](https://github.com/alimozaffari-stack/markdown-editor/releases) · [Source code](https://github.com/alimozaffari-stack/markdown-editor)

## Current release: v1.0.4

Version 1.0.4 makes paste and file saving fail-safe while replacing the
remaining internal artwork with the Markdown Editor identity.

- **Source-aware rich paste:** normal paste prefers explicit Markdown, then
  safe structured HTML from Gemini Canvas and similar editors, then
  high-confidence line-classified Markdown. A preservation check rejects
  partial conversions and inserts the complete plain-text flavour instead.
- **Paste exactly:** the document context menu can bypass rich/Markdown
  conversion. In source mode it inserts every delivered source character and
  line break exactly.
- **Source formatting protection:** `Preserve source formatting` is a
  per-document context-menu option. It keeps source mode authoritative and
  prevents visual serialisation for that note.
- **Write only after a user edit:** opening, focusing, selecting, changing
  mode or workspace, watcher refreshes and autosave timer expiry do not write a
  clean file.
- **Validated atomic saving:** a changed document is checked against its
  baseline hash, written to a recovery draft and validated in a sibling
  temporary file before platform-safe replacement. At least one prior version
  is retained in application storage.

If another application changes a loaded file, Markdown Editor refuses to overwrite
it, retains the local recovery draft and offers to reload the disk version.
UTF-8 and BOM-marked UTF-16 source saves retain their encoding and byte-order
mark; source-mode edits also retain their delivered line endings. Visual mode
preserves document structure and visible content, but legitimate Markdown
normalisation means it is not a byte-preserving mode.

When an application places only flattened `text/plain` on the clipboard, its
original rich hierarchy is unavailable and cannot be reconstructed. The text
is still inserted in full without concatenation.

## What Markdown Editor does

- Creates and manages Markdown notes in a folder you choose; create a new note
  with `Ctrl+N` on Windows or `Cmd+N` on macOS.
- Provides rich-text editing that saves as Markdown, plus a raw Markdown source
  mode.
- Opens external Markdown files without taking ownership of them.
- Supports folders, search, syntax highlighting, Mermaid diagrams, KaTeX
  maths, wikilinks, slash commands, focus mode, themes, typography settings,
  RTL text and optional Git integration.
- Can work with local AI command-line tools and detects external changes to
  open files.
- Runs locally: normal note editing does not require a cloud account or
  internet connection.
- Keeps Markdown repair as a deliberate, previewed operation rather than an
  implicit paste or save transformation.

Existing notes folders continue to use their `.scratch/settings.json` metadata
unchanged, so their per-folder settings are retained. The new application uses
a distinct bundle identifier and application-data location.

## Installation

Download the installer or package from the
[v1.0.4 release](https://github.com/alimozaffari-stack/markdown-editor/releases/tag/v1.0.4).

### Windows

1. Download `Markdown.Editor_1.0.4_x64-setup.exe` for the guided installer, or
   `Markdown.Editor_1.0.4_x64_en-US.msi` for managed deployment.
2. Close any running Markdown Editor windows.
3. Run the installer, then open Markdown Editor or double-click a Markdown
   file.

The installer obtains the Microsoft WebView2 bootstrapper when WebView2 is not
already available.

### Linux

Download the available package from the
[v1.0.4 release](https://github.com/alimozaffari-stack/markdown-editor/releases/tag/v1.0.4)
and follow the normal platform installation steps.

No macOS binary is published for v1.0.4.

### From source

**Prerequisites:** Node.js 20.19+ and a current stable Rust toolchain.

```bash
git clone https://github.com/alimozaffari-stack/markdown-editor.git
cd markdown-editor
npm ci
npm run tauri dev
```

## Essential shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+S` | Save the current document |
| `Ctrl/Cmd+N` | New managed note |
| `Ctrl/Cmd+D` | Duplicate managed note |
| `Ctrl/Cmd+P` | Command palette |
| `Ctrl/Cmd+F` | Find in the current document |
| `Ctrl/Cmd+Shift+M` | Toggle Markdown source mode |
| `Ctrl/Cmd+Shift+Enter` | Toggle focus mode |
| `Ctrl/Cmd+Shift+F` | Search managed notes |
| `Ctrl/Cmd+R` | Reload the current document from disk |
| `Ctrl/Cmd+,` | Open settings |
| `Ctrl/Cmd+\\` | Toggle sidebar |

## Built with

[Tauri](https://tauri.app/) · [React](https://react.dev/) ·
[TipTap](https://tiptap.dev/) · [Tailwind CSS](https://tailwindcss.com/) ·
[Tantivy](https://github.com/quickwit-oss/tantivy)

## Upstream acknowledgement

Markdown Editor was originally derived from
[Scratch by Eric Li](https://github.com/erictli/scratch). We acknowledge Eric
Li and the upstream contributors for the source application on which this
independently maintained product is based.

Markdown Editor is not affiliated with, endorsed by or supported by the
upstream project. The upstream licence is MIT; applicable upstream copyright
and licence notices remain in effect.

## License

MIT
