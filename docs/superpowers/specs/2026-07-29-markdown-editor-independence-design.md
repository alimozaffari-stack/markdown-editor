# Markdown Editor Independence Design

## Decision record

The product is **Markdown Editor**, independently maintained at
`alimozaffari-stack/markdown-editor`.  It is derived from Scratch, but is not
an upstream fork or update channel.  `alimozaffari-stack/scratch` will be
archived only after the new repository contains this verified release
candidate.

## Product boundary

- Rebrand the public app, bundle, repository references and release workflow
  as Markdown Editor.
- Use a distinct application identifier and product data directory.
- Preserve existing per-folder Scratch settings during transition rather than
  deleting or overwriting them.  The implementation must keep `.scratch`
  excluded from note discovery because existing folders may retain it.
- Remove the unused updater runtime dependency and initialisation.  The app
  must not poll, signal or suggest upstream Scratch releases.
- Keep upstream attribution and licence notices in the repository.

## Markdown integrity

Normal paste is byte-preserving: it never runs table formatting, whitespace
trimming, blank-line collapse or fence completion.  The source editor also
remains syntax-preserving.

Formatting repair remains available only through an explicit action.  It first
shows the exact original and proposed Markdown, and changes a note only after
the user selects **Apply changes**.  Formatting and repair are intentionally
not promised to preserve all Markdown constructs; the preview is the review
boundary.

Regression fixtures cover tables, YAML, citations, code fences, Mermaid,
mathematics, footnotes and deliberate whitespace.  They prove that the normal
paste preparation path returns each fixture unchanged.

## Language and autocorrect

The visual prose editor declares `en-GB`, requests spell-check and permits
platform autocorrect.  Markdown source mode, code blocks, mathematical input,
command controls and link/technical entry controls disable spell-check and
autocorrect.  The operating system or WebView remains responsible for the
installed British-English dictionary; the application cannot supply one.

## Acceptance criteria

1. Normal paste preserves the supplied Markdown fixture exactly.
2. Formatting repair is opt-in and cannot apply without a preview/confirmation.
3. Visual prose declares British English; source and code entry disable
   spelling/autocorrect attributes.
4. No release/update configuration or runtime component points to upstream
   Scratch.
5. The independent product identifies itself as Markdown Editor and points to
   `alimozaffari-stack/markdown-editor`.
6. The frontend and Rust checks pass before the new repository is published.

## Deliberately deferred

The reported malformed rendering of particular existing files has no supplied
fixture and the proven paste-repair code is not invoked on file opening.  This
release establishes preservation tests and removes the corruption path; any
remaining parser/visual rendering fault needs one affected Markdown file and a
separate regression test.
