export type DocumentEncoding = "utf-8" | "utf-16le" | "utf-16be";
export type DocumentBom = "none" | "utf-8" | "utf-16le" | "utf-16be";
export type DocumentLineEnding = "none" | "lf" | "crlf" | "cr" | "mixed";
export type DocumentMode = "visual" | "source";
export type DocumentAuthority = "visual" | "source";
export type DocumentSaveReason = "autosave" | "explicit";

export type DocumentProgrammaticEvent =
  | "hydrate"
  | "focus"
  | "selection"
  | "mode-switch"
  | "workspace-switch"
  | "watcher-refresh"
  | "timer-expiry";

export interface DocumentSnapshot {
  content: string;
  sourceContent?: string;
  hash: string;
  revision: number;
  encoding: DocumentEncoding;
  bom: DocumentBom;
  lineEnding: DocumentLineEnding;
}

export interface DocumentSaveRequest {
  content: string;
  contentBaseline?: string;
  sourceBaseline?: string;
  contentIsStorageSource?: boolean;
  baselineHash: string;
  revision: number;
  encoding: DocumentEncoding;
  bom: DocumentBom;
  lineEnding: DocumentLineEnding;
  authority: DocumentAuthority;
  reason: DocumentSaveReason;
}

export type DocumentSaveFailureKind =
  | "conflict"
  | "unsupported-encoding"
  | "validation"
  | "temporary-write"
  | "replacement"
  | "io";

export interface DocumentSaveFailure {
  kind: DocumentSaveFailureKind;
  message: string;
  draftPath?: string;
  currentHash?: string;
}

export function canAcceptDocumentInput({
  isPreview,
  settingsResolved,
}: {
  isPreview: boolean;
  settingsResolved: boolean;
}): boolean {
  return isPreview || settingsResolved;
}

