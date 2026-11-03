import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { ImportInboxError, sanitizeImportProposal } from './importInbox.mjs';
import { canonicalFileUrl } from './files.mjs';

export const ORIGINAL_MAX_BYTES = 12 * 1024 * 1024;
export const ORIGINAL_INLINE_BYTES = 96 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (status, code, message) => { throw new ImportInboxError(status, code, message); };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => hash(JSON.stringify(stable(value)));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const allowed = (value, keys) => { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'INVALID_ORIGINAL', 'Use the supported original-file fields.'); };

export function publicFileAddress(address) {
  if (address.includes(':')) return /^2[0-9a-f]{3}:/i.test(address) && !/^2002:/i.test(address)
    && (!/^2001:/i.test(address) || (parseInt(address.split(':')[1], 16) >= 0x200 && !/^2001:db8:/i.test(address)));
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function authorizedHostFileUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(400, 'FILE_REFERENCE_INVALID', 'Choose an attachment or authorized host file.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || value.length > 8192
    || !(url.hostname === 'files.oaiusercontent.com' || url.hostname.endsWith('.oaiusercontent.com') || url.hostname === 'usercontent.openai.com')) {
    fail(400, 'FILE_REFERENCE_INVALID', 'This is not a supported host file reference. Attach the original in this chat or upload it in Teluva; source page links are not downloads.');
  }
  return url;
}

/** Only host-authorized file download URLs, with public DNS pinned for TLS.
 * No cookies, source-provider credentials, arbitrary URLs or private addresses. */
export async function downloadHostFile(value, { resolve = lookup, request = https.request } = {}, redirects = 0) {
  const url = authorizedHostFileUrl(value);
  const addresses = await resolve(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !publicFileAddress(item.address))) fail(400, 'FILE_REFERENCE_INVALID', 'The attachment download address is unavailable.');
  const selected = addresses.find(item => item.family === 4) || addresses[0];
  const response = await new Promise((resolveResponse, reject) => {
    const req = request(url, { agent: false, signal: AbortSignal.timeout(45_000),
      lookup: (_host, options, done) => options?.all ? done(null, [selected]) : done(null, selected.address, selected.family),
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'TeluvaOriginalImport/1.0' } }, resolveResponse);
    req.setTimeout(30_000, () => req.destroy(new Error('attachment-timeout')));
    req.on('error', reject); req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    if (redirects >= 2 || !response.headers.location) fail(400, 'FILE_REFERENCE_INVALID', 'Refresh the attachment reference and try again.');
    return downloadHostFile(new URL(response.headers.location, url).href, { resolve, request }, redirects + 1);
  }
  if (response.statusCode !== 200) { response.resume(); fail(422, 'FILE_DOWNLOAD_FAILED', 'The attachment link expired or is unavailable. Select the file again; your existing import is kept.'); }
  if (Number(response.headers['content-length']) > ORIGINAL_MAX_BYTES) { response.destroy(); fail(413, 'ORIGINAL_TOO_LARGE', 'Choose an original up to 12 MiB.'); }
  const chunks = []; let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > ORIGINAL_MAX_BYTES) { response.destroy(); fail(413, 'ORIGINAL_TOO_LARGE', 'Choose an original up to 12 MiB.'); }
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), mimeType: String(response.headers['content-type'] || '').split(';')[0] };
}

export function originalSource(input) {
  allowed(input, ['provider', 'sourceId', 'url', 'label', 'representation']);
  if (!['drive', 'gmail', 'local', 'chatgpt', 'other'].includes(input.provider) || !text(input.label, 200)
    || (input.sourceId !== undefined && !text(input.sourceId, 500)) || !['original', 'export'].includes(input.representation)) fail(400, 'INVALID_PROVENANCE', 'Name the source and distinguish an original file from a native-document export.');
  const result = { provider: input.provider, label: input.label.trim(), representation: input.representation, attribution: 'Supplied by the importing assistant' };
  if (input.sourceId) result.sourceId = input.sourceId;
  if (input.url !== undefined) {
    let url; try { url = new URL(input.url); } catch { fail(400, 'INVALID_PROVENANCE', 'Use a source page link without download credentials.'); }
    if (url.protocol !== 'https:' || url.username || url.password || input.url.length > 2000
      || [...url.searchParams.keys()].some(key => /token|signature|secret|credential|^sig$|^code$/i.test(key))) fail(400, 'INVALID_PROVENANCE', 'Keep temporary download credentials out of source links.');
    if (input.provider === 'drive' && !['drive.google.com', 'docs.google.com'].includes(url.hostname)) fail(400, 'INVALID_PROVENANCE', 'Use the original Drive source page.');
    if (input.provider === 'gmail' && url.hostname !== 'mail.google.com') fail(400, 'INVALID_PROVENANCE', 'Use the original Gmail message link.');
    const gmailAccount = input.provider === 'gmail' ? url.searchParams.get('authuser') : null;
    url.search = '';
    if (gmailAccount && gmailAccount.length <= 320) url.searchParams.set('authuser', gmailAccount);
    if (input.provider !== 'gmail' || !/^#(?:all|inbox|sent)\/[A-Za-z0-9_-]+$/.test(url.hash)) url.hash = '';
    result.url = url.href;
  }
  return result;
}
function fileType(bytes, suggested) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > ORIGINAL_MAX_BYTES) fail(413, 'ORIGINAL_TOO_LARGE', 'Choose a nonempty original up to 12 MiB.');
  const head = bytes.subarray(0, 16);
  const type = head.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
    : head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : head[0] === 255 && head[1] === 216 && head[2] === 255 ? 'image/jpeg'
    : /^GIF8[79]a/.test(head.toString()) ? 'image/gif'
    : head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (type) { if (suggested && suggested !== 'application/octet-stream' && suggested !== type) fail(415, 'ORIGINAL_TYPE_MISMATCH', 'The original bytes do not match the stated file type.'); return type; }
  if (!['text/plain', 'text/csv', 'text/markdown'].includes(suggested)) fail(415, 'ORIGINAL_TYPE_UNSUPPORTED', 'Import PDF, common images or UTF-8 text originals.');
  try { if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) throw Error(); } catch { fail(415, 'ORIGINAL_TYPE_MISMATCH', 'This is not a readable UTF-8 text original.'); }
  return suggested;
}

