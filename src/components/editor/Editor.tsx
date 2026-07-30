import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import {
  useEditor,
  EditorContent,
  ReactRenderer,
  ReactNodeViewRenderer,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { lowlight } from "./lowlight";
import { CodeBlockView } from "./CodeBlockView";
import { Extension, InputRule, type JSONContent } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer } from "@tiptap/pm/model";
import { marked } from "marked";
import {
  formatMarkdownTable,
  formatAllTablesInMarkdown,
  repairMarkdownText,
} from "../../lib/markdownFormatter";
import {
  parseClipboardHtmlPreservingContent,
  performClipboardPaste,
  findClipboardImageItem,
  readClipboardPayload,
  type ClipboardInsertionAdapter,
  type ClipboardPayload,
} from "../../lib/clipboardTranslation";
import {
  DocumentSession,
  toSourceEditorText,
  type DocumentSaveFailure,
  type DocumentSaveReason,
  type DocumentSaveRequest,
  type DocumentSnapshot,
} from "../../lib/documentLifecycle";
import {
  parseMarkdownPreservingContent,
  validateMarkdownRoundTrip,
} from "../../lib/markdownConversion";
import { createMarkdownSchemaExtensions } from "../../lib/markdownExtensions";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { mod, alt, shift, isMac, isWindows } from "../../lib/platform";

// Prepend https:// if no protocol is present
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Validate URL scheme for safe opening
function isAllowedUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useOptionalNotes, extractComments } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { BlockMathEditor } from "./BlockMathEditor";
import { LinkEditor } from "./LinkEditor";
import { SearchToolbar } from "./SearchToolbar";
import { SlashCommand } from "./SlashCommand";
import { type WikilinkStorage } from "./Wikilink";
import { WikilinkSuggestion } from "./WikilinkSuggestion";
import { EditorWidthHandles } from "./EditorWidthHandle";
import { ScratchBlockMath, normalizeBlockMath } from "./MathExtensions";
import { TableOfContents } from "./TableOfContents";
import { cn } from "../../lib/utils";
import { plainTextFromMarkdown } from "../../lib/plainText";
import { Button, IconButton, ToolbarButton, Tooltip } from "../ui";
import * as notesService from "../../services/notes";
import { downloadPdf, downloadMarkdown } from "../../services/pdf";
import type { Settings } from "../../types/note";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  CodeIcon,
  InlineCodeIcon,
  BlockMathIcon,
  SeparatorIcon,
  LinkIcon,
  BracketsIcon,
  ImageIcon,
  CalendarIcon,
  LetterCaseIcon,
  TableIcon,
  SpinnerIcon,
  CircleCheckIcon,
  CopyIcon,
  DownloadIcon,
  ShareIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  PinIcon,
  SearchIcon,
  MarkdownIcon,
  MarkdownOffIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  FootnoteIcon,
  HighlighterIcon,
  PasteIcon,
  ScissorsIcon,
  FontColorIcon,
} from "../icons";

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type FormattingPreview = {
  original: string;
  proposed: string;
  sourceMode: boolean;
};

function describeSaveFailure(error: unknown): DocumentSaveFailure {
  if (error && typeof error === "object") {
    const candidate = error as Partial<DocumentSaveFailure>;
    if (typeof candidate.kind === "string" && typeof candidate.message === "string") {
      return {
        kind: candidate.kind as DocumentSaveFailure["kind"],
        message: candidate.message,
        draftPath: candidate.draftPath,
        currentHash: candidate.currentHash,
      };
    }
  }
  return {
    kind: "io",
    message: error instanceof Error ? error.message : String(error),
  };
}

function literalTextContent(text: string): JSONContent[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : undefined,
  }));
}

function focusAndSelectTitle(editor: TiptapEditor): boolean {
  let titleFrom = -1;
  let titleTo = -1;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading" || node.attrs.level !== 1) {
      return true;
    }
    titleFrom = pos + 1;
    titleTo = pos + node.nodeSize - 1;
    return false;
  });

  if (titleFrom < 0 || titleTo < 0) return false;

  editor
    .chain()
    .focus()
    .setTextSelection(
      titleFrom === titleTo ? titleFrom : { from: titleFrom, to: titleTo },
    )
    .run();

  return true;
}

// Standard number-field shortcuts for KaTeX (shared between inline and block math)
const katexMacros: Record<string, string> = {
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
};

// Search highlight extension - adds yellow backgrounds to search matches
const searchHighlightPluginKey = new PluginKey("searchHighlight");

