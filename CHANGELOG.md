# Changelog

All notable changes to Markdown Editor are recorded here.

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
