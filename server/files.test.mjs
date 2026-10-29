import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import {
  createFileHandlers, fileTarget, legacyFilePath, canonicalFileUrl, byteRange,
  fileAccessPolicy, projectConnectedFileUrls, projectedFilePaths, connectedPhotoPaths, FileAccessError,
  FILE_SESSION_COOKIE, FILE_SESSION_MS, MAX_FILE_BYTES,
} from './files.mjs';
import { fileRetirementPlan } from './fileMigration.mjs';

const BUCKET = 'fixture-bucket';
const PATH = 'families/household/documents/doc-one/file.pdf';
const clone = value => structuredClone(value);
function fixture() {
  const records = new Map();
  const roles = new Map(['admin', 'member', 'child'].map(uid => [`household:${uid}`, uid]));
  const revocations = new Set();
  const calls = [];
  const policies = new Map();
  const connected = { active: true, path: PATH };
  const state = { beforeSave: null, beforeDelete: null };
  const seed = (path = PATH, type = 'application/pdf', data = Buffer.from('0123456789'), custom = {}) => records.set(path, {
    data, info: { size: String(data.length), contentType: type, generation: '1', metageneration: '1', metadata: custom },
  });
  seed();
  const checkConditions = (record, options) => {
    if (!options) return;
    if (options.ifGenerationMatch !== undefined && String(record?.info.generation || 0) !== String(options.ifGenerationMatch)) throw Object.assign(new Error('changed generation'), { code: 412 });
    if (options.ifMetagenerationMatch !== undefined && String(record?.info.metageneration) !== String(options.ifMetagenerationMatch)) throw Object.assign(new Error('changed metadata'), { code: 412 });
  };
  const bucket = { file: (path, fileOptions = {}) => ({
    getMetadata: async () => {
      if (!records.has(path)) throw Object.assign(new Error('missing'), { code: 404 });
      return [clone(records.get(path).info)];
    },
    createReadStream: options => {
      const data = records.get(path).data;
      return Readable.from(data.subarray(options.start || 0, options.end === undefined ? data.length : options.end + 1));
    },
    save: async (bytes, options) => {
      if (state.beforeSave) { const action = state.beforeSave; state.beforeSave = null; action(); }
      checkConditions(records.get(path), options.preconditionOpts || fileOptions.preconditionOpts);
      const previous = records.get(path);
      records.set(path, { data: Buffer.from(bytes), info: { ...options.metadata, size: String(bytes.length), generation: String(Number(previous?.info.generation || 0) + 1), metageneration: '1' } });
    },
    delete: async () => {
      if (state.beforeDelete) { const action = state.beforeDelete; state.beforeDelete = null; action(); }
      checkConditions(records.get(path), fileOptions.preconditionOpts);
      records.delete(path);
    },
    setMetadata: async (patch, preconditions) => {
      checkConditions(records.get(path), preconditions);
      const record = records.get(path);
      record.info = { ...record.info, ...clone(patch), metageneration: String(Number(record.info.metageneration) + 1) };
    },
  }) };
  const decode = async (token, checkRevoked) => {
    calls.push({ token, checkRevoked });
    if (revocations.has(token) || token === 'invalid') throw new Error('invalid token');
    const uid = token.replace(/^session-/, '').replace(/^stale-/, '');
    return { uid, email: `${uid}@example.test`, email_verified: uid !== 'unverified', familyId: 'household', familyIds: ['household'], role: 'admin' };
  };
  const handlers = createFileHandlers({
    bucket, verifyIdToken: decode, verifySessionCookie: decode,
    createSessionCookie: async (token, options) => { assert.equal(options.expiresIn, FILE_SESSION_MS); return `session-${token}`; },
    getRole: async (family, uid) => roles.get(`${family}:${uid}`),
    getPolicy: async (family, path) => policies.get(path) || { estate: false, ownerAllowed: true },
    authorizeConnected: async (req, caller) => {
      if (!connected.active || req.query.path !== connected.path || !roles.has(`household:${caller.uid}`)) throw new FileAccessError(403, 'FILE_ACCESS_DENIED', 'No shared photo');
      return { ...caller, ...fileTarget(req.query.path), role: 'connected' };
    },
  });
  const request = (operation, uid = 'member', extra = {}) => handlers[operation]({
    method: operation === 'read' ? 'GET' : 'PUT', query: { path: PATH },
    headers: { authorization: `Bearer ${uid}`, host: 'teluva.example', 'content-type': 'application/pdf' },
    body: Buffer.from('replacement'), ...extra,
  });
  return { request, handlers, records, roles, revocations, calls, policies, connected, state, seed };
}
const bodyBytes = async result => {
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

test('every file operation checks current named-space membership, not stale claims or original household UID', async () => {
  const f = fixture();
  assert.equal((await f.request('read', 'stale-member')).status, 200);
  f.roles.delete('household:member');
  for (const action of ['read', 'write', 'remove']) assert.equal((await f.request(action, 'stale-member')).status, 403);
  for (const uid of ['P22E4pEZTiOJyMXRWCOprWj9ifo2', 'stranger']) assert.equal((await f.request('read', uid)).status, 403);
  assert.equal((await f.request('read', 'admin', { query: { path: 'families/other-space/documents/private/file.pdf' } })).status, 403);
  assert.ok(f.records.has(PATH));
});

test('OCR authorization cannot read a detached cache after its protected source file has been removed', async () => {
  const f = fixture();
  f.records.delete(PATH);
  f.seed(`${PATH}.ocr.json`, 'application/json', Buffer.from('{"pages":["private old text"]}'));
  const result = await f.request('authorizeRead', 'member');
  assert.equal(result.status, 404);
  assert.equal(result.caller, undefined);
  assert.equal((await f.request('read', 'member', { query: { path: `${PATH}.ocr.json` } })).status, 403, 'internal OCR cache cannot be opened as a less protected standalone file');
});

test('child and newly demoted member can read ordinary bytes but cannot upload/update/delete', async () => {
  const f = fixture();
  assert.equal((await f.request('read', 'child')).status, 200);
  f.roles.set('household:member', 'child');
  for (const uid of ['child', 'stale-member']) {
    for (const action of ['write', 'remove']) assert.equal((await f.request(action, uid)).status, 403);
  }
  assert.equal(f.records.get(PATH).data.toString(), '0123456789');
});

test('session cookies are limited, HttpOnly, Secure, SameSite, checked for revocation and cannot authorize writes', async () => {
  const f = fixture();
  const session = await f.request('session', 'member');
  assert.equal(session.status, 200);
  assert.equal(FILE_SESSION_MS, 60 * 60 * 1000);
  assert.match(session.headers['Set-Cookie'], /Max-Age=3600; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
  const headers = { cookie: `${FILE_SESSION_COOKIE}=session-member`, host: 'teluva.example' };
  assert.equal((await f.request('read', '', { headers })).status, 200);
  assert.equal((await f.request('write', '', { headers })).status, 401);
  f.revocations.add('session-member');
  assert.equal((await f.request('read', '', { headers })).status, 401);
  assert.ok(f.calls.every(call => call.checkRevoked === true));
  assert.equal((await f.request('session', 'unverified')).status, 401);
  assert.equal((await f.request('session', 'member', { headers: { authorization: 'Bearer member', host: 'teluva.example', origin: 'https://attacker.example' } })).status, 403);
  assert.match((await f.request('clearSession', '')).headers['Set-Cookie'], /Max-Age=0/);
});

test('GET/HEAD and single byte ranges preserve PDF behavior with private no-store headers', async () => {
  const f = fixture();
  const get = await f.request('read');
  assert.equal((await bodyBytes(get)).toString(), '0123456789');
  assert.equal(get.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(get.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal((await f.request('read', 'member', { method: 'HEAD' })).stream, undefined);
  for (const [range, text, contentRange] of [['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-', '89', 'bytes 8-9/10']]) {
    const response = await f.request('read', 'member', { headers: { authorization: 'Bearer member', range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers['Content-Range'], contentRange);
    assert.equal((await bodyBytes(response)).toString(), text);
  }
  const invalid = await f.request('read', 'member', { headers: { authorization: 'Bearer member', range: 'bytes=20-30' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers['Content-Range'], 'bytes */10');
  for (const invalidRange of ['bytes=1-2,4-5', 'bytes=-0', 'bytes=-', 'bytes=8-2']) assert.throws(() => byteRange(invalidRange, 10));
});

test('active uploaded content is an attachment in an opaque sandbox, never an app-origin script', async () => {
  const f = fixture();
  for (const type of ['text/html', 'image/svg+xml', 'application/xml', 'application/javascript']) {
    f.seed(PATH, type);
    const response = await f.request('read');
    assert.equal(response.headers['Content-Disposition'], 'attachment');
    assert.equal(response.headers['Content-Security-Policy'], "default-src 'none'; sandbox");
    assert.equal(response.headers['Cross-Origin-Resource-Policy'], 'same-origin');
  }
});

test('upload keeps exact bytes, owner identity and unrelated metadata without creating public download tokens', async () => {
  const f = fixture();
  f.seed(PATH, 'application/pdf', Buffer.from('old'), { firebaseStorageDownloadTokens: 'retire-me', unrelated: 'keep' });
  const response = await f.request('write', 'member', { body: Buffer.from('{"a":1}'), headers: { authorization: 'Bearer member', 'content-type': 'application/json' } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { storagePath: PATH, downloadUrl: canonicalFileUrl(PATH) });
  assert.equal(f.records.get(PATH).data.toString(), '{"a":1}');
  assert.deepEqual(f.records.get(PATH).info.metadata, { unrelated: 'keep', teluvaOwnerUid: 'member' });
  assert.equal((await f.request('write', 'member', { body: Buffer.alloc(MAX_FILE_BYTES) })).status, 413);
});

test('a concurrent estate protection cannot be erased by a stale upload or delete', async () => {
  for (const action of ['write', 'remove']) {
    const f = fixture();
    const protect = () => {
      const record = f.records.get(PATH);
      record.info.metadata.teluvaAccess = 'estate';
      record.info.metageneration = '2';
    };
    if (action === 'write') f.state.beforeSave = protect; else f.state.beforeDelete = protect;
    assert.equal((await f.request(action)).status, 409);
    assert.equal(f.records.get(PATH).data.toString(), '0123456789');
    assert.equal(f.records.get(PATH).info.metadata.teluvaAccess, 'estate');
  }
});

test('estate bytes use released readerUids, never naming alone, and no nonadmin can change them', async () => {
  const f = fixture();
  f.policies.set(PATH, { estate: true, readerUids: [], namedUids: ['member'], ownerAllowed: true });
  assert.equal((await f.request('read', 'member')).status, 403);
  f.policies.get(PATH).readerUids = ['member', 'child'];
  assert.equal((await f.request('read', 'member')).status, 200);
  assert.equal((await f.request('read', 'child')).status, 403);
  assert.equal((await f.request('write', 'member')).status, 403);
  assert.equal((await f.request('remove', 'member')).status, 403);
  assert.equal((await f.request('read', 'admin')).status, 200);
  f.policies.get(PATH).readerUids = [];
  assert.equal((await f.request('read', 'member')).status, 403, 'release revocation takes effect without refreshing a token');
});

test('business profile source and permanent owner ledger cannot be relabelled through shared vault metadata', () => {
  const metadata = { metadata: { teluvaProfileIds: '["person-a"]' }, size: '10' };
  const member = { id: 'person-a', linkedUid: 'alice', email: 'alice@example.test', documents: [{ id: 'doc-one', fileData: canonicalFileUrl(PATH) }] };
  const input = { storagePath: PATH, metadata, spaceInfo: { type: 'business' }, members: [member], documents: { docs: [{ id: 'doc-one', memberId: 'bob', storagePath: PATH }] }, bucketName: BUCKET };
  assert.equal(fileAccessPolicy({ ...input, caller: { uid: 'bob', email: 'bob@example.test', role: 'member' } }).ownerAllowed, false);
  assert.equal(fileAccessPolicy({ ...input, caller: { uid: 'alice', role: 'member' } }).ownerAllowed, true);
  const ledger = { metadata: { teluvaProfileIds: '["person-a"]' } };
  assert.equal(fileAccessPolicy({ ...input, metadata: ledger, members: [{ ...member, documents: [] }], caller: { uid: 'bob', role: 'member' } }).ownerAllowed, false);
  assert.equal(fileAccessPolicy({ ...input, members: [], caller: { uid: 'bob', role: 'member' } }).ownerAllowed, false, 'unknown legacy business objects fail closed');
  assert.equal(fileAccessPolicy({ ...input, members: [], metadata: { metadata: { teluvaOwnerUid: 'bob' } }, caller: { uid: 'bob', role: 'member' } }).ownerAllowed, true);
  const copied = { id: 'person-b', linkedUid: 'bob', documents: [{ id: 'copied', fileData: canonicalFileUrl(PATH) }] };
  assert.equal(fileAccessPolicy({ ...input, members: [member, copied], caller: { uid: 'bob', role: 'member' } }).ownerAllowed, false, 'copying a colleague’s file into one’s own editable profile cannot add a grant');
  assert.equal(fileAccessPolicy({ ...input, metadata: { metadata: { teluvaOwnerUid: 'alice' } }, members: [member, copied], caller: { uid: 'bob', role: 'member' } }).ownerAllowed, false, 'untrusted references cannot replace an upload’s authenticated owner');
});

test('admin diff-based profile binding grants an intended employee without trusting a member-supplied binding', async () => {
  const f = fixture();
  const body = { spaceId: 'household', bindings: [{ path: PATH, memberId: 'person-a' }] };
  assert.equal((await f.request('bindProfile', 'member', { body })).status, 403);
  assert.equal((await f.request('bindProfile', 'admin', { body })).status, 200);
  assert.equal(f.records.get(PATH).info.metadata.teluvaProfileIds, '["person-a"]');
  assert.equal(f.records.get(PATH).info.metadata.teluvaProfileBinding, 'admin');
  const input = { storagePath: PATH, metadata: f.records.get(PATH).info, spaceInfo: { type: 'business' }, bucketName: BUCKET,
    members: [{ id: 'person-a', linkedUid: 'alice' }, { id: 'person-b', linkedUid: 'bob', documents: [{ fileData: canonicalFileUrl(PATH) }] }] };
  assert.equal(fileAccessPolicy({ ...input, caller: { uid: 'alice', role: 'member' } }).ownerAllowed, true);
  const deniedPolicy = fileAccessPolicy({ ...input, caller: { uid: 'bob', role: 'member' } });
  f.policies.set(PATH, deniedPolicy);
  f.roles.set('household:bob', 'member');
  for (const operation of ['read', 'write', 'remove']) assert.equal((await f.request(operation, 'bob')).status, 403);
});

test('initial ambiguous business ownership fails closed without changing family sharing or trusted ledgers', async () => {
  const members = [{ id: 'original', linkedUid: 'alice', documents: [{ id: 'doc-one' }] }, { id: 'copier', linkedUid: 'bob', documents: [{ fileData: canonicalFileUrl(PATH) }] }];
  const old = { metadata: {}, metageneration: '1' };
  const business = { members, spaceInfo: { type: 'business' } };
  const plan = fileRetirementPlan(PATH, old, business, BUCKET);
  assert.equal(plan.ambiguousBusiness, true);
  assert.equal(plan.metadata.metadata.teluvaProfileBinding, 'inventory-ambiguous');
  for (const uid of ['alice', 'bob']) assert.equal(fileAccessPolicy({ storagePath: PATH, metadata: plan.metadata, ...business, bucketName: BUCKET, caller: { uid, role: 'member' } }).ownerAllowed, false);
  const family = fileRetirementPlan(PATH, old, { ...business, spaceInfo: { type: 'family' } }, BUCKET);
  assert.equal(family.ambiguousBusiness, false);
  assert.equal(fileAccessPolicy({ storagePath: PATH, metadata: family.metadata, spaceInfo: { type: 'family' }, members, bucketName: BUCKET, caller: { uid: 'bob', role: 'member' } }).ownerAllowed, true);
  const trusted = fileRetirementPlan(PATH, { ...old, metadata: { teluvaProfileIds: '["original"]' } }, business, BUCKET);
  assert.equal(trusted.ambiguousBusiness, false);
  assert.equal(trusted.metadata.metadata.teluvaProfileIds, '["original"]');
  const f = fixture();
  f.records.get(PATH).info.metadata = plan.metadata.metadata;
  assert.equal((await f.request('bindProfile', 'admin', { body: { spaceId: 'household', bindings: [{ path: PATH, memberId: 'original' }] } })).status, 200);
  assert.equal(f.records.get(PATH).info.metadata.teluvaProfileIds, '["original"]', 'explicit admin resolution does not carry an ambiguous copied owner forward');
  assert.equal(f.records.get(PATH).info.metadata.teluvaProfileBinding, 'admin');
});

test('intended shared business photos remain readable but shared flags never override a profile/estate ledger', async () => {
  const f = fixture();
  const photoPath = 'families/household/asset-photos/shared.jpg';
  assert.equal((await f.request('write', 'admin', { query: { path: photoPath } })).status, 200);
  const metadata = f.records.get(photoPath).info;
  assert.equal(metadata.metadata.teluvaScope, 'shared');
  const input = { storagePath: photoPath, metadata, spaceInfo: { type: 'business' }, bucketName: BUCKET, caller: { uid: 'member', role: 'member' } };
  assert.equal(fileAccessPolicy(input).ownerAllowed, true);
  metadata.metadata.teluvaProfileIds = '["private-owner"]';
  assert.equal(fileAccessPolicy({ ...input, members: [{ id: 'private-owner', linkedUid: 'someone-else' }] }).ownerAllowed, false);
});

test('connected-family photos require live exact projection consent and cannot become a document download grant', async () => {
  const f = fixture();
  f.seed(PATH, 'image/png');
  assert.equal((await f.request('readConnected', 'child')).status, 200);
  assert.equal((await f.request('readConnected', 'member', { query: { path: 'families/household/documents/unshared/other.png' } })).status, 403);
  f.connected.active = false;
  assert.equal((await f.request('readConnected', 'member')).status, 403);
  f.connected.active = true;
  f.seed(PATH, 'application/pdf');
  assert.equal((await f.request('readConnected', 'member')).status, 403);
  const projected = { id: 'p', avatarUrl: canonicalFileUrl(PATH), favorites: [{ imageUrl: canonicalFileUrl(PATH) }] };
  const urls = projectConnectedFileUrls(projected, { spaceId: 'receiving', linkId: 'L1', memberId: 'p' }, BUCKET);
  assert.match(urls.avatarUrl, /^\/api\/files\/connected\?spaceId=receiving&linkId=L1&memberId=p&path=/);
  assert.equal(urls.favorites[0].imageUrl, urls.avatarUrl);
  assert.deepEqual(projectedFilePaths(projected, BUCKET), new Set([PATH]));
  const care = { medical: { allergies: canonicalFileUrl(PATH) }, name: canonicalFileUrl(PATH) };
  assert.deepEqual(connectedPhotoPaths(care, BUCKET), new Set(), 'a file URL inside a projected care/name string is not photo consent');
  assert.deepEqual(projectConnectedFileUrls(care, { spaceId: 'receiving', linkId: 'L1', memberId: 'p' }, BUCKET), care);
  assert.deepEqual(connectedPhotoPaths(projected, BUCKET), new Set([PATH]));
});

test('path and old URL parsing is exact, not a cross-bucket proxy or traversal normalizer', () => {
  for (const path of ['', 'families/household/../secret', 'families/household/documents//file', 'families/household/documents/./file', 'families/household/documents/a\\b', 'families/a/b/\0']) assert.throws(() => fileTarget(path));
  assert.equal(fileTarget('families/household/documents/report..pdf').familyId, 'household');
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(PATH)}?alt=media&token=secret`;
  assert.equal(legacyFilePath(url, BUCKET), PATH);
  assert.equal(legacyFilePath(url.replace(BUCKET, 'another-bucket'), BUCKET), null);
  assert.equal(legacyFilePath(url.replace('firebasestorage.googleapis.com', 'evil.example'), BUCKET), null);
});

test('token retirement preserves estate/profile classification and other metadata with metageneration protection', () => {
  const info = { metadata: { firebaseStorageDownloadTokens: 'do-not-print', unrelated: 'retain' }, metageneration: '8' };
  const snapshot = { members: [{ id: 'person', documents: [{ id: 'doc-one' }] }], spaceInfo: { type: 'business' }, estate: { records: [{ linkedDocIds: ['doc-one'] }] }, documents: { docs: [] } };
  const plan = fileRetirementPlan(PATH, info, snapshot, BUCKET);
  assert.equal(plan.hasDownloadTokens, true);
  assert.equal(plan.metadata.metadata.firebaseStorageDownloadTokens, null);
  assert.equal(plan.metadata.metadata.teluvaAccess, 'estate');
  assert.equal(plan.metadata.metadata.teluvaProfileIds, '["person"]');
  assert.equal(plan.metadata.metadata.unrelated, 'retain');
  assert.deepEqual(plan.preconditions, { ifMetagenerationMatch: '8' });
  assert.equal(info.metadata.firebaseStorageDownloadTokens, 'do-not-print', 'dry-run planning mutates no source metadata');
  const rerun = fileRetirementPlan(PATH, { ...info, metadata: { teluvaProfileIds: '["original-owner"]', firebaseStorageDownloadTokens: 'retire' } }, {
    ...snapshot, members: [{ id: 'copier', documents: [{ id: 'doc-one' }] }],
  }, BUCKET);
  assert.equal(rerun.metadata.metadata.teluvaProfileIds, '["original-owner"]', 'later mutable copies cannot widen a permanent migration ledger');
});

test('live source wiring keeps file auth before JSON parsing and protects OCR/connected media', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf("app.use('/api/files', createFileRouter") < source.indexOf("app.use(express.json({ limit: '25mb' }))"));
  assert.ok(source.includes('fileGateway.authorizeRead'));
  assert.ok(source.includes('projectConnectedFileUrls(projectSharedMember'));
  assert.ok(!source.includes('firebaseStorageDownloadTokens: downloadToken'), 'mail/Gmail writers cannot recreate permanent download capabilities');
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(sw.indexOf("url.pathname.startsWith('/api/')") < sw.indexOf("request.mode === 'navigate'"));
});
