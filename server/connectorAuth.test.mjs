import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import { createConnectorAuth, connectorRedirectAllowed, CONNECTOR_ORIGIN, CONNECTOR_ACCESS_MS, CONNECTOR_CODE_MS, CONNECTOR_REQUEST_MS, CONNECTOR_GRANT_MS } from './connectorAuth.mjs';
import { createMemoryConnectorStore, createFirestoreConnectorStore, CONNECTOR_COLLECTIONS } from './connectorAuthStore.mjs';

const callback = 'https://claude.ai/api/mcp/auth_callback';
const resource = `${CONNECTOR_ORIGIN}/mcp`;
const verifier = 'synthetic-PKCE-verifier-'.repeat(3);
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function fixture(t, options = {}) {
  const store = options.store || createMemoryConnectorStore();
  let time = 1_800_000_000_000;
  const roles = new Map([
    ['owner:home', { role: 'admin', spaceType: 'family' }],
    ['owner:work', { role: 'admin', spaceType: 'business' }],
    ['staff:work', { role: 'member', spaceType: 'business' }],
    ['adult:home', { role: 'member', spaceType: 'family' }],
    ['child:home', { role: 'child', spaceType: 'family' }],
  ]);
  const documentChecks = [];
  const module = createConnectorAuth({ store, now: () => time,
    verifyFirebaseToken: async token => {
      if (!token.startsWith('firebase-')) throw new Error('invalid');
      return { uid: token.slice(9), email_verified: token !== 'firebase-unverified' };
    },
    resolveMembership: async ({ uid, spaceId }) => roles.get(`${uid}:${spaceId}`) || null,
    canReadDocument: async input => { documentChecks.push(input); return input.documentId === `doc-${input.spaceId}`; },
  });
  const app = express();
  app.use(module.router);
  app.get('/mcp', async (req, res) => {
    try { res.json(await module.authenticateConnector(req)); }
    catch (error) { res.set(error.headers || {}).status(error.status || 500).json({ error: error.code || 'error' }); }
  });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, user, headers = {}, form = false } = {}) {
    const response = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: {
      ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
      ...(user ? { Authorization: `Bearer firebase-${user}` } : {}), ...headers,
    }, body: body === undefined ? undefined : form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, headers: response.headers, data };
  }
  async function register(extra = {}, headers = {}) {
    const response = await request('/oauth/register', { method: 'POST', headers, body: { client_name: 'Synthetic AI client', redirect_uris: [callback], token_endpoint_auth_method: 'none', ...extra } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.client_id;
  }
  async function authorize(clientId, extra = {}) {
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', resource,
      scope: 'documents:read inbox:write', code_challenge: challenge, code_challenge_method: 'S256', state: 'synthetic-state', ...extra });
    const response = await request(`/oauth/authorize?${query}`);
    return { ...response, id: new URL(response.headers.get('location') || CONNECTOR_ORIGIN).searchParams.get('connector_authorize') };
  }
  async function approve(id, extra = {}, user = 'owner') {
    return request(`/api/connectors/authorization/${id}`, { method: 'POST', user, body: { approve: true, spaceId: 'home', scopes: ['documents:read', 'inbox:write'], documentIds: ['doc-home'], ...extra } });
  }
  async function code(extra = {}, user = 'owner') {
    const clientId = await register();
    const auth = await authorize(clientId);
    assert.equal(auth.status, 302);
    const approved = await approve(auth.id, extra, user);
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    return { clientId, id: auth.id, code: new URL(approved.data.redirectUrl).searchParams.get('code'), redirectUrl: approved.data.redirectUrl };
  }
  async function exchange(input, extra = {}) {
    return request('/oauth/token', { method: 'POST', form: true, body: { grant_type: 'authorization_code', client_id: input.clientId,
      redirect_uri: callback, code: input.code, code_verifier: verifier, resource, ...extra } });
  }
  async function refresh(input, token, extra = {}) {
    return request('/oauth/token', { method: 'POST', form: true, body: { grant_type: 'refresh_token', client_id: input.clientId, refresh_token: token, resource, ...extra } });
  }
  const access = token => request('/mcp', { headers: { Authorization: `Bearer ${token}` } });
  return { request, register, authorize, approve, code, exchange, refresh, access, store, roles, documentChecks, requireFirebase: module.requireFirebase,
    advance(ms) { time += ms; }, time: () => time };
}