export function toSourceEditorText(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function isInternalWorkspaceFile(
  filePath: string | null | undefined,
  notesFolder: string | null | undefined,
): boolean {
  if (!filePath || !notesFolder) return false;
  const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const fileNorm = normalize(filePath);
  const baseNorm = normalize(notesFolder);
  const basePrefix = baseNorm.endsWith("/") ? baseNorm : `${baseNorm}/`;
  return fileNorm === baseNorm || fileNorm.startsWith(basePrefix);
}

function sourceOffsetAtEditorOffset(
  source: string,
  requestedEditorOffset: number,
): number {
  const editorOffset = Math.max(0, requestedEditorOffset);
  let sourceOffset = 0;
  let currentEditorOffset = 0;

  while (
    sourceOffset < source.length &&
    currentEditorOffset < editorOffset
  ) {
    if (
      source[sourceOffset] === "\r" &&
      source[sourceOffset + 1] === "\n"
    ) {
      sourceOffset += 2;
    } else {
      sourceOffset += 1;
    }
    currentEditorOffset += 1;
  }

  return sourceOffset;
}

function preferredLineBreak(
  lineEnding: DocumentLineEnding,
  source: string,
): string {
  if (lineEnding === "crlf") return "\r\n";
  if (lineEnding === "cr") return "\r";
  if (lineEnding === "lf") return "\n";

  const firstBreak = source.match(/\r\n|\r|\n/)?.[0];
  return firstBreak ?? "\n";
}

function encodeEditorInsertion(
  editorText: string,
  lineEnding: DocumentLineEnding,
  source: string,
): string {
  return toSourceEditorText(editorText).replace(
    /\n/g,
    preferredLineBreak(lineEnding, source),
  );
}

function changedEditorRange(
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

export type DocumentEditOutcome = "ignored" | "dirty" | "clean";

export class DocumentSession {
  private snapshot: DocumentSnapshot;
  private sourceContent: string;
  private visualContent: string;
  private visualBaseline: string;
  private dirty = false;
  private mode: DocumentMode = "visual";
  private authority: DocumentAuthority = "source";
  private programmaticDepth = 0;
  private preserveSourceFormatting = false;

  constructor(snapshot: DocumentSnapshot) {
    this.snapshot = { ...snapshot };
    this.sourceContent = snapshot.content;
    this.visualContent = snapshot.content;
    this.visualBaseline = snapshot.content;
  }

  get currentSnapshot(): Readonly<DocumentSnapshot> {
    return this.snapshot;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get currentMode(): DocumentMode {
    return this.mode;
  }

  get currentSourceContent(): string {
    return this.sourceContent;
  }

  get preservesSourceFormatting(): boolean {
    return this.preserveSourceFormatting;
  }

  runProgrammatic<T>(operation: () => T): T {
    this.programmaticDepth += 1;
    try {
      return operation();
    } finally {
      this.programmaticDepth -= 1;
    }
  }

  noteProgrammaticEvent(_event: DocumentProgrammaticEvent): void {
    // Non-content programme events are intentionally incapable of changing
    // the document's dirty state.
  }

  hydrate(snapshot: DocumentSnapshot): void {
    this.runProgrammatic(() => {
      this.snapshot = { ...snapshot };
      this.sourceContent = snapshot.content;
      this.visualContent = snapshot.content;
      this.visualBaseline = snapshot.content;
      this.authority = "source";
      this.dirty = false;
    });
  }

  establishInitialVisualBaseline(serialisedMarkdown: string): void {
    this.visualBaseline = serialisedMarkdown;
    this.visualContent = serialisedMarkdown;
    this.dirty = false;
  }

  rebaseSnapshot(snapshot: DocumentSnapshot): void {
    this.snapshot = { ...snapshot };
    if (!this.dirty) {
      this.sourceContent = snapshot.content;
      this.visualContent = snapshot.content;
      this.visualBaseline = snapshot.content;
      this.authority = "source";
      return;
    }

    if (this.authority === "source") {
      this.visualContent = snapshot.content;
      this.dirty = this.sourceContent !== snapshot.content;
    } else {
      this.sourceContent = snapshot.content;
      this.dirty = this.visualContent !== snapshot.content;
    }
  }

  setMode(mode: DocumentMode): void {
    this.mode = mode;
    this.noteProgrammaticEvent("mode-switch");
  }

  setPreserveSourceFormatting(enabled: boolean): void {
    this.preserveSourceFormatting = enabled;
    if (enabled) {
      this.authority = "source";
      this.setMode("source");
    }
  }

  recordVisualEdit(content: string): DocumentEditOutcome {
    if (this.programmaticDepth > 0) {
      this.visualContent = content;
      return "ignored";
    }
    if (this.preserveSourceFormatting) return "ignored";

    this.visualContent = content;
    this.authority = "visual";

    if (!this.visualBaseline) {
      this.visualBaseline = content;
      this.dirty = false;
      return "clean";
    }

    const norm = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
    const isClean =
      norm(content) === norm(this.visualBaseline) ||
      norm(content) === norm(this.snapshot.content);
    this.dirty = !isClean;
    return this.dirty ? "dirty" : "clean";
  }

  recordSourceEdit(content: string): boolean {
    this.sourceContent = content;
    if (this.programmaticDepth > 0) return false;

    this.authority = "source";
    this.dirty = content !== this.snapshot.content;
    return true;
  }

  recordSourceEditorEdit(editorContent: string): boolean {
    const previousEditorContent = toSourceEditorText(this.sourceContent);
    const change = changedEditorRange(previousEditorContent, editorContent);
    const sourceFrom = sourceOffsetAtEditorOffset(
      this.sourceContent,
      change.from,
    );
    const sourceTo = sourceOffsetAtEditorOffset(this.sourceContent, change.to);
    const inserted = encodeEditorInsertion(
      change.inserted,
      this.snapshot.lineEnding,
      this.sourceContent,
    );
    this.sourceContent =
      this.sourceContent.slice(0, sourceFrom) +
      inserted +
      this.sourceContent.slice(sourceTo);

    if (this.programmaticDepth > 0) return false;
    this.authority = "source";
    this.dirty = this.sourceContent !== this.snapshot.content;
    return true;
  }

  insertExactSourceText(
    requestedFrom: number,
    requestedTo: number,
    delivered: string,
  ): { editorContent: string; cursor: number; changed: boolean } {
    const previousEditorContent = toSourceEditorText(this.sourceContent);
    const from = Math.max(
      0,
      Math.min(requestedFrom, requestedTo, previousEditorContent.length),
    );
    const to = Math.max(
      from,
      Math.min(
        Math.max(requestedFrom, requestedTo),
        previousEditorContent.length,
      ),
    );
    const sourceFrom = sourceOffsetAtEditorOffset(this.sourceContent, from);
    const sourceTo = sourceOffsetAtEditorOffset(this.sourceContent, to);
    const nextSource =
      this.sourceContent.slice(0, sourceFrom) +
      delivered +
      this.sourceContent.slice(sourceTo);
    const insertedEditorText = toSourceEditorText(delivered);
    const editorContent =
      previousEditorContent.slice(0, from) +
      insertedEditorText +
      previousEditorContent.slice(to);
    const changed = nextSource !== this.sourceContent;

    this.sourceContent = nextSource;
    if (this.programmaticDepth === 0) {
      this.authority = "source";
      this.dirty = this.sourceContent !== this.snapshot.content;
    }

    return {
      editorContent,
      cursor: from + insertedEditorText.length,
      changed,
    };
  }

  takeSaveRequest(reason: DocumentSaveReason): DocumentSaveRequest | null {
    if (!this.dirty || this.programmaticDepth > 0) return null;

    const authority = this.preserveSourceFormatting
      ? "source"
      : this.authority;
    const content =
      authority === "source" ? this.sourceContent : this.visualContent;
    if (content === this.snapshot.content) {
      this.dirty = false;
      return null;
    }

    return {
      content,
      ...(this.snapshot.sourceContent !== undefined
        ? {
            contentBaseline: this.snapshot.content,
            sourceBaseline: this.snapshot.sourceContent,
          }
        : {}),
      baselineHash: this.snapshot.hash,
      revision: this.snapshot.revision,
      encoding: this.snapshot.encoding,
      bom: this.snapshot.bom,
      lineEnding: this.snapshot.lineEnding,
      authority,
      reason,
    };
  }

  markSaved(
    snapshot: DocumentSnapshot,
    request: DocumentSaveRequest,
  ): void {
    const activeContent =
      this.authority === "source" ? this.sourceContent : this.visualContent;
    const changedWhileSaving =
      this.authority !== request.authority || activeContent !== request.content;

    this.snapshot = { ...snapshot };
    if (!changedWhileSaving) {
      this.sourceContent = snapshot.content;
      this.visualContent = snapshot.content;
      this.authority = "source";
      this.dirty = false;
      return;
    }

    if (this.authority === "source") {
      this.visualContent = snapshot.content;
      this.dirty = this.sourceContent !== snapshot.content;
    } else {
      this.sourceContent = snapshot.content;
      this.dirty = this.visualContent !== snapshot.content;
    }
  }
}
