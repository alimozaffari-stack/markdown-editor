# Markdown Editor

<img src="docs/app-icon.png" alt="Markdown Editor" width="128" height="128" style="border-radius: 22px; margin-bottom: 8px;">

Markdown Editor is an independently maintained, offline-first desktop Markdown
application for Windows, macOS and Linux. It stores managed notes as plain
Markdown files that remain under your control.

**This repository is the authoritative source and release location for
Markdown Editor.** It is independent from the upstream Scratch project. Its
releases, support and roadmap are maintained here.

[Releases](https://github.com/alimozaffari-stack/markdown-editor/releases) · [Source code](https://github.com/alimozaffari-stack/markdown-editor)

## Current release candidate: v1.0.1

This release candidate incorporates upstream v1.0.0 improvements while
preserving the additions made in this edition, including Find and Replace,
sidebar resizing, external-file handling, source mode, Mermaid, KaTeX,
wikilinks and optional Git integration.

- **Markdown-preserving paste:** normal paste never reformats tables, removes
  whitespace, collapses blank lines or closes code fences.
- **Reviewable repair:** Markdown repair is a deliberate action that displays
  the current and proposed Markdown before it can be applied.
- **British-English prose support:** visual prose requests `en-GB`
  spell-check and platform autocorrect; source mode, code, links and maths are
  excluded.
- **Independent distribution:** there is no upstream update channel or
  automatic release prompt. Install releases only from this repository.

The release workflow builds desktop packages for Windows, macOS and Linux when
the corresponding GitHub Actions jobs complete successfully.

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

Existing notes folders continue to use their `.scratch/settings.json` metadata
unchanged, so their per-folder settings are retained. The new application uses
a distinct bundle identifier and application-data location.

## Installation

Download the installer or package for your platform from the
[Releases page](https://github.com/alimozaffari-stack/markdown-editor/releases).

### Windows

1. Download the current Windows `.exe` installer.
2. Close any running Markdown Editor windows.
3. Run the installer, then open Markdown Editor or double-click a Markdown
   file.

Windows installs WebView2 automatically if it is not already available.

### macOS and Linux

Download the available package from the
[Releases page](https://github.com/alimozaffari-stack/markdown-editor/releases)
and follow the normal platform installation steps.

### From source

**Prerequisites:** Node.js 18+ and Rust 1.70+.

```bash
git clone https://github.com/alimozaffari-stack/markdown-editor.git
cd markdown-editor
npm install
npm run tauri dev
```

## Essential shortcuts

| Shortcut | Action |
| --- | --- |
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