test('callback policy accepts exact documented destinations and explicit loopback only', () => {
  for (const url of [callback, 'https://chatgpt.com/connector_platform_oauth_redirect', 'https://chatgpt.com/connector/oauth/abc_DEF-123',
    'http://127.0.0.1:6274/oauth/callback', 'http://[::1]:3000/callback', 'http://localhost:3000/callback']) assert.equal(connectorRedirectAllowed(url), true, url);
  for (const url of ['https://claude.ai.evil.example/api/mcp/auth_callback', 'https://evil.example/callback', 'https://claude.ai/api/mcp/auth_callback/',
    `${callback}?next=https://evil.example`, `${callback}#fragment`, 'https://user@claude.ai/api/mcp/auth_callback',
    'https://claude.ai:444/api/mcp/auth_callback', 'http://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector/oauth/a/b',
    'https://chat.openai.com/connector_platform_oauth_redirect', 'http://127.0.0.2:3000/callback', 'http://localhost/callback',
    'http://localhost:3000/a/../callback', 'http://localhost:3000/%2e%2e/callback', 'file:///callback']) assert.equal(connectorRedirectAllowed(url), false, url);
});

test('discovery advertises canonical audience, S256, public clients and issuer callbacks', async t => {
  const f = await fixture(t);
  const metadata = await f.request('/.well-known/oauth-protected-resource/mcp', { headers: { Host: 'untrusted.example' } });
  assert.equal(metadata.status, 200);
  assert.equal(metadata.data.resource, resource);
  assert.deepEqual(metadata.data.authorization_servers, [CONNECTOR_ORIGIN]);
  assert.equal(metadata.headers.get('access-control-allow-origin'), '*');
  const as = await f.request('/.well-known/oauth-authorization-server');
  assert.equal(as.data.issuer, CONNECTOR_ORIGIN);
  assert.deepEqual(as.data.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.data.token_endpoint_auth_methods_supported, ['none']);
  assert.equal(as.data.authorization_response_iss_parameter_supported, true);
  assert.equal(as.data.client_id_metadata_document_supported, undefined);
  const noToken = await f.request('/mcp');
  assert.equal(noToken.status, 401);
  assert.match(noToken.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
});

test('DCR bounds redirects, client metadata, scopes and public grant types', async t => {
  const f = await fixture(t);
  for (const extra of [{ redirect_uris: ['https://evil.example/cb'] }, { redirect_uris: [] }, { token_endpoint_auth_method: 'client_secret_post' },
    { scope: 'profile finance:read' }, { client_name: 'unsafe\nname' }, { response_types: ['token'] }, { grant_types: ['refresh_token'] }]) {
    const response = await f.request('/oauth/register', { method: 'POST', body: { redirect_uris: [callback], ...extra } });
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
  const id = await f.register({ logo_uri: 'http://169.254.169.254/latest', client_uri: 'http://127.0.0.1/private' });
  const record = await f.store.get('clients', id);
  assert.equal(record.logo_uri, undefined);
  assert.equal(record.client_uri, undefined);
});

test('invalid clients and redirects never produce an attacker-controlled redirect', async t => {
  const f = await fixture(t);
  const id = await f.register();
  for (const extra of [{ client_id: 'missing' }, { redirect_uri: 'https://evil.example/callback' }, { redirect_uri: `${callback}#bad` }]) {
    const response = await f.authorize(id, extra);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  }
});

test('validated authorization errors retain state and exact issuer, no request is created', async t => {
  const f = await fixture(t);
  const id = await f.register();
  for (const extra of [{ resource: 'https://evil.example/mcp' }, { scope: 'finance:read' }, { code_challenge_method: 'plain' }, { code_challenge: 'short' }, { response_type: 'token' }]) {
    const response = await f.authorize(id, extra);
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.origin + url.pathname, callback);
    assert.ok(url.searchParams.get('error'));
    assert.equal(url.searchParams.get('iss'), CONNECTOR_ORIGIN);
    assert.equal(url.searchParams.get('state'), 'synthetic-state');
    assert.equal(url.searchParams.get('code'), null);
  }
  assert.equal([...await f.store.inspect()].filter(([key]) => key.startsWith('requests/')).length, 0);
});

test('consent requires Firebase identity, displays untrusted name/host, and rejects cross-origin posts', async t => {
  const f = await fixture(t);
  const id = (await f.authorize(await f.register())).id;
  const path = `/api/connectors/authorization/${id}`;
  assert.equal((await f.request(path)).status, 401);
  assert.equal((await f.request(path, { user: 'unverified' })).status, 401);
  const response = await f.request(path, { user: 'owner' });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.data).sort(), ['id', 'clientName', 'redirectHost', 'scopes', 'expiresAt'].sort());
  assert.equal(response.data.redirectHost, 'claude.ai');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await f.request(path, { method: 'POST', user: 'owner', headers: { Origin: 'https://evil.example' }, body: { approve: false } })).status, 403);
});

