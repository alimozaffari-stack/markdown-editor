export interface RebasedSaveOperations<Key, Payload, Snapshot> {
  load: (key: Key) => Promise<Snapshot>;
  save: (key: Key, payload: Payload, base: Snapshot) => Promise<Snapshot>;
}

export interface RebasedSaveQueue<Key, Payload, Snapshot> {
  enqueue: (
    key: Key,
    payload: Payload,
    operations: RebasedSaveOperations<Key, Payload, Snapshot>,
  ) => Promise<Snapshot>;
  setBase: (key: Key, snapshot: Snapshot) => void;
  clearBase: (key: Key) => void;
}

export function createRebasedSaveQueue<
  Key,
  Payload,
  Snapshot,
>(): RebasedSaveQueue<Key, Payload, Snapshot> {
  const bases = new Map<Key, Snapshot>();
  const tails = new Map<Key, Promise<Snapshot>>();

  const loadFreshBase = async (
    key: Key,
    operations: RebasedSaveOperations<Key, Payload, Snapshot>,
  ) => {
    bases.delete(key);
    const loaded = await operations.load(key);
    bases.set(key, loaded);
    return loaded;
  };

  const enqueue = (
    key: Key,
    payload: Payload,
    operations: RebasedSaveOperations<Key, Payload, Snapshot>,
  ) => {
    const previous = tails.get(key);
    const base = previous
      ? previous.catch(() => loadFreshBase(key, operations))
      : bases.has(key)
        ? Promise.resolve(bases.get(key) as Snapshot)
        : loadFreshBase(key, operations);

    const queued = base.then(async (precedingSnapshot) => {
      const currentBase = bases.has(key)
        ? (bases.get(key) as Snapshot)
        : precedingSnapshot;
      try {
        const saved = await operations.save(key, payload, currentBase);
        bases.set(key, saved);
        return saved;
      } catch (error) {
        bases.delete(key);
        throw error;
      }
    });

    tails.set(key, queued);
    void queued
      .finally(() => {
        if (tails.get(key) === queued) {
          tails.delete(key);
        }
      })
      .catch(() => undefined);
    return queued;
  };

  return {
    enqueue,
    setBase(key, snapshot) {
      bases.set(key, snapshot);
    },
    clearBase(key) {
      bases.delete(key);
    },
  };
}
