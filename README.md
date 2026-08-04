# Markdown Editor

<img src="docs/app-icon.png" alt="Markdown Editor" width="128" height="128" style="border-radius: 22px; margin-bottom: 8px;">

Markdown Editor is an independently maintained, offline-first desktop Markdown
application for Windows and Linux. It stores managed notes as plain Markdown
files that remain under your control.

**This repository is the authoritative source and release location for
Markdown Editor.** It is independent from the upstream Scratch project. Its
releases, support and roadmap are maintained here.

[Download the current release](https://github.com/alimozaffari-stack/markdown-editor/releases/latest) · [All releases](https://github.com/alimozaffari-stack/markdown-editor/releases) · [Source code](https://github.com/alimozaffari-stack/markdown-editor)

## Current release: v1.1.6

The [GitHub Releases page](https://github.com/alimozaffari-stack/markdown-editor/releases)
is the only authoritative location for downloadable installers and packages.

This release builds on the file-safety and identity work below, and adds a
persistent list of the latest 50 externally opened Markdown files. The list
records paths only: it never imports, copies, moves or changes the original
files. Each entry can be removed separately, or the list can be cleared
without affecting any document. The packaged application version is also
visible on the welcome screen, sidebar and Settings page.

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
- Keeps a private list of the latest 50 external files opened in the app; each
  entry points back to its original location.
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

Download installers and packages only from the
[GitHub Releases page](https://github.com/alimozaffari-stack/markdown-editor/releases).

### Windows

1. Download the current release's `-setup.exe` for the guided installer, or
   its `.msi` package for managed deployment.
2. Close any running Markdown Editor windows.
3. Run the installer, then open Markdown Editor or double-click a Markdown
   file.

The installer obtains the Microsoft WebView2 bootstrapper when WebView2 is not
already available.

### Linux

Download the available package from the
[Releases page](https://github.com/alimozaffari-stack/markdown-editor/releases)
and follow the package's normal platform installation steps.

No macOS binary is currently published.

### From source

**Prerequisites:** Node.js 22.6+ and a current stable Rust toolchain.

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
upstream project. Scratch declares an MIT licence in its public README;
applicable upstream copyright and licence notices remain in effect. See
[NOTICE](NOTICE) for the project-level provenance statement.

## License

Markdown Editor is released under the [MIT License](LICENSE). Third-party
dependencies remain subject to their own licences.
