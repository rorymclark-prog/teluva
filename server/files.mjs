import express from 'express';
import { pipeline } from 'node:stream/promises';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FILE_SESSION_COOKIE = 'teluva_file_session';
export const FILE_SESSION_MS = 60 * 60 * 1000;

export class FileAccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function fileTarget(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 || /[\\\x00-\x1f\x7f]/.test(value)) {
    throw new FileAccessError(400, 'FILE_PATH_INVALID', 'Choose a valid saved file.');
  }
  const parts = value.split('/');
  if (parts.length < 4 || parts[0] !== 'families' || !/^[A-Za-z0-9_-]{1,128}$/.test(parts[1])
    || parts.some(part => !part || part === '.' || part === '..')) {
    throw new FileAccessError(400, 'FILE_PATH_INVALID', 'Choose a valid saved file.');
  }
  return { path: value, familyId: parts[1] };
}

export const canonicalFileUrl = path => `/api/files/content?path=${encodeURIComponent(fileTarget(path).path)}`;
export const sharedFileNamespace = path => ['asset-photos', 'travel-photos', 'timeline-photos', 'in-memory-photos', 'recipe-photos', 'slip-photos'].includes(path.split('/')[2]);

export function legacyFilePath(value, bucketName) {
  if (typeof value !== 'string') return null;
  try {
    let path;
    if (value.startsWith('/api/files/content?')) {
      const url = new URL(value, 'https://teluva.invalid');
      if (url.pathname !== '/api/files/content') return null;
      path = url.searchParams.get('path');
    } else {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password) return null;
      const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
      if (!match || decodeURIComponent(match[1]) !== bucketName) return null;
      path = decodeURIComponent(match[2]);
    }
    return fileTarget(path).path;
  } catch { return null; }
}

export function estateLinkedIds(estate) {
  return new Set((Array.isArray(estate?.records) ? estate.records : [])
    .flatMap(record => Array.isArray(record?.linkedDocIds) ? record.linkedDocIds.filter(id => typeof id === 'string') : []));
}