test('approval binds one explicit space and only documents whose current authority was checked', async t => {
  const f = await fixture(t);
  const input = await f.code({ spaceId: 'work', documentIds: ['doc-work'] });
  assert.deepEqual(f.documentChecks, [{ uid: 'owner', spaceId: 'work', documentId: 'doc-work' }]);
  const redirect = new URL(input.redirectUrl);
  assert.equal(redirect.searchParams.get('iss'), CONNECTOR_ORIGIN);
  assert.equal(redirect.searchParams.get('state'), 'synthetic-state');
  const tokens = await f.exchange(input);
  assert.equal(tokens.status, 200);
  assert.equal(tokens.headers.get('cache-control'), 'no-store');
  const access = await f.access(tokens.data.access_token);
  assert.equal(access.status, 200);
  assert.equal(access.data.uid, 'owner');
  assert.equal(access.data.spaceId, 'work');
  assert.equal(access.data.spaceType, 'business');
  assert.deepEqual(access.data.documentIds, ['doc-work']);
  assert.equal(access.data.activeFamily, undefined);
});

test('child/unknown/outsider cannot approve; business member can grant inbox only', async t => {
  const f = await fixture(t);
  for (const [user, spaceId] of [['child', 'home'], ['outsider', 'home'], ['staff', 'work']]) {
    const id = (await f.authorize(await f.register())).id;
    assert.equal((await f.approve(id, { spaceId, documentIds: [`doc-${spaceId}`] }, user)).status, 403);
  }
  f.roles.set('unknown:home', { role: 'member' });
  const unknown = (await f.authorize(await f.register())).id;
  assert.equal((await f.approve(unknown, {}, 'unknown')).status, 403);
  const input = await f.code({ spaceId: 'work', scopes: ['inbox:write'], documentIds: [] }, 'staff');
  const tokens = await f.exchange(input);
  const access = await f.access(tokens.data.access_token);
  assert.equal(access.status, 200);
  assert.deepEqual(access.data.scopes, ['inbox:write']);
  assert.deepEqual(access.data.documentIds, []);
});

test('consent cannot add scopes or documents, target another space, or exceed the document cap', async t => {
  const f = await fixture(t);
  const id = (await f.authorize(await f.register(), { scope: 'inbox:write' })).id;
  assert.equal((await f.approve(id)).status, 400);
  for (const extra of [{ spaceId: 'unowned', documentIds: ['doc-unowned'] }, { documentIds: ['private-other-doc'] }]) {
    const next = (await f.authorize(await f.register())).id;
    assert.equal((await f.approve(next, extra)).status, 403);
  }
  for (const extra of [{ spaceId: '../work' }, { documentIds: ['doc-home', 'doc-home'] }, { documentIds: Array.from({ length: 51 }, (_, i) => `doc-${i}`) },
    { scopes: ['inbox:write'], documentIds: ['doc-home'] }, { scopes: ['documents:read'], documentIds: [] }, { scopes: [] }]) {
    const next = (await f.authorize(await f.register())).id;
    assert.equal((await f.approve(next, extra)).status, 400, JSON.stringify(extra));
  }
});

test('denial is one-time and only returns a validated callback OAuth error', async t => {
  const f = await fixture(t);
  const id = (await f.authorize(await f.register())).id;
  const denied = await f.request(`/api/connectors/authorization/${id}`, { method: 'POST', user: 'owner', body: { approve: false } });
  assert.equal(denied.status, 200);
  const url = new URL(denied.data.redirectUrl);
  assert.equal(url.origin + url.pathname, callback);
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('iss'), CONNECTOR_ORIGIN);
  assert.equal((await f.approve(id)).status, 410);
  assert.equal([...await f.store.inspect()].filter(([key]) => key.startsWith('grants/')).length, 0);
});

