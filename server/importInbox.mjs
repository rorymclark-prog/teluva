import { createHash, randomUUID } from 'node:crypto';
import express from 'express';

export const IMPORT_LIMITS = Object.freeze({ sourceChars: 40_000, sourceBytes: 100_000, proposalBytes: 24_000, inputBytes: 150_000, list: 100, analysisLeaseMs: 5 * 60_000 });
export class ImportInboxError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; if (details) this.details = details; }
}
const fail = (status, code, message, details) => { throw new ImportInboxError(status, code, message, details); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const validSpace = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const stable = value => Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const ASSET_CATEGORIES = ['Electronics', 'Appliance', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other'];
const DOCUMENT_CATEGORIES = ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'];
const ASSET_STRINGS = { name: 200, make: 160, model: 160, serialNumber: 200, purchasePrice: 80, currency: 3, purchaseLocation: 250,
  purchaseReference: 200, purchaseCountry: 80, ownerName: 200, location: 250, replacementValue: 80, notes: 4000 };
const ASSET_DATES = ['purchaseDate', 'deliveryDate', 'returnByDate'];
const WARRANTY_STRINGS = { provider: 200, reference: 200, contact: 500, terms: 3000 };
const DOCUMENT_STRINGS = { name: 200, notes: 4000 };
const stringSchema = limits => Object.fromEntries(Object.entries(limits).map(([key, maxLength]) => [key, { type: 'string', maxLength }]));
export const IMPORT_PROPOSAL_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'asset'], properties: { kind: { const: 'asset' }, asset: {
      type: 'object', additionalProperties: false, required: ['name', 'category'], properties: {
        ...stringSchema(ASSET_STRINGS), category: { enum: ASSET_CATEGORIES }, purchaseContext: { enum: ['consumer', 'business', 'unknown'] },
        ...Object.fromEntries(ASSET_DATES.map(key => [key, { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }])),
        warranties: { type: 'array', maxItems: 8, description: 'Only explicitly recorded commercial cover; never infer a warranty from the purchase date or statutory law.', items: {
          type: 'object', additionalProperties: false, required: ['kind'], properties: { id: { type: 'string', maxLength: 100 }, kind: { enum: ['manufacturer', 'retailer', 'extended'] },
            ...stringSchema(WARRANTY_STRINGS), startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        } },
      },
    } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'document'], properties: { kind: { const: 'document' }, document: {
      type: 'object', additionalProperties: false, required: ['name', 'category'], properties: { ...stringSchema(DOCUMENT_STRINGS), category: { enum: DOCUMENT_CATEGORIES }, docDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
    } } },
  ],
};
const allowedKeys = (object, keys) => {
  if (!plain(object) || Object.keys(object).some(key => !keys.includes(key))) fail(400, 'INVALID_IMPORT', 'The import contains unsupported fields.');
};
function text(value, limit, required = false, keepEmpty = false) {
  if (typeof value !== 'string' || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, 'INVALID_IMPORT', 'An import field contains invalid or oversized text.');
  const result = value.trim();
  if (required && !result) fail(400, 'INVALID_IMPORT', 'Add the required import details.');
  return result || (keepEmpty ? '' : undefined);
}
function date(value, keepEmpty = false) {
  if (value === '' && keepEmpty) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(400, 'INVALID_IMPORT', 'Enter a valid calendar date in YYYY-MM-DD form.');
  return value;
}
function strings(input, limits, required = [], keepEmpty = false) {
  const output = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (input[key] !== undefined) { const value = text(input[key], limit, required.includes(key), keepEmpty); if (value !== undefined) output[key] = value; }
    else if (required.includes(key)) fail(400, 'INVALID_IMPORT', 'Add the required import details.');
  }
  return output;
}
export function sanitizeImportProposal(input) {
  if (!plain(input) || bytes(input) > IMPORT_LIMITS.proposalBytes) fail(400, 'INVALID_IMPORT', 'The proposed record is invalid or too large.');
  if (input.kind === 'asset') {
    allowedKeys(input, ['kind', 'asset']);
    const value = input.asset;
    allowedKeys(value, [...Object.keys(ASSET_STRINGS), ...ASSET_DATES, 'category', 'purchaseContext', 'warranties']);
    const asset = strings(value, ASSET_STRINGS, ['name']);
    if (!ASSET_CATEGORIES.includes(value.category)) fail(400, 'INVALID_IMPORT', 'Choose a supported asset category.');
    asset.category = value.category;
    for (const key of ASSET_DATES) if (value[key] !== undefined && value[key] !== '') asset[key] = date(value[key]);
    if (asset.currency) {
      asset.currency = asset.currency.toUpperCase();
      if (!/^[A-Z]{3}$/.test(asset.currency)) fail(400, 'INVALID_IMPORT', 'Use a three-letter currency code.');
    }
    if (value.purchaseContext !== undefined) {
      if (!['consumer', 'business', 'unknown'].includes(value.purchaseContext)) fail(400, 'INVALID_IMPORT', 'Choose a supported purchase context.');
      asset.purchaseContext = value.purchaseContext;
    }
    if (value.warranties !== undefined) {
      if (!Array.isArray(value.warranties) || value.warranties.length > 8) fail(400, 'INVALID_IMPORT', 'The proposed warranty list is invalid or too large.');
      asset.warranties = value.warranties.map((warranty, index) => {
        allowedKeys(warranty, ['id', 'kind', ...Object.keys(WARRANTY_STRINGS), 'startDate', 'endDate']);
        if (!['manufacturer', 'retailer', 'extended'].includes(warranty.kind)) fail(400, 'INVALID_IMPORT', 'Choose a supported warranty kind.');
        const out = { id: warranty.id === undefined ? `warranty-${index + 1}` : text(warranty.id, 100, true), kind: warranty.kind, ...strings(warranty, WARRANTY_STRINGS) };
        if (!safeId(out.id)) fail(400, 'INVALID_IMPORT', 'The warranty identifier is invalid.');
        for (const key of ['startDate', 'endDate']) if (warranty[key] !== undefined && warranty[key] !== '') out[key] = date(warranty[key]);
        if (out.startDate && out.endDate && out.startDate > out.endDate) fail(400, 'INVALID_IMPORT', 'The recorded warranty ends before its start date.');
        return out;
      });
      if (new Set(asset.warranties.map(warranty => warranty.id)).size !== asset.warranties.length) fail(400, 'INVALID_IMPORT', 'Warranty identifiers must be unique.');
    }
    return { kind: 'asset', asset };
  }
  if (input.kind === 'document') {
    allowedKeys(input, ['kind', 'document']);
    allowedKeys(input.document, [...Object.keys(DOCUMENT_STRINGS), 'category', 'docDate']);
    const document = strings(input.document, DOCUMENT_STRINGS, ['name'], true);
    if (!DOCUMENT_CATEGORIES.includes(input.document.category)) fail(400, 'INVALID_IMPORT', 'Choose a supported document category.');
    document.category = input.document.category;
    if (input.document.docDate !== undefined) document.docDate = date(input.document.docDate, true);
    return { kind: 'document', document };
  }
  fail(400, 'INVALID_IMPORT', 'Choose an asset or document proposal.');
}
export function importDocumentVersion(document) {
  return digest({ contentHash: document.contentHash || null, storagePath: document.storagePath || '', downloadUrl: document.downloadUrl || '', fileSize: document.fileSize ?? null, fileType: document.fileType || '' });
}
function sourceSnapshot(document) {
  return { kind: 'document', hasOriginalDocument: true, documentId: document.id, sourceName: String(document.name || document.fileName || 'Vault document').slice(0, 200), contentHash: document.contentHash || null,
    documentVersion: importDocumentVersion(document) };
}
function validateRevision(options = {}) {
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1)) fail(400, 'INVALID_IMPORT', 'Use a valid draft revision.');
}
const revisionCheck = (item, options) => { if (options?.expectedRevision !== undefined && item.revision !== options.expectedRevision) fail(409, 'REVISION_CONFLICT', 'This draft changed. Reload it before saving or applying.'); };
const pending = item => { if (item.status !== 'pending') fail(409, 'IMPORT_TERMINAL', 'This import has already been applied or dismissed.'); };

