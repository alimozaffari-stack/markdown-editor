import { invoke } from "@tauri-apps/api/core";
import type {
  DocumentSaveRequest,
  DocumentSnapshot,
} from "../lib/documentLifecycle";

export interface FileContent {
  path: string;
  content: string;
  title: string;
  modified: number;
  snapshot: DocumentSnapshot;
}

export async function readFileDirect(path: string): Promise<FileContent> {
  return invoke("read_file_direct", { path });
}

export async function saveFileDirect(
  path: string,
  request: DocumentSaveRequest,
): Promise<FileContent> {
  return invoke("save_file_direct", { path, request });
}

export async function retainFileRecoveryDraft(
  path: string,
  request: DocumentSaveRequest,
): Promise<string> {
  return invoke("retain_file_recovery_draft", { path, request });
}

export async function openFilePreview(path: string): Promise<void> {
  return invoke("open_file_preview", { path });
}

export interface ImportedNote {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

export async function importFileToFolder(
  path: string,
): Promise<ImportedNote> {
  return invoke("import_file_to_folder", { path });
}
