// Real HTTP/router tests with an in-memory synthetic bucket. No Firebase/GCS
// connection, credentials or family records are used. Requires localhost bind.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import express from 'express';
import { createFileRouter, canonicalFileUrl, FILE_SESSION_COOKIE, FILE_SESSION_MS, MAX_FILE_BYTES } from './files.mjs';

const path = 'families/synthetic-family/documents/photo/file.png';
const sample = Buffer.from('synthetic-file-bytes-0123456789');

async function fixture() {
  const objects = new Map([[path, { bytes: sample, contentType: 'image/png', metadata: {}, generation: '1', metageneration: '1' }]]);
  const roles = new Map(['admin', 'member', 'reader', 'child'].map(uid => [`synthetic-family:${uid}`, uid === 'reader' ? 'member' : uid]));
  const calls = { streams: 0, saves: 0, deletes: 0, idTokens: [], sessionCookies: [], sessionsCreated: [] };
  const checkPreconditions = (item, options = {}) => {
    const conditions = options.preconditionOpts || {};
    if ((conditions.ifGenerationMatch === 0 && item)
      || (conditions.ifGenerationMatch !== undefined && conditions.ifGenerationMatch !== 0 && String(conditions.ifGenerationMatch) !== item?.generation)
      || (conditions.ifMetagenerationMatch !== undefined && String(conditions.ifMetagenerationMatch) !== item?.metageneration)) {
      throw Object.assign(new Error('Synthetic object changed'), { code: 412 });
    }
  };
  const bucket = { file: (filePath, instanceOptions = {}) => ({
    getMetadata: async () => {
      const item = objects.get(filePath);
      if (!item) throw Object.assign(new Error('Synthetic missing file'), { code: 404 });
      return [{ size: String(item.bytes.length), contentType: item.contentType, metadata: { ...item.metadata }, generation: item.generation, metageneration: item.metageneration }];
    },
    createReadStream: options => {
      calls.streams += 1;
      assert.equal(options.decompress, false);
      const item = objects.get(filePath);
      return Readable.from(item.bytes.subarray(options.start ?? 0, options.end === undefined ? undefined : options.end + 1));
    },
    save: async (bytes, options = {}) => {
      const previous = objects.get(filePath);
      checkPreconditions(previous, { preconditionOpts: options.preconditionOpts || instanceOptions.preconditionOpts });
      assert.ok(Buffer.isBuffer(bytes), 'the raw router must hand the bucket exact file bytes');
      calls.saves += 1;
      objects.set(filePath, { bytes: Buffer.from(bytes), contentType: options.metadata.contentType, metadata: options.metadata.metadata,
        generation: String(Number(previous?.generation || 0) + 1), metageneration: '1' });
    },
    delete: async () => { checkPreconditions(objects.get(filePath), instanceOptions); calls.deletes += 1; objects.delete(filePath); },
    setMetadata: async update => {
      const item = objects.get(filePath);
      item.metadata = { ...update.metadata };
      item.metageneration = String(Number(item.metageneration) + 1);
    },
  }) };
  const identity = uid => {
    if (!['admin', 'member', 'reader', 'child', 'outsider'].includes(uid)) throw new Error('Synthetic invalid identity');
    return { uid, email: `${uid}@example.test`, email_verified: true };
  };
  const app = express();
  app.use('/api/files', createFileRouter({
    verifyIdToken: async (token, checkRevoked) => { calls.idTokens.push({ token, checkRevoked }); return identity(token); },
    verifySessionCookie: async (cookie, checkRevoked) => {
      calls.sessionCookies.push({ cookie, checkRevoked });
      if (!cookie.startsWith('synthetic-session-')) throw new Error('Synthetic invalid cookie');
      return identity(cookie.slice('synthetic-session-'.length));
    },
    createSessionCookie: async (token, options) => { identity(token); calls.sessionsCreated.push({ token, options }); return `synthetic-session-${token}`; },
    getRole: async (familyId, uid) => roles.get(`${familyId}:${uid}`) || null,
    getPolicy: async (_familyId, _path, info) => ({ estate: info?.metadata?.teluvaAccess === 'estate', readerUids: ['reader', 'child'] }),
    bucket, secureCookies: true,
  }));
  // This ordering matches the live server. Placing this above the router would
  // turn application/json uploads into objects and corrupt/reject file bytes.
  app.use(express.json({ limit: '25mb' }));
  const server = http.createServer(app);
  server.keepAliveTimeout = 1;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, { token, cookie, headers, ...options } = {}) => fetch(`${base}${url}`, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
  });
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { objects, roles, calls, request, close, base };
}

function privateHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox");
}

/** Advertise an enormous body but send no payload. Authorization/limit rejection
 * must return from headers alone rather than buffering or awaiting that body. */
function headersOnlyUpload(base, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${base}${canonicalFileUrl(path)}`, { method: 'PUT', headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': MAX_FILE_BYTES * 10, Connection: 'close', ...headers,
    }, agent: false });
    const timeout = setTimeout(() => { request.destroy(); reject(new Error('Router waited for an unauthorized/oversized upload body')); }, 2500);
    request.on('error', error => { clearTimeout(timeout); if (error.code !== 'ECONNRESET') reject(error); });
    request.on('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timeout);
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') });
        request.destroy();
      });
    });
    request.flushHeaders();
  });
}

test('HTTP session exchange sets a private cookie and cookie transport supports native GET/HEAD/ranges', async () => {
  const f = await fixture();
  try {
    const exchange = await f.request('/api/files/session', { method: 'POST', token: 'admin', headers: { Origin: f.base } });
    assert.equal(exchange.status, 200);
    privateHeaders(exchange);
    assert.deepEqual(await exchange.json(), { ok: true });
    const setCookie = exchange.headers.get('set-cookie');
    assert.match(setCookie, new RegExp(`^${FILE_SESSION_COOKIE}=synthetic-session-admin;`));
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag), `cookie includes ${flag}`);
    assert.ok(setCookie.includes(`Max-Age=${FILE_SESSION_MS / 1000}`));
    assert.equal(f.calls.sessionsCreated[0].options.expiresIn, FILE_SESSION_MS);
    const cookie = setCookie.split(';')[0];

    const get = await f.request(canonicalFileUrl(path), { cookie });
    assert.equal(get.status, 200);
    privateHeaders(get);
    assert.equal(get.headers.get('content-type'), 'image/png');
    assert.equal(get.headers.get('content-disposition'), 'inline');
    assert.equal(get.headers.get('accept-ranges'), 'bytes');
    assert.equal(get.headers.get('content-length'), String(sample.length));
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), sample);

    const streamsBeforeHead = f.calls.streams;
    const head = await f.request(canonicalFileUrl(path), { method: 'HEAD', cookie });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(sample.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(f.calls.streams, streamsBeforeHead, 'HEAD never reads file bytes from storage');

    const range = await f.request(canonicalFileUrl(path), { cookie, headers: { Range: 'bytes=2-7' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 2-7/${sample.length}`);
    assert.equal(range.headers.get('content-length'), '6');
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), sample.subarray(2, 8));

    const suffix = await f.request(canonicalFileUrl(path), { cookie, headers: { Range: 'bytes=-4' } });
    assert.equal(suffix.status, 206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), sample.subarray(-4));

    const invalid = await f.request(canonicalFileUrl(path), { cookie, headers: { Range: 'bytes=9-1' } });
    assert.equal(invalid.status, 416);
    privateHeaders(invalid);
    assert.equal(invalid.headers.get('content-range'), `bytes */${sample.length}`);
    await invalid.arrayBuffer();
    assert.ok(f.calls.idTokens.every(call => call.checkRevoked === true));
    assert.ok(f.calls.sessionCookies.every(call => call.checkRevoked === true));
  } finally { await f.close(); }
});