/** All writes use role and source reads in the same transaction. Extraction is
 * deliberately outside that transaction and never writes a canonical record. */
export function createImportInbox({ db, resolveMembership, canReadDocument, extractDocument, now = () => new Date() }) {
  if (!db || typeof resolveMembership !== 'function' || typeof canReadDocument !== 'function' || typeof extractDocument !== 'function') throw new TypeError('Import inbox dependencies are required.');
  const timestamp = () => now().toISOString();
  const actorIn = (actor, spaceId) => {
    if (!actor || typeof actor.uid !== 'string' || !actor.uid || actor.uid.length > 128 || /[\/\x00-\x1f\x7f]/.test(actor.uid)) fail(401, 'AUTH_REQUIRED', 'Sign in to use the import inbox.');
    if (!validSpace(spaceId)) fail(400, 'INVALID_SPACE', 'Choose a valid space.');
  };
  const refs = space => ({ inbox: db.collection(`families/${space}/importInbox`), documents: db.doc(`families/${space}/reference/documents`), assets: db.collection(`families/${space}/assets`) });
  async function authorize(actor, spaceId, transaction) {
    actorIn(actor, spaceId);
    const membership = await resolveMembership(actor, spaceId, { transaction });
    let role = membership?.role;
    if (transaction) { const snap = await transaction.get(db.doc(`families/${spaceId}/roles/${actor.uid}`)); role = snap.exists ? snap.data().role : null; }
    if (!['admin', 'member'].includes(role)) fail(403, 'IMPORT_ADULT_REQUIRED', 'Only current adult members of this space can use the import inbox.');
    return { ...membership, role };
  }
  async function original(actor, spaceId, item, transaction, compare = false) {
    if (!item.source.documentId) return null;
    const reference = refs(spaceId).documents;
    const snapshot = transaction ? await transaction.get(reference) : await reference.get();
    const docs = snapshot.exists ? snapshot.data().docs : [];
    const document = Array.isArray(docs) ? docs.find(document => document?.id === item.source.documentId) : undefined;
    if (!document) fail(404, 'SOURCE_MISSING', 'The original document is no longer in this vault.');
    if (!await canReadDocument(actor, spaceId, document, { transaction })) fail(403, 'SOURCE_FORBIDDEN', 'This account cannot read the original document.');
    if (compare && item.source.documentVersion !== sourceSnapshot(document).documentVersion) fail(409, 'SOURCE_CHANGED', 'The original file changed. Analyze this import again before applying.');
    return { document, snapshot, docs };
  }
  async function readItem(actor, spaceId, id, transaction, membership) {
    if (!safeId(id)) fail(400, 'INVALID_IMPORT', 'Choose a valid import.');
    const ref = refs(spaceId).inbox.doc(id);
    const snap = transaction ? await transaction.get(ref) : await ref.get();
    if (!snap.exists) fail(404, 'IMPORT_MISSING', 'That import is no longer available.');
    const item = snap.data();
    if (item.spaceId !== spaceId || (membership.role !== 'admin' && item.createdBy !== actor.uid)) fail(403, 'IMPORT_FORBIDDEN', 'This account cannot review that import.');
    return { ref, item: { ...item, id } };
  }
  async function list(actor, spaceId) {
    const membership = await authorize(actor, spaceId);
    let query = refs(spaceId).inbox;
    if (membership.role !== 'admin') query = query.where('createdBy', '==', actor.uid);
    const snapshot = await query.orderBy('createdAt', 'desc').limit(IMPORT_LIMITS.list).get();
    const items = [];
    for (const row of snapshot.docs) {
      const item = { ...row.data(), id: row.id };
      if (item.spaceId !== spaceId || (membership.role !== 'admin' && item.createdBy !== actor.uid)) continue;
      try { await original(actor, spaceId, item); items.push(item); }
      catch (error) { if (!(error instanceof ImportInboxError) || ![403, 404].includes(error.status)) throw error; }
    }
    // Do not return a private batch if membership changed while source checks ran.
    const current = await authorize(actor, spaceId);
    return current.role === 'admin' ? items : items.filter(item => item.createdBy === actor.uid);
  }
  async function create(actor, spaceId, input) {
    actorIn(actor, spaceId);
    allowedKeys(input, ['documentId', 'sourceText', 'sourceName', 'proposal', 'requestId']);
    if (bytes(input) > IMPORT_LIMITS.inputBytes) fail(413, 'IMPORT_TOO_LARGE', 'This import is too large.');
    if (!safeId(input.requestId) || input.requestId.length > 128) fail(400, 'INVALID_IMPORT', 'Add a stable requestId for this submission.');
    const documentId = input.documentId;
    if (documentId !== undefined && !safeId(documentId)) fail(400, 'INVALID_IMPORT', 'Choose a valid original document.');
    if (documentId && input.sourceText !== undefined) fail(400, 'INVALID_IMPORT', 'Submit one original document or explicitly named text, not both.');
    const sourceText = !documentId ? text(input.sourceText, IMPORT_LIMITS.sourceChars, true) : undefined;
    const sourceName = !documentId ? text(input.sourceName, 200, true) : input.sourceName === undefined ? undefined : text(input.sourceName, 200);
    if (sourceText && Buffer.byteLength(sourceText, 'utf8') > IMPORT_LIMITS.sourceBytes) fail(413, 'IMPORT_TOO_LARGE', 'The submitted text is too large.');
    const proposal = input.proposal === undefined ? undefined : sanitizeImportProposal(input.proposal);
    const payloadHash = digest({ documentId, sourceText, sourceName, proposal });
    const id = createHash('sha256').update(`${actor.uid}\n${input.requestId}`).digest('hex').slice(0, 40);
    return db.runTransaction(async transaction => {
      await authorize(actor, spaceId, transaction);
      const ref = refs(spaceId).inbox.doc(id);
      const previous = await transaction.get(ref);
      if (previous.exists) {
        const item = previous.data();
        if (item.createdBy !== actor.uid || item.payloadHash !== payloadHash) fail(409, 'REQUEST_CONFLICT', 'This requestId already belongs to a different import.');
        await original(actor, spaceId, item, transaction);
        return { ...item, id };
      }
      let source = { kind: 'text', hasOriginalDocument: false, sourceName, sourceText };
      if (documentId) {
        const resolved = await original(actor, spaceId, { source: { documentId } }, transaction);
        source = sourceSnapshot(resolved.document);
      }
      const stamp = timestamp();
      const item = { id, spaceId, createdBy: actor.uid, status: 'pending', source, ...(proposal ? { proposal } : {}),
        analysis: { status: proposal ? 'ready' : 'idle' }, revision: 1, createdAt: stamp, updatedAt: stamp, payloadHash };
      transaction.set(ref, item);
      return item;
    });
  }
  async function update(actor, spaceId, id, input) {
    allowedKeys(input, ['proposal', 'expectedRevision']); validateRevision(input);
    const proposal = sanitizeImportProposal(input.proposal);
    return db.runTransaction(async transaction => {
      const membership = await authorize(actor, spaceId, transaction);
      const { ref, item } = await readItem(actor, spaceId, id, transaction, membership);
      pending(item); revisionCheck(item, input);
      await original(actor, spaceId, item, transaction, true);
      const next = { ...item, proposal, analysis: { status: 'ready',
        ...(item.analysis?.extractedText ? { extractedText: item.analysis.extractedText } : {}),
        ...(item.analysis?.evidenceQuotes ? { evidenceQuotes: item.analysis.evidenceQuotes } : {}),
      }, revision: item.revision + 1, updatedAt: timestamp() };
      transaction.set(ref, next); return next;
    });
  }
  async function analyze(actor, spaceId, id, options = {}) {
    allowedKeys(options, ['expectedRevision']); validateRevision(options);
    const jobId = randomUUID();
    const started = await db.runTransaction(async transaction => {
      const membership = await authorize(actor, spaceId, transaction);
      const { ref, item } = await readItem(actor, spaceId, id, transaction, membership);
      pending(item); revisionCheck(item, options);
      if (item.analysis?.status === 'running' && now().getTime() - Date.parse(item.analysis.startedAt) < IMPORT_LIMITS.analysisLeaseMs) fail(409, 'ANALYSIS_RUNNING', 'This import is already being analyzed.');
      const resolved = await original(actor, spaceId, item, transaction);
      const source = resolved ? sourceSnapshot(resolved.document) : item.source;
      const next = { ...item, source, analysis: { status: 'running', jobId, startedAt: timestamp(), leaseUntil: new Date(now().getTime() + IMPORT_LIMITS.analysisLeaseMs).toISOString() }, revision: item.revision + 1, updatedAt: timestamp() };
      transaction.set(ref, next);
      return { item: next, document: resolved?.document };
    });
    let analyzed, analysisError;
    try {
      const result = await extractDocument(actor, spaceId, { ...(started.document ? { document: started.document, documentId: started.document.id } : { sourceText: started.item.source.sourceText }), sourceName: started.item.source.sourceName });
      const proposal = sanitizeImportProposal(result?.proposal);
      const extractedText = result.extractedText === undefined ? undefined : text(result.extractedText, IMPORT_LIMITS.sourceChars);
      if (extractedText && Buffer.byteLength(extractedText, 'utf8') > IMPORT_LIMITS.sourceBytes) throw new Error('extracted-text-too-large');
      const originalText = extractedText || started.item.source.sourceText || '';
      const quotes = Array.isArray(result.evidenceQuotes) ? result.evidenceQuotes.slice(0, 24).flatMap(value => {
        const quote = typeof value === 'string' ? value : value?.quote;
        if (typeof quote !== 'string' || !quote.trim() || quote.length > 600 || !originalText.includes(quote)) return [];
        return [{ quote, ...(typeof value?.field === 'string' ? { field: value.field.slice(0, 100) } : {}) }];
      }) : [];
      analyzed = { proposal, analysis: { status: 'ready', ...(extractedText ? { extractedText } : {}), ...(quotes.length ? { evidenceQuotes: quotes } : {}), finishedAt: timestamp() } };
    } catch (error) {
      const safeMessage = [402, 403, 413, 415, 422, 429, 503].includes(error?.status) && typeof error.message === 'string' && error.message.length <= 300
        && !/https?:\/\/|\/api\/files\/|Bearer\s|token=|-----BEGIN|sk-/i.test(error.message);
      analysisError = safeMessage ? error.message.replace(/[\x00-\x1f\x7f]/g, ' ') : 'Could not analyze this import. Your draft is still pending; retry the analysis or enter a proposal manually.';
    }
    return db.runTransaction(async transaction => {
      const membership = await authorize(actor, spaceId, transaction);
      const { ref, item } = await readItem(actor, spaceId, id, transaction, membership);
      const resolved = await original(actor, spaceId, item, transaction);
      // User edits and dismissals win over a slow model response.
      if (item.status !== 'pending' || item.analysis?.jobId !== jobId) return item;
      if (resolved && sourceSnapshot(resolved.document).documentVersion !== item.source.documentVersion) analysisError = 'The original file changed during analysis. Analyze this import again.';
      const next = { ...item, ...(analysisError ? { analysis: { status: 'failed', error: analysisError, finishedAt: timestamp() } } : analyzed), revision: item.revision + 1, updatedAt: timestamp() };
      transaction.set(ref, next); return next;
    });
  }
  async function apply(actor, spaceId, id, options = {}) {
    allowedKeys(options, ['expectedRevision']); validateRevision(options);
    return db.runTransaction(async transaction => {
      const membership = await authorize(actor, spaceId, transaction);
      if (membership.role !== 'admin') fail(403, 'IMPORT_ADMIN_REQUIRED', 'Only an admin can apply an import to the asset register or vault.');
      const { ref, item } = await readItem(actor, spaceId, id, transaction, membership);
      const resolved = await original(actor, spaceId, item, transaction, item.status !== 'applied');
      if (item.status === 'applied') return item;
      pending(item); revisionCheck(item, options);
      if (item.analysis?.status !== 'ready' || !item.proposal) fail(409, 'PROPOSAL_REQUIRED', 'Analyze or enter a proposal, then review it before applying.');
      const proposal = sanitizeImportProposal(item.proposal);
      const stamp = timestamp();
      let appliedRecordId;
      if (proposal.kind === 'asset') {
        const asset = proposal.asset;
        const assetRef = refs(spaceId).assets.doc(`import-${id}`);
        const existing = await transaction.get(assetRef);
        if (existing.exists) fail(409, 'ASSET_CONFLICT', 'An asset already uses this import identifier.');
        if (asset.serialNumber) {
          const query = refs(spaceId).assets.where('serialNumber', '==', asset.serialNumber);
          const duplicates = await transaction.get(query.limit(10));
          if (!duplicates.empty && duplicates.docs.length) fail(409, 'DUPLICATE_ASSET', 'An existing asset matches this serial/model. Review it before creating another record.', {
            candidates: duplicates.docs.map(row => ({ id: row.id, name: String(row.data().name || '').slice(0, 200), serialNumber: String(row.data().serialNumber || '').slice(0, 200), model: String(row.data().model || '').slice(0, 160) })),
          });
        }
        appliedRecordId = assetRef.id || `import-${id}`;
        transaction.set(assetRef, { ...asset, id: appliedRecordId, status: 'owned', createdAt: stamp.slice(0, 10),
          ...(resolved ? { documentIds: [resolved.document.id] } : {}),
          importSource: { inboxId: id, sourceKind: resolved ? 'vault-original' : 'submitted-text', sourceName: item.source.sourceName,
            submittedBy: item.createdBy, reviewedBy: actor.uid, reviewedAt: stamp,
            ...(resolved ? { documentId: resolved.document.id, contentHash: resolved.document.contentHash || null } : {}), hasOriginalDocument: !!resolved },
        });
      } else {
        if (!resolved) fail(400, 'ORIGINAL_REQUIRED', 'Document metadata can only update an existing vault original. Text alone does not create a receipt or document file.');
        appliedRecordId = resolved.document.id;
        const updated = { ...resolved.document, ...proposal.document, importSource: { inboxId: id, submittedBy: item.createdBy, reviewedBy: actor.uid, reviewedAt: stamp } };
        transaction.set(refs(spaceId).documents, { ...resolved.snapshot.data(), docs: resolved.docs.map(document => document.id === appliedRecordId ? updated : document) });
      }
      const next = { ...item, status: 'applied', appliedRecordId, appliedKind: proposal.kind, reviewedBy: actor.uid, appliedAt: stamp, updatedAt: stamp, revision: item.revision + 1 };
      transaction.set(ref, next); return next;
    });
  }
  async function dismiss(actor, spaceId, id, options = {}) {
    allowedKeys(options, ['expectedRevision']); validateRevision(options);
    return db.runTransaction(async transaction => {
      const membership = await authorize(actor, spaceId, transaction);
      const { ref, item } = await readItem(actor, spaceId, id, transaction, membership);
      await original(actor, spaceId, item, transaction);
      if (item.status === 'dismissed') return item;
      pending(item); revisionCheck(item, options);
      const next = { ...item, status: 'dismissed', dismissedBy: actor.uid, updatedAt: timestamp(), revision: item.revision + 1 };
      transaction.set(ref, next); return next;
    });
  }
  return { list, create, analyze, update, apply, dismiss };
}

