import type { Editor } from "@tiptap/react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
export interface CommentExportItem {
  id?: string;
  text: string;
  timestamp: number;
}

/**
 * Triggers the native print dialog for the editor content.
 * Users can save as PDF or print to a physical printer.
 * Uses the browser's native print functionality which produces high-quality PDFs.
 *
 * @param editor - The TipTap editor instance
 * @param _noteTitle - The note title (currently unused, but kept for API consistency)
 */
export async function downloadPdf(
  editor: Editor,
  _noteTitle: string
): Promise<void> {
  if (!editor) throw new Error("Editor not available");

  window.print();
}

/**
 * Downloads the markdown content as a .md file.
 *
 * @param markdown - The markdown content to save
 * @param noteTitle - The note title for the default filename
 * @returns Promise<boolean> - Returns true if file was saved successfully, false if user cancelled
 */
export async function downloadMarkdown(
  markdown: string,
  noteTitle: string
): Promise<boolean> {
  const sanitizedTitle = sanitizeFilename(noteTitle);

  const isTauri =
    typeof window !== "undefined" &&
    (window as any).__TAURI_INTERNALS__ !== undefined;

  if (isTauri) {
    // Show native save dialog
    const filePath = await save({
      defaultPath: `${sanitizedTitle}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (!filePath) return false; // User cancelled

    // Convert string to bytes and write file using Tauri command
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(markdown);
    await invoke("write_file", {
      path: filePath,
      contents: Array.from(uint8Array),
    });

    return true;
  } else {
    // Frontend Blob download branch
    try {
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizedTitle}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (e) {
      console.error("Browser download failed:", e);
      return false;
    }
  }
}

/**
 * Serializes a list of comments into a formatted Markdown document payload.
 *
 * @param comments - Array of comment objects with text and timestamp
 * @param noteTitle - The title of the note
 * @param noteId - Optional ID of the note
 * @returns Formatted markdown string representing the comments payload
 */
export function serializeComments(
  comments: CommentExportItem[],
  noteTitle: string,
  noteId?: string
): string {
  const contentLines: string[] = [
    `# Comments on: ${noteTitle}`,
  ];
  if (noteId) {
    contentLines.push(`Document ID: ${noteId}`);
  }
  contentLines.push(`Exported: ${new Date().toLocaleString()}`);
  contentLines.push("");
  contentLines.push("---");
  contentLines.push("");

  if (!comments || comments.length === 0) {
    contentLines.push("_No comments present for this document._");
    contentLines.push("");
    return contentLines.join("\n");
  }

  comments.forEach((comment, idx) => {
    const dateStr = comment.timestamp
      ? new Date(comment.timestamp * 1000).toLocaleString()
      : "Unknown Date";
    contentLines.push(`### Comment #${idx + 1}`);
    contentLines.push(`**Date:** ${dateStr}`);
    contentLines.push(`**Text:**`);
    contentLines.push(comment.text);
    contentLines.push("");
    contentLines.push("---");
    contentLines.push("");
  });

  return contentLines.join("\n");
}

/**
 * Serializes comments and triggers download through downloadMarkdown.
 *
 * @param comments - List of comments to export
 * @param noteTitle - Note title for file naming
 * @param noteId - Optional note ID for metadata
 * @returns Promise<boolean> - True if downloaded successfully, false if cancelled/failed
 */
export async function exportComments(
  comments: CommentExportItem[],
  noteTitle: string,
  noteId?: string
): Promise<boolean> {
  const serialized = serializeComments(comments, noteTitle, noteId);
  const exportFilename = `${noteTitle}_comments`;
  return downloadMarkdown(serialized, exportFilename);
}

/**
 * Sanitizes a filename by removing invalid characters.
 * Replaces filesystem-unsafe characters with underscores.
 *
 * @param name - The filename to sanitize
 * @returns A filesystem-safe filename
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "note";
}

