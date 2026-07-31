# Changelog

All notable changes to Markdown Editor are recorded here.

## [1.0.6] - 2026-08-01

### Added

- **Multi-Document Tab Bar System:** Supports opening multiple managed workspace notes and external files as tabs simultaneously. Double-clicking any `.md` file in Windows File Explorer automatically opens a new tab in the running window without closing existing files.
- **Domain-Separated Save Workflows:** Retains continuous debounced background autosave (500ms) for managed workspace notes, while requiring explicit manual save (`Ctrl+S` / Save button / Save As `Ctrl+Shift+S`) for external standalone files.
- **Movable Sidebar Splitter UI:** Re-architected sidebar into a vertically stacked split panel with a draggable horizontal divider handle separating Recent External Files (top pane) and Workspace Notes (bottom pane) with single-column scrollbar alignment.
- **Unsaved Close Protection Modal:** Prompts for confirmation (**Save**, **Don't Save**, **Cancel**) when closing dirty external file tabs or closing the app window.

### Fixed

- Cross-volume atomic file replacement (`MOVEFILE_COPY_ALLOWED` in `src-tauri/src/document.rs`) supporting disk writes across different drive volumes (`C:`, `D:`, `G:`).
- Suppressed false positive round-trip validation toasts when visible document character counts are 100% identical.
- Fixed vertical centering for empty state logo frame.

## [1.0.5] - 2026-07-31

### Added

- Persistent **Recent files** list for the latest 50 external Markdown files,
  with individual removal and a clear-list action. The list retains paths and
  metadata only; it never imports, copies, moves, or modifies those files.
- Packaged application version on the welcome screen, sidebar, and Settings.
- Explicit MIT licence, project provenance notice, and release-oriented
  documentation.

### Fixed

- The normal test command now runs the complete TypeScript test suite.
- Tauri development startup and Vite now use the same local port.
- Windows recovery replacement handles a read-only target with a narrowly
  scoped, Windows-only Clippy exemption.

### Changed

- Minimum supported Node.js version is 22.6.

## [1.0.4] - 2026-07-30

- Improved preservation of pasted and saved Markdown content.
