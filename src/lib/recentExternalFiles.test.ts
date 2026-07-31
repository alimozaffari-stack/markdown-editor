import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RECENT_EXTERNAL_FILES,
  clearRecentExternalFiles,
  loadRecentExternalFiles,
  recordRecentExternalFile,
  removeRecentExternalFile,
  saveRecentExternalFiles,
  type RecentExternalFile,
  type RecentFileStorage,
} from "./recentExternalFiles.ts";

class MemoryStorage implements RecentFileStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ThrowingStorage implements RecentFileStorage {
  getItem(): string | null {
    throw new Error("Storage is unavailable");
  }

  setItem(): void {
    throw new Error("Storage is unavailable");
  }

  removeItem(): void {
    throw new Error("Storage is unavailable");
  }
}

test("recent external files move a reopened path to the front without duplicates", () => {
  const first = recordRecentExternalFile([], "C:/Research/first.md", 10);
  const second = recordRecentExternalFile(first, "C:/Research/second.md", 20);
  const reopened = recordRecentExternalFile(second, "C:/Research/first.md", 30);

  assert.deepEqual(reopened, [
    { path: "C:/Research/first.md", lastOpenedAt: 30 },
    { path: "C:/Research/second.md", lastOpenedAt: 20 },
  ]);
});

test("recent external files retain only the latest fifty entries", () => {
  let entries: RecentExternalFile[] = [];
  for (let index = 0; index <= MAX_RECENT_EXTERNAL_FILES; index += 1) {
    entries = recordRecentExternalFile(
      entries,
      `C:/Research/${index}.md`,
      index,
    );
  }

  assert.equal(entries.length, MAX_RECENT_EXTERNAL_FILES);
  assert.equal(entries[0].path, "C:/Research/50.md");
  assert.equal(entries[49].path, "C:/Research/1.md");
});

test("recent external files persist and support individual and full removal", () => {
  const storage = new MemoryStorage();
  saveRecentExternalFiles(storage, [
    { path: "C:/Research/second.md", lastOpenedAt: 20 },
    { path: "C:/Research/first.md", lastOpenedAt: 10 },
  ]);

  assert.deepEqual(loadRecentExternalFiles(storage), [
    { path: "C:/Research/second.md", lastOpenedAt: 20 },
    { path: "C:/Research/first.md", lastOpenedAt: 10 },
  ]);

  assert.deepEqual(removeRecentExternalFile(storage, "C:/Research/first.md"), [
    { path: "C:/Research/second.md", lastOpenedAt: 20 },
  ]);

  clearRecentExternalFiles(storage);
  assert.deepEqual(loadRecentExternalFiles(storage), []);
});

test("recent external files tolerate unavailable storage", () => {
  const storage = new ThrowingStorage();
  const entries = [{ path: "C:/Research/first.md", lastOpenedAt: 10 }];

  assert.deepEqual(loadRecentExternalFiles(storage), []);
  assert.equal(saveRecentExternalFiles(storage, entries), false);
  assert.deepEqual(removeRecentExternalFile(storage, entries[0].path), []);
  assert.equal(clearRecentExternalFiles(storage), false);
});