export function projectedFilePaths(value, bucketName, found = new Set()) {
  if (typeof value === 'string') { const path = legacyFilePath(value, bucketName); if (path) found.add(path); }
  else if (Array.isArray(value)) value.forEach(item => projectedFilePaths(item, bucketName, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => projectedFilePaths(item, bucketName, found));
  return found;
}

export function connectedPhotoPaths(projected, bucketName) {
  const paths = new Set();
  for (const value of [projected?.avatarUrl, ...(Array.isArray(projected?.favorites) ? projected.favorites.map(item => item?.imageUrl) : [])]) {
    const path = legacyFilePath(value, bucketName);
    if (path) paths.add(path);
  }
  return paths;
}

export function projectConnectedFileUrls(value, { spaceId, linkId, memberId }, bucketName) {
  if (!value || typeof value !== 'object') return value;
  const convert = source => {
    const path = legacyFilePath(source, bucketName);
    return path ? `/api/files/connected?spaceId=${encodeURIComponent(spaceId)}&linkId=${encodeURIComponent(linkId)}&memberId=${encodeURIComponent(memberId)}&path=${encodeURIComponent(path)}` : source;
  };
  const output = { ...value };
  if (typeof value.avatarUrl === 'string') output.avatarUrl = convert(value.avatarUrl);
  if (Array.isArray(value.favorites)) output.favorites = value.favorites.map(item => item && typeof item === 'object'
    ? { ...item, ...(typeof item.imageUrl === 'string' ? { imageUrl: convert(item.imageUrl) } : {}) } : item);
  return output;
}

export function isEstateFile(path, metadata, estate, documents, bucketName) {
  if (metadata?.metadata?.teluvaAccess === 'estate' || path.split('/')[2] === 'estate') return true;
  const ids = estateLinkedIds(estate);
  const parts = path.split('/');
  if (parts[2] === 'documents' && ids.has(parts[3])) return true;
  return (Array.isArray(documents?.docs) ? documents.docs : []).some(document => ids.has(document?.id)
    && (document.storagePath === path || legacyFilePath(document.downloadUrl, bucketName) === path));
}

export function sourceMemberIds(storagePath, members, bucketName) {
  const parts = storagePath.split('/');
  return members.filter(member => projectedFilePaths(member, bucketName).has(storagePath)
    || (['referrals', 'birthday-photos'].includes(parts[2]) && parts[3] === member.id)
    || (parts[2] === 'documents' && (member.documents || []).some(document => document.id === parts[3])))
    .map(member => member.id);
}

export function fileAccessPolicy({ storagePath, metadata, caller, spaceInfo, members = [], estate, access, documents, bucketName }) {
  if (caller?.role === 'admin') return { estate: false, ownerAllowed: true };
  let ownerAllowed = true;
  if (spaceInfo?.type === 'business') {
    const ids = new Set();
    try { for (const id of JSON.parse(metadata?.metadata?.teluvaProfileIds || '[]')) if (typeof id === 'string') ids.add(id); } catch { /* fail closed below */ }
    const owners = members.filter(member => ids.has(member.id));
    // A member can edit their own document references. Those references must
    // never add a grant to another person's byte object. Only the immutable
    // server ledger (admin bind/migration), or this upload's authenticated
    // uploader, establishes ownership.
    ownerAllowed = ids.size
      ? owners.some(member => member.linkedUid === caller.uid || (caller.email && member.email === caller.email))
      : metadata?.metadata?.teluvaScope === 'shared' || metadata?.metadata?.teluvaOwnerUid === caller.uid;
    const sourceIds = sourceMemberIds(storagePath, members, bucketName);
    if (!ids.size && sourceIds.length && metadata?.metadata?.teluvaScope !== 'shared') {
      const sourceOwners = members.filter(member => sourceIds.includes(member.id));
      if (!sourceOwners.some(member => member.linkedUid === caller.uid || (caller.email && member.email === caller.email))) ownerAllowed = false;
    }
    if (!metadata && !sourceIds.length && caller.role !== 'connected') ownerAllowed = true;
    if (metadata?.metadata?.teluvaProfileBinding === 'inventory-ambiguous') ownerAllowed = false;
  }
  const parts = storagePath.split('/');
  if (parts[2] === 'chat-attachments' && parts[3] !== caller.uid && caller.role !== 'connected') {
    const adopted = (Array.isArray(documents?.docs) ? documents.docs : [])
      .some(document => document.storagePath === storagePath || projectedFilePaths(document, bucketName).has(storagePath));
    if (!adopted) ownerAllowed = false;
  }
  return {
    estate: isEstateFile(storagePath, metadata, estate, documents, bucketName),
    readerUids: Array.isArray(access?.readerUids) ? access.readerUids : [], ownerAllowed,
  };
}

export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  const fail = () => { throw new FileAccessError(416, 'FILE_RANGE_INVALID', 'That byte range is unavailable.'); };
  if (!match || (!match[1] && !match[2]) || size === 0) return fail();
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return fail();
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return fail();
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

const noStore = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Uploaded HTML/SVG must never execute with the application's origin.
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function cookieValue(header, key) {
  for (const item of String(header || '').split(';')) {
    const index = item.indexOf('=');
    if (index > 0 && item.slice(0, index).trim() === key) return item.slice(index + 1).trim();
  }
  return '';
}

function sameOrigin(req) {
  const origin = req.headers?.origin;
  const fetchSite = req.headers?.['sec-fetch-site'];
  if (fetchSite === 'cross-site') throw new FileAccessError(403, 'FILE_ORIGIN_DENIED', 'Open this action inside Teluva.');
  if (!origin) return;
  const host = req.headers?.host;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host || !['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch { throw new FileAccessError(403, 'FILE_ORIGIN_DENIED', 'Open this action inside Teluva.'); }
}

export function createFileHandlers({ verifyIdToken, verifySessionCookie, createSessionCookie, getRole, getPolicy, authorizeConnected, bucket, secureCookies = true }) {
  const identity = async (req, allowSession = false) => {
    const authorization = req.headers?.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    let decoded;
    try {
      if (token) decoded = await verifyIdToken(token, true);
      else if (allowSession) {
        const session = cookieValue(req.headers?.cookie, FILE_SESSION_COOKIE);
        if (session) decoded = await verifySessionCookie(session, true);
      }
    } catch { throw new FileAccessError(401, 'FILE_SIGN_IN_REQUIRED', 'Sign in again to open this file.'); }
    if (!decoded?.uid || !decoded.email_verified) throw new FileAccessError(401, 'FILE_SIGN_IN_REQUIRED', 'Sign in to open this file.');
    return { uid: decoded.uid, email: decoded.email || '', token };
  };
  const authorize = async (req, write = false) => {
    if (write) sameOrigin(req);
    const target = fileTarget(req.query?.path);
    // OCR caches are server-internal derivatives of the source's permissions;
    // they must never become a separate, less protected byte endpoint.
    if (target.path.endsWith('.ocr.json')) throw new FileAccessError(403, 'FILE_INTERNAL', 'Open the original document instead.');
    const caller = await identity(req, !write);
    const role = await getRole(target.familyId, caller.uid);
    if (!['admin', 'member', 'child'].includes(role)) throw new FileAccessError(403, 'FILE_ACCESS_DENIED', 'You no longer have access to this file.');
    if (write && role === 'child') throw new FileAccessError(403, 'FILE_READ_ONLY', 'This account can view files but cannot change them.');
    return { ...target, ...caller, role };
  };
  const metadata = async file => {
    try { return (await file.getMetadata())[0]; }
    catch (error) { if (error?.code === 404) return null; throw error; }
  };
  const enforcePolicy = async (caller, info, write = false) => {
    const policy = await getPolicy(caller.familyId, caller.path, info, caller);
    if (policy?.ownerAllowed === false) throw new FileAccessError(403, 'FILE_PROFILE_DENIED', 'You do not have access to this person’s files.');
    if (!policy?.estate || caller.role === 'admin') return;
    if (write || caller.role !== 'member' || !policy.readerUids?.includes(caller.uid)) {
      throw new FileAccessError(403, 'FILE_ESTATE_DENIED', 'An admin must give this account access to the estate document.');
    }
  };
  const execute = operation => async req => {
    try { return await operation(req); }
    catch (error) {
      if (error instanceof FileAccessError) return { status: error.status, headers: noStore, body: { error: error.message, code: error.code } };
      if (error?.code === 412) return { status: 409, headers: noStore, body: { error: 'This file changed while you were editing it. Reload before trying again.', code: 'FILE_CHANGED' } };
      console.error('[files] request failed', error?.code || error?.name || 'unknown');
      return { status: 503, headers: noStore, body: { error: 'The file could not be opened. Try again shortly.', code: 'FILE_UNAVAILABLE' } };
    }
  };
  const read = execute(async req => {
      let caller;
      if (req.connectedRead) {
        const signedIn = await identity(req, true);
        if (!authorizeConnected) throw new FileAccessError(403, 'FILE_ACCESS_DENIED', 'That shared photo is unavailable.');
        caller = await authorizeConnected(req, signedIn);
      } else caller = await authorize(req);
      const file = bucket.file(caller.path);
      const info = await metadata(file);
      if (!info) throw new FileAccessError(404, 'FILE_NOT_FOUND', 'That saved file is unavailable.');
      await enforcePolicy(caller, info);
      const size = Number(info.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid-object-size');
      let range;
      try { range = byteRange(req.headers?.range, size); }
      catch (error) {
        if (error instanceof FileAccessError && error.status === 416) return { status: 416, headers: { ...noStore, 'Content-Range': `bytes */${size}` }, body: { error: error.message, code: error.code } };
        throw error;
      }
      const type = String(info.contentType || 'application/octet-stream').replace(/[\r\n]/g, '');
      const safeInline = /^(image\/(?:jpeg|png|webp|gif|avif|bmp)|application\/pdf|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(type);
      if (req.connectedRead && !/^image\/(?:jpeg|png|webp|gif|avif|bmp)$/i.test(type)) throw new FileAccessError(403, 'FILE_ACCESS_DENIED', 'Only the shared photo is available here.');
      const headers = { ...noStore, 'Content-Type': type, 'Content-Length': String(range ? range.end - range.start + 1 : size), 'Accept-Ranges': 'bytes', 'Content-Disposition': safeInline ? 'inline' : 'attachment' };
      if (info.contentEncoding) headers['Content-Encoding'] = String(info.contentEncoding).replace(/[\r\n]/g, '');
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      const stream = req.method === 'HEAD' ? undefined : file.createReadStream({ ...(range || {}), decompress: false });
      return { status: range ? 206 : 200, headers, stream };
  });
  return {
    preflightWrite: execute(async req => {
      const caller = await authorize(req, true);
      const length = req.headers?.['content-length'];
      if (length !== undefined) {
        if (!/^\d+$/.test(String(length))) throw new FileAccessError(400, 'FILE_SIZE_INVALID', 'Choose a valid file.');
        if (!Number.isSafeInteger(Number(length)) || Number(length) >= MAX_FILE_BYTES) throw new FileAccessError(413, 'FILE_TOO_LARGE', 'Choose a file smaller than 20 MiB.');
      }
      await enforcePolicy(caller, await metadata(bucket.file(caller.path)), true);
      return { status: 204 };
    }),
    session: execute(async req => {
      sameOrigin(req);
      const caller = await identity(req);
      const cookie = await createSessionCookie(caller.token, { expiresIn: FILE_SESSION_MS });
      const suffix = secureCookies ? '; Secure' : '';
      return { status: 200, headers: { ...noStore, 'Set-Cookie': `${FILE_SESSION_COOKIE}=${cookie}; Max-Age=${FILE_SESSION_MS / 1000}; Path=/; HttpOnly; SameSite=Strict${suffix}` }, body: { ok: true } };
    }),
    clearSession: execute(async req => {
      sameOrigin(req);
      return { status: 200, headers: { ...noStore, 'Set-Cookie': `${FILE_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}` }, body: { ok: true } };
    }),
    read,
    readConnected: req => read({ headers: req.headers, query: req.query, method: req.method, connectedRead: true }),
    authorizeRead: execute(async req => {
      const caller = await authorize(req);
      const info = await metadata(bucket.file(caller.path));
      if (!info) throw new FileAccessError(404, 'FILE_NOT_FOUND', 'That saved file is unavailable.');
      await enforcePolicy(caller, info);
      return { status: 200, caller };
    }),
    write: execute(async req => {
      const caller = await authorize(req, true);
      if (!Buffer.isBuffer(req.body) || req.body.length >= MAX_FILE_BYTES) throw new FileAccessError(413, 'FILE_TOO_LARGE', 'Choose a file smaller than 20 MiB.');
      const file = bucket.file(caller.path);
      const previous = await metadata(file);
      await enforcePolicy(caller, previous, true);
      const custom = { ...(previous?.metadata || {}) };
      delete custom.firebaseStorageDownloadTokens;
      if (!custom.teluvaOwnerUid) custom.teluvaOwnerUid = caller.uid;
      if (sharedFileNamespace(caller.path) || req.headers?.['x-teluva-file-scope'] === 'shared') custom.teluvaScope = 'shared';
      const preconditionOpts = previous
        ? { ifGenerationMatch: String(previous.generation), ifMetagenerationMatch: String(previous.metageneration) }
        : { ifGenerationMatch: 0 };
      await bucket.file(caller.path, { preconditionOpts }).save(req.body, {
        resumable: false,
        preconditionOpts,
        metadata: { contentType: req.headers?.['content-type'] || 'application/octet-stream', cacheControl: 'private, no-store, max-age=0', metadata: custom },
      });
      return { status: 200, headers: noStore, body: { storagePath: caller.path, downloadUrl: canonicalFileUrl(caller.path) } };
    }),
    remove: execute(async req => {
      const caller = await authorize(req, true);
      const file = bucket.file(caller.path);
      const previous = await metadata(file);
      await enforcePolicy(caller, previous, true);
      if (previous) await bucket.file(caller.path, { preconditionOpts: {
        ifGenerationMatch: String(previous.generation), ifMetagenerationMatch: String(previous.metageneration),
      } }).delete();
      return { status: 200, headers: noStore, body: { ok: true } };
    }),
    protectEstate: execute(async req => {
      sameOrigin(req);
      const caller = await identity(req);
      const paths = req.body?.paths;
      if (!Array.isArray(paths) || paths.length > 200) throw new FileAccessError(400, 'FILE_PATH_INVALID', 'Choose valid estate files.');
      // Validate the whole batch before mutating anything.
      const targets = [...new Set(paths)].map(fileTarget);
      for (const target of targets) {
        if (await getRole(target.familyId, caller.uid) !== 'admin') throw new FileAccessError(403, 'FILE_ESTATE_DENIED', 'Only admins can attach estate files.');
      }
      for (const target of targets) {
        const file = bucket.file(target.path);
        const info = await metadata(file);
        if (!info) throw new FileAccessError(404, 'FILE_NOT_FOUND', 'The estate file could not be found.');
        await file.setMetadata({ metadata: { ...(info.metadata || {}), teluvaAccess: 'estate' } }, { ifMetagenerationMatch: String(info.metageneration) });
      }
      return { status: 200, headers: noStore, body: { ok: true } };
    }),
    bindProfile: execute(async req => {
      sameOrigin(req);
      const caller = await identity(req);
      const familyId = req.body?.spaceId;
      if (typeof familyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(familyId)
        || !Array.isArray(req.body?.bindings) || req.body.bindings.length > 400) throw new FileAccessError(400, 'FILE_BINDING_INVALID', 'Choose valid profile attachments.');
      if (await getRole(familyId, caller.uid) !== 'admin') throw new FileAccessError(403, 'FILE_PROFILE_DENIED', 'Only admins can bind profile attachments.');
      const bindings = req.body.bindings.map(binding => {
        const target = fileTarget(binding?.path);
        if (target.familyId !== familyId || typeof binding?.memberId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(binding.memberId)) throw new FileAccessError(400, 'FILE_BINDING_INVALID', 'Choose valid profile attachments.');
        return { ...target, memberId: binding.memberId };
      });
      const byPath = new Map();
      for (const binding of bindings) {
        if (!byPath.has(binding.path)) byPath.set(binding.path, new Set());
        byPath.get(binding.path).add(binding.memberId);
      }
      for (const [path, ids] of byPath) {
        const file = bucket.file(path);
        const info = await metadata(file);
        if (!info) throw new FileAccessError(404, 'FILE_NOT_FOUND', 'The profile attachment could not be found.');
        if (info.metadata?.teluvaProfileBinding !== 'inventory-ambiguous') {
          try { for (const id of JSON.parse(info.metadata?.teluvaProfileIds || '[]')) if (typeof id === 'string') ids.add(id); } catch { /* authoritative new binding repairs invalid metadata */ }
        }
        await file.setMetadata({ metadata: { ...(info.metadata || {}), teluvaProfileIds: JSON.stringify([...ids].sort()), teluvaProfileBinding: 'admin' } }, { ifMetagenerationMatch: String(info.metageneration) });
      }
      return { status: 200, headers: noStore, body: { ok: true } };
    }),
  };
}

export async function sendFileResult(result, req, res) {
  res.status(result.status);
  if (result.headers) res.set(result.headers);
  if (result.stream) {
    req.once('aborted', () => result.stream.destroy());
    try { await pipeline(result.stream, res); }
    catch { if (!res.destroyed) res.destroy(); }
  } else if (result.body) res.json(result.body);
  else res.end();
}

export function createFileRouter(dependencies) {
  const router = express.Router();
  const handlers = createFileHandlers(dependencies);
  const respond = handler => async (req, res) => sendFileResult(await handler(req), req, res);
  router.post('/session', respond(handlers.session));
  router.delete('/session', respond(handlers.clearSession));
  router.get('/content', respond(handlers.read)); // Express also routes HEAD here
  router.get('/connected', respond(handlers.readConnected));
  router.put('/content', async (req, res, next) => {
    const result = await handlers.preflightWrite(req);
    if (result.status !== 204) return sendFileResult(result, req, res);
    next();
  }, express.raw({ type: () => true, limit: MAX_FILE_BYTES - 1 }), respond(handlers.write));
  router.delete('/content', respond(handlers.remove));
  router.post('/protect-estate', express.json({ limit: '64kb' }), respond(handlers.protectEstate));
  router.post('/bind-profile', express.json({ limit: '128kb' }), respond(handlers.bindProfile));
  router.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).set(noStore).json({ error: 'Choose a file smaller than 20 MiB.', code: 'FILE_TOO_LARGE' });
    next(error);
  });
  return router;
}