test('authorization request and authorization code expire without issuing access', async t => {
  const f = await fixture(t);
  const id = (await f.authorize(await f.register())).id;
  f.advance(CONNECTOR_REQUEST_MS);
  assert.equal((await f.approve(id)).status, 410);
  const input = await f.code();
  f.advance(CONNECTOR_CODE_MS);
  assert.equal((await f.exchange(input)).status, 400);
});

test('concurrent approval and code exchange each commit exactly once', async t => {
  const f = await fixture(t);
  const clientId = await f.register();
  const id = (await f.authorize(clientId)).id;
  const approvals = await Promise.all([f.approve(id), f.approve(id)]);
  assert.deepEqual(approvals.map(r => r.status).sort(), [200, 410]);
  const code = new URL(approvals.find(r => r.status === 200).data.redirectUrl).searchParams.get('code');
  const responses = await Promise.all([f.exchange({ clientId, code }), f.exchange({ clientId, code })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  assert.equal((await f.access(responses.find(r => r.status === 200).data.access_token)).status, 200);
});

test('wrong PKCE, client, redirect, resource or verifier absence cannot redeem or consume a code', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const another = await f.register();
  for (const extra of [{ code_verifier: 'x'.repeat(43) }, { code_verifier: '' }, { client_id: another }, { redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect' }, { resource: `${resource}/` }]) {
    assert.equal((await f.exchange(input, extra)).status, 400, JSON.stringify(extra));
  }
  assert.equal((await f.exchange(input)).status, 200);
});

test('all codes/access/refresh secrets are hashed at rest; management contains none', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const response = await f.exchange(input);
  const serialized = JSON.stringify([...await f.store.inspect()]);
  for (const raw of [input.code, response.data.access_token, response.data.refresh_token, verifier]) assert.equal(serialized.includes(raw), false);
  const managed = await f.request('/api/connectors?spaceId=home', { user: 'owner' });
  assert.equal(managed.status, 200);
  assert.equal(managed.data.connectors.length, 1);
  assert.equal(JSON.stringify(managed.data).includes(response.data.access_token), false);
  assert.equal(JSON.stringify(managed.data).includes(response.data.refresh_token), false);
  assert.deepEqual(Object.keys(managed.data.connectors[0]).sort(), ['id', 'clientName', 'spaceId', 'scopes', 'documentIds', 'createdAt', 'expiresAt'].sort());
});

test('current membership and business demotion invalidate existing access and refresh', async t => {
  const f = await fixture(t);
  const input = await f.code({ spaceId: 'work', documentIds: ['doc-work'] });
  const response = await f.exchange(input);
  f.roles.set('owner:work', { role: 'member', spaceType: 'business' });
  assert.equal((await f.access(response.data.access_token)).status, 401);
  assert.equal((await f.refresh(input, response.data.refresh_token)).status, 400);
  f.roles.set('owner:work', { role: 'admin', spaceType: 'business' });
  assert.equal((await f.access(response.data.access_token)).status, 401, 'observed loss permanently revokes the grant');
  for (const role of ['child', 'unknown', null]) {
    if (role) f.roles.set('owner:work', { role, spaceType: 'business' }); else f.roles.delete('owner:work');
    assert.equal((await f.access(response.data.access_token)).status, 401);
  }
});

test('observed child downgrade permanently revokes even after adult membership is restored', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const tokens = await f.exchange(input);
  f.roles.set('owner:home', { role: 'member', spaceType: 'family' });
  assert.equal((await f.access(tokens.data.access_token)).status, 200);
  f.roles.set('owner:home', { role: 'child', spaceType: 'family' });
  assert.equal((await f.access(tokens.data.access_token)).status, 401);
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family' });
  assert.equal((await f.access(tokens.data.access_token)).status, 401);
});

test('authoritative membership version prevents unobserved removal/rejoin resurrection', async t => {
  const f = await fixture(t);
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', spaceName: 'Synthetic home', membershipVersion: 'role-update-1' });
  const input = await f.code();
  const tokens = (await f.exchange(input)).data;
  assert.equal((await f.access(tokens.access_token)).data.spaceName, 'Synthetic home');
  // No connector request observes the absent role between removal and rejoin.
  f.roles.delete('owner:home');
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', membershipVersion: 'role-update-2' });
  assert.equal((await f.access(tokens.access_token)).status, 401);
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', membershipVersion: 'role-update-1' });
  assert.equal((await f.access(tokens.access_token)).status, 401, 'observed version mismatch is permanent');
  assert.equal((await f.refresh(input, tokens.refresh_token)).status, 400);
});

test('membership changes between consent and token exchange, or before refresh, require fresh consent', async t => {
  const f = await fixture(t);
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', membershipVersion: '1' });
  const staleCode = await f.code();
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', membershipVersion: '2' });
  assert.equal((await f.exchange(staleCode)).status, 400);
  const current = await f.code();
  const tokens = (await f.exchange(current)).data;
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', membershipVersion: '3' });
  assert.equal((await f.refresh(current, tokens.refresh_token)).status, 400);
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family', membershipVersion: '2' });
  assert.equal((await f.access(tokens.access_token)).status, 401);
});

test('duplicate OAuth parameters and non-scalar scopes are refused without consuming a code', async t => {
  const f = await fixture(t);
  const clientId = await f.register();
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', resource,
    scope: 'documents:read', code_challenge: challenge, code_challenge_method: 'S256' });
  q.append('scope', 'inbox:write');
  const auth = await f.request(`/oauth/authorize?${q}`);
  assert.equal(auth.status, 302);
  assert.equal(new URL(auth.headers.get('location')).searchParams.get('error'), 'invalid_request');
  const input = await f.code();
  const body = { grant_type: 'authorization_code', client_id: input.clientId, code: input.code, redirect_uri: callback, resource, code_verifier: verifier, scope: ['documents:read', 'inbox:write'] };
  assert.equal((await f.request('/oauth/token', { method: 'POST', body })).status, 400);
  const duplicate = Object.entries({ ...body, scope: 'documents:read inbox:write' });
  duplicate.push(['code', input.code]);
  assert.equal((await f.request('/oauth/token', { method: 'POST', form: true, body: duplicate })).status, 400);
  assert.equal((await f.exchange(input)).status, 200);
});

