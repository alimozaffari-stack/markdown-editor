// Tauri v2 browser fallback mock layer for the AI Studio preview environment
if (typeof window !== "undefined") {
  const isTauriEnv = (window as any).__TAURI_INTERNALS__ !== undefined;

  if (!isTauriEnv) {
    console.log("Initializing Markdown Editor Tauri Web Fallback Mock Layer...");

    // Helper to get and save notes from localStorage
    interface MockNote {
      id: string;
      title: string;
      content: string;
      path: string;
      modified: number;
    }

    interface MockDocumentSnapshot {
      content: string;
      hash: string;
      revision: number;
      encoding: "utf-8";
      bom: "none";
      lineEnding: "none" | "lf" | "crlf" | "cr" | "mixed";
    }

    const detectLineEnding = (
      content: string,
    ): MockDocumentSnapshot["lineEnding"] => {
      const crlf = (content.match(/\r\n/g) || []).length;
      const withoutCrlf = content.replace(/\r\n/g, "");
      const lf = (withoutCrlf.match(/\n/g) || []).length;
      const cr = (withoutCrlf.match(/\r/g) || []).length;
      const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
      if (kinds > 1) return "mixed";
      if (crlf > 0) return "crlf";
      if (lf > 0) return "lf";
      if (cr > 0) return "cr";
      return "none";
    };

    const sha256 = async (content: string): Promise<string> => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(content),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    };

    const snapshotFor = async (
      note: MockNote,
    ): Promise<MockDocumentSnapshot> => ({
      content: note.content,
      hash: await sha256(note.content),
      revision: note.modified * 1_000,
      encoding: "utf-8",
      bom: "none",
      lineEnding: detectLineEnding(note.content),
    });

    const withSnapshot = async (note: MockNote) => ({
      ...note,
      snapshot: await snapshotFor(note),
    });

    const defaultNotes: MockNote[] = [
      {
        id: "Welcome.md",
        title: "Welcome",
        content: `# Welcome to Markdown Editor

Markdown Editor is an offline-first Markdown editing application.

This is a fully-functional web preview!
- Try editing this Markdown note in the editor.
- Use **bold**, *italics*, and standard markdown formatting.
- Check the **Table of Contents** in the right-hand panel for dynamic outlining.
- Manage comments and annotations directly from the file tree or sidebar.

Enjoy capturing your thoughts!`,
        path: "Welcome.md",
        modified: Math.floor(Date.now() / 1000)
      },
      {
        id: "Guides/Markdown Guide.md",
        title: "Markdown Guide",
        content: `# Markdown Guide

Use standard Markdown syntax here:
- **Bold text**
- *Italics*
- [Links](https://google.com)

## Code Blocks
\`\`\`js
console.log("Hello, Markdown Editor!");
\`\`\`

### LaTeX Math Formulas
$$x^2 + y^2 = z^2$$`,
        path: "Guides/Markdown Guide.md",
        modified: Math.floor(Date.now() / 1000) - 3600
      },
      {
        id: "Drafts/Meeting Notes.md",
        title: "Meeting Notes",
        content: `# Meeting Notes

- Discussed Tauri browser fallback layer
- Integrated Table of Contents outlining panel
- Implemented timestamped note comments in sidebar`,
        path: "Drafts/Meeting Notes.md",
        modified: Math.floor(Date.now() / 1000) - 7200
      }
    ];

    const getStoredNotes = (): MockNote[] => {
      const stored = localStorage.getItem("markdown-editor:notes");
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          return defaultNotes;
        }
      }
      localStorage.setItem("markdown-editor:notes", JSON.stringify(defaultNotes));
      return defaultNotes;
    };

    const saveStoredNotes = (notes: MockNote[]) => {
      localStorage.setItem("markdown-editor:notes", JSON.stringify(notes));
    };

    const getPreview = (content: string): string => {
      const clean = content
        .replace(/^#+ .+/g, "") // strip headers
        .replace(/[*_`#]/g, "") // strip markdown layout chars
        .trim();
      return clean.substring(0, 100) + (clean.length > 100 ? "..." : "");
    };

    // Global mock registry
    (window as any).__TAURI_INTERNALS__ = {
      plugins: {},
      config: {},
      metadata: {
        currentWindowLabel: "main",
        target: "main"
      },
      transformCallback: (callback: any) => {
        const id = Math.floor(Math.random() * 1000000);
        (window as any)[`_${id}`] = callback;
        return id;
      },
      unregisterCallback: (id: number) => {
        delete (window as any)[`_${id}`];
      },
      invoke: async (cmd: string, args: any = {}) => {
        console.log(`[Tauri Mock Invoke] cmd="${cmd}" args=`, args);

        switch (cmd) {
          case "get_open_external_file":
            return null;

          // System/Notes Folders
          case "get_notes_folder": {
            return localStorage.getItem("markdown-editor:notesFolder") || "/documents/markdown-notes";
          }
          case "set_notes_folder": {
            if (args.path) {
              localStorage.setItem("markdown-editor:notesFolder", args.path);
            }
            return;
          }

          // List, read, save, delete notes
          case "list_notes": {
            const notes = getStoredNotes();
            return notes.map(n => ({
              id: n.id,
              title: n.title,
              preview: getPreview(n.content),
              modified: n.modified
            }));
          }
          case "read_note": {
            const notes = getStoredNotes();
            const note = notes.find(n => n.id === args.id);
            if (!note) {
              throw new Error(`Note not found: ${args.id}`);
            }
            return withSnapshot(note);
          }
          case "save_note": {
            const notes = getStoredNotes();
            let id = args.id;
            const request = args.request;
            const content = request?.content ?? args.content ?? "";
            const existingIndex = notes.findIndex(n => n.id === id);
            const existing =
              existingIndex >= 0 ? notes[existingIndex] : undefined;

            if (request && existing) {
              const currentSnapshot = await snapshotFor(existing);
              if (request.baselineHash !== currentSnapshot.hash) {
                throw {
                  kind: "conflict",
                  message: "The document changed in browser storage",
                  draftPath: null,
                  currentHash: currentSnapshot.hash,
                };
              }
            }

            // Extract title from first line or header
            let title = "Untitled";
            const headingMatch = content.match(/^#\s+(.+)$/m);
            if (headingMatch) {
              title = headingMatch[1].trim();
            } else {
              const firstLine = content.split("\n")[0]?.trim();
              if (firstLine) {
                title = firstLine.substring(0, 40);
              }
            }

            if (!id) {
              // Generate new path-safe id
              id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "untitled"}.md`;
            }

            const updatedNote: MockNote = {
              id,
              title,
              content,
              path: id,
              modified: Math.floor(Date.now() / 1000)
            };

            if (existingIndex >= 0) {
              notes[existingIndex] = updatedNote;
            } else {
              notes.push(updatedNote);
            }

            saveStoredNotes(notes);
            return withSnapshot(updatedNote);
          }
          case "retain_note_recovery_draft": {
            const request = args.request;
            const baseline = String(request?.baselineHash ?? "unknown").slice(
              0,
              12,
            );
            const key = `markdown-editor:recovery:${args.id}:${baseline}`;
            localStorage.setItem(key, request?.content ?? "");
            return `browser-storage:${key}`;
          }
          case "delete_note": {
            let notes = getStoredNotes();
            notes = notes.filter(n => n.id !== args.id);
            saveStoredNotes(notes);
            return;
          }
          case "create_note": {
            const notes = getStoredNotes();
            const targetFolder = args.targetFolder;
            const baseName = "Untitled";
            let id = targetFolder ? `${targetFolder}/${baseName}.md` : `${baseName}.md`;

            let counter = 1;
            while (notes.some(n => n.id === id)) {
              id = targetFolder ? `${targetFolder}/${baseName} ${counter}.md` : `${baseName} ${counter}.md`;
              counter++;
            }

            const newNote: MockNote = {
              id,
              title: "Untitled",
              content: `# Untitled\n\nStart writing here...`,
              path: id,
              modified: Math.floor(Date.now() / 1000)
            };

            notes.push(newNote);
            saveStoredNotes(notes);
            return withSnapshot(newNote);
          }

          // Folders
          case "list_folders": {
            const notes = getStoredNotes();
            const folders = new Set<string>();
            notes.forEach(n => {
              const parts = n.id.split("/");
              if (parts.length > 1) {
                let current = "";
                for (let i = 0; i < parts.length - 1; i++) {
                  current = current ? `${current}/${parts[i]}` : parts[i];
                  folders.add(current);
                }
              }
            });

            // Merge with explicitly created folders
            const explicit = JSON.parse(localStorage.getItem("markdown-editor:explicit_folders") || "[]") as string[];
            explicit.forEach(f => folders.add(f));

            return Array.from(folders);
          }
          case "create_folder": {
            const explicit = JSON.parse(localStorage.getItem("markdown-editor:explicit_folders") || "[]") as string[];
            if (!explicit.includes(args.path)) {
              explicit.push(args.path);
              localStorage.setItem("markdown-editor:explicit_folders", JSON.stringify(explicit));
            }
            return;
          }
          case "delete_folder": {
            let notes = getStoredNotes();
            notes = notes.filter(n => !n.id.startsWith(args.path + "/"));
            saveStoredNotes(notes);

            let explicit = JSON.parse(localStorage.getItem("markdown-editor:explicit_folders") || "[]") as string[];
            explicit = explicit.filter(f => f !== args.path && !f.startsWith(args.path + "/"));
            localStorage.setItem("markdown-editor:explicit_folders", JSON.stringify(explicit));
            return;
          }
          case "rename_folder": {
            const oldPath = args.oldPath;
            const newName = args.newName;
            const parentIndex = oldPath.lastIndexOf("/");
            const newPath = parentIndex >= 0 ? `${oldPath.substring(0, parentIndex)}/${newName}` : newName;

            // Rename notes inside
            let notes = getStoredNotes();
            notes = notes.map(n => {
              if (n.id.startsWith(oldPath + "/")) {
                const newId = newPath + n.id.substring(oldPath.length);
                return { ...n, id: newId, path: newId };
              }
              return n;
            });
            saveStoredNotes(notes);

            // Rename explicit folder paths
            let explicit = JSON.parse(localStorage.getItem("markdown-editor:explicit_folders") || "[]") as string[];
            explicit = explicit.map(f => {
              if (f === oldPath) return newPath;
              if (f.startsWith(oldPath + "/")) {
                return newPath + f.substring(oldPath.length);
              }
              return f;
            });
            localStorage.setItem("markdown-editor:explicit_folders", JSON.stringify(explicit));
            return;
          }
          case "move_note": {
            const id = args.id;
            const targetFolder = args.targetFolder;
            const notes = getStoredNotes();
            const idx = notes.findIndex(n => n.id === id);
            if (idx < 0) throw new Error("Note not found");

            const parts = id.split("/");
            const fileName = parts[parts.length - 1];
            const newId = targetFolder ? `${targetFolder}/${fileName}` : fileName;

            notes[idx].id = newId;
            notes[idx].path = newId;
            notes[idx].modified = Math.floor(Date.now() / 1000);

            saveStoredNotes(notes);
            return newId;
          }
          case "move_folder": {
            const path = args.path;
            const targetParent = args.targetParent;
            const parts = path.split("/");
            const folderName = parts[parts.length - 1];
            const newPath = targetParent ? `${targetParent}/${folderName}` : folderName;

            // Move notes inside
            let notes = getStoredNotes();
            notes = notes.map(n => {
              if (n.id.startsWith(path + "/")) {
                const newId = newPath + n.id.substring(path.length);
                return { ...n, id: newId, path: newId };
              }
              return n;
            });
            saveStoredNotes(notes);

            // Move explicit folders
            let explicit = JSON.parse(localStorage.getItem("markdown-editor:explicit_folders") || "[]") as string[];
            explicit = explicit.map(f => {
              if (f === path) return newPath;
              if (f.startsWith(path + "/")) {
                return newPath + f.substring(path.length);
              }
              return f;
            });
            localStorage.setItem("markdown-editor:explicit_folders", JSON.stringify(explicit));
            return;
          }

          // Settings
          case "get_settings": {
            const stored = localStorage.getItem("markdown-editor:settings");
            if (stored) {
              try {
                return JSON.parse(stored);
              } catch {
                // ignore
              }
            }
            const defaultSettings = {
              theme: { mode: "dark" },
              editorFont: {
                baseFontFamily: "system-sans",
                baseFontSize: 15,
                boldWeight: 600,
                lineHeight: 1.6
              },
              gitEnabled: false,
              foldersEnabled: true,
              pinnedNoteIds: [],
              textDirection: "ltr",
              editorWidth: "normal",
              customEditorWidthPx: 768,
              interfaceZoom: 1.0,
              preserveSourceFormattingNoteIds: []
            };
            localStorage.setItem("markdown-editor:settings", JSON.stringify(defaultSettings));
            return defaultSettings;
          }
          case "update_settings": {
            const current = JSON.parse(localStorage.getItem("markdown-editor:settings") || "{}");
            const merged = { ...current, ...args.newSettings };
            localStorage.setItem("markdown-editor:settings", JSON.stringify(merged));
            return;
          }

          // Search notes
          case "search_notes": {
            const notes = getStoredNotes();
            const query = (args.query || "").toLowerCase();
            if (!query) return [];

            return notes
              .map(n => {
                let score = 0;
                if (n.title.toLowerCase().includes(query)) score += 10;
                if (n.content.toLowerCase().includes(query)) score += 2;

                return {
                  id: n.id,
                  title: n.title,
                  preview: getPreview(n.content),
                  modified: n.modified,
                  score
                };
              })
              .filter(r => r.score > 0)
              .sort((a, b) => b.score - a.score);
          }

          // Copy and external helpers
          case "copy_to_clipboard": {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(args.text || "");
            }
            return;
          }
          case "write_file": {
            // Decodes byte array back to file and triggers browser download
            if (args.contents && args.path) {
              try {
                const bytes = new Uint8Array(args.contents);
                const decoder = new TextDecoder();
                const text = decoder.decode(bytes);
                const blob = new Blob([text], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const filename = args.path.split(/[/\\]/).pop() || "note.md";
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (e) {
                console.error("Mock write_file failed:", e);
              }
            }
            return;
          }

          // Tauri plugin/native dialog overrides
          case "plugin:dialog|open": {
            return "/documents/markdown-notes";
          }
          case "plugin:dialog|save": {
            return args.options?.defaultPath || "MockDownload.md";
          }
          case "plugin:opener|open_url": {
            if (args.url) {
              window.open(args.url, "_blank");
            }
            return;
          }
          case "plugin:event|listen":
            return args.handler;
          case "plugin:event|unlisten":
          case "plugin:event|emit":
            return;
          // Unused or stub-only commands
          case "start_file_watcher":
          case "rebuild_search_index":
          case "set_title_bar_theme":
          case "update_git_enabled":
          case "plugin:window|close":
          case "plugin:window|minimize":
          case "plugin:window|maximize":
            return;

          case "mark_main_ui_ready":
            return [];

          case "get_cli_status":
            return { installed: false, path: null };

          case "git_is_available":
            return false;

          default:
            if (cmd.startsWith("ai_")) {
              return { success: false, output: "", error: "AI CLI execution is only supported in native Tauri environment." };
            }
            return null;
        }
      }
    };

    (window as any).__TAURI_IPC__ = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, id: number) => {
        console.log(`[Tauri Mock UnregisterListener] event="${event}" id=${id}`);
        if ((window as any).__TAURI_INTERNALS__.unregisterCallback) {
          (window as any).__TAURI_INTERNALS__.unregisterCallback(id);
        } else {
          delete (window as any)[`_${id}`];
        }
      }
    };
  }
}
export {};