interface SearchHighlightOptions {
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

const SearchHighlight = Extension.create<SearchHighlightOptions>({
  name: "searchHighlight",

  addOptions() {
    return {
      matches: [],
      currentIndex: 0,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, oldSet) => {
            // Map decorations through document changes
            const set = oldSet.map(tr.mapping, tr.doc);

            // Check if we need to update decorations (from transaction meta)
            const meta = tr.getMeta(searchHighlightPluginKey);
            if (meta !== undefined) {
              return meta.decorationSet;
            }

            return set;
          },
        },
        props: {
          decorations: (state) => {
            return searchHighlightPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

// GridPicker component for table insertion
interface GridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

function GridPicker({ onSelect }: GridPickerProps) {
  const [hovered, setHovered] = useState({ row: 3, col: 3 });

  return (
    <>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 25 }).map((_, i) => {
          const row = Math.floor(i / 5) + 1;
          const col = (i % 5) + 1;
          const isHighlighted = row <= hovered.row && col <= hovered.col;

          return (
            <div
              key={i}
              className={cn(
                "w-5.5 h-5.5 border rounded cursor-pointer transition-colors",
                isHighlighted
                  ? "bg-accent/20 border-accent/50"
                  : "border-border hover:border-accent/50",
              )}
              onMouseEnter={() => setHovered({ row, col })}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>
      <p className="text-xs text-center mt-2 text-text-muted">
        {hovered.row} × {hovered.col} table
      </p>
    </>
  );
}

interface FormatBarProps {
  editor: TiptapEditor | null;
  onAddLink: () => void;
  onAddBlockMath: () => void;
  onAddImage: () => void;
  onAddFootnote: () => void;
  onToggleCase: () => void;
}

// FormatBar must re-render with parent to reflect editor.isActive() state changes
// (editor instance is mutable, so memo would cause stale active states)
function FormatBar({
  editor,
  onAddLink,
  onAddBlockMath,
  onAddImage,
  onAddFootnote,
  onToggleCase,
}: FormatBarProps) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  if (!editor) return null;

  const fontColors = [
    { name: "Default", color: "" },
    { name: "Red", color: "#ef4444" },
    { name: "Orange", color: "#f97316" },
    { name: "Amber", color: "#f59e0b" },
    { name: "Green", color: "#10b981" },
    { name: "Teal", color: "#14b8a6" },
    { name: "Blue", color: "#3b82f6" },
    { name: "Indigo", color: "#6366f1" },
    { name: "Purple", color: "#a855f7" },
    { name: "Pink", color: "#ec4899" },
    { name: "Gray", color: "#6b7280" },
  ];

  return (
    <div className="flex items-center gap-1 px-3 pb-2 border-b border-border overflow-x-auto scrollbar-none">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title={`Bold (${mod}${isMac ? "" : "+"}B)`}
      >
        <BoldIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title={`Italic (${mod}${isMac ? "" : "+"}I)`}
      >
        <ItalicIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title={`Strikethrough (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}S)`}
      >
        <StrikethroughIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()}
        isActive={editor.isActive("highlight")}
        title={`Highlight (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}H)`}
      >
        <HighlighterIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={onToggleCase}
        isActive={false}
        title="Toggle Uppercase / Lowercase"
      >
        <LetterCaseIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      {/* Font Color Picker */}
      <div className="relative">
        <ToolbarButton
          onClick={() => setColorMenuOpen(!colorMenuOpen)}
          isActive={editor.isActive("textStyle")}
          title="Text Color"
        >
          <FontColorIcon className="w-4.5 h-4.5 stroke-[1.5]" />
        </ToolbarButton>

        {colorMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setColorMenuOpen(false)}
            />
            <div className="absolute top-full left-0 mt-1 z-50 p-2.5 bg-bg rounded-lg shadow-xl border border-border flex flex-col gap-2 min-w-[180px]">
              <div className="text-[11px] font-medium text-text-muted px-1">
                Text Color
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {fontColors.map((item) => (
                  <button
                    key={item.name}
                    title={item.name}
                    onClick={() => {
                      if (item.color) {
                        editor.chain().focus().setColor(item.color).run();
                      } else {
                        editor.chain().focus().unsetColor().run();
                      }
                      setColorMenuOpen(false);
                    }}
                    className="w-5.5 h-5.5 rounded-full border border-black/10 dark:border-white/20 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer relative shadow-xs"
                    style={{ backgroundColor: item.color || "transparent" }}
                  >
                    {!item.color && (
                      <div className="w-3 h-0.5 bg-red-500 rotate-45" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1.5 border-t border-border/60">
                <label className="text-xs text-text-muted cursor-pointer flex items-center gap-1.5 hover:text-text">
                  <input
                    type="color"
                    onChange={(e) => {
                      editor.chain().focus().setColor(e.target.value).run();
                      setColorMenuOpen(false);
                    }}
                    className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                  />
                  <span>Custom color...</span>
                </label>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title={`Heading 1 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}1)`}
      >
        <Heading1Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title={`Heading 2 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}2)`}
      >
        <Heading2Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title={`Heading 3 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}3)`}
      >
        <Heading3Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        isActive={editor.isActive("heading", { level: 4 })}
        title={`Heading 4 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}4)`}
      >
        <Heading4Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
        isActive={editor.isActive("heading", { level: 5 })}
        title={`Heading 5 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}5)`}
      >
        <Heading5Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
        isActive={editor.isActive("heading", { level: 6 })}
        title={`Heading 6 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}6)`}
      >
        <Heading6Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title={`Bullet List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}8)`}
      >
        <ListIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title={`Numbered List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}7)`}
      >
        <ListOrderedIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
        title="Task List"
      >
        <CheckSquareIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title={`Blockquote (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}B)`}
      >
        <QuoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title={`Inline Code (${mod}${isMac ? "" : "+"}E)`}
      >
        <InlineCodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title={`Code Block (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}C)`}
      >
        <CodeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={onAddBlockMath}
        isActive={editor.isActive("blockMath")}
        title="Block Math"
      >
        <BlockMathIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        isActive={false}
        title="Horizontal Rule"
      >
        <SeparatorIcon />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={onAddLink}
        isActive={editor.isActive("link")}
        title={`Add Link (${mod}${isMac ? "" : "+"}K)`}
      >
        <LinkIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().insertContent("[[").run()}
        isActive={false}
        title="Insert Wikilink"
      >
        <BracketsIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton onClick={onAddImage} isActive={false} title="Insert Image">
        <ImageIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={onAddFootnote}
        isActive={editor.isActive("footnoteReference")}
        title={`Insert Footnote (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}F)`}
      >
        <FootnoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <DropdownMenu.Root open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
        <Tooltip content="Insert Table">
          <DropdownMenu.Trigger asChild>
            <ToolbarButton isActive={editor.isActive("table")}>
              <TableIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </ToolbarButton>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="p-2.5 bg-bg border border-border rounded-md shadow-lg z-50"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <GridPicker
              onSelect={(rows, cols) => {
                editor
                  .chain()
                  .focus()
                  .insertTable({
                    rows,
                    cols,
                    withHeaderRow: true,
                  })
                  .run();
                setTableMenuOpen(false);
              }}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

// Data source for preview mode — bypasses NotesContext
export interface PreviewModeData {
  content: string | null;
  title: string;
  filePath: string;
  modified: number;
  snapshot: DocumentSnapshot | null;
  hasExternalChanges: boolean;
  reloadVersion: number;
  save: (request: DocumentSaveRequest) => Promise<DocumentSnapshot>;
  retainRecoveryDraft: (request: DocumentSaveRequest) => Promise<string>;
  reload: () => Promise<void>;
}

interface EditorProps {
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  focusMode?: boolean;
  previewMode?: PreviewModeData;
  onEditorReady?: (editor: TiptapEditor | null) => void;
  onSaveToFolder?: () => void;
  saveToFolderDisabled?: boolean;
}

/**
 * Get character offsets where each top-level block starts in markdown.
 * Blocks are separated by blank lines, with awareness of code fences
 * and ATX headings.
 */
function getMarkdownBlockOffsets(md: string): number[] {
  const offsets: number[] = [];
  const lines = md.split("\n");
  let pos = 0;
  let prevBlank = true; // treat doc start as preceded by blank
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (inCodeFence) {
      // Only look for closing fence; don't start new blocks inside code
      if (trimmed.startsWith("```")) {
        inCodeFence = false;
      }
    } else if (trimmed.startsWith("```")) {
      // Opening fence is always a block start
      offsets.push(pos);
      inCodeFence = true;
      prevBlank = false;
    } else {
      const isBlank = trimmed === "";
      // Start a new block after a blank line, or for ATX headings
      if (!isBlank && (prevBlank || trimmed.startsWith("#"))) {
        offsets.push(pos);
      }
      prevBlank = isBlank;
    }

    pos += line.length + 1;
  }

  return offsets;
}

/** ProseMirror position at the start of the Nth top-level block. */
function blockIndexToPos(
  doc: { childCount: number; child: (i: number) => { nodeSize: number } },
  blockIndex: number,
): number {
  const idx = Math.max(0, Math.min(blockIndex, doc.childCount - 1));
  let pos = 1; // 1 for doc opening token
  for (let i = 0; i < idx; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

export function Editor({
  onToggleSidebar,
  sidebarVisible,
  focusMode,
  onEditorReady,
  previewMode,
  onSaveToFolder,
  saveToFolderDisabled,
}: EditorProps) {
  // Always call the hook (rules of hooks), but it returns null outside NotesProvider
  const notesCtx = useOptionalNotes();

  const currentNote = previewMode
    ? previewMode.content !== null && previewMode.snapshot
      ? {
          id: previewMode.filePath,
          title: previewMode.title,
          content: previewMode.content,
          path: previewMode.filePath,
          modified: previewMode.modified,
          snapshot: previewMode.snapshot,
        }
      : null
    : (notesCtx?.currentNote ?? null);

  const saveDocument = previewMode
    ? async (request: DocumentSaveRequest, _noteId?: string) => {
        const snapshot = await previewMode.save(request);
        return { id: previewMode.filePath, snapshot, warning: undefined };
      }
    : async (request: DocumentSaveRequest, noteId?: string) => {
        const note = await notesCtx!.saveNote(request, noteId);
        if (!note) throw new Error("No note is selected");
        return {
          id: note.id,
          snapshot: note.snapshot,
          warning: note.warning,
        };
      };
  const retainRecoveryDraft = previewMode
    ? async (request: DocumentSaveRequest, _noteId?: string) =>
        previewMode.retainRecoveryDraft(request)
    : async (request: DocumentSaveRequest, noteId?: string) =>
        notesCtx!.retainRecoveryDraft(request, noteId);

  const createNote = notesCtx?.createNote;
  const consumePendingNewNote = notesCtx?.consumePendingNewNote;
  const hasExternalChanges = previewMode
    ? previewMode.hasExternalChanges
    : notesCtx!.hasExternalChanges;
  const reloadCurrentNote = previewMode
    ? previewMode.reload
    : notesCtx!.reloadCurrentNote;
  const reloadVersion = previewMode
    ? previewMode.reloadVersion
    : notesCtx!.reloadVersion;
  const pinNote = notesCtx?.pinNote;
  const unpinNote = notesCtx?.unpinNote;
  const notes = notesCtx?.notes;
  const footnotesMap = notesCtx?.footnotesMap ?? {};
  const addFootnote = notesCtx?.addFootnote;
  const { textDirection } = useTheme();
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? "⌘" : "Ctrl";
  const [isSaving, setIsSaving] = useState(false);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saveConflict, setSaveConflict] =
    useState<DocumentSaveFailure | null>(null);
  // Force re-render when selection changes to update toolbar active states
  const [, setSelectionKey] = useState(0);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Delay transition classes until after initial mount to avoid format bar height animation on note load
  const [hasTransitioned, setHasTransitioned] = useState(false);
  useEffect(() => {
    setIsUnsaved(false);
    setSaveConflict(null);
  }, [currentNote?.id]);

  useEffect(() => {
    if (!hasTransitioned && currentNote) {
      const id = requestAnimationFrame(() => setHasTransitioned(true));
      return () => cancelAnimationFrame(id);
    }
  }, [hasTransitioned, currentNote]);

  // Delay format bar / header transitions only when the sidebar needs to animate closed
  const needsSidebarDelay = focusMode && sidebarVisible;
  const isSidebarActive = sidebarVisible && !focusMode;
  // Source mode state
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [formattingPreview, setFormattingPreview] =
    useState<FormattingPreview | null>(null);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
    selectedText: string;
    hasSelection: boolean;
    isHighlighted: boolean;
  } | null>(null);
  const sourceTimeoutRef = useRef<number | null>(null);
  const sourceModeTransitionRef = useRef<{
    topBlockIndex: number;
    cursorBlockIndex: number;
    md?: string;
  } | null>(null);
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<
    Array<{ from: number; to: number }>
  >([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const linkPopupRef = useRef<TippyInstance | null>(null);
  const blockMathPopupRef = useRef<TippyInstance | null>(null);
  const isLoadingRef = useRef(false);
  const documentSessionRef = useRef<DocumentSession | null>(null);
  const sessionNoteIdsRef = useRef(new WeakMap<DocumentSession, string>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  // Track if we need to save (use ref to avoid computing markdown on every keystroke)
  const needsSaveRef = useRef(false);
  // Stable refs for wikilink click handler (avoids re-registering listener on every notes change)
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const notesCtxRef = useRef(notesCtx);
  notesCtxRef.current = notesCtx;

  // Keep ref in sync with current note ID
  currentNoteIdRef.current = currentNote?.id ?? null;

  // Get markdown from editor
  const getMarkdown = useCallback(
    (editorInstance: ReturnType<typeof useEditor>) => {
      if (!editorInstance) return "";
      const manager = editorInstance.storage.markdown?.manager;
      if (manager) {
        let markdown = manager.serialize(editorInstance.getJSON());
        // Clean up nbsp entities that TipTap inserts (especially in table cells)
        markdown = markdown.replace(/&nbsp;|&#160;/g, " ");
        return markdown;
      }
      // Fallback to plain text
      return editorInstance.getText();
    },
    [],
  );

  // Load settings when note changes or notes are refreshed (e.g., after pin/unpin)
  useEffect(() => {
    if (currentNote?.id && !previewMode) {
      notesService
        .getSettings()
        .then(setSettings)
        .catch((error) => {
          console.error("Failed to load settings:", error);
        });
    }
  }, [currentNote?.id, notes, previewMode]);

  // Calculate if current note is pinned
  const isPinned =
    settings?.pinnedNoteIds?.includes(currentNote?.id || "") || false;
  const preserveSourceFormatting =
    settings?.preserveSourceFormattingNoteIds?.includes(
      currentNote?.id || "",
    ) || false;

  useEffect(() => {
    const session = documentSessionRef.current;
    session?.setPreserveSourceFormatting(preserveSourceFormatting);
    if (preserveSourceFormatting && session) {
      setSourceContent(toSourceEditorText(session.currentSourceContent));
      setSourceMode(true);
    }
  }, [preserveSourceFormatting]);

  // Find all matches for search query (case-insensitive)
  const findMatches = useCallback(
    (query: string, editorInstance: TiptapEditor | null) => {
      if (!editorInstance || !query.trim()) return [];

      const doc = editorInstance.state.doc;
      const lowerQuery = query.toLowerCase();
      const matches: Array<{ from: number; to: number }> = [];

      // Search through each text node
      doc.descendants((node, nodePos) => {
        if (node.isText && node.text) {
          const text = node.text;
          const lowerText = text.toLowerCase();

          let searchPos = 0;
          while (searchPos < lowerText.length && matches.length < 500) {
            const index = lowerText.indexOf(lowerQuery, searchPos);
            if (index === -1) break;

            const matchFrom = nodePos + index;
            const matchTo = matchFrom + query.length;

            // Make sure the match doesn't extend beyond valid document bounds
            if (matchTo <= doc.content.size) {
              matches.push({
                from: matchFrom,
                to: matchTo,
              });
            }

            searchPos = index + 1;
          }
        }
      });

      return matches;
    },
    [],
  );

  // Update search decorations - applies yellow backgrounds to all matches
  const updateSearchDecorations = useCallback(
    (
      matches: Array<{ from: number; to: number }>,
      currentIndex: number,
      editorInstance: TiptapEditor | null,
    ) => {
      if (!editorInstance) return;

      try {
        const { state } = editorInstance;
        const decorations: Decoration[] = [];

        // Add decorations for all matches
        matches.forEach((match, index) => {
          const isActive = index === currentIndex;
          decorations.push(
            Decoration.inline(match.from, match.to, {
              class: isActive ? "search-match-active" : "search-match",
            }),
          );
        });

        const decorationSet = DecorationSet.create(state.doc, decorations);

        // Update decorations via transaction
        const tr = state.tr.setMeta(searchHighlightPluginKey, {
          decorationSet,
        });

        editorInstance.view.dispatch(tr);

        // Scroll to current match
        if (matches[currentIndex]) {
          const match = matches[currentIndex];
          const { node } = editorInstance.view.domAtPos(match.from);
          const element =
            node.nodeType === Node.ELEMENT_NODE
              ? (node as HTMLElement)
              : node.parentElement;

          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      } catch (error) {
        console.error("Failed to update search decorations:", error);
      }
    },
    [],
  );

  // Every autosave and explicit save passes through the same session request.
  const saveImmediately = useCallback(
    (noteId: string, reason: DocumentSaveReason) => {
      const session = documentSessionRef.current;
      const request = session?.takeSaveRequest(reason);
      if (!session || !request) {
        setIsUnsaved(false);
        return Promise.resolve();
      }
      if (!sessionNoteIdsRef.current.has(session)) {
        sessionNoteIdsRef.current.set(session, noteId);
      }

      let validationError: Error | null = null;
      if (request.authority === "visual" && editorRef.current) {
        const manager = editorRef.current.storage.markdown?.manager;
        if (manager) {
          const validation = validateMarkdownRoundTrip(
            manager,
            editorRef.current.getJSON(),
            request.content,
          );
          if (!validation.ok) {
            validationError = new Error(
              validation.reason ?? "Markdown round-trip validation failed",
            );
          }
        }
      }

      const operation = async () => {
        const isCurrentSession = () =>
          documentSessionRef.current === session;
        if (isCurrentSession()) setIsSaving(true);
        try {
          // A prior queued save may have advanced this session's baseline.
          // Keep this request's frozen candidate while rebasing its conflict
          // metadata onto the successfully saved snapshot.
          const baseline = session.currentSnapshot;
          const executableRequest: DocumentSaveRequest = {
            ...request,
            baselineHash: baseline.hash,
            revision: baseline.revision,
            encoding: baseline.encoding,
            bom: baseline.bom,
            lineEnding: baseline.lineEnding,
          };
          const activeNoteId =
            sessionNoteIdsRef.current.get(session) ?? noteId;
          if (validationError) {
            const draftPath = await retainRecoveryDraft(
              executableRequest,
              activeNoteId,
            );
            throw {
              kind: "validation",
              message: validationError.message,
              draftPath,
            } satisfies DocumentSaveFailure;
          }
          const saved = await saveDocument(
            executableRequest,
            activeNoteId,
          );
          if (saved.warning) toast.warning(saved.warning);
          sessionNoteIdsRef.current.set(session, saved.id);
          lastSaveRef.current = {
            noteId,
            content: saved.snapshot.content,
          };
          session.markSaved(saved.snapshot, executableRequest);
          if (isCurrentSession()) {
            setSaveConflict(null);
            setIsUnsaved(session.isDirty);
          }
        } catch (error) {
          const failure = describeSaveFailure(error);
          if (isCurrentSession()) {
            if (failure.kind === "conflict") setSaveConflict(failure);
            setIsUnsaved(true);
          }
          const recovery = failure.draftPath
            ? ` Recovery draft: ${failure.draftPath}`
            : "";
          toast.error(`${failure.message}${recovery}`);
        } finally {
          if (isCurrentSession()) setIsSaving(false);
        }
      };

      const queued = saveQueueRef.current.then(operation, operation);
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [retainRecoveryDraft, saveDocument],
  );
  const saveImmediatelyRef = useRef(saveImmediately);
  saveImmediatelyRef.current = saveImmediately;

  // Flush any pending save immediately (saves to the note currently loaded in editor)
  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (sourceTimeoutRef.current) {
      clearTimeout(sourceTimeoutRef.current);
      sourceTimeoutRef.current = null;
    }

    // Use loadedNoteIdRef (the note in the editor) not currentNoteIdRef
    // (which may already point at the next selected note).
    if (documentSessionRef.current?.isDirty && loadedNoteIdRef.current) {
      needsSaveRef.current = false;
      await saveImmediately(loadedNoteIdRef.current, "autosave");
    }
  }, [saveImmediately]);

  // Schedule a debounced save (markdown computed only when timer fires)
  const scheduleSave = useCallback(() => {
    setIsUnsaved(true);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;

    needsSaveRef.current = true;

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (currentNoteIdRef.current !== savingNoteId || !needsSaveRef.current) {
        return;
      }

      if (editorRef.current) {
        needsSaveRef.current = false;
        await saveImmediately(savingNoteId, "autosave");
      }
    }, 500);
  }, [saveImmediately, currentNote?.id]);

  useEffect(() => {
    const handleExplicitSave = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "s"
      ) {
        return;
      }
      event.preventDefault();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (sourceTimeoutRef.current) clearTimeout(sourceTimeoutRef.current);
      saveTimeoutRef.current = null;
      sourceTimeoutRef.current = null;
      const noteId = loadedNoteIdRef.current;
      if (noteId) void saveImmediately(noteId, "explicit");
    };

    window.addEventListener("keydown", handleExplicitSave, true);
    return () =>
      window.removeEventListener("keydown", handleExplicitSave, true);
  }, [saveImmediately]);

  const closeBlockMathPopup = useCallback(() => {
    if (blockMathPopupRef.current) {
      blockMathPopupRef.current.destroy();
      blockMathPopupRef.current = null;
    }
  }, []);

  const handleEditBlockMath = useCallback(
    (pos: number) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      if (linkPopupRef.current) {
        linkPopupRef.current.destroy();
        linkPopupRef.current = null;
      }
      closeBlockMathPopup();

      const node = currentEditor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "blockMath") {
        return;
      }

      const virtualElement = {
        getBoundingClientRect: () => {
          const nodeDom = currentEditor.view.nodeDOM(pos);
          if (nodeDom instanceof HTMLElement) {
            return nodeDom.getBoundingClientRect();
          }

          const start = currentEditor.view.coordsAtPos(pos);
          const end = currentEditor.view.coordsAtPos(pos + node.nodeSize);
          const left = Math.min(start.left, end.left);
          const top = Math.min(start.top, end.top);
          const right = Math.max(start.right, end.right);
          const bottom = Math.max(start.bottom, end.bottom);

          return {
            width: Math.max(2, right - left),
            height: Math.max(20, bottom - top),
            top,
            left,
            right,
            bottom,
            x: left,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        },
      };

      const component = new ReactRenderer(BlockMathEditor, {
        props: {
          initialLatex: String(node.attrs.latex ?? ""),
          onSubmit: (latex: string) => {
            const trimmed = latex.trim();
            if (!trimmed) {
              toast.error("Please enter a formula.");
              return;
            }
            currentEditor
              .chain()
              .focus()
              .updateBlockMath({ pos, latex: trimmed })
              .setTextSelection(pos + node.nodeSize)
              .run();
            closeBlockMathPopup();
          },
          onCancel: () => {
            // Move cursor after the node instead of restoring the NodeSelection,
            // which would re-trigger native DOM selection highlight bleed
            currentEditor
              .chain()
              .focus()
              .setTextSelection(pos + node.nodeSize)
              .run();
            closeBlockMathPopup();
          },
        },
        editor: currentEditor,
      });

      blockMathPopupRef.current = tippy(document.body, {
        getReferenceClientRect: () =>
          virtualElement.getBoundingClientRect() as DOMRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement: "bottom-start",
        offset: [0, 8],
        onDestroy: () => {
          component.destroy();
        },
      });
    },
    [closeBlockMathPopup],
  );

  const handleAddBlockMath = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    closeBlockMathPopup();
    if (linkPopupRef.current) {
      linkPopupRef.current.destroy();
      linkPopupRef.current = null;
    }
    const { selection, doc } = currentEditor.state;
    const { from, to, empty, $from } = selection;

    if (
      selection instanceof NodeSelection &&
      selection.node.type.name === "blockMath"
    ) {
      handleEditBlockMath(from);
      return;
    }

    if (!empty) {
      const selectedNode = doc.nodeAt(from);
      if (
        selectedNode?.type.name === "blockMath" &&
        from + selectedNode.nodeSize === to
      ) {
        handleEditBlockMath(from);
        return;
      }
    }

    if (empty) {
      const nodeBefore = $from.nodeBefore;
      if (nodeBefore?.type.name === "blockMath") {
        handleEditBlockMath(from - nodeBefore.nodeSize);
        return;
      }
      const nodeAfter = $from.nodeAfter;
      if (nodeAfter?.type.name === "blockMath") {
        handleEditBlockMath(from);
        return;
      }
    }

    const selectedText = empty ? "" : doc.textBetween(from, to, "\n");
    const initialLatex = normalizeBlockMath(selectedText);
    const targetRange = { from, to };
    const hasSelection = from !== to;

    const virtualElement = {
      getBoundingClientRect: () => {
        if (hasSelection) {
          const startPos = currentEditor.view.domAtPos(from);
          const endPos = currentEditor.view.domAtPos(to);

          if (startPos && endPos) {
            try {
              const range = document.createRange();
              range.setStart(startPos.node, startPos.offset);
              range.setEnd(endPos.node, endPos.offset);
              return range.getBoundingClientRect();
            } catch (error) {
              console.error("Block math range creation failed:", error);
            }
          }
        }

        const coords = currentEditor.view.coordsAtPos(from);
        return {
          width: 2,
          height: 20,
          top: coords.top,
          left: coords.left,
          right: coords.right,
          bottom: coords.bottom,
          x: coords.left,
          y: coords.top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    };

    const component = new ReactRenderer(BlockMathEditor, {
      props: {
        initialLatex,
        onSubmit: (latex: string) => {
          const normalizedLatex = latex.trim();
          if (!normalizedLatex) {
            toast.error("Please enter a formula.");
            return;
          }

          const inserted = currentEditor
            .chain()
            .focus()
            .insertContentAt(targetRange, {
              type: "blockMath",
              attrs: { latex: normalizedLatex },
            })
            .command(({ state, tr, dispatch }) => {
              if (!dispatch) return true;

              const { $to } = tr.selection;
              if ($to.nodeAfter?.isTextblock) {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1));
                tr.scrollIntoView();
                return true;
              }

              const paragraphType =
                state.schema.nodes.paragraph ??
                $to.parent.type.contentMatch.defaultType;
              const paragraphNode = paragraphType?.create();
              const insertPos = $to.nodeAfter ? $to.pos : $to.end();

              if (paragraphNode) {
                const $insertPos = tr.doc.resolve(insertPos);
                if (
                  $insertPos.parent.canReplaceWith(
                    $insertPos.index(),
                    $insertPos.index(),
                    paragraphNode.type,
                  )
                ) {
                  tr.insert(insertPos, paragraphNode);
                  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
                  tr.scrollIntoView();
                  return true;
                }
              }

              tr.scrollIntoView();
              return true;
            })
            .run();

          if (inserted) {
            closeBlockMathPopup();
          }
        },
        onCancel: () => {
          currentEditor.commands.focus();
          closeBlockMathPopup();
        },
      },
      editor: currentEditor,
    });

    blockMathPopupRef.current = tippy(document.body, {
      getReferenceClientRect: () =>
        virtualElement.getBoundingClientRect() as DOMRect,
      appendTo: () => document.body,
      content: component.element,
      showOnCreate: true,
      interactive: true,
      trigger: "manual",
      placement: "bottom-start",
      offset: [0, 8],
      onDestroy: () => {
        component.destroy();
      },
    });
  }, [closeBlockMathPopup, handleEditBlockMath]);

  const insertClipboardPayload = useCallback(
    async (payload: ClipboardPayload, exact = false) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const adapter: ClipboardInsertionAdapter = {
        insertHtml: (html) => {
          const parsed = parseClipboardHtmlPreservingContent(
            currentEditor.schema,
            html,
            document,
          );
          return currentEditor
            .chain()
            .focus()
            .insertContent(parsed.content ?? [])
            .run();
        },
        insertMarkdown: (markdown) => {
          const manager = currentEditor.storage.markdown?.manager;
          if (!manager) return false;
          const parsed = parseMarkdownPreservingContent(manager, markdown);
          return currentEditor
            .chain()
            .focus()
            .insertContent(parsed.content ?? [])
            .run();
        },
        insertText: (text) => {
          if (!text) return;
          currentEditor
            .chain()
            .focus()
            .insertContent(literalTextContent(text))
            .run();
        },
      };

      await performClipboardPaste(payload, adapter, {
        exact,
        document,
        onFallback: (reason) => {
          toast.warning(
            `Rich paste was inserted as complete plain text: ${reason}`,
          );
        },
      });
    },
    [],
  );

  const editor = useEditor({
    textDirection,
    extensions: [
      ...createMarkdownSchemaExtensions({
        codeBlock: CodeBlockLowlight.extend({
          addNodeView() {
            return ReactNodeViewRenderer(CodeBlockView);
          },
        }).configure({
          lowlight,
          defaultLanguage: null,
        }),
        link: Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: "underline cursor-pointer",
          },
        }),
        table: TableKit.configure({
          table: {
            resizable: false,
            HTMLAttributes: {
              class: "not-prose",
            },
          },
        }),
        blockMath: ScratchBlockMath.configure({
          katexOptions: {
            throwOnError: false,
            displayMode: true,
            macros: katexMacros,
          },
          onClick: (_node, pos) => {
            handleEditBlockMath(pos);
          },
        }),
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      // Convert markdown link syntax [text](url) into real links when typed
      Extension.create({
        name: "markdownLinkInputRule",
        addInputRules() {
          return [
            new InputRule({
              find: /\[([^\]]+)\]\(([^)]+)\)$/,
              handler: ({ state, range, match, commands }) => {
                const [, text, rawUrl] = match;
                const url = normalizeUrl(rawUrl);
                commands.command(({ tr }) => {
                  const linkMark = state.schema.marks.link.create({
                    href: url,
                  });
                  const textNode = state.schema.text(text, [linkMark]);
                  tr.replaceWith(range.from, range.to, textNode);
                  return true;
                });
              },
            }),
          ];
        },
      }),
      Markdown.configure({}),
      SearchHighlight.configure({
        matches: [],
        currentIndex: 0,
      }),
      SlashCommand,
      WikilinkSuggestion,
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg dark:prose-invert max-w-3xl mx-auto focus:outline-none min-h-full px-6 pt-8 pb-24",
        spellcheck: "true",
        autocorrect: "on",
        autocapitalize: "sentences",
        lang: "en-GB",
      },
      handleClickOn: (_view, _pos, node, _nodePos, _event, _direct) => {
        if (node.type.name === "footnoteReference") {
          const label = node.attrs.label;
          window.dispatchEvent(
            new CustomEvent("editor:focus-footnote", { detail: { label } })
          );
          return true;
        }
        return false;
      },
      // Serialize copied text as markdown instead of plain text
      clipboardTextSerializer: (slice) => {
        const fallback = slice.content.textBetween(
          0,
          slice.content.size,
          "\n\n",
        );
        const currentEditor = editorRef.current;
        const manager = currentEditor?.storage.markdown?.manager;
        if (!currentEditor || !manager) return fallback;
        try {
          const doc = currentEditor.schema.topNodeType.create(
            null,
            slice.content,
          );
          return manager.serialize(doc.toJSON());
        } catch {
          return fallback;
        }
      },
      // Trap Tab key inside the editor
      handleKeyDown: (_view, event) => {
        if (event.key === "Tab") {
          // Allow default tab behavior (indent in lists, etc.)
          // but prevent focus from leaving the editor
          return false;
        }
        return false;
      },
      // Handle markdown and image paste
      handlePaste: (_view, event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Check for images first
        const items = Array.from(clipboardData.items);
        const imageItem = findClipboardImageItem(items);

        if (imageItem) {
          const blob = imageItem.getAsFile();
          if (blob) {
            // Convert blob to base64 and handle async operations
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = (reader.result as string).split(",")[1]; // Remove data:image/...;base64, prefix

              try {
                // Save clipboard image
                const relativePath = await invoke<string>(
                  "save_clipboard_image",
                  { base64Data: base64 },
                );

                // Get notes folder and construct absolute path using Tauri's join
                const notesFolder = await invoke<string>("get_notes_folder");
                const absolutePath = await join(notesFolder, relativePath);

                // Convert to Tauri asset URL
                const assetUrl = convertFileSrc(absolutePath);

                // Insert image
                editorRef.current
                  ?.chain()
                  .focus()
                  .setImage({ src: assetUrl })
                  .run();
              } catch (error) {
                console.error("Failed to paste image:", error);
                toast.error("Failed to paste image");
              }
            };
            reader.onerror = () => {
              console.error("Failed to read clipboard image:", reader.error);
              toast.error("Failed to read clipboard image");
            };
            reader.readAsDataURL(blob);
            return true; // Handled
          }
        }

        const payload: ClipboardPayload = {
          markdown: clipboardData.getData("text/markdown"),
          html: clipboardData.getData("text/html"),
          text: clipboardData.getData("text/plain"),
        };
        if (!payload.markdown && !payload.html && !payload.text) return false;

        void insertClipboardPayload(payload);
        return true;
      },
    },
    onCreate: ({ editor: editorInstance }) => {
      editorRef.current = editorInstance;
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (isLoadingRef.current) return;
      const markdown = getMarkdown(updatedEditor);
      const recorded =
        documentSessionRef.current?.recordVisualEdit(markdown) ?? false;
      if (recorded) {
        scheduleSave();
      }
    },
    onSelectionUpdate: () => {
      // Trigger re-render to update toolbar active states without flushSync in lifecycle
      queueMicrotask(() => {
        setSelectionKey((k) => k + 1);
      });
    },
    // Prevent flash of unstyled content during initial render
    immediatelyRender: false,
  });