export function createImportInboxRouter({ service, authenticateFirebase }) {
  const router = express.Router();
  router.use(express.json({ limit: '160kb', strict: true }));
  router.use((_req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  const run = operation => async (req, res) => {
    try {
      const actor = await authenticateFirebase(req);
      const spaceId = req.query.spaceId;
      if (!validSpace(spaceId) || (req.body?.spaceId !== undefined && req.body.spaceId !== spaceId)) fail(400, 'INVALID_SPACE', 'Choose one matching explicit space.');
      const body = { ...(req.body || {}) }; delete body.spaceId;
      const result = await operation(actor, spaceId, req.params.id, body);
      res.json({ spaceId, ...result });
    } catch (error) {
      const known = error instanceof ImportInboxError;
      if (error?.status === 429 && /^\d{1,4}$/.test(error?.headers?.['Retry-After'] || '')) res.set('Retry-After', error.headers['Retry-After']);
      res.status(known ? error.status : [401, 403, 429].includes(error?.status) ? error.status : 500).json({ error: known ? error.message : error?.status === 401 ? 'Sign in to use the import inbox.' : error?.status === 403 ? 'This account cannot use this import inbox.' : error?.status === 429 ? 'Too many import requests. Try again shortly.' : 'The import operation failed. Please try again.', code: known ? error.code : error?.status === 429 ? 'IMPORT_RATE_LIMIT' : 'IMPORT_UNAVAILABLE', ...(known && error.details ? { details: error.details } : {}) });
    }
  };
  router.get('/', run(async (actor, space) => ({ items: await service.list(actor, space) })));
  router.post('/', run(async (actor, space, _id, body) => ({ item: await service.create(actor, space, body) })));
  router.patch('/:id', run(async (actor, space, id, body) => ({ item: await service.update(actor, space, id, body) })));
  for (const action of ['analyze', 'apply', 'dismiss']) router.post(`/:id/${action}`, run(async (actor, space, id, body) => ({ item: await service[action](actor, space, id, body) })));
  router.use((error, _req, res, _next) => res.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'Send a bounded JSON import request.', code: 'INVALID_IMPORT' }));
  return router;
}
