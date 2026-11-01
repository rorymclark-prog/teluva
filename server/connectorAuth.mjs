import express from 'express';
import { randomBytes as cryptoRandomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createFirestoreConnectorStore, connectorDigest, connectorOwnerKey } from './connectorAuthStore.mjs';
import { clientIp } from './rateLimit.mjs';

export const CONNECTOR_ORIGIN = 'https://teluva-x3k4bua7pq-nw.a.run.app';
export const CONNECTOR_SCOPES = Object.freeze(['documents:read', 'inbox:write']);
export const CONNECTOR_REQUEST_MS = 10 * 60 * 1000;
export const CONNECTOR_CODE_MS = 2 * 60 * 1000;
export const CONNECTOR_ACCESS_MS = 10 * 60 * 1000;
export const CONNECTOR_GRANT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DOCUMENTS = 50;
const MAX_GRANTS = 20;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^tc[ar]_[A-Za-z0-9_-]{43}$/;
const CODE = /^tcc_[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export class ConnectorAuthError extends Error {
  constructor(status, code, message, headers = {}) { super(message); this.status = status; this.code = code; this.headers = headers; }
}
const fail = (status, code, message) => { throw new ConnectorAuthError(status, code, message); };
const scalar = (value, max = 2048) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const isId = value => typeof value === 'string' && ID.test(value);

/** No suffix/domain matching, custom schemes, fragments, credentials, or URLs
 * fetched from client metadata. Each resulting URL is registered exactly. */
export function connectorRedirectAllowed(value) {
  if (!scalar(value)) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password || url.hash || url.search || url.href !== value) return false;
  if (url.protocol === 'https:' && !url.port) {
    if (url.hostname === 'claude.ai' && url.pathname === '/api/mcp/auth_callback') return true;
    if (url.hostname === 'chatgpt.com' && (url.pathname === '/connector_platform_oauth_redirect'
      || /^\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname))) return true;
  }
  return url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    && !!url.port && Number(url.port) > 0 && /^\/[A-Za-z0-9_./~-]{1,200}$/.test(url.pathname)
    && !url.pathname.split('/').some(part => part === '.' || part === '..');
}

function parseScopes(value, defaults = CONNECTOR_SCOPES) {
  if (value === undefined) return [...defaults];
  const values = typeof value === 'string' && scalar(value, 128) ? value.split(' ') : Array.isArray(value) ? value : null;
  if (!values?.length || values.length > 2 || values.some(scope => !CONNECTOR_SCOPES.includes(scope))
    || new Set(values).size !== values.length) fail(400, 'invalid_scope', 'Choose only the supported connector permissions.');
  return [...values];
}

function appOrigin(req, origin) {
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'access_denied', 'Open this action inside Teluva.');
  if (!req.headers.origin) return;
  try {
    const url = new URL(req.headers.origin);
    if (url.origin === origin || (url.protocol === 'https:' && url.host === req.headers.host)) return;
  } catch { /* refuse below */ }
  fail(403, 'access_denied', 'Open this action inside Teluva.');
}

/**
 * Mount router before the app's global API authentication and SPA fallback.
 * resolveMembership({uid,spaceId}) -> current
 * {role,spaceType,spaceName,membershipVersion} | null. Production pins the
 * authoritative role snapshot updateTime as membershipVersion, so removal and
 * rejoining (even between requests) cannot resurrect an earlier consent.
 * canReadDocument({uid,spaceId,documentId}) -> boolean, including file/estate ACL.
 * authenticateConnector(req) returns only a grant's one space and explicit IDs;
 * every MCP operation must still enforce scope, selected ID, and current file ACL.
 */