  // Track which note's content is currently loaded in the editor
  const loadedNoteIdRef = useRef<string | null>(null);
  // Track the modified timestamp of the loaded content
  const loadedModifiedRef = useRef<number | null>(null);
  // Track the last save (note ID and content) to detect our own saves vs external changes
  const lastSaveRef = useRef<{ noteId: string; content: string } | null>(null);
  // Track reloadVersion to detect manual refreshes
  const lastReloadVersionRef = useRef(0);

  // Word & Character count stats
  const getStats = () => {
    let rawText = "";
    if (sourceMode) {
      rawText = sourceContent || "";
    } else if (editor) {
      rawText = editor.state.doc.textContent || "";
    }
    
    // Clean text from comments
    const { cleanContent } = extractComments(rawText);
    const trimmed = cleanContent.trim();
    
    const chars = trimmed.length;
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const readingTime = Math.max(1, Math.ceil(words / 200));
    
    return { words, chars, readingTime };
  };

  const { words, chars, readingTime } = getStats();


  // Notify parent component when editor is ready
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // Sync notes list into editor storage for wikilink autocomplete
  useEffect(() => {
    if (!editor || !notes) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = (editor.storage as any).wikilink as
      | WikilinkStorage
      | undefined;
    if (storage) storage.notes = notes;
  }, [editor, notes]);

