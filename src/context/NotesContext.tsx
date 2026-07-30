import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Note, NoteMetadata, Comment, Footnote, SortOption } from "../types/note";
import { recordCreationDate } from "../lib/utils";
import * as notesService from "../services/notes";
import type { SearchResult } from "../services/notes";
import type { DocumentSaveRequest } from "../lib/documentLifecycle";
import {
  mergeEditedContentIntoSource,
  parseNoteAnnotations,
} from "../lib/noteAnnotations";
import { createRebasedSaveQueue } from "../lib/rebasedSaveQueue";
import { rebaseSaveRequestToSnapshot } from "../lib/noteSaveRebase";

interface QueuedNoteSave {
  annotationVersion: number;
  createRequest: (base: Note) => DocumentSaveRequest;
}

export function extractComments(content: string): { cleanContent: string; comments: Comment[] } {
  const match = content.match(
    /(?:\r?\n){1,2}<!-- SCRATCH_COMMENTS\r?\n([\s\S]*?)\r?\n-->$/,
  );
  if (match) {
    try {
      const comments = JSON.parse(match[1]);
      const cleanContent = content.substring(0, match.index);
      return { cleanContent, comments };
    } catch (e) {
      console.error("Failed to parse comments JSON", e);
    }
  }
  return { cleanContent: content, comments: [] };
}

export function appendComments(content: string, comments: Comment[]): string {
  if (!comments || comments.length === 0) return content;
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.endsWith(lineEnding)
    ? lineEnding
    : `${lineEnding}${lineEnding}`;
  return `${content}${separator}<!-- SCRATCH_COMMENTS${lineEnding}${JSON.stringify(comments, null, 2).replace(/\n/g, lineEnding)}${lineEnding}-->`;
}

export function extractFootnotes(content: string): { cleanContent: string; footnotes: Footnote[] } {
  const footnotes: Footnote[] = [];
  const segments = content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  const cleanSegments: string[] = [];

  for (const segment of segments) {
    if (!segment) continue;
    const line = segment.replace(/(?:\r\n|\r|\n)$/, "");
    const match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (match) {
      footnotes.push({
        id: match[1],
        text: match[2].trim()
      });
    } else {
      cleanSegments.push(segment);
    }
  }

  return { cleanContent: cleanSegments.join(""), footnotes };
}

export function appendFootnotes(content: string, footnotes: Footnote[]): string {
  if (!footnotes || footnotes.length === 0) return content;
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.endsWith(lineEnding)
    ? lineEnding
    : `${lineEnding}${lineEnding}`;
  const footnoteLines = footnotes
    .map(f => `[^${f.id}]: ${f.text}`)
    .join(lineEnding);
  return `${content}${separator}${footnoteLines}`;
}

function prepareNoteForEditing(note: Note): {
  note: Note;
  comments: Comment[];
  footnotes: Footnote[];
} {
  const parsed = parseNoteAnnotations(note.content);
  const sourceContent =
    parsed.cleanContent === note.content ? undefined : note.content;
  return {
    note: {
      ...note,
      content: parsed.cleanContent,
      snapshot: {
        ...note.snapshot,
        content: parsed.cleanContent,
        ...(sourceContent === undefined ? {} : { sourceContent }),
      },
    },
    comments: parsed.comments,
    footnotes: parsed.footnotes,
  };
}

function prepareStorageSaveRequest(
  request: DocumentSaveRequest,
  footnotes: Footnote[],
  comments: Comment[],
): DocumentSaveRequest {
  const {
    content,
    contentBaseline,
    sourceBaseline,
    contentIsStorageSource,
    ...requestMetadata
  } = request;
  let storageContent = content;
  if (
    !contentIsStorageSource &&
    contentBaseline !== undefined &&
    sourceBaseline !== undefined
  ) {
    storageContent = mergeEditedContentIntoSource(
      sourceBaseline,
      contentBaseline,
      content,
    );
  } else if (!contentIsStorageSource) {
    storageContent = appendComments(
      appendFootnotes(content, footnotes),
      comments,
    );
  }

  return { ...requestMetadata, content: storageContent };
}

// Separate contexts to prevent unnecessary re-renders
// Data context: changes frequently, only subscribed by components that need the data
interface NotesDataContextValue {
  notes: NoteMetadata[];
  selectedNoteId: string | null;
  currentNote: Note | null;
  notesFolder: string | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  hasExternalChanges: boolean;
  reloadVersion: number;
  commentsMap: Record<string, Comment[]>;
  footnotesMap: Record<string, Footnote[]>;
  activeCommentsNoteId: string | null;
  activeCommentsInitialText: string;
  sortBy: SortOption;
}

