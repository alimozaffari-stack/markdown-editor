import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  IconButton,
} from "../ui";
import { NoteIcon, XIcon } from "../icons";
import * as filesService from "../../services/files";
import {
  MAX_RECENT_EXTERNAL_FILES,
  RECENT_EXTERNAL_FILES_CHANGED_EVENT,
  clearStoredRecentExternalFiles,
  getStoredRecentExternalFiles,
  removeStoredRecentExternalFile,
  type RecentExternalFile,
} from "../../lib/recentExternalFiles";

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function parentPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator > 0 ? path.slice(0, separator) : "";
}

export function RecentExternalFiles() {
  const [files, setFiles] = useState<RecentExternalFile[]>(() =>
    getStoredRecentExternalFiles(),
  );
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const refresh = useCallback(() => {
    setFiles(getStoredRecentExternalFiles());
  }, []);

  useEffect(() => {
    window.addEventListener(RECENT_EXTERNAL_FILES_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(RECENT_EXTERNAL_FILES_CHANGED_EVENT, refresh);
  }, [refresh]);

  const handleOpen = useCallback(async (path: string) => {
    try {
      await filesService.openFilePreview(path);
      // The native event records the canonical path only when this remains an
      // external document. It also moves a reopened entry to the front.
    } catch (error) {
      console.error("Failed to open recent external file:", error);
      toast.error(
        "This file could not be opened. It may have been moved or deleted.",
      );
    }
  }, []);

  const handleRemove = useCallback((path: string) => {
    setFiles(removeStoredRecentExternalFile(path));
  }, []);

  const handleClear = useCallback(() => {
    clearStoredRecentExternalFiles();
    setFiles([]);
    setClearDialogOpen(false);
  }, []);

  if (files.length === 0) return null;

  return (
    <>
      <section className="border-b border-border shrink-0" aria-label="Recent files">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
              Recent files
            </span>
            <span className="text-2xs text-text-muted/70">
              {files.length}/{MAX_RECENT_EXTERNAL_FILES}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setClearDialogOpen(true)}
            className="text-2xs text-text-muted hover:text-text underline-offset-2 hover:underline shrink-0 cursor-pointer"
          >
            Clear list
          </button>
        </div>

        <div className="px-2 pb-2">
          {files.map((file) => (
            <div
              key={file.path}
              className="group flex items-center gap-1 rounded-md hover:bg-bg-muted"
            >
              <button
                type="button"
                onClick={() => void handleOpen(file.path)}
                title={file.path}
                className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-left cursor-pointer"
              >
                <NoteIcon className="w-3.75 h-3.75 shrink-0 stroke-[1.5] text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">
                    {fileName(file.path)}
                  </span>
                  <span className="block truncate text-2xs text-text-muted">
                    {parentPath(file.path)}
                  </span>
                </span>
              </button>
              <IconButton
                type="button"
                size="xs"
                title={`Remove ${fileName(file.path)} from recent files`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemove(file.path);
                }}
                className="mr-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <XIcon className="w-3.5 h-3.5 stroke-[1.75]" />
              </IconButton>
            </div>
          ))}
        </div>
      </section>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear recent files?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the recent-files list from Markdown Editor. It does
              not delete, move, or change any original document.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              Clear list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
