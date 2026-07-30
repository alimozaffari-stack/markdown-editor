import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("browser fallback honours snapshot-aware read and save requests", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://markdown-editor.test/",
  });
  const originalDescriptors = new Map(
    ["window", "document", "navigator", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    localStorage: { configurable: true, value: dom.window.localStorage },
  });

  try {
    await import(`./tauri-mock.ts?test=${Date.now()}`);
    const invoke = (
      dom.window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<any>;
        };
      }
    ).__TAURI_INTERNALS__.invoke;

    const loaded = await invoke("read_note", { id: "Welcome.md" });
    assert.equal(loaded.snapshot.content, loaded.content);
    assert.match(loaded.snapshot.hash, /^[a-f0-9]{64}$/);
    assert.equal(loaded.snapshot.encoding, "utf-8");
    assert.equal(loaded.snapshot.bom, "none");
    assert.deepEqual(await invoke("mark_main_ui_ready"), []);
    assert.equal(
      await invoke("plugin:event|listen", { handler: 41 }),
      41,
    );

    const editedContent = "# Changed\r\n\r\nLiteral *source* text\r\n";
    const saved = await invoke("save_note", {
      id: loaded.id,
      request: {
        ...loaded.snapshot,
        baselineHash: loaded.snapshot.hash,
        content: editedContent,
        authority: "source",
        reason: "explicit",
      },
    });
    assert.equal(saved.content, editedContent);
    assert.equal(saved.snapshot.content, editedContent);
    assert.equal(saved.snapshot.lineEnding, "crlf");
    assert.notEqual(saved.snapshot.hash, loaded.snapshot.hash);

    const reopened = await invoke("read_note", { id: loaded.id });
    assert.equal(reopened.content, editedContent);
    assert.equal(reopened.snapshot.hash, saved.snapshot.hash);

    const recoveryContent = "# Lossy candidate must not replace the note\n";
    const draftPath = await invoke("retain_note_recovery_draft", {
      id: loaded.id,
      request: {
        ...saved.snapshot,
        baselineHash: saved.snapshot.hash,
        content: recoveryContent,
        authority: "visual",
        reason: "explicit",
      },
    });
    assert.match(draftPath, /^browser-storage:/);
    assert.equal(
      dom.window.localStorage.getItem(draftPath.replace(/^browser-storage:/, "")),
      recoveryContent,
    );
    assert.equal((await invoke("read_note", { id: loaded.id })).content, editedContent);

    await assert.rejects(
      invoke("save_note", {
        id: loaded.id,
        request: {
          ...loaded.snapshot,
          baselineHash: loaded.snapshot.hash,
          content: "# Stale edit\n",
          authority: "source",
          reason: "autosave",
        },
      }),
      (error: any) =>
        error?.kind === "conflict" && error?.currentHash === saved.snapshot.hash,
    );
  } finally {
    dom.window.close();
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  }
});