test('HTTP raw PUT preserves application/json bytes exactly and DELETE removes the same object', async () => {
  const f = await fixture();
  try {
    const jsonPath = 'families/synthetic-family/documents/json/source.json';
    const bytes = Buffer.from('{\n  "fixture": true, "values": [1, 2, 3]\n}\n');
    const upload = await f.request(canonicalFileUrl(jsonPath), { method: 'PUT', token: 'member', headers: { 'Content-Type': 'application/json' }, body: bytes });
    assert.equal(upload.status, 200);
    privateHeaders(upload);
    assert.deepEqual(await upload.json(), { storagePath: jsonPath, downloadUrl: canonicalFileUrl(jsonPath) });
    assert.deepEqual(f.objects.get(jsonPath).bytes, bytes, 'the global JSON parser cannot preparse file bytes');
    assert.equal(f.objects.get(jsonPath).metadata.teluvaOwnerUid, 'member');
    assert.equal(f.calls.saves, 1);
    const download = await f.request(canonicalFileUrl(jsonPath), { token: 'member' });
    assert.equal(download.headers.get('content-disposition'), 'attachment');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const remove = await f.request(canonicalFileUrl(jsonPath), { method: 'DELETE', token: 'member' });
    assert.equal(remove.status, 200);
    assert.deepEqual(await remove.json(), { ok: true });
    assert.equal(f.calls.deletes, 1);
    assert.equal(f.objects.has(jsonPath), false);
    const gone = await f.request(canonicalFileUrl(jsonPath), { token: 'member' });
    assert.equal(gone.status, 404);
    await gone.arrayBuffer();
  } finally { await f.close(); }
});

test('HTTP rejects unauthorized and child uploads before consuming an advertised giant body', async () => {
  const f = await fixture();
  try {
    const anonymous = await headersOnlyUpload(f.base, {});
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.body, /FILE_SIGN_IN_REQUIRED/);
    assert.equal(anonymous.headers['cache-control'], 'private, no-store, max-age=0');
    const child = await headersOnlyUpload(f.base, { Authorization: 'Bearer child' });
    assert.equal(child.status, 403);
    assert.match(child.body, /FILE_READ_ONLY/);
    const oversized = await headersOnlyUpload(f.base, { Authorization: 'Bearer member' });
    assert.equal(oversized.status, 413);
    assert.match(oversized.body, /FILE_TOO_LARGE/);
    f.objects.get(path).metadata.teluvaAccess = 'estate';
    const estate = await headersOnlyUpload(f.base, { Authorization: 'Bearer member', 'Content-Length': 1024 });
    assert.equal(estate.status, 403, 'estate authorization also rejects before awaiting file bytes');
    assert.match(estate.body, /FILE_ESTATE_DENIED/);
    assert.equal(f.calls.saves, 0);
    assert.deepEqual(f.objects.get(path).bytes, sample);
  } finally { await f.close(); }
});

test('HTTP file bytes require current membership even with a valid cookie; writes require bearer authorization', async () => {
  const f = await fixture();
  try {
    const cookie = `${FILE_SESSION_COOKIE}=synthetic-session-admin`;
    const anonymous = await f.request(canonicalFileUrl(path));
    assert.equal(anonymous.status, 401);
    privateHeaders(anonymous);
    await anonymous.arrayBuffer();
    const outsider = await f.request(canonicalFileUrl(path), { token: 'outsider' });
    assert.equal(outsider.status, 403);
    await outsider.arrayBuffer();
    const cookieWrite = await f.request(canonicalFileUrl(path), { method: 'PUT', cookie, body: Buffer.from('replacement') });
    assert.equal(cookieWrite.status, 401, 'session cookies authorize native reads, never mutation');
    await cookieWrite.arrayBuffer();
    f.roles.delete('synthetic-family:admin');
    const removed = await f.request(canonicalFileUrl(path), { cookie });
    assert.equal(removed.status, 403, 'removing the role immediately revokes file access without waiting for cookie expiry');
    await removed.arrayBuffer();
    assert.equal(f.calls.streams, 0);
    assert.equal(f.calls.saves, 0);
  } finally { await f.close(); }
});