test('wrong refresh client cannot revoke a grant and active grant count is bounded per owner/space', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const tokens = (await f.exchange(input)).data;
  const other = await f.register();
  assert.equal((await f.refresh(input, tokens.refresh_token, { client_id: other })).status, 400);
  assert.equal((await f.access(tokens.access_token)).status, 200);
  for (let i = 1; i < 20; i++) {
    const pending = await f.authorize(input.clientId);
    assert.equal((await f.approve(pending.id)).status, 200);
  }
  const extra = await f.authorize(input.clientId);
  assert.equal((await f.approve(extra.id)).status, 400);
  const grantId = (await f.access(tokens.access_token)).data.grantId;
  assert.equal((await f.request(`/api/connectors/${grantId}`, { method: 'DELETE', user: 'owner' })).status, 200);
  assert.equal((await f.approve(extra.id)).status, 200, 'revoking one connection frees capacity');
  assert.equal((await f.request('/api/connectors?spaceId=home', { user: 'owner' })).data.connectors.length, 20);
});

test('refresh rotates once and reuse revokes the complete grant, including new tokens', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const original = (await f.exchange(input)).data;
  const rotated = await f.refresh(input, original.refresh_token);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.refresh_token, original.refresh_token);
  assert.equal((await f.access(rotated.data.access_token)).status, 200);
  assert.equal((await f.refresh(input, original.refresh_token)).status, 400);
  assert.equal((await f.access(original.access_token)).status, 401);
  assert.equal((await f.access(rotated.data.access_token)).status, 401);
  assert.equal((await f.refresh(input, rotated.data.refresh_token)).status, 400);
});

test('concurrent refresh reuse leaves no usable token family', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const original = (await f.exchange(input)).data;
  const results = await Promise.all([f.refresh(input, original.refresh_token), f.refresh(input, original.refresh_token)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await f.access(results.find(r => r.status === 200).data.access_token)).status, 401);
});

test('owner-only management is bound to the requested space and revocation survives membership removal', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const tokens = (await f.exchange(input)).data;
  const auth = (await f.access(tokens.access_token)).data;
  assert.equal((await f.request('/api/connectors?spaceId=work', { user: 'owner' })).data.connectors.length, 0);
  assert.equal((await f.request('/api/connectors?spaceId=home', { user: 'adult' })).data.connectors.length, 0);
  assert.equal((await f.request(`/api/connectors/${auth.grantId}`, { method: 'DELETE', user: 'adult' })).status, 404);
  assert.equal((await f.access(tokens.access_token)).status, 200);
  f.roles.delete('owner:home');
  assert.equal((await f.request(`/api/connectors/${auth.grantId}`, { method: 'DELETE', user: 'owner' })).status, 200);
  f.roles.set('owner:home', { role: 'admin', spaceType: 'family' });
  assert.equal((await f.access(tokens.access_token)).status, 401);
  assert.equal((await f.refresh(input, tokens.refresh_token)).status, 400);
});