export function createConnectorOriginals({ db, bucket, resolveMembership, canReadDocument, inbox, download = downloadHostFile, origin }) {
  let activeImports = 0;
  async function authority(actor, tx) {
    const member = await resolveMembership(actor, actor.spaceId, { transaction: tx });
    if (!member || !['admin', 'member'].includes(member.role) || !actor.grantId) fail(403, 'IMPORT_FORBIDDEN', 'Reconnect to this space before importing originals.');
    const ref = db.doc(`connector_grants/${actor.grantId}`), snapshot = tx ? await tx.get(ref) : await ref.get();
    const grant = snapshot.exists && snapshot.data();
    if (!grant || grant.uid !== actor.uid || grant.spaceId !== actor.spaceId || grant.revokedAt || grant.expiresAt <= Date.now()
      || !grant.scopes?.includes('inbox:write') || (grant.membershipVersion || '') !== (member.membershipVersion || '')) fail(403, 'CONNECTION_REVOKED', 'This connection changed or was revoked. Reconnect before importing.');
    return member;
  }
  async function importOriginal(actor, input) {
    allowed(input, ['requestId', 'file', 'contentBase64', 'fileName', 'mimeType', 'sha256', 'source', 'proposal']);
    if (!text(input.requestId, 100) || !/^[A-Za-z0-9_.:-]+$/.test(input.requestId)) fail(400, 'INVALID_ORIGINAL', 'Use a stable request ID of up to 100 characters.');
    if (!!input.file === (input.contentBase64 !== undefined)) fail(400, 'INVALID_ORIGINAL', 'Send one authorized file reference or original bytes.');
    const source = originalSource(input.source);
    const proposal = input.proposal === undefined ? undefined : sanitizeImportProposal(input.proposal);
    if (proposal?.kind === 'preferences') fail(400, 'INVALID_IMPORT', 'Use an explicit named text request for preferences, not an attachment.');
    if (input.file) {
      allowed(input.file, ['download_url', 'file_id', 'file_name', 'mime_type']);
      if (!text(input.file.file_id, 300) || !text(input.file.download_url, 8192)) fail(400, 'FILE_REFERENCE_INVALID', 'Select an attachment from the host.');
      authorizedHostFileUrl(input.file.download_url);
    }
    const name = input.file?.file_name || input.fileName || 'Imported original';
    if (!text(name, 180) || /[\/\\]/.test(name)) fail(400, 'INVALID_ORIGINAL', 'Use a filename without folders.');
    const declaredType = input.file?.mime_type || input.mimeType;
    if (declaredType !== undefined && !text(declaredType, 100)) fail(400, 'INVALID_ORIGINAL', 'Use a valid MIME type.');
    if (input.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.sha256)) fail(400, 'INVALID_ORIGINAL', 'Use a SHA-256 checksum in lowercase hexadecimal.');
    let inline;
    if (input.contentBase64 !== undefined) {
      if (typeof input.contentBase64 !== 'string' || input.contentBase64.length > ORIGINAL_INLINE_BYTES * 4 / 3 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) fail(400, 'INVALID_ORIGINAL', 'Use complete base64 bytes up to 96 KiB, or a host file reference for larger originals.');
      inline = Buffer.from(input.contentBase64, 'base64');
    }
    const fingerprint = digest({ inlineHash: inline && hash(inline), name, declaredType, sha256: input.sha256, source, proposal });
    const requestId = hash(`${actor.uid}\n${input.requestId}`), space = actor.spaceId;
    const requestRef = db.doc(`families/${space}/originalImportRequests/${requestId}`), docsRef = db.doc(`families/${space}/reference/documents`);
    await authority(actor);
    const previous = await requestRef.get();
    let document;
    if (previous.exists) {
      const stored = previous.data();
      if (stored.fingerprint !== fingerprint || stored.createdBy !== actor.uid) fail(409, 'REQUEST_CONFLICT', 'This request ID belongs to a different original import.');
      document = stored.document;
      if (input.file && stored.fileId !== input.file.file_id) {
        let refreshed;
        try { refreshed = await download(input.file.download_url); } catch { fail(422, 'FILE_DOWNLOAD_FAILED', 'Refresh the attachment reference and retry. Your existing original is kept.'); }
        if (!Buffer.isBuffer(refreshed.bytes) || refreshed.bytes.length > ORIGINAL_MAX_BYTES || hash(refreshed.bytes) !== document.contentHash) fail(409, 'ORIGINAL_HASH_MISMATCH', 'The refreshed source has different bytes. Your existing original and review have not been overwritten.');
      }
    } else {
      let downloaded;
      try { downloaded = inline ? { bytes: inline } : await download(input.file.download_url); }
      catch (error) { if (error instanceof ImportInboxError) throw error; fail(422, 'FILE_DOWNLOAD_FAILED', 'The original could not be downloaded. Select the attachment again and retry with the same request ID.'); }
      const bytes = downloaded.bytes, mimeType = fileType(bytes, declaredType || downloaded.mimeType), contentHash = hash(bytes);
      if (input.sha256 && input.sha256 !== contentHash) fail(409, 'ORIGINAL_HASH_MISMATCH', 'The original checksum changed. Verify the source before retrying.');
      const id = `import-${hash(`${actor.uid}\n${contentHash}`).slice(0, 40)}`;
      const storagePath = `families/${space}/documents/${id}/original`, file = bucket.file(storagePath);
      await authority(actor);
      try { await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: mimeType, cacheControl: 'private, no-store, max-age=0',
        metadata: { teluvaOwnerUid: actor.uid, teluvaOriginalHash: contentHash } } }); }
      catch (error) {
        if (Number(error.code) !== 412) throw error;
        const [metadata] = await file.getMetadata();
        if (metadata.metadata?.teluvaOwnerUid !== actor.uid || metadata.metadata?.teluvaOriginalHash !== contentHash || Number(metadata.size) !== bytes.length) fail(409, 'ORIGINAL_CONFLICT', 'The existing original could not be verified.');
      }
      const stamp = new Date().toISOString();
      document = { id, name: name.replace(/\.[^.]+$/, '') || name, fileName: name, category: 'Other', fileType: mimeType, fileSize: bytes.length,
        contentHash, storagePath, downloadUrl: canonicalFileUrl(storagePath), uploadedAt: stamp.slice(0, 10),
        connectorSource: { ...source, importedBy: actor.uid, importedAt: stamp, byteSource: inline ? 'supplied-bytes' : 'authorized-host-file', contentHash } };
      document = await db.runTransaction(async tx => {
        await authority(actor, tx);
        const [request, snapshot] = await Promise.all([tx.get(requestRef), tx.get(docsRef)]);
        if (request.exists) { if (request.data().fingerprint !== fingerprint) fail(409, 'REQUEST_CONFLICT', 'This request ID belongs to a different import.'); return request.data().document; }
        const data = snapshot.exists ? snapshot.data() : {}, docs = Array.isArray(data.docs) ? data.docs : [];
        const existing = docs.find(row => row.id === id);
        if (existing && (existing.contentHash !== contentHash || existing.connectorSource?.importedBy !== actor.uid)) fail(409, 'ORIGINAL_CONFLICT', 'This original identifier is unavailable.');
        const resolved = existing || document;
        if (!existing) {
          const next = { ...data, docs: [document, ...docs] };
          if (Buffer.byteLength(JSON.stringify(next)) > 750_000) fail(413, 'VAULT_METADATA_FULL', 'The Vault index is full. The original is kept; contact support before retrying.');
          tx.set(docsRef, next);
        }
        tx.set(requestRef, { fingerprint, createdBy: actor.uid, grantId: actor.grantId, document: resolved, reportedSource: source,
          ...(input.file ? { fileId: input.file.file_id } : {}), createdAt: stamp });
        return resolved;
      });
    }
    await authority(actor);
    if (!await canReadDocument(actor, space, document.id)) fail(403, 'SOURCE_FORBIDDEN', 'Access to this saved original changed.');
    const item = await inbox.create(actor, space, { requestId: `original-${hash(`${actor.uid}\n${document.id}`)}`, documentId: document.id, ...(proposal ? { proposal } : {}) });
    return { spaceId: space, item, original: { documentId: document.id, fileName: document.fileName, mimeType: document.fileType, bytes: document.fileSize, sha256: document.contentHash, source: document.connectorSource },
      reviewUrl: `${origin}/?open=inbox&connector_space=${encodeURIComponent(space)}`, pendingReviewOnly: true };
  }
  return { importOriginal: async (...args) => {
    if (activeImports >= 3) fail(429, 'ORIGINAL_IMPORT_BUSY', 'Original imports are busy. Retry this item shortly with the same request ID.');
    activeImports++;
    try { return await importOriginal(...args); } finally { activeImports--; }
  } };
}
