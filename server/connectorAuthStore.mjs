import { createHash } from 'node:crypto';

// These are top-level server-only collections. No browser read/write rule is
// added for them. Secrets are indexed exclusively by their SHA-256 digest.
export const CONNECTOR_COLLECTIONS = Object.freeze({
  clients: 'connector_clients', requests: 'connector_authorizations',
  codes: 'connector_codes', grants: 'connector_grants', tokens: 'connector_tokens',
  owners: 'connector_owners', limits: 'connector_limits',
});

export const connectorDigest = value => createHash('sha256').update(value).digest('hex');
export const connectorOwnerKey = (uid, spaceId) => connectorDigest(JSON.stringify([uid, spaceId]));

/** Minimal adapter; all reads in a transaction must precede its first write. */
export function createFirestoreConnectorStore(db) {
  if (!db?.runTransaction || !db?.collection) throw new Error('A server Firestore database is required.');
  const ref = (collection, id) => {
    if (!CONNECTOR_COLLECTIONS[collection] || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid connector store key.');
    return db.collection(CONNECTOR_COLLECTIONS[collection]).doc(id);
  };
  return {
    async get(collection, id) {
      const snapshot = await ref(collection, id).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    transaction(callback) {
      return db.runTransaction(native => callback({
        async get(collection, id) {
          const snapshot = await native.get(ref(collection, id));
          return snapshot.exists ? snapshot.data() : null;
        },
        set(collection, id, value) { native.set(ref(collection, id), value); },
      }));
    },
  };
}

/** Serialized, rollback-capable adapter for behavioral tests, never production. */
export function createMemoryConnectorStore() {
  let state = new Map();
  let queue = Promise.resolve();
  const key = (collection, id) => `${collection}/${id}`;
  return {
    async get(collection, id) { await queue; return structuredClone(state.get(key(collection, id)) ?? null); },
    transaction(callback) {
      const operation = queue.then(async () => {
        const next = structuredClone(state);
        const result = await callback({
          async get(collection, id) { return structuredClone(next.get(key(collection, id)) ?? null); },
          set(collection, id, value) { next.set(key(collection, id), structuredClone(value)); },
        });
        state = next;
        return result;
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async inspect() { await queue; return structuredClone(state); },
  };
}
