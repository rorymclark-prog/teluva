import express from 'express';
import { ImportInboxError, IMPORT_LIMITS, IMPORT_PROPOSAL_SCHEMA } from './importInbox.mjs';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const MAX_TEXT = 60_000;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const scopeOk = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const byteSize = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const has = (grant, scope) => new Set(grant.scopes || []).has(scope);
const documents = grant => new Set(grant.documentIds || []);
class ToolError extends Error { constructor(code, message) { super(message); this.code = code; } }
const bad = message => { throw new ToolError('INVALID_ARGUMENT', message); };
function keys(args, allowed) {
  if (!plain(args) || Object.keys(args).some(key => !allowed.includes(key))) bad('Use only the supported tool arguments. The connection fixes its space; another space cannot be requested.');
}
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS = [
  { name: 'search', title: 'Search selected Teluva documents', description: 'Search only the vault documents selected when this connection was authorized. Returns document IDs, titles and Teluva links. It cannot search other people, spaces or the web.',
    inputSchema: objectSchema({ query: { type: 'string', minLength: 1, maxLength: 300 } }, ['query']), annotations: readOnly },
  { name: 'fetch', title: 'Read a selected Teluva document', description: 'Fetch prepared text from one explicitly selected document. A fresh PDF may not have text yet; submit_import can prepare a review draft. This never returns binary files or download credentials.',
    inputSchema: objectSchema({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']), annotations: readOnly },
  { name: 'get_connection', title: 'Inspect this Teluva connection', description: 'Show this connection’s selected space, permitted tools and selected-document count. It does not list other spaces or private profile records.',
    inputSchema: objectSchema({}), annotations: readOnly },
  { name: 'submit_import', title: 'Submit a Teluva import for review', description: 'Create a persistent pending-review draft from selected original evidence or explicitly named extracted text. Optional analysis uses Teluva’s existing extractor. An admin must review and apply it inside Teluva; this tool cannot apply, overwrite or delete assets or documents. Text alone is not an original receipt.',
    inputSchema: objectSchema({ documentId: { type: 'string', minLength: 1, maxLength: 200 }, sourceText: { type: 'string', minLength: 1, maxLength: IMPORT_LIMITS.sourceChars }, sourceName: { type: 'string', minLength: 1, maxLength: 200 },
      proposal: { ...IMPORT_PROPOSAL_SCHEMA, description: 'An asset or document proposal using the fixed Teluva import fields. Values remain drafts until reviewed.' },
      requestId: { type: 'string', minLength: 1, maxLength: 128, description: 'Stable ID for this submission; retry the same payload with the same ID.' }, analyze: { type: 'boolean', default: true, description: 'Analyze the selected original when no proposal was supplied. Both document read and inbox write consent are required.' } }, ['requestId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const content = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false });
function safeText(value, limit = MAX_TEXT) {
  return typeof value === 'string' ? value.slice(0, limit).replace(/(?:https?:\/\/firebasestorage\.googleapis\.com\/[^\s<>"']+|\/api\/files\/(?:content|connected)\?[^\s<>"']+)/gi, '[private file link omitted]') : '';
}
function linkFor(origin, spaceId, id, candidate) {
  if (typeof candidate === 'string') {
    try { const url = new URL(candidate, origin); if (url.origin === origin && !url.username && !url.password && !url.pathname.startsWith('/api/')
      && ![...url.searchParams.keys()].some(key => /^(token|access_token|authkey|code|sig|signature|x-goog-signature|x-amz-signature)$/i.test(key))) return url.toString(); } catch { /* use a stable app link */ }
  }
  return `${origin}/?spaceId=${encodeURIComponent(spaceId)}&documentId=${encodeURIComponent(id)}`;
}

/** Stateless Streamable HTTP: JSON replies, 202 for accepted notifications,
 * no unsolicited SSE stream and no remote tool that applies canonical data. */
export function createConnectorMcpRouter({ authenticateConnector, inbox, searchDocuments, fetchDocument, origin, allowedOrigins = [] }) {
  if (typeof authenticateConnector !== 'function' || !inbox || typeof searchDocuments !== 'function' || typeof fetchDocument !== 'function') throw new TypeError('Connector MCP dependencies are required.');
  const canonical = new URL(origin).origin;
  if (!/^https:\/\//.test(canonical) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(canonical)) throw new TypeError('Use a canonical HTTPS connector origin.');
  const acceptedOrigins = new Set([canonical, ...allowedOrigins]);
  const resourceMetadata = `${canonical}/.well-known/oauth-protected-resource/mcp`;
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.headers.origin && !acceptedOrigins.has(req.headers.origin)) return res.status(403).json(rpcError(null, -32003, 'This origin is not allowed to use this connector.'));
    next();
  });
  router.get('/', (_req, res) => res.set('Allow', 'POST').status(405).end());
  router.post('/', express.json({ limit: '160kb', strict: true }), async (req, res) => {
    let grant;
    try {
      grant = await authenticateConnector(req);
      if (!grant?.uid || !scopeOk(grant.spaceId) || !Array.isArray(grant.scopes) || !Array.isArray(grant.documentIds)) throw new Error('invalid-grant');
    } catch (error) {
      if (error?.status === 429) {
        if (/^\d{1,4}$/.test(error?.headers?.['Retry-After'] || '')) res.set('Retry-After', error.headers['Retry-After']);
        return res.status(429).json(rpcError(null, -32029, 'Too many connector requests. Try again shortly.'));
      }
      const challenge = error?.headers?.['WWW-Authenticate'] || `Bearer resource_metadata="${resourceMetadata}"`;
      return res.set('WWW-Authenticate', challenge).status(error?.status === 403 ? 403 : 401).json(rpcError(null, -32001, 'Authorize this Teluva connection before calling tools.'));
    }
    if (!req.is('application/json')) return res.status(415).json(rpcError(null, -32600, 'Send a JSON-RPC request as application/json.'));
    if (req.headers.accept && !/application\/json|\*\/\*/i.test(req.headers.accept)) return res.status(406).json(rpcError(null, -32600, 'This connector returns application/json.'));
    if (req.headers['mcp-protocol-version'] && ![MCP_PROTOCOL_VERSION, '2025-03-26', '2025-11-25'].includes(req.headers['mcp-protocol-version'])) return res.status(400).json(rpcError(null, -32600, 'Unsupported MCP protocol version.'));
    const message = req.body;
    if (!plain(message) || byteSize(message) > IMPORT_LIMITS.inputBytes || message.jsonrpc !== '2.0') return res.status(400).json(rpcError(null, -32600, 'Send one bounded JSON-RPC 2.0 message.'));
    const id = message.id;
    if (id !== undefined && !(typeof id === 'string' && id.length <= 200) && !(Number.isSafeInteger(id))) return res.status(400).json(rpcError(null, -32600, 'Use a bounded request ID.'));
    if (message.method === undefined && id !== undefined && (message.result !== undefined || message.error !== undefined)) return res.status(202).end();
    if (typeof message.method !== 'string') return res.status(400).json(rpcError(id ?? null, -32600, 'A JSON-RPC method is required.'));
    if (id === undefined) {
      if (['notifications/initialized', 'notifications/cancelled'].includes(message.method)) return res.status(202).end();
      return res.status(400).json(rpcError(null, -32600, 'Tool operations require a request ID.'));
    }
    const reply = value => res.json({ jsonrpc: '2.0', id, result: value });
    if (message.method === 'initialize') return reply({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'teluva-connector', version: '1.0.0' }, instructions: 'Read selected documents only. Import submissions are pending drafts. An admin reviews and applies them in Teluva.' });
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') return reply({ tools: TOOLS.filter(tool => !['search', 'fetch'].includes(tool.name) || has(grant, 'documents:read')).filter(tool => tool.name !== 'submit_import' || has(grant, 'inbox:write')) });
    if (message.method !== 'tools/call') return res.json(rpcError(id, -32601, 'Method not found.'));
    const params = message.params;
    if (!plain(params) || typeof params.name !== 'string' || !TOOLS.some(tool => tool.name === params.name)) return res.json(rpcError(id, -32602, 'Choose an available tool.'));
    if (Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key))) return res.json(rpcError(id, -32602, 'Tool parameters cannot override the connection space.'));
    const args = params.arguments === undefined ? {} : params.arguments;
    const selected = documents(grant);
    const actor = { uid: grant.uid, spaceId: grant.spaceId, documentIds: [...selected], scopes: [...grant.scopes], ...(grant.grantId ? { grantId: grant.grantId } : {}) };
    const requireScope = scope => { if (!has(grant, scope)) throw new ToolError('INSUFFICIENT_SCOPE', `This connection does not permit ${scope}. Reconnect with that permission.`); };
    const selectedDocument = id => { if (!idOk(id) || !selected.has(id)) throw new ToolError('DOCUMENT_NOT_SELECTED', 'That document was not selected for this connection. Reconnect to change the selected evidence.'); };
    try {
      if (params.name === 'get_connection') {
        keys(args, []);
        return reply(content({ spaceId: grant.spaceId, scopes: [...new Set(grant.scopes)].filter(scope => ['documents:read', 'inbox:write'].includes(scope)), selectedDocumentCount: selected.size, pendingReviewOnly: true }));
      }
      if (params.name === 'search') {
        keys(args, ['query']); requireScope('documents:read');
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) bad('Enter a search query of at most 300 characters.');
        if (!selected.size) return reply(content({ results: [] }));
        const found = await searchDocuments(actor, grant.spaceId, { query: args.query.trim(), documentIds: [...selected], limit: 20 });
        const rows = Array.isArray(found) ? found : found?.results;
        const results = (Array.isArray(rows) ? rows : []).filter(row => row && selected.has(row.id)).slice(0, 20).map(row => ({ id: row.id, title: safeText(row.title || row.name || 'Selected document', 200), url: linkFor(canonical, grant.spaceId, row.id, row.url) }));
        return reply(content({ results }));
      }
      if (params.name === 'fetch') {
        keys(args, ['id', 'documentId']); requireScope('documents:read');
        if (args.id !== undefined && args.documentId !== undefined && args.id !== args.documentId) bad('Choose one selected document.');
        const documentId = args.id ?? args.documentId;
        selectedDocument(documentId);
        const found = await fetchDocument(actor, grant.spaceId, documentId);
        if (!found || found.id !== documentId) throw new ToolError('DOCUMENT_UNAVAILABLE', 'The selected document is unavailable.');
        const metadata = { textPrepared: typeof found.metadata?.textPrepared === 'boolean' ? found.metadata.textPrepared : !!found.text };
        for (const [key, limit] of [['textOrigin', 100], ['category', 80], ['fileType', 120]]) if (typeof found.metadata?.[key] === 'string') metadata[key] = safeText(found.metadata[key], limit);
        if (typeof found.metadata?.originalAvailableInTeluva === 'boolean') metadata.originalAvailableInTeluva = found.metadata.originalAvailableInTeluva;
        if (!metadata.textPrepared) metadata.note = 'Text is not prepared for this document. Use submit_import with this selected document ID to prepare a review draft; original bytes are not returned here.';
        else if (/\bai\b|transcript|ocr|generated|model/i.test(metadata.textOrigin || '')) metadata.note = 'This prepared transcription may be incomplete. Verify the original document in Teluva.';
        return reply(content({ id: documentId, title: safeText(found.title || found.name || 'Selected document', 200), text: safeText(found.text), url: linkFor(canonical, grant.spaceId, documentId, found.url),
          metadata }));
      }
      keys(args, ['documentId', 'sourceText', 'sourceName', 'proposal', 'requestId', 'analyze']); requireScope('inbox:write');
      if (args.analyze !== undefined && typeof args.analyze !== 'boolean') bad('The analyze option must be true or false.');
      if (args.documentId !== undefined) { requireScope('documents:read'); selectedDocument(args.documentId); }
      const { analyze, ...submission } = args;
      let item = await inbox.create(actor, grant.spaceId, submission);
      const shouldAnalyze = analyze ?? (!!args.documentId && !args.proposal);
      if (shouldAnalyze && item.status === 'pending' && (!item.proposal || item.analysis?.status === 'failed')) item = await inbox.analyze(actor, grant.spaceId, item.id, { expectedRevision: item.revision });
      return reply(content({ spaceId: grant.spaceId, item, pendingReviewOnly: true, message: item.status === 'pending' ? 'Submitted for review in Teluva. No asset or vault metadata was applied.' : 'This idempotent submission was already reviewed in Teluva. No additional canonical write was made.' }));
    } catch (error) {
      if (error?.code === 'INSUFFICIENT_SCOPE') res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}", error="insufficient_scope"`);
      const known = error instanceof ToolError || error instanceof ImportInboxError;
      return reply({ content: [{ type: 'text', text: JSON.stringify({ error: { code: known ? error.code : 'TOOL_UNAVAILABLE', message: known ? error.message : 'The tool could not complete this request. Retry in Teluva.' } }) }], isError: true });
    }
  });
  router.all('/', (_req, res) => res.set('Allow', 'POST').status(405).end());
  router.use((error, _req, res, _next) => res.status(error?.type === 'entity.too.large' ? 413 : 400).json(rpcError(null, -32700, 'Send one bounded JSON-RPC JSON message.')));
  return router;
}
