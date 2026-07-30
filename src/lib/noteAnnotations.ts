import type { Comment, Footnote } from "../types/note.ts";

interface AnnotationRange {
  from: number;
  to: number;
}

interface SourceSegment {
  kind: "content" | "annotation";
  text: string;
}

interface ParsedAnnotations {
  cleanContent: string;
  footnotes: Footnote[];
  comments: Comment[];
  segments: SourceSegment[];
}

const lineBreakPattern = String.raw`(?:\r\n|\r|\n)`;
const commentsPattern = new RegExp(
  String.raw`(?:${lineBreakPattern}){1,2}<!-- SCRATCH_COMMENTS${lineBreakPattern}([\s\S]*?)${lineBreakPattern}-->$`,
);

function mergeRanges(ranges: AnnotationRange[]): AnnotationRange[] {
  const ordered = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: AnnotationRange[] = [];
  for (const range of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to) {
      merged.push({ ...range });
    } else {
      previous.to = Math.max(previous.to, range.to);
    }
  }
  return merged;
}

export function parseNoteAnnotations(source: string): ParsedAnnotations {
  const ranges: AnnotationRange[] = [];
  const footnotes: Footnote[] = [];
  let comments: Comment[] = [];

  const commentsMatch = commentsPattern.exec(source);
  const commentsRange = commentsMatch
    ? {
        from: commentsMatch.index,
        to: commentsMatch.index + commentsMatch[0].length,
      }
    : null;
  if (commentsMatch && commentsRange) {
    try {
      const parsed = JSON.parse(commentsMatch[1]);
      if (Array.isArray(parsed)) comments = parsed;
      ranges.push(commentsRange);
    } catch {
      // Malformed compatibility metadata remains ordinary source content.
    }
  }

  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const match of source.matchAll(linePattern)) {
    const segment = match[0];
    if (!segment) continue;
    const from = match.index;
    const to = from + segment.length;
    if (
      commentsRange &&
      from >= commentsRange.from &&
      to <= commentsRange.to
    ) {
      continue;
    }
    const line = segment.replace(/(?:\r\n|\r|\n)$/, "");
    const footnote = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!footnote) continue;
    footnotes.push({ id: footnote[1], text: footnote[2].trim() });
    ranges.push({ from, to });
  }

  const annotations = mergeRanges(ranges);
  const segments: SourceSegment[] = [];
  let cursor = 0;
  for (const range of annotations) {
    if (range.from > cursor) {
      segments.push({
        kind: "content",
        text: source.slice(cursor, range.from),
      });
    }
    segments.push({
      kind: "annotation",
      text: source.slice(range.from, range.to),
    });
    cursor = range.to;
  }
  if (cursor < source.length) {
    segments.push({ kind: "content", text: source.slice(cursor) });
  }
  if (segments.length === 0 && source) {
    segments.push({ kind: "content", text: source });
  }

  return {
    cleanContent: segments
      .filter((segment) => segment.kind === "content")
      .map((segment) => segment.text)
      .join(""),
    footnotes,
    comments,
    segments,
  };
}

function changedRange(
  previous: string,
  next: string,
): { from: number; to: number; inserted: string } {
  const sharedLength = Math.min(previous.length, next.length);
  let from = 0;
  while (from < sharedLength && previous[from] === next[from]) from += 1;

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > from &&
    nextEnd > from &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    from,
    to: previousEnd,
    inserted: next.slice(from, nextEnd),
  };
}

export function mergeEditedContentIntoSource(
  sourceBaseline: string,
  contentBaseline: string,
  editedContent: string,
): string {
  if (editedContent === contentBaseline) return sourceBaseline;
  const parsed = parseNoteAnnotations(sourceBaseline);
  if (parsed.cleanContent !== contentBaseline) {
    throw new Error(
      "The annotated source no longer matches the loaded document baseline",
    );
  }
  if (!parsed.segments.some((segment) => segment.kind === "annotation")) {
    return editedContent;
  }

  const change = changedRange(contentBaseline, editedContent);
  let cleanOffset = 0;
  let inserted = false;
  let merged = "";
  let remainingContentSegments = parsed.segments.filter(
    (segment) => segment.kind === "content",
  ).length;

  for (const segment of parsed.segments) {
    if (segment.kind === "content") remainingContentSegments -= 1;
    const hasLaterContent = remainingContentSegments > 0;
    if (
      !inserted &&
      cleanOffset === change.from &&
      (segment.kind === "content" || !hasLaterContent)
    ) {
      merged += change.inserted;
      inserted = true;
    }

    if (segment.kind === "annotation") {
      merged += segment.text;
      continue;
    }

    const segmentStart = cleanOffset;
    const segmentEnd = segmentStart + segment.text.length;
    if (segmentStart < change.from) {
      merged += segment.text.slice(
        0,
        Math.min(segment.text.length, change.from - segmentStart),
      );
    }
    if (
      !inserted &&
      change.from >= segmentStart &&
      change.from < segmentEnd
    ) {
      merged += change.inserted;
      inserted = true;
    }
    if (segmentEnd > change.to) {
      merged += segment.text.slice(
        Math.max(0, change.to - segmentStart),
      );
    }
    cleanOffset = segmentEnd;
  }

  if (!inserted) merged += change.inserted;
  return merged;
}

export function appendFootnotes(
  content: string,
  footnotes: Footnote[],
): string {
  if (!footnotes || footnotes.length === 0) return content;
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.endsWith(lineEnding)
    ? lineEnding
    : `${lineEnding}${lineEnding}`;
  const footnoteLines = footnotes
    .map((footnote) => `[^${footnote.id}]: ${footnote.text}`)
    .join(lineEnding);
  return `${content}${separator}${footnoteLines}`;
}

export function appendComments(
  content: string,
  comments: Comment[],
): string {
  if (!comments || comments.length === 0) return content;
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.endsWith(lineEnding)
    ? lineEnding
    : `${lineEnding}${lineEnding}`;
  const serialised = JSON.stringify(comments, null, 2).replace(
    /\n/g,
    lineEnding,
  );
  return `${content}${separator}<!-- SCRATCH_COMMENTS${lineEnding}${serialised}${lineEnding}-->`;
}
