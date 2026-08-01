import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { listen } from "@tauri-apps/api/event";
import { GitProvider } from "./context/GitContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { SidebarResizeHandle } from "./components/layout/SidebarResizeHandle";
import { SIDEBAR_DEFAULT_PX } from "./lib/sidebar";
import { Editor } from "./components/editor/Editor";
import { PreviewApp } from "./components/preview/PreviewApp";
import { TabBar, type TabItem } from "./components/editor/TabBar";
import { UnsavedChangesModal } from "./components/editor/UnsavedChangesModal";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { FolderPicker } from "./components/layout/FolderPicker";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { SettingsPage } from "./components/settings";
import {
  SpinnerIcon,
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
} from "./components/icons";
import { AiEditModal } from "./components/ai/AiEditModal";
import { CommentsModal } from "./components/notes/CommentsModal";
import { AiResponseToast } from "./components/ai/AiResponseToast";
import { KeyboardShortcutsModal } from "./components/shortcuts/KeyboardShortcutsModal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as aiService from "./services/ai";
import type { AiProvider } from "./services/ai";
import { isMac, isWindows } from "./lib/platform";

type ViewState = "notes" | "settings";

interface AppContentProps {
  externalFilePath: string | null;
  onExitExternalFile: () => void;
}

