import assert from "node:assert/strict";
import test from "node:test";
import { createRebasedSaveQueue } from "./rebasedSaveQueue.ts";

interface Snapshot {
  hash: string;
}

test("rapid saves are serialised and each request uses the preceding snapshot", async () => {
  const queue = createRebasedSaveQueue<string, string, Snapshot>();
  queue.setBase("note", { hash: "baseline" });

  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const firstDidStart = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const calls: Array<{ payload: string; baseline: string }> = [];
  let active = 0;
  let maximumActive = 0;

  const save = async (
    _key: string,
    payload: string,
    base: Snapshot,
  ): Promise<Snapshot> => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push({ payload, baseline: base.hash });
    if (payload === "A") {
      firstStarted();
      await firstCanFinish;
    }
    active -= 1;
    return { hash: `${base.hash}:${payload}` };
  };
  const operations = {
    load: async () => {
      throw new Error("the seeded baseline should be used");
    },
    save,
  };

  const first = queue.enqueue("note", "A", operations);
  await firstDidStart;
  const second = queue.enqueue("note", "AB", operations);
  await Promise.resolve();

  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, [{ payload: "A", baseline: "baseline" }]);

  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, [
    { payload: "A", baseline: "baseline" },
    { payload: "AB", baseline: "baseline:A" },
  ]);
});

test("a request after a failed save reloads its baseline", async () => {
  const queue = createRebasedSaveQueue<string, string, Snapshot>();
  queue.setBase("note", { hash: "stale" });
  let loadCount = 0;

  const failed = queue.enqueue("note", "first", {
    load: async () => ({ hash: "disk" }),
    save: async () => {
      throw new Error("conflict");
    },
  });
  await assert.rejects(failed, /conflict/);

  const recovered = await queue.enqueue("note", "second", {
    load: async () => {
      loadCount += 1;
      return { hash: "disk" };
    },
    save: async (_key, payload, base) => ({
      hash: `${base.hash}:${payload}`,
    }),
  });

  assert.equal(loadCount, 1);
  assert.equal(recovered.hash, "disk:second");
});