test('RFC7009 revocation does not disclose token existence and never accepts another client', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const tokens = (await f.exchange(input)).data;
  const other = await f.register();
  assert.equal((await f.request('/oauth/revoke', { method: 'POST', form: true, body: { client_id: other, token: tokens.refresh_token } })).status, 200);
  assert.equal((await f.access(tokens.access_token)).status, 200);
  assert.equal((await f.request('/oauth/revoke', { method: 'POST', form: true, body: { client_id: input.clientId, token: 'not-a-token' } })).status, 200);
  assert.equal((await f.request('/oauth/revoke', { method: 'POST', form: true, body: { client_id: input.clientId, token: tokens.refresh_token } })).status, 200);
  assert.equal((await f.access(tokens.access_token)).status, 401);
});

test('short-lived access expires and grant lifetime cannot be extended by refresh', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const tokens = (await f.exchange(input)).data;
  f.advance(CONNECTOR_ACCESS_MS);
  assert.equal((await f.access(tokens.access_token)).status, 401);
  const rotated = await f.refresh(input, tokens.refresh_token);
  assert.equal(rotated.status, 200);
  f.advance(CONNECTOR_GRANT_MS);
  assert.equal((await f.refresh(input, rotated.data.refresh_token)).status, 400);
});

test('DCR rate bounds are persistent across module instances with shared store', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) await f.register({}, { 'X-Forwarded-For': `9.9.9.${i}, 203.0.113.7, 35.191.0.1` });
  const anotherInstance = await fixture(t, { store: f.store });
  const denied = await anotherInstance.request('/oauth/register', { method: 'POST', headers: { 'X-Forwarded-For': '8.8.8.8, 203.0.113.7, 35.191.0.1' }, body: { redirect_uris: [callback] } });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  f.advance(60 * 60 * 1000);
  assert.ok(await f.register({}, { 'X-Forwarded-For': '7.7.7.7, 203.0.113.7, 35.191.0.1' }));
  assert.equal([...await f.store.inspect()].filter(([key]) => key.startsWith('limits/')).length, 2, 'next window reuses bounded counter keys');
});

test('authenticated connector and Firebase helpers throttle use with 429 and recover next window', async t => {
  const f = await fixture(t);
  const input = await f.code();
  const token = (await f.exchange(input)).data.access_token;
  for (let i = 0; i < 120; i++) assert.equal((await f.access(token)).status, 200);
  const limited = await f.access(token);
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error, 'temporarily_unavailable');
  const req = { headers: { authorization: 'Bearer firebase-adult' } };
  for (let i = 0; i < 240; i++) assert.deepEqual(await f.requireFirebase(req), { uid: 'adult' });
  await assert.rejects(f.requireFirebase(req), error => error.status === 429 && error.code === 'temporarily_unavailable');
  f.advance(60 * 1000);
  assert.equal((await f.access(token)).status, 200);
  assert.deepEqual(await f.requireFirebase(req), { uid: 'adult' });
});

test('Firestore store uses only default-denied server collections and atomic transactions', async () => {
  const data = new Map();
  let writes = false;
  let runs = 0;
  const db = {
    collection(name) { assert.ok(Object.values(CONNECTOR_COLLECTIONS).includes(name)); return { doc(id) { return { key: `${name}/${id}`, async get() { return { exists: data.has(this.key), data: () => data.get(this.key) }; } }; } }; },
    async runTransaction(callback) {
      runs++;
      const pending = [];
      const result = await callback({
        async get(ref) { assert.equal(writes, false, 'all reads before writes'); return ref.get(); },
        set(ref, value) { writes = true; pending.push([ref.key, structuredClone(value)]); },
      });
      for (const [key, value] of pending) data.set(key, value);
      writes = false;
      return result;
    },
  };
  const store = createFirestoreConnectorStore(db);
  await store.transaction(async tx => { assert.equal(await tx.get('grants', 'synthetic'), null); tx.set('grants', 'synthetic', { scopes: ['inbox:write'] }); });
  assert.equal(runs, 1);
  assert.deepEqual(await store.get('grants', 'synthetic'), { scopes: ['inbox:write'] });
  await assert.rejects(() => store.get('families', 'not-supported'));
});