// Actions context: stable references, rarely causes re-renders
interface NotesActionsContextValue {
  selectNote: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  consumePendingNewNote: (id: string) => boolean;
  saveNote: (
    request: DocumentSaveRequest,
    noteId?: string,
  ) => Promise<Note | null>;
  retainRecoveryDraft: (
    request: DocumentSaveRequest,
    noteId?: string,
  ) => Promise<string>;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<void>;
  refreshNotes: () => Promise<void>;
  reloadCurrentNote: () => Promise<void>;
  setNotesFolder: (path: string) => Promise<void>;
  syncNotesFolder: (path: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  pinNote: (id: string) => Promise<void>;
  unpinNote: (id: string) => Promise<void>;
  createNoteInFolder: (folderPath: string) => Promise<void>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  renameFolder: (oldPath: string, newName: string) => Promise<void>;
  moveNote: (id: string, targetFolder: string) => Promise<void>;
  moveFolder: (path: string, targetParent: string) => Promise<void>;
  addComment: (noteId: string, text: string) => Promise<void>;
  deleteComment: (noteId: string, commentId: string) => Promise<void>;
  addFootnote: (noteId: string, id: string, text: string) => Promise<void>;
  updateFootnote: (noteId: string, id: string, text: string) => Promise<void>;
  deleteFootnote: (noteId: string, id: string) => Promise<void>;
  setActiveCommentsNoteId: (id: string | null, initialText?: string) => void;
  setSortBy: (option: SortOption) => void;
}

const NotesDataContext = createContext<NotesDataContextValue | null>(null);
const NotesActionsContext = createContext<NotesActionsContextValue | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [notesFolder, setNotesFolderState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  // Increments when user manually refreshes, so Editor knows to reload content
  const [reloadVersion, setReloadVersion] = useState(0);
  const [commentsMap, setCommentsMap] = useState<Record<string, Comment[]>>({});
  const [footnotesMap, setFootnotesMap] = useState<Record<string, Footnote[]>>({});
  const [activeCommentsNoteId, setActiveCommentsNoteIdState] = useState<string | null>(null);
  const [activeCommentsInitialText, setActiveCommentsInitialText] = useState<string>("");

  const setActiveCommentsNoteId = useCallback((id: string | null, initialText: string = "") => {
    setActiveCommentsNoteIdState(id);
    setActiveCommentsInitialText(initialText);
  }, []);
  const [sortBy, setSortByState] = useState<SortOption>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("markdown-editor:sortBy");
      if (saved === "modified" || saved === "created" || saved === "alphabetical") {
        return saved;
      }
    }
    return "modified";
  });

  const setSortBy = useCallback((option: SortOption) => {
    setSortByState(option);
    if (typeof window !== "undefined") {
      localStorage.setItem("markdown-editor:sortBy", option);
    }
  }, []);

  // Track recently saved note IDs to ignore file-change events from our own saves
  const recentlySavedRef = useRef<Set<string>>(new Set());
  // Track pending refresh timeout to debounce refreshes during rapid saves
  const refreshTimeoutRef = useRef<number | null>(null);
  // Ref to access selectedNoteId in file watcher without re-registering listener
  const selectedNoteIdRef = useRef<string | null>(null);
  selectedNoteIdRef.current = selectedNoteId;
  // Ref to access notes in search callback without re-creating it on every notes change
  const notesRef = useRef<NoteMetadata[]>([]);
  notesRef.current = notes;
  // Ref to access comments and current note in stable callbacks
  const commentsMapRef = useRef(commentsMap);
  commentsMapRef.current = commentsMap;
  const footnotesMapRef = useRef(footnotesMap);
  footnotesMapRef.current = footnotesMap;
  const currentNoteRef = useRef(currentNote);
  currentNoteRef.current = currentNote;
  const noteSaveQueueRef = useRef(
    createRebasedSaveQueue<object, QueuedNoteSave, Note>(),
  );
  const noteSaveQueueKeysRef = useRef(new Map<string, object>());
  const activeNoteIdsRef = useRef(new Map<object, string>());
  const blockedNoteSaveErrorsRef = useRef(new Map<object, unknown>());
  const annotationVersionsRef = useRef(new Map<string, number>());
  // Monotonic counter to ignore stale async note selection responses.
  const selectRequestIdRef = useRef(0);
  // Monotonic counter to ignore stale async search responses
  const searchRequestIdRef = useRef(0);
  // Tracks the ID of a newly created note so Editor can focus its title.
  const pendingNewNoteIdRef = useRef<string | null>(null);

  const getNoteSaveQueueKey = useCallback((id: string) => {
    const existing = noteSaveQueueKeysRef.current.get(id);
    if (existing) return existing;
    const key = {};
    noteSaveQueueKeysRef.current.set(id, key);
    activeNoteIdsRef.current.set(key, id);
    return key;
  }, []);

  const setNoteSaveQueueBase = useCallback(
    (note: Note, previousId?: string) => {
      const key = getNoteSaveQueueKey(previousId ?? note.id);
      noteSaveQueueKeysRef.current.set(note.id, key);
      activeNoteIdsRef.current.set(key, note.id);
      blockedNoteSaveErrorsRef.current.delete(key);
      noteSaveQueueRef.current.setBase(key, note);
    },
    [getNoteSaveQueueKey],
  );

  const installPreparedNote = useCallback(
    (rawNote: Note, previousId?: string) => {
      const prepared = prepareNoteForEditing(rawNote);
      const sourceId = previousId ?? prepared.note.id;
      const annotationVersion =
        annotationVersionsRef.current.get(sourceId) ??
        annotationVersionsRef.current.get(prepared.note.id) ??
        0;

      commentsMapRef.current = {
        ...commentsMapRef.current,
        [prepared.note.id]: prepared.comments,
      };
      footnotesMapRef.current = {
        ...footnotesMapRef.current,
        [prepared.note.id]: prepared.footnotes,
      };
      if (sourceId !== prepared.note.id) {
        delete commentsMapRef.current[sourceId];
        delete footnotesMapRef.current[sourceId];
        annotationVersionsRef.current.delete(sourceId);
      }
      annotationVersionsRef.current.set(
        prepared.note.id,
        annotationVersion,
      );
      setCommentsMap(commentsMapRef.current);
      setFootnotesMap(footnotesMapRef.current);
      setNoteSaveQueueBase(prepared.note, sourceId);
      currentNoteRef.current = prepared.note;
      setCurrentNote(prepared.note);
      return prepared.note;
    },
    [setNoteSaveQueueBase],
  );

  const bumpAnnotationVersion = useCallback((noteId: string) => {
    const next = (annotationVersionsRef.current.get(noteId) ?? 0) + 1;
    annotationVersionsRef.current.set(noteId, next);
    return next;
  }, []);

  const refreshNotes = useCallback(async () => {
    if (!notesFolder) return;
    try {
      const notesList = await notesService.listNotes();
      setNotes(notesList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    }
  }, [notesFolder]);

  // Debounced refresh - coalesces rapid saves into a single refresh
  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshNotes();
    }, 300);
  }, [refreshNotes]);

  const selectNote = useCallback(async (id: string) => {
    const requestId = ++selectRequestIdRef.current;
    try {
      if (pendingNewNoteIdRef.current !== id) {
        pendingNewNoteIdRef.current = null;
      }
      // Set selected ID immediately for responsive UI
      selectedNoteIdRef.current = id;
      setSelectedNoteId(id);
      setHasExternalChanges(false);
      // Expand parent folders so the note is visible in the tree
      const lastSlash = id.lastIndexOf("/");
      if (lastSlash > 0) {
        window.dispatchEvent(
          new CustomEvent("expand-folder", {
            detail: id.substring(0, lastSlash),
          }),
        );
      }
      const note = await notesService.readNote(id);
      if (requestId !== selectRequestIdRef.current) return;
      installPreparedNote(note);
    } catch (err) {
      if (requestId !== selectRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load note");
    }
  }, [installPreparedNote]);

  const reloadCurrentNote = useCallback(async () => {
    const noteId = selectedNoteIdRef.current;
    if (!noteId) return;
    try {
      const note = await notesService.readNote(noteId);
      if (selectedNoteIdRef.current !== noteId) return;
      installPreparedNote(note);
      setHasExternalChanges(false);
      setReloadVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload note");
    }
  }, [installPreparedNote]);

  const createNote = useCallback(async () => {
    try {
      // Derive target folder from the selected note's parent path
      let targetFolder: string | undefined;
      if (selectedNoteIdRef.current) {
        const lastSlash = selectedNoteIdRef.current.lastIndexOf("/");
        if (lastSlash > 0) {
          targetFolder = selectedNoteIdRef.current.substring(0, lastSlash);
        }
      }
      const note = await notesService.createNote(targetFolder);
      recordCreationDate(note.id);
      selectRequestIdRef.current += 1;
      pendingNewNoteIdRef.current = note.id;
      // Mark as recently saved to ignore file-change events from our own creation
      recentlySavedRef.current.add(note.id);
      await refreshNotes();
      installPreparedNote(note);
      selectedNoteIdRef.current = note.id;
      setSelectedNoteId(note.id);
      // Clear search when creating a new note
      setSearchQuery("");
      setSearchResults([]);
      setTimeout(() => {
        recentlySavedRef.current.delete(note.id);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    }
  }, [installPreparedNote, refreshNotes]);

  const consumePendingNewNote = useCallback((id: string) => {
    if (pendingNewNoteIdRef.current !== id) {
      pendingNewNoteIdRef.current = null;
      return false;
    }
    pendingNewNoteIdRef.current = null;
    return true;
  }, []);

  const enqueueNoteSave = useCallback(
    async (requestedNoteId: string, queuedSave: QueuedNoteSave) => {
      const queueKey = getNoteSaveQueueKey(requestedNoteId);
      const blockedError = blockedNoteSaveErrorsRef.current.get(queueKey);
      if (blockedError !== undefined) throw blockedError;
      return noteSaveQueueRef.current.enqueue(
        queueKey,
        queuedSave,
        {
          load: async (key) => {
            const blockedSaveError =
              blockedNoteSaveErrorsRef.current.get(key);
            if (blockedSaveError !== undefined) {
              throw blockedSaveError;
            }
            const activeId =
              activeNoteIdsRef.current.get(key) ?? requestedNoteId;
            const loaded = prepareNoteForEditing(
              await notesService.readNote(activeId),
            ).note;
            noteSaveQueueKeysRef.current.set(loaded.id, key);
            activeNoteIdsRef.current.set(key, loaded.id);
            return loaded;
          },
          save: async (key, operation, base) => {
            const savingNoteId = base.id;
            recentlySavedRef.current.add(savingNoteId);
            try {
              const updated = await notesService.saveNote(
                savingNoteId,
                operation.createRequest(base),
              );
              const prepared = prepareNoteForEditing(updated);
              noteSaveQueueKeysRef.current.set(updated.id, key);
              activeNoteIdsRef.current.set(key, updated.id);
              if (updated.id !== savingNoteId) {
                recentlySavedRef.current.add(updated.id);
              }

              const currentAnnotationVersion =
                annotationVersionsRef.current.get(savingNoteId) ??
                annotationVersionsRef.current.get(requestedNoteId) ??
                0;
              const annotationsAreCurrent =
                currentAnnotationVersion === operation.annotationVersion;
              const latestComments =
                commentsMapRef.current[savingNoteId] ??
                commentsMapRef.current[requestedNoteId] ??
                prepared.comments;
              const latestFootnotes =
                footnotesMapRef.current[savingNoteId] ??
                footnotesMapRef.current[requestedNoteId] ??
                prepared.footnotes;

              commentsMapRef.current = {
                ...commentsMapRef.current,
                [updated.id]: annotationsAreCurrent
                  ? prepared.comments
                  : latestComments,
              };
              footnotesMapRef.current = {
                ...footnotesMapRef.current,
                [updated.id]: annotationsAreCurrent
                  ? prepared.footnotes
                  : latestFootnotes,
              };
              for (const staleId of [requestedNoteId, savingNoteId]) {
                if (staleId !== updated.id) {
                  delete commentsMapRef.current[staleId];
                  delete footnotesMapRef.current[staleId];
                  annotationVersionsRef.current.delete(staleId);
                }
              }
              annotationVersionsRef.current.set(
                updated.id,
                currentAnnotationVersion,
              );
              setCommentsMap(commentsMapRef.current);
              setFootnotesMap(footnotesMapRef.current);
              setHasExternalChanges(false);

              if (
                selectedNoteIdRef.current === requestedNoteId ||
                selectedNoteIdRef.current === savingNoteId
              ) {
                selectedNoteIdRef.current = updated.id;
                currentNoteRef.current = prepared.note;
                setSelectedNoteId(updated.id);
                setCurrentNote(prepared.note);
              }

              scheduleRefresh();
              setTimeout(() => {
                recentlySavedRef.current.delete(savingNoteId);
                recentlySavedRef.current.delete(updated.id);
              }, 1000);
              return prepared.note;
            } catch (error) {
              recentlySavedRef.current.delete(savingNoteId);
              if (
                typeof error === "object" &&
                error !== null &&
                "kind" in error &&
                error.kind === "conflict"
              ) {
                blockedNoteSaveErrorsRef.current.set(key, error);
              }
              setError(
                error instanceof Error
                  ? error.message
                  : "Failed to save note",
              );
              throw error;
            }
          },
        },
      );
    },
    [getNoteSaveQueueKey, scheduleRefresh],
  );

  const saveNote = useCallback(
    async (request: DocumentSaveRequest, noteId?: string) => {
      const savingNoteId = noteId ?? currentNoteRef.current?.id;
      if (!savingNoteId) return null;
      const annotationVersion =
        annotationVersionsRef.current.get(savingNoteId) ?? 0;

      return enqueueNoteSave(savingNoteId, {
        annotationVersion,
        createRequest: (base) => {
          const rebasedRequest = rebaseSaveRequestToSnapshot(
            request,
            base.snapshot,
          );
          return prepareStorageSaveRequest(
            rebasedRequest,
            footnotesMapRef.current[base.id] ??
              footnotesMapRef.current[savingNoteId] ??
              [],
            commentsMapRef.current[base.id] ??
              commentsMapRef.current[savingNoteId] ??
              [],
          );
        },
      });
    },
    [enqueueNoteSave],
  );

  const retainRecoveryDraft = useCallback(
    async (request: DocumentSaveRequest, noteId?: string) => {
      const savingNoteId = noteId || currentNote?.id;
      if (!savingNoteId) {
        throw new Error("No note is selected");
      }
      const storageRequest = prepareStorageSaveRequest(
        request,
        footnotesMapRef.current[savingNoteId] || [],
        commentsMapRef.current[savingNoteId] || [],
      );
      return notesService.retainNoteRecoveryDraft(
        savingNoteId,
        storageRequest,
      );
    },
    [currentNote],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        await notesService.deleteNote(id);

        // Clean up pinned status for deleted note
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];
        const protectedIds =
          currentSettings.preserveSourceFormattingNoteIds || [];
        if (pinnedIds.includes(id) || protectedIds.includes(id)) {
          const updatedSettings = {
            ...currentSettings,
            pinnedNoteIds: pinnedIds.filter((pinId) => pinId !== id),
            preserveSourceFormattingNoteIds: protectedIds.filter(
              (noteId) => noteId !== id,
            ),
          };
          await notesService.updateSettings(updatedSettings);
        }

        if (selectedNoteIdRef.current === id) {
          selectedNoteIdRef.current = null;
          currentNoteRef.current = null;
          setSelectedNoteId(null);
          setCurrentNote(null);
        }
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete note");
      }
    },
    [refreshNotes]
  );

  const duplicateNote = useCallback(
    async (id: string) => {
      try {
        const newNote = await notesService.duplicateNote(id);
        recordCreationDate(newNote.id);
        selectRequestIdRef.current += 1;
        // Mark as recently saved to ignore file-change events from our own creation
        recentlySavedRef.current.add(newNote.id);
        await refreshNotes();
        installPreparedNote(newNote);
        selectedNoteIdRef.current = newNote.id;
        setSelectedNoteId(newNote.id);
        setTimeout(() => {
          recentlySavedRef.current.delete(newNote.id);
        }, 1000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to duplicate note");
      }
    },
    [installPreparedNote, refreshNotes]
  );

  const pinNote = useCallback(
    async (id: string) => {
      try {
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];

        if (!pinnedIds.includes(id)) {
          const updatedSettings = {
            ...currentSettings,
            pinnedNoteIds: [...pinnedIds, id],
          };
          await notesService.updateSettings(updatedSettings);
          await refreshNotes();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to pin note");
      }
    },
    [refreshNotes]
  );

  const unpinNote = useCallback(
    async (id: string) => {
      try {
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];

        const updatedSettings = {
          ...currentSettings,
          pinnedNoteIds: pinnedIds.filter((pinId) => pinId !== id),
        };
        await notesService.updateSettings(updatedSettings);
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to unpin note");
      }
    },
    [refreshNotes]
  );

  const persistAnnotations = useCallback(
    async (
      noteId: string,
      footnotes: Footnote[],
      comments: Comment[],
    ) => {
      const annotationVersion =
        annotationVersionsRef.current.get(noteId) ?? 0;
      await enqueueNoteSave(noteId, {
        annotationVersion,
        createRequest: (base) => {
          const storageContent = appendComments(
            appendFootnotes(base.content, footnotes),
            comments,
          );
          return {
            ...notesService.createSaveRequest(
              base.snapshot,
              storageContent,
            ),
            contentIsStorageSource: true,
          };
        },
      });
    },
    [enqueueNoteSave],
  );

  const addComment = useCallback(
    async (noteId: string, text: string) => {
      bumpAnnotationVersion(noteId);
      const newComment: Comment = {
        id: crypto.randomUUID(),
        text,
        timestamp: Math.floor(Date.now() / 1000),
      };
      const updatedComments = [
        ...(commentsMapRef.current[noteId] || []),
        newComment,
      ];
      commentsMapRef.current = {
        ...commentsMapRef.current,
        [noteId]: updatedComments,
      };
      setCommentsMap((prev) => ({
        ...prev,
        [noteId]: updatedComments,
      }));
      await persistAnnotations(
        noteId,
        footnotesMapRef.current[noteId] || [],
        updatedComments,
      );
    },
    [bumpAnnotationVersion, persistAnnotations],
  );

  const deleteComment = useCallback(
    async (noteId: string, commentId: string) => {
      bumpAnnotationVersion(noteId);
      const updatedComments = (
        commentsMapRef.current[noteId] || []
      ).filter((comment) => comment.id !== commentId);
      commentsMapRef.current = {
        ...commentsMapRef.current,
        [noteId]: updatedComments,
      };
      setCommentsMap((prev) => ({
        ...prev,
        [noteId]: updatedComments,
      }));
      await persistAnnotations(
        noteId,
        footnotesMapRef.current[noteId] || [],
        updatedComments,
      );
    },
    [bumpAnnotationVersion, persistAnnotations],
  );

  const addFootnote = useCallback(
    async (noteId: string, id: string, text: string) => {
      bumpAnnotationVersion(noteId);
      const currentFootnotes = footnotesMapRef.current[noteId] || [];
      const exists = currentFootnotes.some(
        (footnote) => footnote.id === id,
      );
      const updatedFootnotes = exists
        ? currentFootnotes.map((footnote) =>
            footnote.id === id ? { ...footnote, text } : footnote,
          )
        : [...currentFootnotes, { id, text }];
      footnotesMapRef.current = {
        ...footnotesMapRef.current,
        [noteId]: updatedFootnotes,
      };
      setFootnotesMap((prev) => ({
        ...prev,
        [noteId]: updatedFootnotes,
      }));
      await persistAnnotations(
        noteId,
        updatedFootnotes,
        commentsMapRef.current[noteId] || [],
      );
    },
    [bumpAnnotationVersion, persistAnnotations],
  );

  const updateFootnote = useCallback(
    async (noteId: string, id: string, text: string) => {
      bumpAnnotationVersion(noteId);
      const updatedFootnotes = (
        footnotesMapRef.current[noteId] || []
      ).map((footnote) =>
        footnote.id === id ? { ...footnote, text } : footnote,
      );
      footnotesMapRef.current = {
        ...footnotesMapRef.current,
        [noteId]: updatedFootnotes,
      };
      setFootnotesMap((prev) => ({
        ...prev,
        [noteId]: updatedFootnotes,
      }));
      await persistAnnotations(
        noteId,
        updatedFootnotes,
        commentsMapRef.current[noteId] || [],
      );
    },
    [bumpAnnotationVersion, persistAnnotations],
  );

  const deleteFootnote = useCallback(
    async (noteId: string, id: string) => {
      bumpAnnotationVersion(noteId);
      const updatedFootnotes = (
        footnotesMapRef.current[noteId] || []
      ).filter((footnote) => footnote.id !== id);
      footnotesMapRef.current = {
        ...footnotesMapRef.current,
        [noteId]: updatedFootnotes,
      };
      setFootnotesMap((prev) => ({
        ...prev,
        [noteId]: updatedFootnotes,
      }));
      await persistAnnotations(
        noteId,
        updatedFootnotes,
        commentsMapRef.current[noteId] || [],
      );
    },
    [bumpAnnotationVersion, persistAnnotations],
  );

  const createNoteInFolder = useCallback(
    async (folderPath: string) => {
      try {
        const note = await notesService.createNote(folderPath);
        recordCreationDate(note.id);
        selectRequestIdRef.current += 1;
        pendingNewNoteIdRef.current = note.id;
        recentlySavedRef.current.add(note.id);
        await refreshNotes();
        installPreparedNote(note);
        selectedNoteIdRef.current = note.id;
        setSelectedNoteId(note.id);
        setSearchQuery("");
        setSearchResults([]);
        setTimeout(() => {
          recentlySavedRef.current.delete(note.id);
        }, 1000);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create note"
        );
      }
    },
    [installPreparedNote, refreshNotes]
  );

  const createFolderAction = useCallback(
    async (parentPath: string, name: string) => {
      try {
        const fullPath = parentPath ? `${parentPath}/${name}` : name;
        await notesService.createFolder(fullPath);
        await refreshNotes();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create folder"
        );
      }
    },
    [refreshNotes]
  );

  const deleteFolderAction = useCallback(
    async (path: string) => {
      try {
        await notesService.deleteFolder(path);
        if (selectedNoteIdRef.current?.startsWith(path + "/")) {
          selectedNoteIdRef.current = null;
          currentNoteRef.current = null;
          setSelectedNoteId(null);
          setCurrentNote(null);
        }
        await refreshNotes();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete folder"
        );
      }
    },
    [refreshNotes]
  );

  const renameFolderAction = useCallback(
    async (oldPath: string, newName: string) => {
      try {
        await notesService.renameFolder(oldPath, newName);

        // Compute new folder path
        const lastSlash = oldPath.lastIndexOf("/");
        const newPath =
          lastSlash >= 0
            ? `${oldPath.substring(0, lastSlash)}/${newName}`
            : newName;
        const oldPrefix = oldPath + "/";
        const newPrefix = newPath + "/";

        const selectedId = selectedNoteIdRef.current;
        if (selectedId?.startsWith(oldPrefix)) {
          const newId =
            newPrefix + selectedId.substring(oldPrefix.length);
          selectedNoteIdRef.current = newId;
          setSelectedNoteId(newId);
          const note = await notesService.readNote(newId);
          if (selectedNoteIdRef.current === newId) {
            installPreparedNote(note, selectedId);
          }
        }

        await refreshNotes();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to rename folder"
        );
      }
    },
    [installPreparedNote, refreshNotes]
  );

  const moveNoteAction = useCallback(
    async (id: string, targetFolder: string) => {
      try {
        const newId = await notesService.moveNote(id, targetFolder);
        // Update selection if we moved the selected note
        if (selectedNoteIdRef.current === id) {
          selectedNoteIdRef.current = newId;
          setSelectedNoteId(newId);
          const note = await notesService.readNote(newId);
          if (selectedNoteIdRef.current === newId) {
            installPreparedNote(note, id);
          }
        }
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to move note");
      }
    },
    [installPreparedNote, refreshNotes]
  );

  const moveFolderAction = useCallback(
    async (path: string, targetParent: string) => {
      try {
        await notesService.moveFolder(path, targetParent);

        // Compute new folder path
        const folderName = path.includes("/")
          ? path.substring(path.lastIndexOf("/") + 1)
          : path;
        const newPath = targetParent
          ? `${targetParent}/${folderName}`
          : folderName;
        const oldPrefix = path + "/";
        const newPrefix = newPath + "/";

        const selectedId = selectedNoteIdRef.current;
        if (selectedId?.startsWith(oldPrefix)) {
          const newId =
            newPrefix + selectedId.substring(oldPrefix.length);
          selectedNoteIdRef.current = newId;
          setSelectedNoteId(newId);
          const note = await notesService.readNote(newId);
          if (selectedNoteIdRef.current === newId) {
            installPreparedNote(note, selectedId);
          }
        }

        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to move folder");
      }
    },
    [installPreparedNote, refreshNotes]
  );

  const setNotesFolder = useCallback(async (path: string) => {
    try {
      await notesService.setNotesFolder(path);
      setNotesFolderState(path);
      // Start file watcher after setting folder
      await notesService.startFileWatcher();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set notes folder"
      );
    }
  }, []);

  // Update local state only (backend already initialized the folder).
  // Used when the CLI sets the notes folder and emits an event.
  const syncNotesFolder = useCallback(async (path: string) => {
    try {
      setNotesFolderState(path);
      selectedNoteIdRef.current = null;
      currentNoteRef.current = null;
      setSelectedNoteId(null);
      setCurrentNote(null);
      const notesList = await notesService.listNotes();
      setNotes(notesList);
      await notesService.startFileWatcher();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sync notes folder"
      );
    }
  }, []);

  const search = useCallback(async (query: string) => {
    const requestId = ++searchRequestIdRef.current;
    setSearchQuery(query);

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const queryLower = trimmedQuery.toLowerCase();
    // Instant local results for responsive UX while full-text search runs.
    const instantResults: SearchResult[] = notesRef.current
      .filter(
        (note) =>
          note.title.toLowerCase().includes(queryLower) ||
          note.preview.toLowerCase().includes(queryLower),
      )
      .slice(0, 20)
      .map((note) => ({
        id: note.id,
        title: note.title,
        preview: note.preview,
        modified: note.modified,
        score: 0,
      }));

    // Show instant local matches immediately; clear stale results if none match.
    setSearchResults(instantResults);

    setIsSearching(true);
    try {
      const results = await notesService.searchNotes(trimmedQuery);
      if (requestId !== searchRequestIdRef.current) return;
      if (results.length === 0) {
        // If neither backend nor instant matches found, clear results only now
        // (after async search settles) to avoid transient empty states.
        setSearchResults(instantResults);
      } else {
        // Merge backend + instant results, deduping by note id.
        const merged = [...results];
        const seen = new Set(results.map((result) => result.id));
        for (const result of instantResults) {
          if (!seen.has(result.id)) {
            merged.push(result);
          }
        }
        setSearchResults(merged);
      }
    } catch (err) {
      console.error("Search failed:", err);
    }
    if (requestId !== searchRequestIdRef.current) return;
    setIsSearching(false);
  }, []);

  const clearSearch = useCallback(() => {
    searchRequestIdRef.current += 1;
    setSearchQuery("");
    setSearchResults([]);
    setIsSearching(false);
  }, []);

  // Load initial state
  useEffect(() => {
    async function init() {
      try {
        const folder = await notesService.getNotesFolder();
        setNotesFolderState(folder);
        if (folder) {
          const notesList = await notesService.listNotes();
          setNotes(notesList);
          // Start file watcher
          await notesService.startFileWatcher();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Listen for file change events and notify if current note changed externally
  useEffect(() => {
    let isCancelled = false;
    let unlisten: (() => void) | undefined;

    listen<{ changed_ids: string[] }>("file-change", (event) => {
      // Don't process if effect was cleaned up
      if (isCancelled) return;

      const changedIds = event.payload.changed_ids || [];

      // Filter out notes we recently saved ourselves
      const externalChanges = changedIds.filter(
        (id) => !recentlySavedRef.current.has(id)
      );

      // Only refresh if there are external changes
      if (externalChanges.length > 0) {
        refreshNotes();

        // If the currently selected note was changed externally, set flag (don't auto-reload)
        const currentId = selectedNoteIdRef.current;
        if (currentId && externalChanges.includes(currentId)) {
          setHasExternalChanges(true);
        }
      }
    }).then((fn) => {
      if (isCancelled) {
        // Effect was cleaned up before listener registered, clean up immediately
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      isCancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshNotes]);

  // Register before draining native startup requests so first-launch file associations
  // cannot emit a selection event before the React interface is listening.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const registerSelectionListener = async () => {
      const dispose = await listen<string>("select-note", (event) => {
        // Refresh the notes list so the sidebar shows the new note immediately
        void refreshNotes();
        void selectNote(event.payload);
      });

      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;

      const pendingNoteIds = await invoke<string[]>("mark_main_ui_ready");
      if (cancelled || pendingNoteIds.length === 0) return;

      await refreshNotes();
      for (const noteId of pendingNoteIds) {
        if (cancelled) return;
        await selectNote(noteId);
      }
    };

    void registerSelectionListener();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [selectNote, refreshNotes]);

  // Refresh notes when folder changes
  useEffect(() => {
    if (notesFolder) {
      refreshNotes();
    }
  }, [notesFolder, refreshNotes]);

  // Memoize data context value to prevent unnecessary re-renders
  const dataValue = useMemo<NotesDataContextValue>(
    () => ({
      notes,
      selectedNoteId,
      currentNote,
      notesFolder,
      isLoading,
      error,
      searchQuery,
      searchResults,
      isSearching,
      hasExternalChanges,
      reloadVersion,
      commentsMap,
      footnotesMap,
      activeCommentsNoteId,
      activeCommentsInitialText,
      sortBy,
    }),
    [
      notes,
      selectedNoteId,
      currentNote,
      notesFolder,
      isLoading,
      error,
      searchQuery,
      searchResults,
      isSearching,
      hasExternalChanges,
      reloadVersion,
      commentsMap,
      footnotesMap,
      activeCommentsNoteId,
      activeCommentsInitialText,
      sortBy,
    ]
  );

  // Memoize actions context value - these are stable callbacks
  const actionsValue = useMemo<NotesActionsContextValue>(
    () => ({
      selectNote,
      createNote,
      consumePendingNewNote,
      saveNote,
      retainRecoveryDraft,
      deleteNote,
      duplicateNote,
      refreshNotes,
      reloadCurrentNote,
      setNotesFolder,
      syncNotesFolder,
      search,
      clearSearch,
      pinNote,
      unpinNote,
      createNoteInFolder,
      createFolder: createFolderAction,
      deleteFolder: deleteFolderAction,
      renameFolder: renameFolderAction,
      moveNote: moveNoteAction,
      moveFolder: moveFolderAction,
      addComment,
      deleteComment,
      addFootnote,
      updateFootnote,
      deleteFootnote,
      setActiveCommentsNoteId,
      setSortBy,
    }),
    [
      selectNote,
      createNote,
      consumePendingNewNote,
      saveNote,
      retainRecoveryDraft,
      deleteNote,
      duplicateNote,
      refreshNotes,
      reloadCurrentNote,
      setNotesFolder,
      syncNotesFolder,
      search,
      clearSearch,
      pinNote,
      unpinNote,
      createNoteInFolder,
      createFolderAction,
      deleteFolderAction,
      renameFolderAction,
      moveNoteAction,
      moveFolderAction,
      addComment,
      deleteComment,
      addFootnote,
      updateFootnote,
      deleteFootnote,
      setActiveCommentsNoteId,
      setSortBy,
    ]
  );

  return (
    <NotesActionsContext.Provider value={actionsValue}>
      <NotesDataContext.Provider value={dataValue}>
        {children}
      </NotesDataContext.Provider>
    </NotesActionsContext.Provider>
  );
}

// Hook to get notes data (subscribes to data changes)
export function useNotesData() {
  const context = useContext(NotesDataContext);
  if (!context) {
    throw new Error("useNotesData must be used within a NotesProvider");
  }
  return context;
}

// Hook to get notes actions (stable references, rarely causes re-renders)
export function useNotesActions() {
  const context = useContext(NotesActionsContext);
  if (!context) {
    throw new Error("useNotesActions must be used within a NotesProvider");
  }
  return context;
}

// Combined hook for convenience (backward compatible)
export function useNotes() {
  const data = useNotesData();
  const actions = useNotesActions();
  return { ...data, ...actions };
}

// Optional hook that returns null when outside a NotesProvider (for preview mode)
export function useOptionalNotes() {
  const data = useContext(NotesDataContext);
  const actions = useContext(NotesActionsContext);
  if (!data || !actions) return null;
  return { ...data, ...actions };
}
