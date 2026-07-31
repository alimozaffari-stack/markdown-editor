export const MAX_RECENT_EXTERNAL_FILES = 50;
export const RECENT_EXTERNAL_FILES_CHANGED_EVENT =
  "recent-external-files-changed";

const RECENT_EXTERNAL_FILES_STORAGE_KEY =
  "markdown-editor:recent-external-files";

let inMemoryRecentExternalFiles: RecentExternalFile[] = [];
let recentFilesStorageUnavailable = false;

export interface RecentExternalFile {
  path: string;
  lastOpenedAt: number;
}

export interface RecentFileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function normaliseRecentExternalFiles(value: unknown): RecentExternalFile[] {
  if (!Array.isArray(value)) return [];

  const paths = new Set<string>();
  const entries: RecentExternalFile[] = [];

  for (const valueEntry of value) {
    if (!valueEntry || typeof valueEntry !== "object") continue;

    const entry = valueEntry as Partial<RecentExternalFile>;
    if (
      typeof entry.path !== "string" ||
      entry.path.trim().length === 0 ||
      paths.has(entry.path)
    ) {
      continue;
    }

    paths.add(entry.path);
    entries.push({
      path: entry.path,
      lastOpenedAt:
        typeof entry.lastOpenedAt === "number" &&
        Number.isFinite(entry.lastOpenedAt)
          ? entry.lastOpenedAt
          : 0,
    });

    if (entries.length === MAX_RECENT_EXTERNAL_FILES) break;
  }

  return entries;
}

export function recordRecentExternalFile(
  entries: readonly RecentExternalFile[],
  path: string,
  lastOpenedAt: number,
): RecentExternalFile[] {
  const normalised = normaliseRecentExternalFiles(entries);
  if (path.trim().length === 0) return normalised;

  return [
    { path, lastOpenedAt },
    ...normalised.filter((entry) => entry.path !== path),
  ].slice(0, MAX_RECENT_EXTERNAL_FILES);
}

function readRecentExternalFiles(
  storage: RecentFileStorage,
): RecentExternalFile[] | null {
  let stored: string | null;

  try {
    stored = storage.getItem(RECENT_EXTERNAL_FILES_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!stored) return [];

  try {
    return normaliseRecentExternalFiles(JSON.parse(stored));
  } catch {
    return [];
  }
}

export function loadRecentExternalFiles(
  storage: RecentFileStorage,
): RecentExternalFile[] {
  return readRecentExternalFiles(storage) ?? [];
}

export function saveRecentExternalFiles(
  storage: RecentFileStorage,
  entries: readonly RecentExternalFile[],
): boolean {
  const normalised = normaliseRecentExternalFiles(entries);

  try {
    if (normalised.length === 0) {
      storage.removeItem(RECENT_EXTERNAL_FILES_STORAGE_KEY);
    } else {
      storage.setItem(
        RECENT_EXTERNAL_FILES_STORAGE_KEY,
        JSON.stringify(normalised),
      );
    }
    return true;
  } catch {
    return false;
  }
}

export function removeRecentExternalFile(
  storage: RecentFileStorage,
  path: string,
): RecentExternalFile[] {
  const entries = loadRecentExternalFiles(storage).filter(
    (entry) => entry.path !== path,
  );
  saveRecentExternalFiles(storage, entries);
  return entries;
}

export function clearRecentExternalFiles(storage: RecentFileStorage): boolean {
  try {
    storage.removeItem(RECENT_EXTERNAL_FILES_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): RecentFileStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function notifyRecentExternalFilesChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RECENT_EXTERNAL_FILES_CHANGED_EVENT));
  }
}

export function getStoredRecentExternalFiles(): RecentExternalFile[] {
  if (recentFilesStorageUnavailable) return inMemoryRecentExternalFiles;

  const storage = browserStorage();
  if (!storage) {
    recentFilesStorageUnavailable = true;
    return inMemoryRecentExternalFiles;
  }

  const entries = readRecentExternalFiles(storage);
  if (entries === null) {
    recentFilesStorageUnavailable = true;
    return inMemoryRecentExternalFiles;
  }

  inMemoryRecentExternalFiles = entries;
  return entries;
}

function persistStoredRecentExternalFiles(
  entries: RecentExternalFile[],
): void {
  inMemoryRecentExternalFiles = entries;

  const storage = browserStorage();
  if (!storage || !saveRecentExternalFiles(storage, entries)) {
    recentFilesStorageUnavailable = true;
  }
}

export function rememberRecentExternalFile(path: string): RecentExternalFile[] {
  const entries = recordRecentExternalFile(
    getStoredRecentExternalFiles(),
    path,
    Date.now(),
  );
  persistStoredRecentExternalFiles(entries);
  notifyRecentExternalFilesChanged();
  return entries;
}

export function removeStoredRecentExternalFile(
  path: string,
): RecentExternalFile[] {
  const entries = getStoredRecentExternalFiles().filter(
    (entry) => entry.path !== path,
  );
  persistStoredRecentExternalFiles(entries);
  notifyRecentExternalFilesChanged();
  return entries;
}

export function clearStoredRecentExternalFiles(): void {
  inMemoryRecentExternalFiles = [];

  const storage = browserStorage();
  recentFilesStorageUnavailable = !storage || !clearRecentExternalFiles(storage);

  notifyRecentExternalFilesChanged();
}