  // Search navigation functions (defined after editor is created)
  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0 || !editor) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    updateSearchDecorations(searchMatches, nextIndex, editor);
  }, [searchMatches, currentMatchIndex, editor, updateSearchDecorations]);

  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0 || !editor) return;
    const prevIndex =
      (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIndex);
    updateSearchDecorations(searchMatches, prevIndex, editor);
  }, [searchMatches, currentMatchIndex, editor, updateSearchDecorations]);

  // Handle search query change
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const replaceCurrent = useCallback((replaceText: string) => {
    if (!editor || !searchQuery.trim()) return;

    // Recompute from current doc state to avoid stale debounced matches.
    const currentMatches = findMatches(searchQuery, editor);
    if (currentMatches.length === 0) return;

    const safeIndex = Math.min(currentMatchIndex, currentMatches.length - 1);
    const match = currentMatches[safeIndex];
    if (!match) return;

    editor.view.dispatch(
      editor.state.tr.insertText(replaceText, match.from, match.to)
    );

    const newMatches = findMatches(searchQuery, editor);
    setSearchMatches(newMatches);

    if (newMatches.length > 0) {
      // Move to the first match after the replaced range.
      const nextPos = match.from + replaceText.length;
      const nextIndex = newMatches.findIndex((m) => m.from >= nextPos);
      const resolvedIndex = nextIndex === -1 ? 0 : nextIndex;
      setCurrentMatchIndex(resolvedIndex);
      updateSearchDecorations(newMatches, resolvedIndex, editor);
    } else {
      setCurrentMatchIndex(0);
      updateSearchDecorations([], 0, editor);
    }
  }, [editor, searchQuery, currentMatchIndex, findMatches, updateSearchDecorations]);

  const replaceAll = useCallback((replaceText: string) => {
    if (!editor || !searchQuery) return;
    const currentMatches = findMatches(searchQuery, editor);
    if (currentMatches.length === 0) return;

    const tr = editor.state.tr;
    for (let i = currentMatches.length - 1; i >= 0; i--) {
      const match = currentMatches[i];
      tr.insertText(replaceText, match.from, match.to);
    }
    editor.view.dispatch(tr);

    const newMatches = findMatches(searchQuery, editor);
    setSearchMatches(newMatches);
    setCurrentMatchIndex(0);
    updateSearchDecorations(newMatches, 0, editor);
  }, [editor, searchQuery, findMatches, updateSearchDecorations]);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      // Clear decorations when search is empty
      if (editor) {
        updateSearchDecorations([], 0, editor);
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!editor) return;
      const matches = findMatches(searchQuery, editor);
      setSearchMatches(matches);
      setCurrentMatchIndex(0);
      // Always update decorations (clears old highlights when no matches)
      updateSearchDecorations(matches, 0, editor);
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery, editor, findMatches, updateSearchDecorations]);

  // Handle clicks on wikilinks and external links
  useEffect(() => {
    if (!editor) return;

    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check for wikilink click first (no modifier key required)
      const wikilinkEl = target.closest("[data-wikilink]");
      if (wikilinkEl) {
        e.preventDefault();
        const noteTitle = wikilinkEl.getAttribute("data-note-title");
        const currentNotes = notesRef.current;
        if (noteTitle && currentNotes) {
          const note = currentNotes.find(
            (n) => n.title.toLowerCase() === noteTitle.toLowerCase(),
          );
          if (note) {
            notesCtxRef.current?.selectNote(note.id);
          } else {
            toast.info(`Note "${noteTitle}" does not exist yet`);
          }
        }
        return;
      }

      // Prevent links from opening unless Cmd/Ctrl+Click
      const link = target.closest("a");
      if (link) {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && link.href) {
          // Use raw href attribute and normalize to handle protocol-less URLs
          const rawHref = link.getAttribute("href") ?? "";
          const normalizedHref = normalizeUrl(rawHref);
          if (isAllowedUrlScheme(normalizedHref)) {
            openUrl(normalizedHref).catch((error) =>
              console.error("Failed to open link:", error),
            );
          } else {
            toast.error("Cannot open links with this URL scheme");
          }
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("click", handleEditorClick);

    return () => {
      editorElement.removeEventListener("click", handleEditorClick);
    };
  }, [editor]);

  // Load note content when the current note changes
  useEffect(() => {
    // Skip if no note or editor
    if (!currentNote || !editor) {
      return;
    }

    const isSameNote = currentNote.id === loadedNoteIdRef.current;

    // Detect rename BEFORE flush to prevent stale-ID saves from creating duplicates.
    // When a save renames the file (title changed), the ID changes but we're still
    // editing the same note. Update loadedNoteIdRef first so any flush uses the new ID.
    if (!isSameNote) {
      const lastSave = lastSaveRef.current;
      if (
        lastSave?.noteId === loadedNoteIdRef.current &&
        lastSave?.content === currentNote.content
      ) {
        loadedNoteIdRef.current = currentNote.id;
        loadedModifiedRef.current = currentNote.modified;
        lastSaveRef.current = null;
        // If user typed during the rename, flush with the now-correct ID
        if (documentSessionRef.current?.isDirty) {
          void flushPendingSave();
        }
        return;
      }
    }

    // Flush any pending save before switching to a different note
    if (!isSameNote && documentSessionRef.current?.isDirty) {
      void flushPendingSave();
    }
    // Reset source mode when genuinely switching notes (renames return early above)
    if (!isSameNote) {
      setSourceMode(false);
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
        sourceTimeoutRef.current = null;
      }
    }
    // Check if this is a manual reload (user clicked Refresh button or pressed Cmd+R)
    const isManualReload = reloadVersion !== lastReloadVersionRef.current;

    if (isSameNote) {
      if (isManualReload) {
        // Manual reload - update the editor content
        lastReloadVersionRef.current = reloadVersion;
        loadedModifiedRef.current = currentNote.modified;
        documentSessionRef.current?.hydrate(currentNote.snapshot);
        documentSessionRef.current?.setPreserveSourceFormatting(
          preserveSourceFormatting,
        );
        setSourceContent(toSourceEditorText(currentNote.content));
        if (preserveSourceFormatting) {
          documentSessionRef.current?.setMode("source");
          setSourceMode(true);
        }
        isLoadingRef.current = true;
        const manager = editor.storage.markdown?.manager;
        if (manager) {
          try {
            const parsed = parseMarkdownPreservingContent(
              manager,
              currentNote.content,
            );
            documentSessionRef.current?.runProgrammatic(() => {
              editor.commands.setContent(parsed);
            });
          } catch (error) {
            setSourceMode(true);
            toast.error(
              `Visual conversion was blocked to protect the source: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        isLoadingRef.current = false;
        return;
      }
      // Just a save - update refs but don't reload content
      loadedModifiedRef.current = currentNote.modified;
      const session = documentSessionRef.current;
      if (
        session &&
        session.currentSnapshot.hash !== currentNote.snapshot.hash
      ) {
        session.rebaseSnapshot(currentNote.snapshot);
        setIsUnsaved(session.isDirty);
      }
      return;
    }

    const isNewNote = loadedNoteIdRef.current === null;
    const wasEmpty = !isNewNote && currentNote.content?.trim() === "";
    const loadingNoteId = currentNote.id;

    loadedNoteIdRef.current = loadingNoteId;
    loadedModifiedRef.current = currentNote.modified;
    documentSessionRef.current = new DocumentSession(currentNote.snapshot);
    documentSessionRef.current.setPreserveSourceFormatting(
      preserveSourceFormatting,
    );
    setSourceContent(toSourceEditorText(currentNote.content));
    if (preserveSourceFormatting) {
      documentSessionRef.current.setMode("source");
      setSourceMode(true);
    }

    isLoadingRef.current = true;

    // Blur editor before setting content to prevent ghost cursor
    editor.commands.blur();

    // Parse markdown and set content
    const manager = editor.storage.markdown?.manager;
    if (manager) {
      try {
        const parsed = parseMarkdownPreservingContent(
          manager,
          currentNote.content,
        );
        documentSessionRef.current.runProgrammatic(() => {
          editor.commands.setContent(parsed);
        });
      } catch (error) {
        setSourceMode(true);
        toast.error(
          `Visual conversion was blocked to protect the source: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Scroll to top after content is set (must be after setContent to work reliably)
    scrollContainerRef.current?.scrollTo(0, 0);

    // Capture note ID to check in RAF callback - prevents race condition
    // if user switches notes quickly before RAF fires
    requestAnimationFrame(() => {
      // Bail if a different note started loading
      if (loadedNoteIdRef.current !== loadingNoteId) {
        return;
      }

      // Scroll again in RAF to ensure it takes effect after DOM updates
      scrollContainerRef.current?.scrollTo(0, 0);

      isLoadingRef.current = false;

      if (consumePendingNewNote?.(loadingNoteId)) {
        if (!focusAndSelectTitle(editor)) {
          editor.commands.focus("start");
        }
        return;
      }

      // For brand new empty notes, focus and select all so user can start typing
      // Skip if the note list has focus (e.g. keyboard navigation with arrow keys)
      if ((isNewNote || wasEmpty) && currentNote.content.trim() === "") {
        const noteListFocused =
          document.activeElement?.closest("[data-note-list]");
        if (!noteListFocused) {
          editor.commands.focus("start");
          editor.commands.selectAll();
        }
      }
      // For existing notes, don't auto-focus - let user click where they want
    });
  }, [
    currentNote,
    editor,
    flushPendingSave,
    reloadVersion,
    consumePendingNewNote,
    preserveSourceFormatting,
  ]);

  // Scroll to top on mount (e.g., when returning from settings)
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, []);

  // Cleanup on unmount - flush pending saves
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
      }
      if (documentSessionRef.current?.isDirty && loadedNoteIdRef.current) {
        needsSaveRef.current = false;
        void saveImmediatelyRef.current(
          loadedNoteIdRef.current,
          "autosave",
        );
      }
      if (linkPopupRef.current) {
        linkPopupRef.current.destroy();
      }
      if (blockMathPopupRef.current) {
        blockMathPopupRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run cleanup on unmount, not when saveNote changes

  // Link handlers - show inline popup at cursor position
  const handleAddLink = useCallback(() => {
    if (!editor) return;

    // Close block math popup if open (popups are mutually exclusive)
    closeBlockMathPopup();

    // Destroy existing popup if any
    if (linkPopupRef.current) {
      linkPopupRef.current.destroy();
      linkPopupRef.current = null;
    }

    // Get existing link URL if cursor is on a link
    const existingUrl = editor.getAttributes("link").href || "";

    // Get selection bounds for popup placement using DOM Range for accurate multi-line support
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    // Create a virtual element at the selection for tippy to anchor to
    const virtualElement = {
      getBoundingClientRect: () => {
        // For selections with text, use DOM Range for accurate bounds
        if (hasSelection) {
          const startPos = editor.view.domAtPos(from);
          const endPos = editor.view.domAtPos(to);

          if (startPos && endPos) {
            try {
              const range = document.createRange();
              range.setStart(startPos.node, startPos.offset);
              range.setEnd(endPos.node, endPos.offset);
              return range.getBoundingClientRect();
            } catch (e) {
              // Fallback if range creation fails
              console.error("Range creation failed:", e);
            }
          }
        }

        // For collapsed cursor, use coordsAtPos with proper viewport positioning
        const coords = editor.view.coordsAtPos(from);

        // Create a DOMRect-like object with proper positioning
        return {
          width: 2,
          height: 20,
          top: coords.top,
          left: coords.left,
          right: coords.right,
          bottom: coords.bottom,
          x: coords.left,
          y: coords.top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    };

    // Create the link editor component
    const component = new ReactRenderer(LinkEditor, {
      props: {
        initialUrl: existingUrl,
        // Only show text input if there's no selection AND not editing an existing link
        initialText: hasSelection || existingUrl ? undefined : "",
        onSubmit: (url: string, text?: string) => {
          const normalizedUrl = normalizeUrl(url);
          if (normalizedUrl) {
            if (text !== undefined) {
              // No selection case - insert new link with text
              if (text.trim()) {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: text.trim(),
                    marks: [{ type: "link", attrs: { href: normalizedUrl } }],
                  })
                  .run();
              }
            } else {
              // Has selection - apply link to selection
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: normalizedUrl })
                .run();
            }
          } else {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          }
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
        onRemove: () => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
        onCancel: () => {
          editor.commands.focus();
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
      },
      editor,
    });

    // Create tippy popup
    linkPopupRef.current = tippy(document.body, {
      getReferenceClientRect: () =>
        virtualElement.getBoundingClientRect() as DOMRect,
      appendTo: () => document.body,
      content: component.element,
      showOnCreate: true,
      interactive: true,
      trigger: "manual",
      placement: "bottom-start",
      offset: [0, 8],
      onDestroy: () => {
        component.destroy();
      },
    });
  }, [editor, closeBlockMathPopup]);

  const scheduleSourceSave = useCallback(() => {
    setIsUnsaved(true);
    if (sourceTimeoutRef.current) {
      clearTimeout(sourceTimeoutRef.current);
    }
    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;
    sourceTimeoutRef.current = window.setTimeout(async () => {
      if (currentNoteIdRef.current !== savingNoteId) return;
      await saveImmediately(savingNoteId, "autosave");
    }, 300);
  }, [currentNote, saveImmediately]);

  // Textareas expose logical LF line endings. The session maps each user edit
  // back onto the lossless source snapshot so untouched CRLF/CR bytes survive.
  const handleSourceChange = useCallback(
    (value: string) => {
      setSourceContent(value);
      if (!documentSessionRef.current?.recordSourceEditorEdit(value)) return;
      scheduleSourceSave();
    },
    [scheduleSourceSave],
  );

  const insertExactSourceText = useCallback(
    (textarea: HTMLTextAreaElement, delivered: string) => {
      const session = documentSessionRef.current;
      if (!session) return false;
      const insertion = session.insertExactSourceText(
        textarea.selectionStart,
        textarea.selectionEnd,
        delivered,
      );
      setSourceContent(insertion.editorContent);
      if (insertion.changed) scheduleSourceSave();
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(insertion.cursor, insertion.cursor);
      });
      return insertion.changed;
    },
    [scheduleSourceSave],
  );

  // Automatic list continuation and indentation support for source mode editor
  const handleSourceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const { selectionStart, selectionEnd, value } = textarea;

      // 1. Tab / Shift+Tab for Indentation / Outdentation
      if (e.key === "Tab") {
        e.preventDefault();
        if (selectionStart !== selectionEnd) {
          const startLineIdx = value.lastIndexOf("\n", selectionStart - 1) + 1;
          const endLineIdx = value.indexOf("\n", selectionEnd);
          const effectiveEndLine = endLineIdx === -1 ? value.length : endLineIdx;
          const selectedBlock = value.substring(startLineIdx, effectiveEndLine);
          const lines = selectedBlock.split("\n");

          let newLines: string[];
          if (e.shiftKey) {
            newLines = lines.map((l) => l.replace(/^(  |\t)/, ""));
          } else {
            newLines = lines.map((l) => `  ${l}`);
          }
          const newBlock = newLines.join("\n");
          const newValue =
            value.substring(0, startLineIdx) + newBlock + value.substring(effectiveEndLine);
          handleSourceChange(newValue);

          setTimeout(() => {
            textarea.selectionStart = startLineIdx;
            textarea.selectionEnd = startLineIdx + newBlock.length;
          }, 0);
        } else {
          if (e.shiftKey) {
            const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
            const lineContent = value.substring(lineStart, selectionStart);
            if (lineContent.startsWith("  ")) {
              const newValue = value.substring(0, lineStart) + value.substring(lineStart + 2);
              handleSourceChange(newValue);
              setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = Math.max(
                  lineStart,
                  selectionStart - 2,
                );
              }, 0);
            } else if (lineContent.startsWith("\t")) {
              const newValue = value.substring(0, lineStart) + value.substring(lineStart + 1);
              handleSourceChange(newValue);
              setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = Math.max(
                  lineStart,
                  selectionStart - 1,
                );
              }, 0);
            }
          } else {
            const newValue =
              value.substring(0, selectionStart) + "  " + value.substring(selectionEnd);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
            }, 0);
          }
        }
        return;
      }

      // 2. Enter key: auto-continue lists (unordered, ordered, tasks, blockquotes) & indentation
      if (e.key === "Enter" && !e.shiftKey && selectionStart === selectionEnd) {
        const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
        const currentLine = value.substring(lineStart, selectionStart);

        // Task list: e.g. "  - [ ] ", "  * [x] "
        const taskMatch = currentLine.match(/^(\s*)([-*+])\s+\[([ xX])\]\s*(.*)$/);
        // Ordered list: e.g. "  1. "
        const orderedMatch = !taskMatch && currentLine.match(/^(\s*)(\d+)\.\s*(.*)$/);
        // Unordered list or blockquote: e.g. "  - ", "  * ", "  > "
        const bulletMatch =
          !taskMatch && !orderedMatch && currentLine.match(/^(\s*)([-*+>]|\d+\.)\s*(.*)$/);

        if (taskMatch) {
          const [, indent, bullet, , rest] = taskMatch;
          if (!rest.trim()) {
            e.preventDefault();
            const newValue = value.substring(0, lineStart) + value.substring(selectionStart);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = lineStart;
            }, 0);
          } else {
            e.preventDefault();
            const prefix = `\n${indent}${bullet} [ ] `;
            const newValue =
              value.substring(0, selectionStart) + prefix + value.substring(selectionEnd);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = selectionStart + prefix.length;
            }, 0);
          }
          return;
        }

        if (orderedMatch) {
          const [, indent, numStr, rest] = orderedMatch;
          if (!rest.trim()) {
            e.preventDefault();
            const newValue = value.substring(0, lineStart) + value.substring(selectionStart);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = lineStart;
            }, 0);
          } else {
            e.preventDefault();
            const nextNum = parseInt(numStr, 10) + 1;
            const prefix = `\n${indent}${nextNum}. `;
            const newValue =
              value.substring(0, selectionStart) + prefix + value.substring(selectionEnd);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = selectionStart + prefix.length;
            }, 0);
          }
          return;
        }

        if (bulletMatch) {
          const [, indent, marker, rest] = bulletMatch;
          if (!rest.trim()) {
            e.preventDefault();
            const newValue = value.substring(0, lineStart) + value.substring(selectionStart);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = lineStart;
            }, 0);
          } else {
            e.preventDefault();
            const prefix = `\n${indent}${marker} `;
            const newValue =
              value.substring(0, selectionStart) + prefix + value.substring(selectionEnd);
            handleSourceChange(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = selectionStart + prefix.length;
            }, 0);
          }
          return;
        }

        // Preserve plain leading whitespace indentation
        const plainIndentMatch = currentLine.match(/^(\s+)(.*)$/);
        if (plainIndentMatch && plainIndentMatch[2].trim()) {
          e.preventDefault();
          const indent = plainIndentMatch[1];
          const prefix = `\n${indent}`;
          const newValue =
            value.substring(0, selectionStart) + prefix + value.substring(selectionEnd);
          handleSourceChange(newValue);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = selectionStart + prefix.length;
          }, 0);
          return;
        }
      }
    },
    [handleSourceChange],
  );

  // Helper to insert image src into editor or source textarea
  const insertImageIntoDoc = useCallback((src: string, altText: string = "Image") => {
    if (sourceMode) {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const mdImage = `![${altText}](${src})`;
        const newVal = val.substring(0, start) + mdImage + val.substring(end);
        handleSourceChange(newVal);
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + mdImage.length, start + mdImage.length);
        }, 0);
      }
    } else if (editor) {
      editor.chain().focus().setImage({ src, alt: altText }).run();
    }
  }, [editor, sourceMode, handleSourceChange]);

  // Fallback HTML file picker for web preview or when native dialog returns non-image path
  const handleFallbackFileInput = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const result = reader.result as string;
        if (!result) return;

        let finalSrc = result;
        const altName = file.name.replace(/\.[^/.]+$/, "");

        try {
          const base64Data = result.split(",")[1];
          if (base64Data) {
            const ext = file.name.split(".").pop() || "png";
            const relativePath = await invoke<string>("save_clipboard_image", {
              base64Data,
              extension: ext,
            });
            if (relativePath) {
              const notesFolder = await invoke<string>("get_notes_folder");
              const absolutePath = await join(notesFolder, relativePath);
              finalSrc = convertFileSrc(absolutePath);
            }
          }
        } catch {
          // If backend save unavailable (web mode), data URL works directly
        }

        insertImageIntoDoc(finalSrc, altName);
        toast.success("Image inserted");
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [insertImageIntoDoc]);

  // Image handler
  const handleAddImage = useCallback(async () => {
    if (!editor && !sourceMode) return;

    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        const isImageExt = /\.(png|jpe?g|gif|webp|svg)$/i.test(selected);

        if (isImageExt) {
          try {
            // Copy image to assets folder and get relative path (assets/filename.ext)
            const relativePath = await invoke<string>("copy_image_to_assets", {
              sourcePath: selected,
            });

            // Get notes folder and construct absolute path using Tauri's join
            const notesFolder = await invoke<string>("get_notes_folder");
            const absolutePath = await join(notesFolder, relativePath);

            // Convert to Tauri asset URL
            const assetUrl = convertFileSrc(absolutePath);
            const fileName = selected.split(/[/\\]/).pop() || "Image";

            insertImageIntoDoc(assetUrl, fileName);
            toast.success("Image inserted");
            return;
          } catch (error) {
            console.error("Failed to copy image to assets:", error);
          }
        }
      }

      // If openDialog returned null/mock path or non-image extension, trigger browser file input fallback
      if (!selected || typeof selected !== "string" || !/\.(png|jpe?g|gif|webp|svg)$/i.test(selected)) {
        handleFallbackFileInput();
      }
    } catch (error) {
      console.error("Native dialog error, triggering fallback file picker:", error);
      handleFallbackFileInput();
    }
  }, [editor, sourceMode, insertImageIntoDoc, handleFallbackFileInput]);

  // Footnote insertion handler
  const handleAddFootnote = useCallback(async () => {
    if (!currentNote) return;
    const noteId = currentNote.id;
    const currentFootnotes = footnotesMap[noteId] || [];

    // Auto-calculate next footnote label/number
    let nextNum = 1;
    currentFootnotes.forEach((f) => {
      const num = parseInt(f.id, 10);
      if (!isNaN(num) && num >= nextNum) {
        nextNum = num + 1;
      }
    });
    const nextLabel = String(nextNum);

    // Register empty footnote text in context/disk
    if (addFootnote) {
      await addFootnote(noteId, nextLabel, "");
    }

    if (sourceMode) {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const before = text.substring(0, start);
        const after = text.substring(end);
        const insertText = `[^${nextLabel}]`;
        const newContent = before + insertText + after;

        handleSourceChange(newContent);

        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + insertText.length, start + insertText.length);
        }, 0);
      }
    } else {
      if (editor) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "footnoteReference",
            attrs: { label: nextLabel },
          })
          .run();
      }
    }
  }, [
    currentNote,
    footnotesMap,
    addFootnote,
    sourceMode,
    editor,
    handleSourceChange,
  ]);

  // Insert current date handler
  const handleInsertCurrentDate = useCallback(() => {
    const formattedDate = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    if (sourceMode) {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const newVal = val.substring(0, start) + formattedDate + val.substring(end);
        handleSourceChange(newVal);
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + formattedDate.length, start + formattedDate.length);
        }, 0);
      }
    } else if (editor) {
      editor.chain().focus().insertContent(formattedDate).run();
    }
  }, [editor, sourceMode, handleSourceChange]);

  // Listen for insert current date events
  useEffect(() => {
    const handler = () => handleInsertCurrentDate();
    window.addEventListener("insert-current-date", handler);
    return () => window.removeEventListener("insert-current-date", handler);
  }, [handleInsertCurrentDate]);

  // Toggle Lowercase / Uppercase handler
  const handleToggleCase = useCallback(() => {
    if (sourceMode) {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        let start = textarea.selectionStart;
        let end = textarea.selectionEnd;
        const val = textarea.value;

        if (start === end) {
          // Expand selection to word at cursor
          let wStart = start;
          let wEnd = start;
          while (wStart > 0 && /[\w\u00C0-\u024F]/.test(val[wStart - 1])) wStart--;
          while (wEnd < val.length && /[\w\u00C0-\u024F]/.test(val[wEnd])) wEnd++;
          if (wStart < wEnd) {
            start = wStart;
            end = wEnd;
          }
        }

        if (start !== end) {
          const selectedText = val.substring(start, end);
          const isUpper = selectedText === selectedText.toUpperCase();
          const transformed = isUpper ? selectedText.toLowerCase() : selectedText.toUpperCase();
          const newVal = val.substring(0, start) + transformed + val.substring(end);
          handleSourceChange(newVal);
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start, start + transformed.length);
          }, 0);
        }
      }
    } else if (editor) {
      const { from, to } = editor.state.selection;
      let rangeFrom = from;
      let rangeTo = to;

      if (from === to) {
        // Expand selection to word at cursor
        const $pos = editor.state.doc.resolve(from);
        const parent = $pos.parent;
        const parentStart = $pos.start();
        const offsetInParent = $pos.parentOffset;
        const parentText = parent.textContent;

        let wStart = offsetInParent;
        let wEnd = offsetInParent;
        while (wStart > 0 && /[\w\u00C0-\u024F]/.test(parentText[wStart - 1])) wStart--;
        while (wEnd < parentText.length && /[\w\u00C0-\u024F]/.test(parentText[wEnd])) wEnd++;

        if (wStart < wEnd) {
          rangeFrom = parentStart + wStart;
          rangeTo = parentStart + wEnd;
        }
      }

      if (rangeFrom !== rangeTo) {
        const selectedText = editor.state.doc.textBetween(rangeFrom, rangeTo, " ");
        if (selectedText) {
          const isUpper = selectedText === selectedText.toUpperCase();
          const transformed = isUpper ? selectedText.toLowerCase() : selectedText.toUpperCase();
          editor.chain().focus().insertContentAt({ from: rangeFrom, to: rangeTo }, transformed).run();
        }
      }
    }
  }, [editor, sourceMode, handleSourceChange]);

  // Listen for toggle-case custom event
  useEffect(() => {
    const handler = () => handleToggleCase();
    window.addEventListener("toggle-case", handler);
    return () => window.removeEventListener("toggle-case", handler);
  }, [handleToggleCase]);

  // Keyboard shortcut for Cmd+Alt+F to add footnote
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "f") {
        const target = e.target as HTMLElement;
        const isInEditor = target.closest(".ProseMirror") || target.tagName === "TEXTAREA";
        if (isInEditor) {
          e.preventDefault();
          handleAddFootnote();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleAddFootnote]);

  // Listen for insert footnote events from sidebar or other panels
  useEffect(() => {
    const handler = () => {
      handleAddFootnote();
    };
    window.addEventListener("editor:insert-footnote", handler);
    return () => window.removeEventListener("editor:insert-footnote", handler);
  }, [handleAddFootnote]);

  // Listen for slash command image insertion
  useEffect(() => {
    const handler = () => handleAddImage();
    window.addEventListener("slash-command-image", handler);
    return () => window.removeEventListener("slash-command-image", handler);
  }, [handleAddImage]);

  // Listen for slash command block math insertion
  useEffect(() => {
    const handler = () => handleAddBlockMath();
    window.addEventListener("slash-command-block-math", handler);
    return () =>
      window.removeEventListener("slash-command-block-math", handler);
  }, [handleAddBlockMath]);

  // Keyboard shortcut for Cmd+K to add link (only when editor is focused)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Only handle if we're in the editor
        const target = e.target as HTMLElement;
        const isInEditor = target.closest(".ProseMirror");
        if (isInEditor && editor) {
          e.preventDefault();
          handleAddLink();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleAddLink, editor]);

  // Keyboard shortcut for Cmd+Shift+C to open copy menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
        e.preventDefault();
        setCopyMenuOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Open and focus editor search (supports repeated Cmd/Ctrl+F)
  const openEditorSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  // Cmd/Ctrl+F to open search, ⌥⌘F (macOS) / Ctrl+H to open replace
  // (works when document/editor area is focused)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const openFind =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "f";
      // Cmd+H is reserved by macOS (Hide), so replace uses the platform
      // convention: ⌥⌘F on macOS, Ctrl+H elsewhere. e.code is checked on
      // macOS because ⌥ changes e.key to a special character ("ƒ").
      const openReplace = isMac
        ? e.metaKey && e.altKey && !e.shiftKey && e.code === "KeyF"
        : e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h";
      if (openFind || openReplace) {
        if (!currentNote || !editor) return;

        const target = e.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        // Don't intercept if user is in an input/textarea (except the editor itself or search toolbar)
        if (
          (tagName === "input" || tagName === "textarea") &&
          !target.closest(".ProseMirror") &&
          !target.closest(".search-toolbar-container")
        ) {
          return;
        }

        // Don't intercept if in sidebar
        if (target.closest('[class*="sidebar"]')) {
          return;
        }

        // Open search for the editor
        e.preventDefault();
        if (openReplace) {
          setIsReplaceOpen(true);
        }
        openEditorSearch();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, currentNote, openEditorSearch]);

  // Clear search on note switch
  useEffect(() => {
    if (currentNote?.id) {
      setSearchOpen(false);
      setSearchQuery("");
      setReplaceQuery("");
      setIsReplaceOpen(false);
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      // Clear decorations
      if (editor) {
        updateSearchDecorations([], 0, editor);
      }
    }
  }, [currentNote?.id, editor, updateSearchDecorations]);

  // Copy handlers
  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;
    try {
      const markdown = getMarkdown(editor);
      await invoke("copy_to_clipboard", { text: markdown });
      toast.success("Copied as Markdown");
    } catch (error) {
      console.error("Failed to copy markdown:", error);
      toast.error("Failed to copy");
    }
  }, [editor, getMarkdown]);

  const handleCopyPlainText = useCallback(async () => {
    if (!editor) return;
    try {
      const markdown = getMarkdown(editor);
      const plainText = plainTextFromMarkdown(markdown);
      await invoke("copy_to_clipboard", { text: plainText });
      toast.success("Copied as plain text");
    } catch (error) {
      console.error("Failed to copy plain text:", error);
      toast.error("Failed to copy");
    }
  }, [editor, getMarkdown]);

  const handleCopyHtml = useCallback(async () => {
    if (!editor) return;
    try {
      const html = editor.getHTML();
      await invoke("copy_to_clipboard", { text: html });
      toast.success("Copied as HTML");
    } catch (error) {
      console.error("Failed to copy HTML:", error);
      toast.error("Failed to copy");
    }
  }, [editor]);

  // Download handlers
  const handleDownloadPdf = useCallback(async () => {
    if (!editor || !currentNote) return;
    try {
      await downloadPdf(editor, currentNote.title);
    } catch (error) {
      console.error("Failed to open print dialog:", error);
      toast.error("Failed to open print dialog");
    }
  }, [editor, currentNote]);

  // Listen for Cmd+P print shortcut
  useEffect(() => {
    const handler = () => handleDownloadPdf();
    window.addEventListener("print-note", handler);
    return () => window.removeEventListener("print-note", handler);
  }, [handleDownloadPdf]);

  const handleDownloadMarkdown = useCallback(async () => {
    if (!editor || !currentNote) return;
    try {
      const markdown = getMarkdown(editor);
      const saved = await downloadMarkdown(markdown, currentNote.title);
      if (saved) {
        toast.success("Markdown saved successfully");
      }
    } catch (error) {
      console.error("Failed to download markdown:", error);
      toast.error("Failed to save markdown");
    }
  }, [editor, currentNote, getMarkdown]);

  // Toggle source mode — computes anchor data and toggles state;
  // focus/scroll restoration happens in the useLayoutEffect below.
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    const container = scrollContainerRef.current;

    if (!sourceMode) {
      // === Entering source mode (TipTap → textarea) ===
      const session = documentSessionRef.current;
      const rawMarkdown =
        session && !session.isDirty
          ? session.currentSourceContent
          : getMarkdown(editor);
      const md = toSourceEditorText(rawMarkdown);

      // Find which top-level block is at the viewport top
      let topBlockIndex = 0;
      if (container) {
        const rect = container.getBoundingClientRect();
        try {
          const topPos = editor.view.posAtCoords({
            left: rect.left + rect.width / 2,
            top: rect.top + 10,
          });
          if (topPos) {
            const resolved = editor.state.doc.resolve(
              Math.min(topPos.pos, editor.state.doc.content.size),
            );
            topBlockIndex = resolved.index(0);
          }
        } catch {
          // posAtCoords can fail at edges
        }
      }

      // Find which block the cursor is in
      let cursorBlockIndex = 0;
      try {
        const { from } = editor.state.selection;
        const resolved = editor.state.doc.resolve(
          Math.min(from, editor.state.doc.content.size),
        );
        cursorBlockIndex = resolved.index(0);
      } catch {
        // resolve can fail at edges
      }

      sourceModeTransitionRef.current = { topBlockIndex, cursorBlockIndex, md };
      setSourceContent(md);
      if (session?.isDirty) {
        session.runProgrammatic(() => session.recordSourceEditorEdit(md));
      }
      session?.setMode("source");
      setSourceMode(true);
    } else {
      if (preserveSourceFormatting) {
        toast.info(
          "Source formatting is protected. Disable preservation to use the visual editor.",
        );
        return;
      }
      // === Exiting source mode (textarea → TipTap) ===
      const textarea = container?.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;

      // Find which block is at the top of the textarea and which has the cursor
      let topBlockIndex = 0;
      let cursorBlockIndex = 0;
      if (textarea) {
        const blockOffsets = getMarkdownBlockOffsets(sourceContent);
        const lineHeight =
          parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        const topLine = Math.floor(textarea.scrollTop / lineHeight);
        const lines = sourceContent.split("\n");
        let charOffset = 0;
        for (let i = 0; i < Math.min(topLine, lines.length); i++) {
          charOffset += lines[i].length + 1;
        }
        for (let i = 0; i < blockOffsets.length; i++) {
          if (blockOffsets[i] <= charOffset) topBlockIndex = i;
          if (blockOffsets[i] <= textarea.selectionStart) cursorBlockIndex = i;
        }
      }

      sourceModeTransitionRef.current = { topBlockIndex, cursorBlockIndex };

      // Parse and set content
      const manager = editor.storage.markdown?.manager;
      if (manager) {
        try {
          const parsed = parseMarkdownPreservingContent(manager, sourceContent);
          documentSessionRef.current?.runProgrammatic(() => {
            editor.commands.setContent(parsed);
          });
        } catch (error) {
          toast.error(
            `Visual conversion was blocked to protect the source: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return;
        }
      }
      documentSessionRef.current?.setMode("visual");
      setSourceMode(false);
    }
  }, [
    editor,
    sourceMode,
    sourceContent,
    getMarkdown,
    preserveSourceFormatting,
  ]);

  // Restore focus and scroll position after source mode transitions.
  // useLayoutEffect runs synchronously after React commits DOM changes,
  // guaranteeing the new textarea / EditorContent is mounted.
  useLayoutEffect(() => {
    let rafId: number | undefined;
    const transition = sourceModeTransitionRef.current;
    if (!transition) {
      return () => {};
    }
    sourceModeTransitionRef.current = null;

    const container = scrollContainerRef.current;

    if (sourceMode) {
      // Just entered source mode — focus textarea and scroll to anchor block
      const textarea = container?.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      if (!textarea) return () => {};

      const md = transition.md || "";

      // Place cursor at the start of the same block in markdown
      const blockOffsets = getMarkdownBlockOffsets(md);
      const cursorPos =
        transition.cursorBlockIndex < blockOffsets.length
          ? blockOffsets[transition.cursorBlockIndex]
          : md.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
      textarea.focus();

      if (transition.topBlockIndex < blockOffsets.length) {
        const charOffset = blockOffsets[transition.topBlockIndex];
        const linesBefore = md.slice(0, charOffset).split("\n").length - 1;
        const lineHeight =
          parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        textarea.scrollTop = linesBefore * lineHeight;
      }
    } else if (editor) {
      // Just exited source mode — focus editor and scroll to anchor block.
      // Use rAF because EditorContent reattaches the ProseMirror view in
      // its own useEffect, which hasn't run yet during useLayoutEffect.
      rafId = requestAnimationFrame(() => {
        if (!editor.view?.dom?.isConnected) return;
        const doc = editor.state.doc;
        editor.commands.focus(
          blockIndexToPos(doc, transition.cursorBlockIndex),
        );

        // Scroll to anchor block
        const el = scrollContainerRef.current;
        if (el) {
          try {
            el.scrollTop = 0;
            const coords = editor.view.coordsAtPos(
              blockIndexToPos(doc, transition.topBlockIndex),
            );
            const containerRect = el.getBoundingClientRect();
            el.scrollTop = coords.top - containerRect.top;
          } catch {
            // coordsAtPos can fail if view isn't fully rendered
          }
        }
      });
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [sourceMode, editor]);

  // Listen for toggle-source-mode custom event (from App.tsx shortcut / command palette)
  useEffect(() => {
    const handler = () => toggleSourceMode();
    window.addEventListener("toggle-source-mode", handler);
    return () => window.removeEventListener("toggle-source-mode", handler);
  }, [toggleSourceMode]);

  // Custom Right-Click Context Menu Handler
  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    let selectedText = "";
    let hasSelection = false;

    if (sourceMode) {
      const textarea = (e.currentTarget.querySelector("textarea") as HTMLTextAreaElement | null) || (e.target as HTMLTextAreaElement);
      if (textarea && typeof textarea.selectionStart === "number") {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start !== end) {
          selectedText = textarea.value.substring(start, end).trim();
          hasSelection = true;
        }
      }
    } else if (editor) {
      const { state } = editor;
      const { selection } = state;
      if (!selection.empty) {
        selectedText = state.doc.textBetween(selection.from, selection.to, " ").trim();
        hasSelection = true;
      }
    }

    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 230;
    const menuHeight = 260;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 12);

    setEditorContextMenu({
      x: Math.max(12, x),
      y: Math.max(12, y),
      selectedText,
      hasSelection,
      isHighlighted: !sourceMode && editor ? editor.isActive("highlight") : false,
    });
  }, [editor, sourceMode]);

  const handleContextHighlight = useCallback((color?: string) => {
    if (sourceMode) {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const highlightColor = color || "#fef08a";

      if (start !== end) {
        const sel = val.substring(start, end);
        const wrapped = `<mark style="background-color: ${highlightColor}">${sel}</mark>`;
        const newVal = val.substring(0, start) + wrapped + val.substring(end);
        handleSourceChange(newVal);
      } else {
        const wrapped = `<mark style="background-color: ${highlightColor}">highlight</mark>`;
        const newVal = val.substring(0, start) + wrapped + val.substring(start);
        handleSourceChange(newVal);
      }
    } else if (editor) {
      if (color) {
        editor.chain().focus().setHighlight({ color }).run();
      } else {
        editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run();
      }
    }
  }, [editor, sourceMode, handleSourceChange]);

  const handleContextCopy = useCallback(async (selectedTextParam?: string) => {
    let textToCopy = selectedTextParam || editorContextMenu?.selectedText || "";

    if (!textToCopy) {
      if (sourceMode) {
        textToCopy = sourceContent;
      } else if (editor) {
        textToCopy = editor.state.doc.textContent;
      }
    }

    if (!textToCopy) {
      toast.info("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      toast.success("Copied to clipboard");
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy to clipboard");
    }
  }, [editorContextMenu, editor, sourceMode, sourceContent]);

  const handleContextCopyAsHtml = useCallback(
    async (selectedTextParam?: string) => {
      let htmlContent = "";
      let plainText = selectedTextParam || editorContextMenu?.selectedText || "";

      try {
        if (!sourceMode && editor && editorContextMenu?.hasSelection) {
          const { state } = editor;
          const fragment = state.selection.content().content;
          const tempDiv = document.createElement("div");
          tempDiv.appendChild(
            DOMSerializer.fromSchema(state.schema).serializeFragment(fragment)
          );
          htmlContent = tempDiv.innerHTML;
          if (!plainText) {
            plainText = state.doc.textBetween(
              state.selection.from,
              state.selection.to,
              " "
            );
          }
        }

        if (!htmlContent) {
          if (plainText) {
            htmlContent = await marked.parse(plainText);
          } else {
            if (!sourceMode && editor) {
              htmlContent = editor.getHTML();
              plainText = editor.state.doc.textContent;
            } else {
              plainText = sourceContent || currentNote?.content || "";
              htmlContent = await marked.parse(plainText);
            }
          }
        }

        if (!htmlContent) {
          toast.info("Nothing to copy");
          return;
        }

        try {
          const blobHtml = new Blob([htmlContent], { type: "text/html" });
          const blobText = new Blob([plainText || htmlContent], {
            type: "text/plain",
          });
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": blobHtml,
              "text/plain": blobText,
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(htmlContent);
        }

        toast.success(
          editorContextMenu?.hasSelection
            ? "Copied selection as HTML"
            : "Copied note as HTML"
        );
      } catch (err) {
        console.error("Failed to copy HTML:", err);
        toast.error("Failed to copy as HTML");
      }
    },
    [editorContextMenu, editor, sourceMode, sourceContent, currentNote]
  );

  const handleContextCut = useCallback(async () => {
    if (!editorContextMenu?.hasSelection) return;
    const textToCut = editorContextMenu.selectedText;

    try {
      await navigator.clipboard.writeText(textToCut);
      if (sourceMode) {
        const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const val = textarea.value;
          const newVal = val.substring(0, start) + val.substring(end);
          handleSourceChange(newVal);
        }
      } else if (editor) {
        editor.chain().focus().deleteSelection().run();
      }
      toast.success("Cut to clipboard");
    } catch (err) {
      console.error("Failed to cut:", err);
      toast.error("Failed to cut");
    }
  }, [editorContextMenu, editor, sourceMode, handleSourceChange]);

  const handleContextPaste = useCallback(
    async (exact = false) => {
      try {
        const payload = await readClipboardPayload(navigator.clipboard);
        if (!payload.markdown && !payload.html && !payload.text) {
          toast.info("Clipboard is empty");
          return;
        }

        if (!sourceMode) {
          await insertClipboardPayload(payload, exact);
        } else {
          const textarea = scrollContainerRef.current?.querySelector(
            "textarea",
          ) as HTMLTextAreaElement | null;
          const manager = editor?.storage.markdown?.manager;
          if (!textarea || !editor || !manager) return;

          const insertSourceText = (text: string) => {
            if (exact) {
              insertExactSourceText(textarea, text);
              return;
            }
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;
            const next = value.slice(0, start) + text + value.slice(end);
            handleSourceChange(next);
            requestAnimationFrame(() => {
              const position = start + text.length;
              textarea.focus();
              textarea.setSelectionRange(position, position);
            });
          };
          const adapter: ClipboardInsertionAdapter = {
            insertHtml: (html) => {
              const parsed = parseClipboardHtmlPreservingContent(
                editor.schema,
                html,
                document,
              );
              insertSourceText(manager.serialize(parsed));
              return true;
            },
            insertMarkdown: (markdown) => {
              parseMarkdownPreservingContent(manager, markdown);
              insertSourceText(markdown);
              return true;
            },
            insertText: insertSourceText,
          };
          await performClipboardPaste(payload, adapter, {
            exact,
            document,
            onFallback: (reason) =>
              toast.warning(
                `Rich paste was inserted as complete plain text: ${reason}`,
              ),
          });
        }
        toast.success(exact ? "Pasted exactly" : "Pasted");
      } catch (error) {
        console.error("Failed to paste:", error);
        toast.error("Unable to access clipboard. Use shortcut Ctrl+V / Cmd+V");
      }
    },
    [
      editor,
      sourceMode,
      handleSourceChange,
      insertExactSourceText,
      insertClipboardPayload,
    ],
  );

  const handleToggleSourcePreservation = useCallback(async () => {
    if (!currentNote || previewMode) return;
    const enabling = !preserveSourceFormatting;

    if (enabling && documentSessionRef.current?.isDirty) {
      await saveImmediately(currentNote.id, "explicit");
      if (documentSessionRef.current?.isDirty) return;
    }

    const currentSettings = settings ?? (await notesService.getSettings());
    const protectedIds = new Set(
      currentSettings.preserveSourceFormattingNoteIds ?? [],
    );
    if (enabling) protectedIds.add(currentNote.id);
    else protectedIds.delete(currentNote.id);
    const updatedSettings = {
      ...currentSettings,
      preserveSourceFormattingNoteIds: [...protectedIds],
    };
    await notesService.updateSettings(updatedSettings);
    setSettings(updatedSettings);
    documentSessionRef.current?.setPreserveSourceFormatting(enabling);

    if (enabling) {
      const source =
        documentSessionRef.current?.currentSourceContent ??
        currentNote.content;
      setSourceContent(toSourceEditorText(source));
      documentSessionRef.current?.setMode("source");
      setSourceMode(true);
      toast.success("Source formatting protection enabled");
    } else {
      toast.success("Source formatting protection disabled");
    }
  }, [
    currentNote,
    previewMode,
    preserveSourceFormatting,
    saveImmediately,
    settings,
  ]);

  const handleContextFormatTable = useCallback(() => {
    try {
      if (sourceMode) {
        if (editorContextMenu?.hasSelection && editorContextMenu.selectedText) {
          const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
          if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const val = textarea.value;
            const sel = val.substring(start, end);
            const formatted = formatMarkdownTable(sel);
            const newVal = val.substring(0, start) + formatted + val.substring(end);
            handleSourceChange(newVal);
            toast.success("Table formatted & aligned");
            return;
          }
        }
        const formatted = formatAllTablesInMarkdown(sourceContent);
        handleSourceChange(formatted);
        toast.success("All tables formatted & aligned");
      } else if (editor) {
        const manager = editor.storage.markdown?.manager;
        const currentMd = manager
          ? manager.serialize(editor.getJSON())
          : editor.getText();
        const formatted = formatAllTablesInMarkdown(currentMd);
        if (manager && typeof manager.parse === "function") {
          try {
            const parsed = manager.parse(formatted);
            editor.commands.setContent(parsed);
          } catch {
            editor.commands.setContent(formatted);
          }
        } else {
          editor.commands.setContent(formatted);
        }
        toast.success("Table formatted & aligned");
      }
    } catch (err) {
      console.error("Failed to format table:", err);
      toast.error("Failed to format table");
    }
  }, [editor, sourceMode, sourceContent, editorContextMenu, handleSourceChange]);

  const handleContextRepairFormat = useCallback(() => {
    try {
      if (sourceMode) {
        const proposed = repairMarkdownText(sourceContent);
        if (proposed === sourceContent) {
          toast.info("Markdown repair found no changes");
          return;
        }
        setFormattingPreview({
          original: sourceContent,
          proposed,
          sourceMode: true,
        });
      } else if (editor) {
        const manager = editor.storage.markdown?.manager;
        const original = manager
          ? manager.serialize(editor.getJSON())
          : editor.getText();
        const proposed = repairMarkdownText(original);
        if (proposed === original) {
          toast.info("Markdown repair found no changes");
          return;
        }
        setFormattingPreview({ original, proposed, sourceMode: false });
      }
    } catch (err) {
      console.error("Failed to repair format:", err);
      toast.error("Failed to repair format");
    }
  }, [editor, sourceMode, sourceContent]);

  const applyFormattingPreview = useCallback(() => {
    if (!formattingPreview) return;

    try {
      if (formattingPreview.sourceMode) {
        handleSourceChange(formattingPreview.proposed);
      } else if (editor) {
        const manager = editor.storage.markdown?.manager;
        if (manager && typeof manager.parse === "function") {
          try {
            editor.commands.setContent(manager.parse(formattingPreview.proposed));
          } catch {
            editor.commands.setContent(formattingPreview.proposed);
          }
        } else {
          editor.commands.setContent(formattingPreview.proposed);
        }
      }
      toast.success("Markdown repair applied");
      setFormattingPreview(null);
    } catch (err) {
      console.error("Failed to apply markdown repair:", err);
      toast.error("Failed to apply markdown repair");
    }
  }, [editor, formattingPreview, handleSourceChange]);

  useEffect(() => {
    const onFormatTable = () => handleContextFormatTable();
    const onRepairFormat = () => handleContextRepairFormat();

    window.addEventListener("editor:format-table", onFormatTable);
    window.addEventListener("editor:repair-format", onRepairFormat);

    return () => {
      window.removeEventListener("editor:format-table", onFormatTable);
      window.removeEventListener("editor:repair-format", onRepairFormat);
    };
  }, [handleContextFormatTable, handleContextRepairFormat]);

  const handleContextSelectAll = useCallback(() => {
    if (sourceMode) {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    } else if (editor) {
      editor.chain().focus().selectAll().run();
    }
  }, [editor, sourceMode]);

  if (!currentNote) {
    // Preview mode: show loading state (content not yet loaded)
    if (previewMode) {
      return (
        <div className="flex-1 flex flex-col bg-bg">
          {!isWindows && (
            <div
              className="h-10 shrink-0 flex items-end px-4 pb-1"
              data-tauri-drag-region
            ></div>
          )}
          <div className="flex-1 flex items-center justify-center">
            <SpinnerIcon className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        </div>
      );
    }

    // A note is selected but not yet loaded — show loading spinner to avoid empty state flash
    if (notesCtx?.selectedNoteId) {
      return (
        <div className="flex-1 flex flex-col bg-bg">
          {!isWindows && (
            <div
              className="h-10 shrink-0 flex items-end px-4 pb-1"
              data-tauri-drag-region
            ></div>
          )}
          <div className="flex-1 flex items-center justify-center">
            <SpinnerIcon className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        </div>
      );
    }

    // Folder mode: show empty state with "New Note" button
    return (
      <div className="flex-1 flex flex-col bg-bg">
        {/* Drag region */}
        {!isWindows && (
          <div
            className="h-10 shrink-0 flex items-end px-4 pb-1"
            data-tauri-drag-region
          ></div>
        )}
        <div className="flex-1 flex items-center justify-center pb-8">
          <div className="text-center text-text-muted select-none">
            <img
              src="/markdown-editor-logo.png"
              alt="Markdown Editor"
              className="w-42 aspect-square object-contain mx-auto mb-1"
            />
            <h1 className="text-2xl text-text font-serif mb-1 tracking-[-0.01em] ">
              What's on your mind?
            </h1>
            <p className="text-sm">
              Pick up where you left off, or start something new
            </p>
            {createNote && (
              <Button
                onClick={createNote}
                variant="secondary"
                size="md"
                className="mt-4"
              >
                New Note{" "}
                <span className="text-text-muted ml-1">
                  {mod}
                  {isMac ? "" : "+"}N
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      {/* Drag region with sidebar toggle, date and save status */}
      <div
        className={cn(
          "h-11 shrink-0 flex items-center justify-between px-3",
          !isSidebarActive && !isWindows && "pl-22",
        )}
        data-tauri-drag-region
      >
        <div
          className={`titlebar-no-drag flex items-center gap-1 min-w-0 transition-opacity duration-400 ${needsSidebarDelay ? "delay-200" : ""} ${focusMode ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        >
          {onToggleSidebar && (
            <IconButton
              onClick={onToggleSidebar}
              title={
                isSidebarActive
                  ? `Hide sidebar (${mod}${isMac ? "" : "+"}\\)`
                  : `Show sidebar (${mod}${isMac ? "" : "+"}\\)`
              }
              className="shrink-0"
            >
              <PanelLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          )}
          <span className="text-xs text-text-muted mb-px truncate">
            {formatDateTime(currentNote.modified)}
          </span>
        </div>
        <div
          className={`titlebar-no-drag flex items-center gap-px shrink-0 transition-opacity duration-400 ${needsSidebarDelay ? "delay-200" : ""} ${focusMode ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        >
          {saveConflict ? (
            <Tooltip
              content={`${saveConflict.message}. Your recovery draft is retained; reload the disk version when ready.`}
            >
              <button
                onClick={async () => {
                  await reloadCurrentNote();
                  setSaveConflict(null);
                }}
                className="h-7 px-2 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-bg-emphasis rounded transition-colors font-medium"
              >
                <RefreshCwIcon className="w-4 h-4 stroke-[1.6]" />
                <span>Conflict — reload</span>
              </button>
            </Tooltip>
          ) : hasExternalChanges ? (
            <Tooltip
              content={`External changes detected (${mod}${isMac ? "" : "+"}R to refresh)`}
            >
              <button
                onClick={reloadCurrentNote}
                className="h-7 px-2 flex items-center gap-1 text-xs text-text-muted hover:bg-bg-emphasis rounded transition-colors font-medium"
              >
                <RefreshCwIcon className="w-4 h-4 stroke-[1.6]" />
                <span>Refresh</span>
              </button>
            </Tooltip>
          ) : isSaving ? (
            <Tooltip content="Saving changes to disk...">
              <div className="h-6.5 px-2 flex items-center gap-1.5 text-[11px] text-text-muted/80 bg-bg-muted/50 rounded-md border border-border/50 select-none">
                <SpinnerIcon className="w-3.5 h-3.5 animate-spin text-text-muted" />
                <span className="font-medium">Saving...</span>
              </div>
            </Tooltip>
          ) : isUnsaved ? (
            <Tooltip content="Unsaved changes">
              <div className="h-6.5 px-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md border border-amber-500/30 select-none">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="font-medium">Unsaved changes</span>
              </div>
            </Tooltip>
          ) : (
            <Tooltip content="All changes saved to disk">
              <div className="h-6.5 px-2 flex items-center gap-1.5 text-[11px] text-text-muted/70 bg-bg-muted/30 rounded-md border border-border/30 select-none">
                <CircleCheckIcon className="w-3.5 h-3.5 text-emerald-500/80 stroke-[2]" />
                <span className="font-medium">Saved</span>
              </div>
            </Tooltip>
          )}
          {preserveSourceFormatting && (
            <Tooltip content="Exact source formatting is protected">
              <div className="h-6.5 px-2 flex items-center text-[11px] text-text-muted bg-bg-muted/30 rounded-md border border-border/30 select-none">
                Source protected
              </div>
            </Tooltip>
          )}
          {currentNote && pinNote && unpinNote && (
            <Tooltip content={isPinned ? "Unpin note" : "Pin note"}>
              <IconButton
                onClick={async () => {
                  if (!currentNote) return;
                  try {
                    if (isPinned) {
                      await unpinNote(currentNote.id);
                      toast.success("Note unpinned");
                    } else {
                      await pinNote(currentNote.id);
                      toast.success("Note pinned");
                    }
                    // Reload settings to update isPinned state
                    const updatedSettings = await notesService.getSettings();
                    setSettings(updatedSettings);
                  } catch (error) {
                    console.error("Failed to pin/unpin note:", error);
                    toast.error(
                      `Failed to ${isPinned ? "unpin" : "pin"} note: ${
                        error instanceof Error ? error.message : "Unknown error"
                      }`,
                    );
                  }
                }}
              >
                <PinIcon
                  className={cn(
                    "w-5 h-5 stroke-[1.3]",
                    isPinned && "fill-current",
                  )}
                />
              </IconButton>
            </Tooltip>
          )}
          {currentNote && (
            <Tooltip content={`Find in note (${mod}${isMac ? "" : "+"}F)`}>
              <IconButton onClick={openEditorSearch}>
                <SearchIcon className="w-4.25 h-4.25 stroke-[1.6]" />
              </IconButton>
            </Tooltip>
          )}
          {currentNote && (
            <Tooltip
              content={
                sourceMode
                  ? `View Formatted (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}M)`
                  : `View Markdown Source (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}M)`
              }
            >
              <IconButton onClick={toggleSourceMode}>
                {sourceMode ? (
                  <MarkdownOffIcon className="w-4.75 h-4.75 stroke-[1.4]" />
                ) : (
                  <MarkdownIcon className="w-4.75 h-4.75 stroke-[1.4]" />
                )}
              </IconButton>
            </Tooltip>
          )}
          <DropdownMenu.Root open={copyMenuOpen} onOpenChange={setCopyMenuOpen}>
            <Tooltip
              content={`Export (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}C)`}
            >
              <DropdownMenu.Trigger asChild>
                <IconButton>
                  <ShareIcon className="w-4.25 h-4.25 stroke-[1.6]" />
                </IconButton>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-35 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
                sideOffset={5}
                align="end"
                onCloseAutoFocus={(e) => {
                  // Prevent focus returning to trigger button
                  e.preventDefault();
                }}
                onKeyDown={(e) => {
                  // Stop arrow keys from bubbling to note list navigation
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.stopPropagation();
                  }
                }}
              >
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={handleCopyMarkdown}
                >
                  <CopyIcon className="w-4 h-4 stroke-[1.6]" />
                  Copy Markdown
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={handleCopyPlainText}
                >
                  <CopyIcon className="w-4 h-4 stroke-[1.6]" />
                  Copy Plain Text
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={handleCopyHtml}
                >
                  <CopyIcon className="w-4 h-4 stroke-[1.6]" />
                  Copy HTML
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-border my-1" />
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={handleDownloadPdf}
                >
                  <DownloadIcon className="w-4 h-4 stroke-[1.6]" />
                  Print as PDF
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                  onSelect={handleDownloadMarkdown}
                >
                  <DownloadIcon className="w-4 h-4 stroke-[1.6]" />
                  Export Markdown
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {onSaveToFolder && (
            <Tooltip content="Save in Folder">
              <IconButton
                onClick={onSaveToFolder}
                aria-label="Save in Folder"
                disabled={saveToFolderDisabled}
              >
                {saveToFolderDisabled ? (
                  <SpinnerIcon className="w-4.25 h-4.25 animate-spin" />
                ) : (
                  <FolderPlusIcon className="w-4.25 h-4.25 stroke-[1.6]" />
                )}
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Format Bar – transition only after initial mount to avoid height animation on note load */}
      <div
        data-format-bar
        className={`${focusMode || sourceMode ? "opacity-0 max-h-0 overflow-hidden pointer-events-none" : "opacity-100 max-h-20"} ${hasTransitioned ? `transition-all duration-400 ${needsSidebarDelay ? "delay-200" : ""}` : ""}`}
      >
        <FormatBar
          editor={editor}
          onAddLink={handleAddLink}
          onAddBlockMath={handleAddBlockMath}
          onAddImage={handleAddImage}
          onAddFootnote={handleAddFootnote}
          onToggleCase={handleToggleCase}
        />
      </div>

      {/* Editor content area with resize handles overlay */}
      <div data-editor-content-area className="flex-1 relative overflow-hidden flex flex-row">
        {!focusMode && !sourceMode && (
          <EditorWidthHandles containerRef={scrollContainerRef} />
        )}
        <div
          data-editor-scroll
          ref={scrollContainerRef}
          className="flex-1 h-full overflow-y-auto overflow-x-hidden relative"
          dir={textDirection}
        >
          {sourceMode ? (
            /* Markdown source textarea */
            <div className="h-full" onContextMenu={handleEditorContextMenu}>
              <textarea
                value={sourceContent}
                onChange={(e) => handleSourceChange(e.target.value)}
                onKeyDown={handleSourceKeyDown}
                onPaste={(event) => {
                  const delivered =
                    event.clipboardData.getData("text/markdown") ||
                    event.clipboardData.getData("text/plain");
                  if (!delivered) return;
                  event.preventDefault();
                  insertExactSourceText(event.currentTarget, delivered);
                }}
                wrap="off"
                dir={textDirection}
                className="w-full h-full bg-transparent text-text focus:outline-none resize-none px-6 pt-8 pb-24 mx-auto block"
                style={{
                  maxWidth: "var(--editor-max-width, 48rem)",
                  fontFamily:
                    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
                  fontSize: "0.875em",
                  lineHeight: "var(--editor-line-height)",
                  tabSize: 2,
                }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                lang="en-GB"
              />
            </div>
          ) : (
            <>
              {searchOpen && (
                <div className="sticky top-2 z-10 animate-in fade-in slide-in-from-top-4 duration-200 pointer-events-none pr-2 flex justify-end">
                  <div className="pointer-events-auto">
                    <SearchToolbar
                      inputRef={searchInputRef}
                      query={searchQuery}
                      onChange={handleSearchChange}
                      onNext={goToNextMatch}
                      onPrevious={goToPreviousMatch}
                      onClose={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        setReplaceQuery("");
                        setIsReplaceOpen(false);
                        setSearchMatches([]);
                        setCurrentMatchIndex(0);
                        // Clear decorations and refocus editor
                        if (editor) {
                          updateSearchDecorations([], 0, editor);
                          editor.commands.focus();
                        }
                      }}
                      currentMatch={
                        searchMatches.length === 0 ? 0 : currentMatchIndex + 1
                      }
                      totalMatches={searchMatches.length}
                      replaceQuery={replaceQuery}
                      onReplaceChange={setReplaceQuery}
                      onReplace={() => replaceCurrent(replaceQuery)}
                      onReplaceAll={() => replaceAll(replaceQuery)}
                      isReplaceOpen={isReplaceOpen}
                      onToggleReplace={() => setIsReplaceOpen(!isReplaceOpen)}
                    />
                  </div>
                </div>
              )}
              <div
                className="h-full"
                onContextMenu={async (e) => {
                  if (!editor) return;

                  // If we have highlighted text, show our custom selection context menu
                  const { selection } = editor.state;
                  if (!selection.empty) {
                    handleEditorContextMenu(e);
                    return;
                  }

                  // Get the position at the click coordinates
                  const clickPos = editor.view.posAtCoords({
                    left: e.clientX,
                    top: e.clientY,
                  });

                  if (clickPos) {
                    // Set selection to clicked pos
                    editor.chain().focus().setTextSelection(clickPos.pos).run();
                  }

                  // If in a table and empty selection, open table context menu
                  if (!editor.isActive("table")) {
                    handleEditorContextMenu(e);
                    return;
                  }

                  e.preventDefault();

                  try {
                    // Work with the updated selection
                    const { state } = editor;
                    const { selection } = state;
                    const { $anchor } = selection;

                    // Find the table cell/header node
                    let cellDepth = $anchor.depth;
                    while (
                      cellDepth > 0 &&
                      state.doc.resolve($anchor.pos).node(cellDepth).type
                        .name !== "tableCell" &&
                      state.doc.resolve($anchor.pos).node(cellDepth).type
                        .name !== "tableHeader"
                    ) {
                      cellDepth--;
                    }

                    // Guard: if we didn't find a table cell, bail out
                    if (cellDepth <= 0) return;

                    const resolvedNode = state.doc
                      .resolve($anchor.pos)
                      .node(cellDepth);
                    if (
                      resolvedNode.type.name !== "tableCell" &&
                      resolvedNode.type.name !== "tableHeader"
                    ) {
                      return;
                    }

                    // Get the cell position
                    const cellPos = $anchor.before(cellDepth);

                    // Check if we're in the first column (index 0 in parent row)
                    const rowNode = state.doc
                      .resolve(cellPos)
                      .node(cellDepth - 1);
                    let cellIndex = 0;
                    rowNode.forEach((_node, offset) => {
                      if (
                        offset <
                        cellPos - $anchor.before(cellDepth - 1) - 1
                      ) {
                        cellIndex++;
                      }
                    });
                    const isFirstColumn = cellIndex === 0;

                    // Check if we're in the first row (index 0 in parent table)
                    const tableNode = state.doc
                      .resolve(cellPos)
                      .node(cellDepth - 2);
                    let rowIndex = 0;
                    tableNode.forEach((_node, offset) => {
                      if (
                        offset <
                        $anchor.before(cellDepth - 1) -
                          $anchor.before(cellDepth - 2) -
                          1
                      ) {
                        rowIndex++;
                      }
                    });
                    const isFirstRow = rowIndex === 0;

                    const menuItems = [];

                    // Only show "Add Column Before" if not in first column
                    if (!isFirstColumn) {
                      menuItems.push(
                        await MenuItem.new({
                          text: "Add Column Before",
                          action: () =>
                            editor.chain().focus().addColumnBefore().run(),
                        }),
                      );
                    }
                    menuItems.push(
                      await MenuItem.new({
                        text: "Add Column After",
                        action: () =>
                          editor.chain().focus().addColumnAfter().run(),
                      }),
                    );
                    menuItems.push(
                      await MenuItem.new({
                        text: "Delete Column",
                        action: () =>
                          editor.chain().focus().deleteColumn().run(),
                      }),
                    );
                    menuItems.push(
                      await PredefinedMenuItem.new({ item: "Separator" }),
                    );

                    // Only show "Add Row Above" if not in first row
                    if (!isFirstRow) {
                      menuItems.push(
                        await MenuItem.new({
                          text: "Add Row Above",
                          action: () =>
                            editor.chain().focus().addRowBefore().run(),
                        }),
                      );
                    }
                    menuItems.push(
                      await MenuItem.new({
                        text: "Add Row Below",
                        action: () =>
                          editor.chain().focus().addRowAfter().run(),
                      }),
                    );
                    menuItems.push(
                      await MenuItem.new({
                        text: "Delete Row",
                        action: () => editor.chain().focus().deleteRow().run(),
                      }),
                    );
                    menuItems.push(
                      await PredefinedMenuItem.new({ item: "Separator" }),
                    );
                    menuItems.push(
                      await MenuItem.new({
                        text: "Toggle Header Row",
                        action: () =>
                          editor.chain().focus().toggleHeaderRow().run(),
                      }),
                    );
                    menuItems.push(
                      await MenuItem.new({
                        text: "Toggle Header Column",
                        action: () =>
                          editor.chain().focus().toggleHeaderColumn().run(),
                      }),
                    );
                    menuItems.push(
                      await PredefinedMenuItem.new({ item: "Separator" }),
                    );
                    menuItems.push(
                      await MenuItem.new({
                        text: "Delete Table",
                        action: () =>
                          editor.chain().focus().deleteTable().run(),
                      }),
                    );

                    const menu = await Menu.new({ items: menuItems });

                    await menu.popup();
                  } catch (err) {
                    console.error("Table context menu error:", err);
                  }
                }}
              >
                <EditorContent editor={editor} className="h-full text-text" lang="en-GB" />
              </div>
            </>
          )}
        </div>

        {!focusMode && (
          <TableOfContents
            editor={editor}
            sourceMode={sourceMode}
            sourceContent={sourceContent}
          />
        )}
      </div>

      {/* Editor Status Bar */}
      <div
        className={cn(
          "h-8 border-t border-border/40 px-4 bg-bg flex items-center justify-between text-[11px] font-medium text-text-muted select-none shrink-0 transition-opacity duration-300",
          focusMode ? "opacity-0 pointer-events-none" : "opacity-100"
        )}
      >
        <div className="flex items-center gap-3">
          <span>{words} {words === 1 ? "word" : "words"}</span>
          <span className="text-border/40">•</span>
          <span>{chars} {chars === 1 ? "character" : "characters"}</span>
          <span className="text-border/40">•</span>
          <span>{readingTime} min read</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Markdown</span>
        </div>
      </div>

      <AlertDialog.Root
        open={formattingPreview !== null}
        onOpenChange={(open) => {
          if (!open) setFormattingPreview(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/45" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[min(92vw,72rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg p-5 shadow-2xl text-text">
            <AlertDialog.Title className="text-lg font-medium">
              Review Markdown repair
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-text-muted">
              No change has been made. Review the proposed Markdown before applying it.
            </AlertDialog.Description>
            {formattingPreview && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <section>
                  <h3 className="mb-1.5 text-sm font-medium">Current Markdown</h3>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-muted p-3 text-xs leading-5">
                    {formattingPreview.original}
                  </pre>
                </section>
                <section>
                  <h3 className="mb-1.5 text-sm font-medium">Proposed Markdown</h3>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-muted p-3 text-xs leading-5">
                    {formattingPreview.proposed}
                  </pre>
                </section>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-muted">
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  onClick={applyFormattingPreview}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90"
                >
                  Apply changes
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* Custom Right-Click Context Menu */}
      {editorContextMenu && (
        <>
          {/* Invisible click-away backdrop */}
          <div
            className="fixed inset-0 z-50"
            onClick={() => setEditorContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setEditorContextMenu(null);
            }}
          />
          <div
            style={{
              position: "fixed",
              top: editorContextMenu.y,
              left: editorContextMenu.x,
            }}
            className="z-50 min-w-56 bg-bg border border-border/80 rounded-xl shadow-2xl py-1.5 animate-scale-in text-xs text-text font-sans divide-y divide-border/40 select-none"
          >
            {/* Highlight Section */}
            <div className="py-1">
              <button
                onClick={() => {
                  handleContextHighlight();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <HighlighterIcon className="w-4 h-4 text-amber-500 fill-amber-500/20" />
                  <span>
                    {editorContextMenu.isHighlighted
                      ? "Remove Highlight"
                      : "Highlight"}
                  </span>
                </div>
                <span className="text-[10px] text-text-muted font-mono">
                  {mod}+Shift+H
                </span>
              </button>

              {/* Color Presets */}
              <div className="px-3 pt-1.5 pb-1 flex items-center justify-between">
                <span className="text-[10px] text-text-muted font-medium">
                  Highlights:
                </span>
                <div className="flex items-center gap-1.5">
                  {[
                    { name: "Yellow", color: "#fef08a", bg: "bg-yellow-300" },
                    { name: "Green", color: "#bbf7d0", bg: "bg-emerald-300" },
                    { name: "Blue", color: "#bfdbfe", bg: "bg-sky-300" },
                    { name: "Pink", color: "#fbcfe8", bg: "bg-pink-300" },
                    { name: "Orange", color: "#fed7aa", bg: "bg-orange-300" },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      title={`Highlight ${preset.name}`}
                      onClick={() => {
                        handleContextHighlight(preset.color);
                        setEditorContextMenu(null);
                      }}
                      className={`w-4 h-4 rounded-full ${preset.bg} hover:scale-125 transition-transform border border-black/10 dark:border-white/20 cursor-pointer shadow-xs`}
                    />
                  ))}
                </div>
              </div>

              {/* Font Color Presets */}
              <div className="px-3 pt-1.5 pb-1 flex items-center justify-between border-t border-border/30 mt-1">
                <span className="text-[10px] text-text-muted font-medium flex items-center gap-1">
                  <FontColorIcon className="w-3 h-3 text-text-muted" />
                  Text Color:
                </span>
                <div className="flex items-center gap-1.5">
                  {[
                    { name: "Default", color: "" },
                    { name: "Red", color: "#ef4444" },
                    { name: "Orange", color: "#f97316" },
                    { name: "Green", color: "#10b981" },
                    { name: "Blue", color: "#3b82f6" },
                    { name: "Purple", color: "#a855f7" },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      title={`Text Color: ${preset.name}`}
                      onClick={() => {
                        const ed = editorRef.current;
                        if (ed) {
                          if (preset.color) {
                            ed.chain().focus().setColor(preset.color).run();
                          } else {
                            ed.chain().focus().unsetColor().run();
                          }
                        }
                        setEditorContextMenu(null);
                      }}
                      className="w-3.5 h-3.5 rounded-full hover:scale-125 transition-transform border border-black/10 dark:border-white/20 cursor-pointer shadow-xs relative flex items-center justify-center"
                      style={{ backgroundColor: preset.color || "transparent" }}
                    >
                      {!preset.color && (
                        <div className="w-2.5 h-0.5 bg-red-500 rotate-45" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Format Tools Section */}
            <div className="py-1 border-b border-border/50">
              {!previewMode && (
                <button
                  onClick={() => {
                    void handleToggleSourcePreservation();
                    setEditorContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
                >
                  <div className="flex items-center gap-2">
                    <CircleCheckIcon className="w-4 h-4 text-emerald-500" />
                    <span>Preserve source formatting</span>
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {preserveSourceFormatting ? "On" : "Off"}
                  </span>
                </button>
              )}
              <button
                onClick={() => {
                  handleToggleCase();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <LetterCaseIcon className="w-4 h-4 text-text-muted" />
                  <span>Toggle Lowercase / Uppercase</span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleInsertCurrentDate();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-text-muted" />
                  <span>Insert Current Date</span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleAddImage();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-text-muted" />
                  <span>Insert Image</span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleContextFormatTable();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <TableIcon className="w-4 h-4 text-text-muted" />
                  <span>Format Table</span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleContextRepairFormat();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <CircleCheckIcon className="w-4 h-4 text-emerald-500" />
                  <span>Preview Markdown Repair</span>
                </div>
              </button>
            </div>

            {/* Cut / Copy / Paste Section */}
            <div className="py-1">
              <button
                onClick={() => {
                  handleContextCut();
                  setEditorContextMenu(null);
                }}
                disabled={!editorContextMenu.hasSelection}
                className={cn(
                  "w-full text-left px-3 py-1.5 flex items-center justify-between font-medium transition-colors",
                  editorContextMenu.hasSelection
                    ? "hover:bg-bg-muted focus:bg-bg-muted cursor-pointer text-text"
                    : "opacity-40 cursor-not-allowed text-text-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  <ScissorsIcon className="w-4 h-4 text-text-muted" />
                  <span>Cut</span>
                </div>
                <span className="text-[10px] text-text-muted font-mono">
                  {mod}+X
                </span>
              </button>

              <button
                onClick={() => {
                  handleContextCopy();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <CopyIcon className="w-4 h-4 text-text-muted" />
                  <span>Copy</span>
                </div>
                <span className="text-[10px] text-text-muted font-mono">
                  {mod}+C
                </span>
              </button>

              <button
                onClick={() => {
                  handleContextCopyAsHtml();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <CodeIcon className="w-4 h-4 text-text-muted" />
                  <span>
                    {editorContextMenu.hasSelection
                      ? "Copy Selection as HTML"
                      : "Copy as HTML"}
                  </span>
                </div>
              </button>

              <button
                onClick={() => {
                  handleContextPaste();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <PasteIcon className="w-4 h-4 text-text-muted" />
                  <span>Paste</span>
                </div>
                <span className="text-[10px] text-text-muted font-mono">
                  {mod}+V
                </span>
              </button>
              <button
                onClick={() => {
                  handleContextPaste(true);
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <div className="flex items-center gap-2">
                  <PasteIcon className="w-4 h-4 text-text-muted" />
                  <span>Paste exactly</span>
                </div>
                <span className="text-[10px] text-text-muted">
                  No conversion
                </span>
              </button>
            </div>

            {/* Select All & Comment Section */}
            <div className="py-1">
              <button
                onClick={() => {
                  handleContextSelectAll();
                  setEditorContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center justify-between cursor-pointer transition-colors font-medium text-text"
              >
                <span>Select All</span>
                <span className="text-[10px] text-text-muted font-mono">
                  {mod}+A
                </span>
              </button>

              {editorContextMenu.hasSelection && currentNote && notesCtx && (
                <button
                  onClick={() => {
                    const quote = `> ${editorContextMenu.selectedText}\n\n`;
                    notesCtx.setActiveCommentsNoteId(currentNote.id, quote);
                    setEditorContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2 cursor-pointer transition-colors font-medium text-text"
                >
                  <MessageSquareIcon className="w-4 h-4 text-text-muted" />
                  <span>Comment on Highlight...</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