function AppContent({
  externalFilePath,
  onExitExternalFile,
}: AppContentProps) {
  const {
    notesFolder,
    isLoading,
    createNote,
    duplicateNote,
    notes,
    selectedNoteId,
    selectNote,
    searchQuery,
    searchResults,
    reloadCurrentNote,
    currentNote,
    syncNotesFolder,
  } = useNotes();
  const { interfaceZoom, setInterfaceZoom, reloadSettings } = useTheme();
  const interfaceZoomRef = useRef(interfaceZoom);
  interfaceZoomRef.current = interfaceZoom;
  const currentNoteRef = useRef(currentNote);
  currentNoteRef.current = currentNote;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<ViewState>("notes");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("claude");
  const editorRef = useRef<TiptapEditor | null>(null);

  // Listen for set-notes-folder event from CLI (markdown-editor .)
  // Placed here in AppContent where both NotesContext and ThemeContext are available
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>("set-notes-folder", async (event) => {
      await syncNotesFolder(event.payload);
      await reloadSettings();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [syncNotesFolder, reloadSettings]);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((prev) => !prev);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      // Don't enter focus mode without an open managed or external document.
      if (!prev && !selectedNoteId && !externalFilePath) return prev;
      if (prev) {
        // Exiting focus mode — always restore sidebar
        setSidebarVisible(true);
      }
      return !prev;
    });
  }, [selectedNoteId, externalFilePath]);

  const createManagedNote = useCallback(async () => {
    if (!notesFolder) {
      toast.error("Choose a notes folder before creating a new note");
      return;
    }
    await createNote();
    if (externalFilePath) onExitExternalFile();
  }, [createNote, externalFilePath, notesFolder, onExitExternalFile]);

  const [openTabs, setOpenTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Track tabs explicitly closed by the user so the sync effect doesn't re-add them.
  const closedTabIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (externalFilePath) {
      // Re-opening an external file clears its closed status.
      closedTabIdsRef.current.delete(externalFilePath);
      const fileName =
        externalFilePath.substring(
          Math.max(
            externalFilePath.lastIndexOf("/"),
            externalFilePath.lastIndexOf("\\"),
          ) + 1,
        ) || "External File";
      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === externalFilePath)) return prev;
        return [
          ...prev,
          {
            id: externalFilePath,
            title: fileName,
            path: externalFilePath,
            isExternal: true,
          },
        ];
      });
      setActiveTabId(externalFilePath);
    } else if (selectedNoteId && currentNote) {
      // Don't re-open a tab the user just closed.
      if (closedTabIdsRef.current.has(selectedNoteId)) return;
      setOpenTabs((prev) => {
        const title = currentNote.title || "Untitled";
        const existingIndex = prev.findIndex((t) => t.id === selectedNoteId);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            title,
            path: currentNote.path,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: selectedNoteId,
            title,
            path: currentNote.path,
            isExternal: false,
          },
        ];
      });
      setActiveTabId(selectedNoteId);
    }
  }, [externalFilePath, selectedNoteId, currentNote]);

  const [unsavedModalTab, setUnsavedModalTab] = useState<TabItem | null>(null);
  const openTabsRef = useRef<TabItem[]>(openTabs);
  openTabsRef.current = openTabs;
  const isClosingWindowRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        // Listen for the Rust-level close interception.
        // Rust always prevents the OS close and fires this event so we can
        // decide: destroy() immediately (no dirty external files) or show the
        // save/discard dialog first.
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("app-close-requested", async () => {
          try {
            const dirtyExternalTab = openTabsRef.current.find(
              (t) => t.isExternal && t.isDirty,
            );
            if (dirtyExternalTab) {
              isClosingWindowRef.current = true;
              setActiveTabId(dirtyExternalTab.id);
              setUnsavedModalTab(dirtyExternalTab);
              // destroy() will be called by checkNextWindowClose after the dialog.
            } else {
              // Nothing to save — close immediately.
try {
  await getCurrentWindow().destroy();
} catch (destroyErr) {
  console.warn("destroy failed, invoking backend termination", destroyErr);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("terminate_application");
}
            }
          } catch (err) {
            console.error("app-close-requested handler error:", err);
            // Ensure the window can still close on error.
            try { await getCurrentWindow().destroy(); } catch { /* ignore */ }
          }
        });
      } catch (err) {
        console.warn("Window close listener setup failed:", err);
      }
    };
    setup();
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const handleDirtyChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; isDirty: boolean };
      if (!detail?.path) return;
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === detail.path || t.path === detail.path
            ? { ...t, isDirty: detail.isDirty }
            : t,
        ),
      );
    };
    window.addEventListener("document-dirty-changed", handleDirtyChange);
    return () => window.removeEventListener("document-dirty-changed", handleDirtyChange);
  }, []);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      const tab = openTabs.find((t) => t.id === tabId);
      if (!tab) return;
      if (!tab.isExternal) {
        selectNote(tab.id);
      }
    },
    [openTabs, selectNote],
  );

  const performCloseTab = useCallback(
    (tabId: string) => {
      // Mark this tab as explicitly closed so the sync effect won't re-add it.
      closedTabIdsRef.current.add(tabId);
      setOpenTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const nextTab = filtered[filtered.length - 1];
          if (nextTab) {
            setActiveTabId(nextTab.id);
            // If switching to a managed note, clear its closed status first.
            closedTabIdsRef.current.delete(nextTab.id);
            if (!nextTab.isExternal) selectNote(nextTab.id);
          } else {
            setActiveTabId(null);
          }
        }
        return filtered;
      });
      if (tabId === externalFilePath) {
        onExitExternalFile();
      }
    },
    [activeTabId, externalFilePath, onExitExternalFile, selectNote],
  );

  const handleCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const tab = openTabs.find((t) => t.id === tabId);
      if (tab?.isDirty) {
        setUnsavedModalTab(tab);
        return;
      }
      performCloseTab(tabId);
    },
    [openTabs, performCloseTab],
  );

  const checkNextWindowClose = useCallback(
    (closedTabId: string) => {
      if (isClosingWindowRef.current) {
        const remainingDirty = openTabsRef.current.filter(
          (t) => t.id !== closedTabId && t.isExternal && t.isDirty,
        );
        if (remainingDirty.length > 0) {
          const next = remainingDirty[0];
          setActiveTabId(next.id);
          setUnsavedModalTab(next);
        } else {
          isClosingWindowRef.current = false;
          try {
            void getCurrentWindow().destroy();
          } catch {
            // ignore
          }
        }
      }
    },
    [],
  );

  const handleModalSave = useCallback(() => {
    if (!unsavedModalTab) return;
    window.dispatchEvent(new CustomEvent("trigger-explicit-save"));
    const tabId = unsavedModalTab.id;
    setUnsavedModalTab(null);
    performCloseTab(tabId);
    checkNextWindowClose(tabId);
  }, [unsavedModalTab, performCloseTab, checkNextWindowClose]);

  const handleModalDontSave = useCallback(() => {
    if (!unsavedModalTab) return;
    const tabId = unsavedModalTab.id;
    setUnsavedModalTab(null);
    performCloseTab(tabId);
    checkNextWindowClose(tabId);
  }, [unsavedModalTab, performCloseTab, checkNextWindowClose]);

  const handleModalCancel = useCallback(() => {
    setUnsavedModalTab(null);
    isClosingWindowRef.current = false;
  }, []);

  const toggleSettings = useCallback(() => {
    setView((prev) => (prev === "settings" ? "notes" : "settings"));
  }, []);

  const closeSettings = useCallback(() => {
    setView("notes");
  }, []);

  // Go back to command palette from AI modal
  const handleBackToPalette = useCallback(() => {
    setAiModalOpen(false);
    setPaletteOpen(true);
  }, []);

  // AI Edit handler
  const handleAiEdit = useCallback(
    async (prompt: string, modelName?: string) => {
      if (!currentNote) {
        toast.error("No note selected");
        return;
      }

      setAiEditing(true);

      try {
        let result: aiService.AiExecutionResult;
        if (aiProvider === "codex") {
          result = await aiService.executeCodexEdit(currentNote.path, prompt);
        } else if (aiProvider === "opencode") {
          result = await aiService.executeOpenCodeEdit(currentNote.path, prompt);
        } else if (aiProvider === "ollama") {
          result = await aiService.executeOllamaEdit(
            currentNote.path,
            prompt,
            modelName || "qwen3:8b",
          );
        } else if (aiProvider === "lmstudio") {
          result = await aiService.executeLMStudioEdit(
            currentNote.path,
            prompt,
            modelName,
          );
        } else if (aiProvider === "antigravity") {
          result = await aiService.executeAntigravityEdit(
            currentNote.path,
            prompt,
            modelName,
          );
        } else {
          result = await aiService.executeClaudeEdit(currentNote.path, prompt);
        }

        // Reload the current note from disk
        await reloadCurrentNote();

        // Show results
        if (result.success) {
          // Close modal after success
          setAiModalOpen(false);

          // Show success toast with provider response
          toast(
            <AiResponseToast output={result.output} provider={aiProvider} />,
            {
              duration: Infinity,
              closeButton: true,
              className: "!min-w-[450px] !max-w-[600px]",
            },
          );
        } else {
          toast.error(
            <div className="space-y-1">
              <div className="font-medium">AI Edit Failed</div>
              <div className="text-xs">{result.error || "Unknown error"}</div>
            </div>,
            { duration: Infinity, closeButton: true },
          );
        }
      } catch (error) {
        console.error("[AI] Error:", error);
        toast.error(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        setAiEditing(false);
      }
    },
    [aiProvider, currentNote, reloadCurrentNote],
  );

  // Memoize display items to prevent unnecessary recalculations
  const displayItems = useMemo(() => {
    return searchQuery.trim() ? searchResults : notes;
  }, [searchQuery, searchResults, notes]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInEditor = !!target.closest(".ProseMirror");
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const isEditorEmpty =
        isInEditor && currentNoteRef.current?.content.trim() === "";

      // Cmd+, - Toggle settings (always works, even in settings)
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        toggleSettings();
        return;
      }

      // Cmd+= or Cmd++ - Zoom in (works everywhere, including settings)
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setInterfaceZoom((prev) => prev + 0.05);
        const newZoom = Math.round(Math.min(interfaceZoomRef.current + 0.05, 1.5) * 20) / 20;
        toast(`Zoom ${Math.round(newZoom * 100)}%`, { id: "zoom", duration: 1500 });
        return;
      }

      // Cmd+- - Zoom out (works everywhere, including settings)
      if ((e.metaKey || e.ctrlKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        setInterfaceZoom((prev) => prev - 0.05);
        const newZoom = Math.round(Math.max(interfaceZoomRef.current - 0.05, 0.7) * 20) / 20;
        toast(`Zoom ${Math.round(newZoom * 100)}%`, { id: "zoom", duration: 1500 });
        return;
      }

      // Cmd+0 - Reset zoom (works everywhere, including settings)
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        setInterfaceZoom(1.0);
        toast("Zoom 100%", { id: "zoom", duration: 1500 });
        return;
      }

      // Block all other shortcuts when in settings view
      if (view === "settings") {
        return;
      }

      // Cmd+Shift+Enter - Toggle focus mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Cmd+Shift+M - Toggle markdown source mode
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-source-mode"));
        return;
      }

      // Escape exits focus mode when not in editor
      if (e.key === "Escape" && focusMode && !isInEditor) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Let dialogs handle their own keyboard events (Tab, Enter, etc.)
      if (target.closest("[role='dialog'], [role='alertdialog']")) {
        return;
      }

      // Trap Tab/Shift+Tab in notes view only - prevent focus navigation
      // TipTap handles indentation internally before event bubbles up
      if (e.key === "Tab") {
        e.preventDefault();
        return;
      }

      // Cmd+P - Open command palette
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // Cmd+Shift+P - Print
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("print-note"));
        return;
      }

      // Cmd+/ - Open keyboard shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // Cmd/Ctrl+Shift+F - Open sidebar search
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        setSidebarVisible(true);
        window.dispatchEvent(new CustomEvent("open-sidebar-search"));
        return;
      }

      // Cmd+\ - Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+N - New note
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        void createManagedNote();
        return;
      }

      // Delete current note (note list focused, or editor on empty note)
      if (
        selectedNoteId &&
        !isInInput &&
        (e.key === "Delete" ||
          (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) &&
        (!isInEditor || isEditorEmpty)
      ) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("request-delete-note", { detail: selectedNoteId }),
        );
        return;
      }

      // Cmd+D - Duplicate current note
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "d" &&
        !isInEditor &&
        !isInInput &&
        selectedNoteId
      ) {
        e.preventDefault();
        duplicateNote(selectedNoteId);
        return;
      }

      // Cmd+R - Reload current note (pull external changes)
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        if (externalFilePath) {
          window.dispatchEvent(new CustomEvent("reload-external-file"));
        } else {
          reloadCurrentNote();
        }
        return;
      }

      // Arrow keys for note navigation
      // Skip if folder tree view is handling its own navigation
      const isInFolderTree = !!(e.target as HTMLElement).closest("[data-folder-tree]");
      if (
        displayItems.length > 0 &&
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        ((!isInEditor && !isInInput) || isEditorEmpty) &&
        !isInFolderTree
      ) {
        e.preventDefault();
        const currentIndex = displayItems.findIndex(
          (n: { id: string }) => n.id === selectedNoteId,
        );
        let newIndex: number;

        if (e.key === "ArrowDown") {
          newIndex =
            currentIndex < displayItems.length - 1 ? currentIndex + 1 : 0;
        } else {
          newIndex =
            currentIndex > 0 ? currentIndex - 1 : displayItems.length - 1;
        }

        selectNote(displayItems[newIndex].id);
        window.dispatchEvent(new CustomEvent("focus-note-list"));
        return;
      }

      // Enter to focus editor
      if (e.key === "Enter" && selectedNoteId && !isInEditor && !isInInput) {
        e.preventDefault();
        const editor = document.querySelector(".ProseMirror") as HTMLElement;
        if (editor) {
          editor.focus();
        }
        return;
      }

      // Escape to blur editor and go back to note list
      if (e.key === "Escape" && isInEditor) {
        e.preventDefault();
        (target as HTMLElement).blur();
        // Focus the note list for keyboard navigation
        window.dispatchEvent(new CustomEvent("focus-note-list"));
        return;
      }
    };

    // Disable right-click context menu except in editor
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Allow context menu in editor (prose class), inputs, and note list sidebar
      const isInEditor =
        target.closest(".prose") || target.closest(".ProseMirror");
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const isInNoteList = target.closest("[data-note-list]");
      if (!isInEditor && !isInput && !isInNoteList) {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [
    createManagedNote,
    duplicateNote,
    displayItems,
    reloadCurrentNote,
    selectedNoteId,
    selectNote,
    toggleSettings,
    toggleSidebar,
    toggleFocusMode,
    focusMode,
    view,
    externalFilePath,
    setInterfaceZoom,
  ]);

  const handleClosePalette = useCallback(() => {
    setPaletteOpen(false);
    editorRef.current?.commands.focus();
  }, []);

  if (isLoading) {
    return (
      <div className="h-full min-h-0 flex items-center justify-center bg-bg-secondary">
        <div className="text-text-muted/70 text-sm flex items-center gap-1.5 font-medium">
          <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
          Initializing Markdown Editor...
        </div>
      </div>
    );
  }

  if (!notesFolder) {
    if (externalFilePath) {
      return (
        <PreviewApp
          filePath={externalFilePath}
          focusMode={focusMode}
          onExitPreview={onExitExternalFile}
        />
      );
    }
    return <FolderPicker />;
  }

  return (
    <>
      <div className="h-full min-h-0 flex bg-bg text-text overflow-hidden">
        {view === "settings" ? (
          <SettingsPage onBack={closeSettings} />
        ) : (
          <>
            <div
              data-sidebar
              style={{ width: (!sidebarVisible || focusMode) ? 0 : `var(--sidebar-width, ${SIDEBAR_DEFAULT_PX}px)` }}
              className={`relative transition-all duration-500 ease-out overflow-hidden ${!sidebarVisible || focusMode ? "opacity-0 -translate-x-4 pointer-events-none" : "opacity-100 translate-x-0"}`}
            >
              <Sidebar
                onOpenSettings={toggleSettings}
                onCreateNote={createManagedNote}
              />
              {sidebarVisible && !focusMode && <SidebarResizeHandle />}
            </div>
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
              <TabBar
                tabs={openTabs}
                activeTabId={activeTabId}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
                onNewTab={createManagedNote}
              />
              <div className="flex-1 min-h-0 relative">
                {externalFilePath ? (
                  <PreviewApp
                    key={externalFilePath}
                    filePath={externalFilePath}
                    onToggleSidebar={toggleSidebar}
                    sidebarVisible={sidebarVisible}
                    focusMode={focusMode}
                    onExitPreview={onExitExternalFile}
                  />
                ) : (
                  <Editor
                    onToggleSidebar={toggleSidebar}
                    sidebarVisible={sidebarVisible}
                    focusMode={focusMode}
                    onEditorReady={(editor) => {
                      editorRef.current = editor;
                    }}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Shared backdrop for command palette and AI modal */}
      {(paletteOpen || aiModalOpen) && (
        <div
          className="fixed inset-0 bg-text/50 backdrop-blur-sm z-40 animate-fade-in"
          onClick={() => {
            if (paletteOpen) handleClosePalette();
            if (aiModalOpen) setAiModalOpen(false);
          }}
        />
      )}

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={handleClosePalette}
        onOpenSettings={toggleSettings}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenAiModal={(provider) => {
          setAiProvider(provider);
          setAiModalOpen(true);
        }}
        focusMode={focusMode}
        onToggleFocusMode={toggleFocusMode}
        editorRef={editorRef}
      />
      <AiEditModal
        open={aiModalOpen}
        provider={aiProvider}
        onBack={handleBackToPalette}
        onExecute={handleAiEdit}
        isExecuting={aiEditing}
      />

      <CommentsModal />

      <UnsavedChangesModal
        open={Boolean(unsavedModalTab)}
        fileName={unsavedModalTab?.title || "Untitled.md"}
        onSave={handleModalSave}
        onDontSave={handleModalDontSave}
        onCancel={handleModalCancel}
      />

      {/* AI Editing Overlay */}
      {aiEditing && (
        <div className="fixed inset-0 bg-bg/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {aiProvider === "codex" ? (
              <CodexIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            ) : aiProvider === "opencode" ? (
              <OpenCodeIcon className="w-4.5 h-4.5 fill-text-muted animate-pulse-gentle" />
            ) : aiProvider === "ollama" ? (
              <OllamaIcon className="w-4.5 h-4.5 fill-text-muted animate-bounce-gentle" />
            ) : (
              <ClaudeIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            )}
            <div className="text-sm font-medium text-text">
              {aiProvider === "codex"
                ? "Codex is editing your note..."
                : aiProvider === "opencode"
                  ? "OpenCode is editing your note..."
                : aiProvider === "ollama"
                  ? "Ollama is editing your note..."
                  : "Claude is editing your note..."}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface AppProps {
  externalFilePath?: string | null;
  onExitExternalFile?: () => void;
}

function App({
  externalFilePath = null,
  onExitExternalFile = () => undefined,
}: AppProps) {
  // Cmd/Ctrl+W — close window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        getCurrentWindow().close().catch(console.error);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Add platform class for OS-specific styling (e.g., keyboard shortcuts)
  useEffect(() => {
    const os = isMac ? "mac" : isWindows ? "windows" : "linux";
    document.documentElement.classList.add(`platform-${os}`);
  }, []);

  return (
    <ThemeProvider>
      <Toaster />
      <TooltipProvider>
        <NotesProvider>
          <GitProvider>
            <AppContent
              externalFilePath={externalFilePath}
              onExitExternalFile={onExitExternalFile}
            />
          </GitProvider>
        </NotesProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