export function createConnectorAuth({ db, verifyFirebaseToken, resolveMembership, canReadDocument,
  origin = CONNECTOR_ORIGIN, store = createFirestoreConnectorStore(db), now = Date.now, randomBytes = cryptoRandomBytes }) {
  const canonical = new URL(origin);
  if (canonical.protocol !== 'https:' || canonical.origin !== origin || canonical.username || canonical.password) throw new Error('Use a fixed HTTPS connector origin without a path.');
  if (typeof verifyFirebaseToken !== 'function' || typeof resolveMembership !== 'function' || typeof canReadDocument !== 'function') throw new Error('Connector authorization requires identity, membership, and document authority callbacks.');
  const resource = `${origin}/mcp`;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}", scope="${CONNECTOR_SCOPES.join(' ')}"` };
  const unauthorized = () => new ConnectorAuthError(401, 'invalid_token', 'Reconnect this connector in Teluva.', challenge);
  const opaque = () => randomBytes(32).toString('base64url');
  const secret = prefix => `${prefix}_${opaque()}`;
  const router = express.Router();
  const json = express.json({ limit: '16kb', strict: true });
  const form = express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 12 });
  const wrap = callback => (req, res, next) => Promise.resolve(callback(req, res)).catch(next);
  const publicHeaders = (_req, res, next) => { res.set({ ...NO_STORE, 'Access-Control-Allow-Origin': '*' }); next(); };
  const apiHeaders = (req, res, next) => { res.set(NO_STORE); try { appOrigin(req, origin); next(); } catch (error) { next(error); } };

  async function rate(req, area, max, windowMs, uid = '') {
    const instant = now();
    const window = Math.floor(instant / windowMs);
    // One document per area/identity, overwritten for the next window. Do not
    // create a new permanent Firestore document for every minute of traffic.
    const id = connectorDigest(JSON.stringify([area, uid || clientIp(req)]));
    await store.transaction(async tx => {
      const record = await tx.get('limits', id);
      const count = record?.window === window ? record.count : 0;
      if (count >= max) fail(429, 'temporarily_unavailable', 'Too many connector requests. Try again later.');
      tx.set('limits', id, { window, count: count + 1, expiresAt: (window + 1) * windowMs });
    });
  }

  async function requireFirebase(req) {
    const match = /^Bearer ([^\s]{1,8192})$/i.exec(req.headers?.authorization || '');
    if (!match) fail(401, 'login_required', 'Sign in to Teluva first.');
    let user;
    try { user = await verifyFirebaseToken(match[1]); } catch { fail(401, 'login_required', 'Sign in to Teluva again.'); }
    if (!user?.uid || typeof user.uid !== 'string' || user.email_verified === false) fail(401, 'login_required', 'Sign in to Teluva again.');
    await rate(req, 'firebase-api', 240, 60 * 1000, user.uid);
    return { uid: user.uid };
  }

  async function membership(grant, checkVersion = true) {
    const member = await resolveMembership({ uid: grant.uid, spaceId: grant.spaceId });
    if (!member || !['admin', 'member'].includes(member.role)
      || (member.spaceType === 'business' && grant.scopes.includes('documents:read') && member.role !== 'admin')) return null;
    // A missing/unknown type must not turn a business grant into a family one.
    if (!['family', 'business'].includes(member.spaceType)) return null;
    if (member.membershipVersion !== undefined && !scalar(member.membershipVersion, 128)) return null;
    if (checkVersion && (grant.membershipVersion || '') !== (member.membershipVersion || '')) return null;
    return member;
  }

  async function revokeObservedMembership(grantId) {
    await store.transaction(async tx => {
      const current = await tx.get('grants', grantId);
      if (current && !current.revokedAt) tx.set('grants', grantId, { ...current, revokedAt: now(), revokeReason: 'membership_changed' });
    });
  }

  async function authenticateConnector(req) {
    const match = /^Bearer (tca_[A-Za-z0-9_-]{43})$/i.exec(req.headers?.authorization || '');
    if (!match) throw unauthorized();
    const token = await store.get('tokens', connectorDigest(match[1]));
    if (!token || token.kind !== 'access' || token.expiresAt <= now() || token.resource !== resource) throw unauthorized();
    const grant = await store.get('grants', token.grantId);
    if (!grant || grant.revokedAt || grant.expiresAt <= now() || grant.resource !== resource) throw unauthorized();
    const member = await membership(grant);
    if (!member) { await revokeObservedMembership(token.grantId); throw unauthorized(); }
    await rate(req, 'connector-access', 120, 60 * 1000, token.grantId);
    return { uid: grant.uid, spaceId: grant.spaceId, grantId: token.grantId, scopes: [...grant.scopes], documentIds: [...grant.documentIds],
      spaceType: member.spaceType, spaceName: typeof member.spaceName === 'string' ? member.spaceName : '' };
  }

  const protectedMetadata = { resource, authorization_servers: [origin], scopes_supported: [...CONNECTOR_SCOPES], bearer_methods_supported: ['header'], resource_name: 'Teluva selected documents and review inbox' };
  const serverMetadata = { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [...CONNECTOR_SCOPES],
    authorization_response_iss_parameter_supported: true };
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], publicHeaders, (_req, res) => res.json(protectedMetadata));
  router.get('/.well-known/oauth-authorization-server', publicHeaders, (_req, res) => res.json(serverMetadata));
  router.options(['/oauth/register', '/oauth/token', '/oauth/revoke'], publicHeaders, (_req, res) => res.set({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }).sendStatus(204));

  router.post('/oauth/register', publicHeaders, json, wrap(async (req, res) => {
    await rate(req, 'register', 20, 60 * 60 * 1000);
    await rate(req, 'register-global', 1000, 24 * 60 * 60 * 1000, 'global');
    const body = req.body;
    if (!body || !Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 5
      || body.redirect_uris.some(uri => !connectorRedirectAllowed(uri)) || new Set(body.redirect_uris).size !== body.redirect_uris.length) {
      fail(400, 'invalid_redirect_uri', 'Register exact ChatGPT, Claude, or loopback callback URLs.');
    }
    if ((body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none')
      || (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || !body.grant_types.includes('authorization_code') || body.grant_types.length > 2
        || new Set(body.grant_types).size !== body.grant_types.length || body.grant_types.some(type => !['authorization_code', 'refresh_token'].includes(type))))
      || (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== 'code'))) {
      fail(400, 'invalid_client_metadata', 'Only public authorization-code clients with PKCE are supported.');
    }
    const scopes = parseScopes(body.scope);
    const clientName = body.client_name === undefined ? 'AI connector' : body.client_name;
    if (!scalar(clientName, 80) || !clientName.trim()) fail(400, 'invalid_client_metadata', 'Choose a short client name.');
    const clientId = opaque();
    const client = { clientName: clientName.trim(), redirectUris: [...body.redirect_uris], scopes, createdAt: now() };
    await store.transaction(async tx => tx.set('clients', clientId, client));
    res.status(201).json({ client_id: clientId, client_id_issued_at: Math.floor(client.createdAt / 1000), client_name: client.clientName,
      redirect_uris: client.redirectUris, scope: scopes.join(' '), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  }));

  function callbackUrl(request, parameters) {
    const url = new URL(request.redirectUri);
    for (const [key, value] of Object.entries({ ...parameters, state: request.state, iss: origin })) if (value !== undefined) url.searchParams.set(key, value);
    return url.href;
  }

  router.get('/oauth/authorize', publicHeaders, wrap(async (req, res) => {
    await rate(req, 'authorize', 60, 60 * 60 * 1000);
    const q = req.query;
    if (!scalar(q.client_id, 128) || !OPAQUE.test(q.client_id)) fail(400, 'invalid_client', 'Register this connector first.');
    const client = await store.get('clients', q.client_id);
    if (!client || !scalar(q.redirect_uri) || !client.redirectUris.includes(q.redirect_uri) || !connectorRedirectAllowed(q.redirect_uri)) fail(400, 'invalid_redirect_uri', 'The callback does not match this registered connector.');
    const request = { clientId: q.client_id, clientName: client.clientName, redirectUri: q.redirect_uri,
      ...(q.state === undefined ? {} : scalar(q.state, 1024) ? { state: q.state } : {}) };
    try {
      if (Object.values(q).some(value => typeof value !== 'string')) fail(400, 'invalid_request', 'OAuth parameters must appear exactly once.');
      if (q.state !== undefined && !scalar(q.state, 1024)) fail(400, 'invalid_request', 'Choose a valid OAuth state.');
      if (q.response_type !== 'code') fail(400, 'unsupported_response_type', 'Use the authorization-code flow.');
      if (q.resource !== resource) fail(400, 'invalid_target', 'Choose the Teluva MCP resource.');
      if (q.code_challenge_method !== 'S256' || !scalar(q.code_challenge, 43) || !OPAQUE.test(q.code_challenge)) fail(400, 'invalid_request', 'PKCE S256 is required.');
      const scopes = parseScopes(q.scope, client.scopes);
      if (scopes.some(scope => !client.scopes.includes(scope))) fail(400, 'invalid_scope', 'Choose this connector’s registered permissions.');
      const id = opaque();
      await store.transaction(async tx => tx.set('requests', id, { ...request, scopes, challenge: q.code_challenge, resource,
        createdAt: now(), expiresAt: now() + CONNECTOR_REQUEST_MS, status: 'pending' }));
      res.redirect(302, `${origin}/?connector_authorize=${id}`);
    } catch (error) {
      if (!(error instanceof ConnectorAuthError)) throw error;
      res.redirect(302, callbackUrl(request, { error: error.code, error_description: error.message }));
    }
  }));

  async function authorizationRequest(id) {
    if (!OPAQUE.test(id || '')) fail(404, 'invalid_request', 'This connector request is unavailable. Start again from your AI app.');
    const request = await store.get('requests', id);
    if (!request || request.status !== 'pending' || request.expiresAt <= now()) fail(410, 'invalid_request', 'This connector request expired or was already completed. Start again from your AI app.');
    return request;
  }

  router.get('/api/connectors/authorization/:id', apiHeaders, wrap(async (req, res) => {
    const user = await requireFirebase(req);
    await rate(req, 'consent-view', 120, 60 * 1000, user.uid);
    const request = await authorizationRequest(req.params.id);
    res.json({ id: req.params.id, clientName: request.clientName, redirectHost: new URL(request.redirectUri).host, scopes: request.scopes, expiresAt: request.expiresAt });
  }));

  router.post('/api/connectors/authorization/:id', apiHeaders, json, wrap(async (req, res) => {
    const user = await requireFirebase(req);
    await rate(req, 'consent', 30, 60 * 1000, user.uid);
    const request = await authorizationRequest(req.params.id);
    if (req.body?.approve === false || req.body?.decision === 'deny') {
      await store.transaction(async tx => {
        const current = await tx.get('requests', req.params.id);
        if (!current || current.status !== 'pending' || current.expiresAt <= now()) fail(410, 'invalid_request', 'This connector request is no longer available.');
        tx.set('requests', req.params.id, { ...current, status: 'denied', completedAt: now() });
      });
      return res.json({ redirectUrl: callbackUrl(request, { error: 'access_denied', error_description: 'The connection was declined.' }) });
    }
    if (!isId(req.body?.spaceId)) fail(400, 'invalid_request', 'Choose one valid Teluva space.');
    const scopes = parseScopes(req.body?.scopes, []);
    if (!scopes.length || scopes.some(scope => !request.scopes.includes(scope))) fail(400, 'invalid_scope', 'Approve only the requested connector permissions.');
    const documentIds = req.body.documentIds;
    if (!Array.isArray(documentIds) || documentIds.length > MAX_DOCUMENTS || documentIds.some(id => !isId(id))
      || new Set(documentIds).size !== documentIds.length || (scopes.includes('documents:read') ? !documentIds.length : documentIds.length)) {
      fail(400, 'invalid_request', 'Select up to 50 saved documents only when granting document access.');
    }
    const grant = { uid: user.uid, spaceId: req.body.spaceId, clientId: request.clientId, clientName: request.clientName,
      scopes, documentIds: [...documentIds], resource, createdAt: now(), expiresAt: now() + CONNECTOR_GRANT_MS, revokedAt: null };
    const member = await membership(grant, false);
    if (!member) fail(403, 'access_denied', 'An adult space member must approve this connection. Business document access requires an administrator.');
    grant.membershipVersion = member.membershipVersion || '';
    for (const documentId of documentIds) if (!(await canReadDocument({ uid: user.uid, spaceId: grant.spaceId, documentId }))) fail(403, 'access_denied', 'One of the selected documents is not available to share.');
    const grantId = opaque();
    const code = secret('tcc');
    await store.transaction(async tx => {
      const current = await tx.get('requests', req.params.id);
      if (!current || current.status !== 'pending' || current.expiresAt <= now()) fail(410, 'invalid_request', 'This connector request is no longer available.');
      const ownerKey = connectorOwnerKey(user.uid, grant.spaceId);
      const owner = await tx.get('owners', ownerKey);
      const activeIds = [];
      for (const id of owner?.grantIds || []) {
        const existing = await tx.get('grants', id);
        if (existing && !existing.revokedAt && existing.expiresAt > now()) activeIds.push(id);
      }
      if (activeIds.length >= MAX_GRANTS) fail(400, 'access_denied', 'Disconnect an existing connector in this space before adding another.');
      tx.set('requests', req.params.id, { ...current, status: 'approved', completedAt: now() });
      tx.set('grants', grantId, grant);
      tx.set('owners', ownerKey, { uid: user.uid, spaceId: grant.spaceId, grantIds: [...activeIds, grantId] });
      tx.set('codes', connectorDigest(code), { grantId, clientId: request.clientId, redirectUri: request.redirectUri,
        challenge: request.challenge, resource, expiresAt: now() + CONNECTOR_CODE_MS, usedAt: null });
    });
    res.json({ redirectUrl: callbackUrl(request, { code }) });
  }));

  const makeTokens = () => ({ access: secret('tca'), refresh: secret('tcr') });
  function writeTokens(tx, pair, grantId, grant, instant) {
    tx.set('tokens', connectorDigest(pair.access), { kind: 'access', grantId, resource, expiresAt: Math.min(instant + CONNECTOR_ACCESS_MS, grant.expiresAt) });
    tx.set('tokens', connectorDigest(pair.refresh), { kind: 'refresh', grantId, resource, expiresAt: grant.expiresAt, usedAt: null });
  }
  function tokenResponse(res, pair, grant) {
    res.json({ access_token: pair.access, token_type: 'Bearer', expires_in: Math.max(0, Math.floor(Math.min(CONNECTOR_ACCESS_MS, grant.expiresAt - now()) / 1000)),
      refresh_token: pair.refresh, scope: grant.scopes.join(' ') });
  }

  router.post('/oauth/token', publicHeaders, form, json, wrap(async (req, res) => {
    await rate(req, 'token', 120, 60 * 1000);
    const b = req.body;
    if (b && Object.values(b).some(value => typeof value !== 'string')) fail(400, 'invalid_request', 'OAuth token parameters must appear exactly once.');
    if (!b || !scalar(b.client_id, 128) || !OPAQUE.test(b.client_id) || b.client_secret !== undefined || req.headers.authorization) fail(400, 'invalid_client', 'Use a registered public client.');
    if (b.resource !== resource) fail(400, 'invalid_target', 'Choose the Teluva MCP resource.');
    const client = await store.get('clients', b.client_id);
    if (!client) fail(400, 'invalid_client', 'Register this connector first.');
    if (b.grant_type !== 'authorization_code' && b.grant_type !== 'refresh_token') fail(400, 'unsupported_grant_type', 'Use a code or rotating refresh token.');
    const raw = b.grant_type === 'authorization_code' ? b.code : b.refresh_token;
    if (!scalar(raw, 64) || !(b.grant_type === 'authorization_code' ? CODE : TOKEN).test(raw)) fail(400, 'invalid_grant', 'This authorization is no longer valid.');
    if (b.grant_type === 'authorization_code' && (!scalar(b.redirect_uri) || !client.redirectUris.includes(b.redirect_uri)
      || !scalar(b.code_verifier, 128) || !VERIFIER.test(b.code_verifier))) fail(400, 'invalid_grant', 'The callback and PKCE verifier must match the authorization request.');
    const collection = b.grant_type === 'authorization_code' ? 'codes' : 'tokens';
    const digest = connectorDigest(raw);
    const prior = await store.get(collection, digest);
    const priorGrant = prior ? await store.get('grants', prior.grantId) : null;
    if (!priorGrant || priorGrant.clientId !== b.client_id) fail(400, 'invalid_grant', 'This connection is no longer authorized.');
    if (!(await membership(priorGrant))) {
      await revokeObservedMembership(prior.grantId);
      fail(400, 'invalid_grant', 'This connection is no longer authorized.');
    }
    if (b.scope !== undefined && parseScopes(b.scope).sort().join(' ') !== [...priorGrant.scopes].sort().join(' ')) fail(400, 'invalid_scope', 'Reauthorize to change connector permissions.');
    const pair = makeTokens();
    const outcome = await store.transaction(async tx => {
      const record = await tx.get(collection, digest);
      const grant = record ? await tx.get('grants', record.grantId) : null;
      if (!record || !grant || grant.clientId !== b.client_id || grant.revokedAt || grant.expiresAt <= now()
        || record.expiresAt <= now() || record.resource !== resource || grant.resource !== resource) return { error: 'invalid_grant' };
      if (b.grant_type === 'authorization_code') {
        const calculated = createHash('sha256').update(b.code_verifier).digest('base64url');
        if (record.usedAt || record.clientId !== b.client_id || record.redirectUri !== b.redirect_uri
          || !timingSafeEqual(Buffer.from(record.challenge), Buffer.from(calculated))) return { error: 'invalid_grant' };
      } else {
        if (record.kind !== 'refresh') return { error: 'invalid_grant' };
        if (record.usedAt) {
          // Commit revocation before returning the error; throwing inside the
          // transaction would roll this security write back.
          tx.set('grants', record.grantId, { ...grant, revokedAt: now(), revokeReason: 'refresh_reuse' });
          return { error: 'invalid_grant' };
        }
      }
      const instant = now();
      tx.set(collection, digest, { ...record, usedAt: instant });
      writeTokens(tx, pair, record.grantId, grant, instant);
      return { grant };
    });
    if (outcome.error) fail(400, 'invalid_grant', 'This authorization expired, was used, or was revoked. Reconnect from your AI app.');
    tokenResponse(res, pair, outcome.grant);
  }));

  router.get('/api/connectors', apiHeaders, wrap(async (req, res) => {
    const user = await requireFirebase(req);
    await rate(req, 'manage', 120, 60 * 1000, user.uid);
    if (!isId(req.query.spaceId)) fail(400, 'invalid_request', 'Choose one valid Teluva space.');
    const member = await resolveMembership({ uid: user.uid, spaceId: req.query.spaceId });
    if (!member || !['admin', 'member'].includes(member.role)) fail(403, 'access_denied', 'You no longer have access to this space.');
    const owner = await store.get('owners', connectorOwnerKey(user.uid, req.query.spaceId));
    const connectors = [];
    for (const id of owner?.grantIds || []) {
      const grant = await store.get('grants', id);
      if (grant && grant.uid === user.uid && grant.spaceId === req.query.spaceId && !grant.revokedAt && grant.expiresAt > now()) {
        connectors.push({ id, clientName: grant.clientName, spaceId: grant.spaceId, scopes: grant.scopes, documentIds: grant.documentIds, createdAt: grant.createdAt, expiresAt: grant.expiresAt });
      }
    }
    res.json({ spaceId: req.query.spaceId, connectors });
  }));

  router.delete('/api/connectors/:id', apiHeaders, wrap(async (req, res) => {
    const user = await requireFirebase(req);
    await rate(req, 'manage', 120, 60 * 1000, user.uid);
    if (!OPAQUE.test(req.params.id)) fail(404, 'invalid_request', 'This connection is unavailable.');
    await store.transaction(async tx => {
      const grant = await tx.get('grants', req.params.id);
      if (!grant || grant.uid !== user.uid) fail(404, 'invalid_request', 'This connection is unavailable.');
      // An owner may revoke even after losing membership in its old space.
      tx.set('grants', req.params.id, { ...grant, revokedAt: grant.revokedAt || now(), revokeReason: 'owner' });
    });
    res.json({ ok: true });
  }));

  router.post('/oauth/revoke', publicHeaders, form, json, wrap(async (req, res) => {
    await rate(req, 'revoke', 60, 60 * 1000);
    const b = req.body;
    if (!scalar(b?.client_id, 128) || !OPAQUE.test(b.client_id) || req.headers.authorization || b.client_secret !== undefined) fail(400, 'invalid_client', 'Use a registered public client.');
    if (!scalar(b.token, 64) || !TOKEN.test(b.token)) return res.sendStatus(200);
    await store.transaction(async tx => {
      const token = await tx.get('tokens', connectorDigest(b.token));
      const grant = token ? await tx.get('grants', token.grantId) : null;
      if (grant?.clientId === b.client_id) tx.set('grants', token.grantId, { ...grant, revokedAt: grant.revokedAt || now(), revokeReason: 'client' });
    });
    res.sendStatus(200);
  }));

  router.use((error, _req, res, _next) => {
    const known = error instanceof ConnectorAuthError;
    const malformed = error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large';
    const status = known ? error.status : malformed ? (error.status || 400) : 500;
    res.set(NO_STORE).set(known ? error.headers : {}).status(status).json({ error: known ? error.code : malformed ? 'invalid_request' : 'server_error',
      error_description: known ? error.message : malformed ? 'Choose a valid connector request.' : 'The connector is temporarily unavailable.' });
  });
  return { router, authenticateConnector, requireFirebase, resource, metadataUrl };
}
