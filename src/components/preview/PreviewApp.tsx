import { useState, useCallback, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Editor, type PreviewModeData } from "../editor/Editor";
import * as filesService from "../../services/files";
import type {
  DocumentSaveRequest,
  DocumentSnapshot,
} from "../../lib/documentLifecycle";

interface PreviewAppProps {
  filePath: string;
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  focusMode?: boolean;
  onExitPreview: () => void;
}

export function PreviewApp({
  filePath,
  onToggleSidebar,
  sidebarVisible,
  focusMode = false,
  onExitPreview,
}: PreviewAppProps) {
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [modified, setModified] = useState(0);
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const recentlySavedRef = useRef(false);

  // Load file on mount
  useEffect(() => {
    setContent(null);
    setSnapshot(null);
    setHasExternalChanges(false);
    filesService
      .readFileDirect(filePath)
      .then((result) => {
        setContent(result.content);
        setTitle(result.title);
        setModified(result.modified);
        setSnapshot(result.snapshot);
      })
      .catch((error) => {
        console.error("Failed to load file:", error);
        toast.error(`Failed to load file: ${error}`);
      });
  }, [filePath]);

  // Listen for window focus to detect external changes
  useEffect(() => {
    const handleFocus = async () => {
      if (recentlySavedRef.current) {
        recentlySavedRef.current = false;
        return;
      }
      try {
        const result = await filesService.readFileDirect(filePath);
        if (result.modified !== modified && content !== null) {
          setHasExternalChanges(true);
        }
      } catch {
        // File may have been deleted
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [filePath, modified, content]);

  const save = useCallback(
    async (request: DocumentSaveRequest): Promise<DocumentSnapshot> => {
      try {
        const result = await filesService.saveFileDirect(filePath, request);
        recentlySavedRef.current = true;
        setContent(result.content);
        setModified(result.modified);
        setTitle(result.title);
        setSnapshot(result.snapshot);
        setHasExternalChanges(false);
        return result.snapshot;
      } catch (error) {
        console.error("Failed to save file:", error);
        toast.error(`Failed to save: ${error}`);
        throw error;
      }
    },
    [filePath],
  );

  const retainRecoveryDraft = useCallback(
    (request: DocumentSaveRequest) =>
      filesService.retainFileRecoveryDraft(filePath, request),
    [filePath],
  );

  const reload = useCallback(async () => {
    try {
      const result = await filesService.readFileDirect(filePath);
      setContent(result.content);
      setTitle(result.title);
      setModified(result.modified);
      setSnapshot(result.snapshot);
      setHasExternalChanges(false);
      setReloadVersion((v) => v + 1);
    } catch (error) {
      console.error("Failed to reload file:", error);
      toast.error(`Failed to reload: ${error}`);
    }
  }, [filePath]);

  // Listen for preview-file-change events
  useEffect(() => {
    const unlisten = listen<string>("preview-file-change", () => {
      setHasExternalChanges(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // The main app owns shared shortcuts. This listener only reloads the
  // externally opened file when the main window requests it.
  useEffect(() => {
    const handleReload = () => {
      void reload();
    };
    window.addEventListener("reload-external-file", handleReload);
    return () => window.removeEventListener("reload-external-file", handleReload);
  }, [reload]);

  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const handleSaveToFolder = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      await filesService.importFileToFolder(filePath);
      // The backend selects the imported note in the main interface.
      onExitPreview();
    } catch (error) {
      console.error("Failed to save to folder:", error);
      toast.error(`Failed to save to folder: ${error}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [filePath, onExitPreview]);

  const previewData: PreviewModeData = {
    content,
    title,
    filePath,
    modified,
    snapshot,
    hasExternalChanges,
    reloadVersion,
    save,
    retainRecoveryDraft,
    reload,
  };

  return (
    <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col bg-bg text-text">
      <Editor
        focusMode={focusMode}
        onToggleSidebar={onToggleSidebar}
        sidebarVisible={sidebarVisible}
        previewMode={previewData}
        onSaveToFolder={handleSaveToFolder}
        saveToFolderDisabled={isSaving}
      />
    </div>
  );
}
