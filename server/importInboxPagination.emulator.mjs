// Synthetic-only Firestore/HTTP acceptance for inbox continuation.
// firebase emulators:exec --config firebase.invites.emulator.json --only firestore --project rules-probe "node --test server/importInboxPagination.emulator.mjs"
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createImportInbox, createImportInboxRouter } from './importInbox.mjs';

if (!/^(127\.0\.0\.1|localhost):\d{1,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'].some(key => process.env[key] && process.env[key] !== 'rules-probe')) {
  throw Error('Only a loopback Firestore emulator with the synthetic rules-probe project is allowed.');
}

test('family and business customers can recover older pending imports through HTTP and real Firestore cursors', async () => {
  const app = initializeApp({ projectId: 'rules-probe' }, `inbox-history-${randomUUID()}`);
  const db = getFirestore(app), spaces = [];
  const service = createImportInbox({ db,
    resolveMembership: async (actor, space) => ({ role: (await db.doc(`families/${space}/roles/${actor.uid}`).get()).data()?.role }),
    canReadDocument: async () => false,
    extractDocument: async () => { throw Error('No paid AI in pagination acceptance'); },
  });
  const http = express();
  http.use('/api/import-inbox', createImportInboxRouter({ service, authenticateFirebase: async req => ({ uid: req.get('x-synthetic-user') || 'member' }) }));
  const server = await new Promise((resolve, reject) => { const s = http.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}/api/import-inbox`;
  try {
    for (const type of ['family', 'business']) {
      const space = `inbox-history-${type}-${randomUUID()}`; spaces.push(space);
      const batch = db.batch();
      batch.set(db.doc(`families/${space}`), { type });
      batch.set(db.doc(`families/${space}/roles/member`), { role: 'member' });
      batch.set(db.doc(`families/${space}/roles/admin`), { role: 'admin' });
      batch.set(db.doc(`families/${space}/reference/documents`), { docs: [{ id: 'private-original', ownerUid: 'other-member' }] });
      for (let index = 0; index < 206; index++) {
        const id = `history-${String(index).padStart(3, '0')}`;
        batch.set(db.doc(`families/${space}/importInbox/${id}`), {
          id, spaceId: space, createdBy: 'member', createdAt: '2026-11-05T08:00:00.000Z', status: index ? 'applied' : 'pending',
          // First page is source-filtered entirely, yet must retain its cursor.
          source: index > 105 ? { documentId: 'private-original' } : { sourceName: 'Synthetic receipt', sourceText: 'Synthetic source' },
        });
      }
      batch.set(db.doc(`families/${space}/importInbox/other-private`), { id: 'other-private', spaceId: space, createdBy: 'other-member', createdAt: '2026-11-05T08:00:00.000Z', source: { sourceText: 'Other member private source' } });
      await batch.commit();
      const get = (cursor, user = 'member') => fetch(`${base}?spaceId=${space}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { 'x-synthetic-user': user } });
      let response = await get(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
      const first = await response.json(); assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
      let page = first, pages = 1; const found = [];
      while (page.nextCursor && pages < 5) {
        response = await get(page.nextCursor); assert.equal(response.status, 200);
        page = await response.json(); found.push(...page.items); pages++;
      }
      assert.equal(pages, 3); assert.equal(page.nextCursor, null);
      assert.equal(found.length, 106); assert.equal(new Set(found.map(item => item.id)).size, 106);
      assert.equal(found.at(-1).id, 'history-000'); assert.equal(found.at(-1).status, 'pending');
      assert.ok(found.every(item => item.createdBy === 'member'));
      assert.equal((await get('other-private')).status, 409, 'a member cannot paginate from another member’s private draft');
      assert.equal((await get('../invalid')).status, 400);
      await db.doc(`families/${space}/roles/member`).set({ role: 'child' });
      assert.equal((await get(first.nextCursor)).status, 403, 'fresh membership gates continuation');
      const admin = await (await get(undefined, 'admin')).json();
      assert.ok(admin.items.some(item => item.id === 'other-private'), 'admin query uses its own authorized page');
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const space of spaces) await db.recursiveDelete(db.doc(`families/${space}`));
    await deleteApp(app);
  }
});