test('HTTP sends active file types as sandboxed attachments and safe PDF/media as inline', async () => {
  const f = await fixture();
  try {
    for (const contentType of ['text/html', 'image/svg+xml', 'application/javascript']) {
      f.objects.set(path, { ...f.objects.get(path), contentType, bytes: Buffer.from('<script>fixture()</script>') });
      const response = await f.request(canonicalFileUrl(path), { token: 'admin' });
      assert.equal(response.status, 200);
      privateHeaders(response);
      assert.equal(response.headers.get('content-disposition'), 'attachment', `${contentType} cannot execute as an application page`);
      await response.arrayBuffer();
    }
    for (const contentType of ['application/pdf', 'audio/mpeg', 'video/mp4']) {
      f.objects.set(path, { ...f.objects.get(path), contentType });
      const response = await f.request(canonicalFileUrl(path), { token: 'admin' });
      assert.equal(response.headers.get('content-disposition'), 'inline');
      privateHeaders(response);
      await response.arrayBuffer();
    }
  } finally { await f.close(); }
});

test('HTTP estate policy denies ordinary members/children and allows only current explicit adult readers', async () => {
  const f = await fixture();
  try {
    f.objects.get(path).metadata.teluvaAccess = 'estate';
    for (const uid of ['member', 'child']) {
      const read = await f.request(canonicalFileUrl(path), { token: uid });
      assert.equal(read.status, 403);
      assert.equal((await read.json()).code, 'FILE_ESTATE_DENIED');
    }
    const reader = await f.request(canonicalFileUrl(path), { cookie: `${FILE_SESSION_COOKIE}=synthetic-session-reader` });
    assert.equal(reader.status, 200);
    assert.deepEqual(Buffer.from(await reader.arrayBuffer()), sample);
    const readerDelete = await f.request(canonicalFileUrl(path), { method: 'DELETE', token: 'reader' });
    assert.equal(readerDelete.status, 403);
    await readerDelete.arrayBuffer();
    const admin = await f.request(canonicalFileUrl(path), { token: 'admin' });
    assert.equal(admin.status, 200);
    await admin.arrayBuffer();
    assert.equal(f.calls.deletes, 0);
  } finally { await f.close(); }
});

test('HTTP session exchange refuses cross-origin requests and logout clears all cookie security attributes', async () => {
  const f = await fixture();
  try {
    const crossed = await f.request('/api/files/session', { method: 'POST', token: 'admin', headers: { Origin: 'https://other.example.test' } });
    assert.equal(crossed.status, 403);
    assert.equal(crossed.headers.get('set-cookie'), null);
    await crossed.arrayBuffer();
    const crossSite = await f.request('/api/files/session', { method: 'POST', token: 'admin', headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    await crossSite.arrayBuffer();
    assert.equal(f.calls.sessionsCreated.length, 0);
    const clear = await f.request('/api/files/session', { method: 'DELETE', headers: { Origin: f.base } });
    assert.equal(clear.status, 200);
    privateHeaders(clear);
    assert.deepEqual(await clear.json(), { ok: true });
    const cookie = clear.headers.get('set-cookie');
    assert.match(cookie, new RegExp(`^${FILE_SESSION_COOKIE}=; Max-Age=0;`));
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cookie.includes(flag));
  } finally { await f.close(); }
});

test('the live file router precedes the general body parser', () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const files = source.indexOf("app.use('/api/files', createFileRouter(fileGatewayDependencies))");
  const json = source.indexOf("app.use(express.json({ limit: '25mb' }))");
  assert.ok(files >= 0 && json >= 0 && files < json, 'native JSON uploads must reach the raw file router before express.json');
});
