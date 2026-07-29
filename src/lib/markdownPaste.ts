/**
 * Normal paste is intentionally lossless. Markdown transformations belong to
 * explicit, reviewable formatting commands, never to an insertion path.
 */
export function prepareMarkdownPaste(text: string): string {
  return text;
}
