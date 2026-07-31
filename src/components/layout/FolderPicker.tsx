import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui";
import { isWindows } from "../../lib/platform";
import { getAppVersionLabel } from "../../lib/appVersion";

export function FolderPicker() {
  const { setNotesFolder } = useNotes();
  const { reloadSettings } = useTheme();
  const [appVersion, setAppVersion] = useState("Version…");

  useEffect(() => {
    void getAppVersionLabel().then(setAppVersion);
  }, []);

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Notes Folder",
      });

      if (selected && typeof selected === "string") {
        await setNotesFolder(selected);
        // Reload compatible settings from the folder's legacy .scratch/settings.json.
        await reloadSettings();
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      {/* Draggable title bar area */}
      {!isWindows && <div className="h-10 shrink-0" data-tauri-drag-region />}

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8 max-w-lg select-none">
          <img
            src="/markdown-editor-logo.png"
            alt="Markdown Editor"
            className="w-48 aspect-square object-contain mx-auto mb-2 animate-fade-in-up"
            style={{ animationDelay: "0ms" }}
          />

          <h1
            className="text-3xl text-text font-serif mb-2 tracking-[-0.01em] animate-fade-in-up"
            style={{ animationDelay: "100ms" }}
          >
            Welcome to Markdown Editor
          </h1>
          <p
            className="text-text-muted mb-6 animate-fade-in-up"
            style={{ animationDelay: "100ms" }}
          >
            Markdown Editor is an offline-first Markdown application. Your notes are simply stored
            on your computer as markdown files.
          </p>
          <p
            className="text-xs text-text-muted/70 mb-5 animate-fade-in-up"
            style={{ animationDelay: "150ms" }}
          >
            Markdown Editor {appVersion}
          </p>
          <div
            className="animate-fade-in-up"
            style={{ animationDelay: "200ms" }}
          >
            <Button onClick={handleSelectFolder} size="xl">
              Choose your notes folder
            </Button>
          </div>

          <p
            className="mt-2 text-xs text-text-muted/60 animate-fade-in-up"
            style={{ animationDelay: "300ms" }}
          >
            You can change this later
          </p>
        </div>
      </div>
    </div>
  );
}
