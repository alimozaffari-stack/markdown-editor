import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clean title - remove markdown syntax and invisible characters
 */
export function cleanTitle(title: string | undefined): string {
  if (!title) return "Untitled";
  const cleaned = title
    // Remove heading markers (##, ###, etc.)
    .replace(/^#+\s+/, "")
    // Remove bold (**text** or __text__)
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    // Remove italic (*text* or _text_)
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, "$1")
    // Remove inline code (`code`)
    .replace(/`([^`]+)`/g, "$1")
    // Remove images ![alt](url) - must come before links to avoid leaving "!"
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Remove links [text](url) - keep only text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove non-breaking spaces and other invisible characters
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .trim();
  return cleaned || "Untitled";
}

/**
 * Helper to get or set a note's creation date in local storage.
 * Defaults to the provided modified time if no creation time is recorded.
 */
export function getCreationDate(noteId: string, modifiedTime: number): number {
  if (typeof window === "undefined") return modifiedTime;
  try {
    const stored = localStorage.getItem("markdown-editor:creation_dates");
    let dates: Record<string, number> = {};
    if (stored) {
      dates = JSON.parse(stored);
    }
    if (dates[noteId]) {
      return dates[noteId];
    }
    dates[noteId] = modifiedTime;
    localStorage.setItem("markdown-editor:creation_dates", JSON.stringify(dates));
    return modifiedTime;
  } catch {
    return modifiedTime;
  }
}

/**
 * Explicitly record a creation date for a newly created note.
 */
export function recordCreationDate(noteId: string, timestamp?: number): void {
  if (typeof window === "undefined") return;
  try {
    const stored = localStorage.getItem("markdown-editor:creation_dates");
    let dates: Record<string, number> = {};
    if (stored) {
      dates = JSON.parse(stored);
    }
    dates[noteId] = timestamp || Math.floor(Date.now() / 1000);
    localStorage.setItem("markdown-editor:creation_dates", JSON.stringify(dates));
  } catch {
    // ignore
  }
}
