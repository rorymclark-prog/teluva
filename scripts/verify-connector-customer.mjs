/** Explicit live acceptance, disposable identities/spaces only. No model turns.
 * printf '<authorised fixture JSON>' | node scripts/verify-connector-customer.mjs --run-live
 * --backend-fixture uses a loopback disposable identity for consent/review;
 * OAuth exchange and MCP tools still run on the deployed service. It is not a
 * normal customer sign-in or production review-HTTP acceptance test.
 * Fixture: {fixtures:[{label,synthetic,file:{download_url,file_id,mime_type,file_name},source,proposal}],allowSensitiveTestCopy?:true}
 * Download URLs/tokens/original contents are held in memory, never in the report.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { once } from 'node:events';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { createRequire } from 'node:module';
// Match google-gax's auth-library major: its gRPC adapter consumes v9 header
// records, while the app's v10 client returns a Headers instance.
const { GoogleAuth, OAuth2Client } = createRequire(import.meta.resolve('google-gax'))('google-auth-library');
import { downloadHostFile } from '../server/connectorOriginals.mjs';
import { connectorOwnerKey } from '../server/connectorAuthStore.mjs';
import { createConnectorAuth } from '../server/connectorAuth.mjs';
import { createConnectorIntegration } from '../server/connectorIntegration.mjs';
import { createImportInbox, createImportInboxRouter } from '../server/importInbox.mjs';

if (!process.argv.includes('--run-live')) throw Error('Explicit --run-live is required for disposable live acceptance fixtures.');
const origin = 'https://teluva-x3k4bua7pq-nw.a.run.app', project = 'gen-lang-client-0384516171';
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = project;
const output = resolve('output/verification/connector-v380');
const backendFixture = process.argv.includes('--backend-fixture');
await mkdir(output, { recursive: true });
const input = JSON.parse(await new Promise((done, reject) => { const reader = readline.createInterface({ input: process.stdin, terminal: false }); reader.once('line', line => { reader.close(); done(line); }); reader.once('error', reject); }));
assert.ok(Array.isArray(input.fixtures) && input.fixtures.length >= 1 && input.fixtures.length <= 2, 'One or two explicitly selected fixtures only.');
for (const fixture of input.fixtures) { assert.ok(fixture.synthetic === true || input.allowSensitiveTestCopy === true, 'Sensitive test copies require explicit separate approval.'); assert.ok(fixture.file?.download_url && fixture.file?.file_id, 'Each selected fixture needs a fresh original file reference.'); }
const liveVersion = await fetch(`${origin}/version.json`).then(res => res.json());
assert.equal(liveVersion.label, 'v380', 'Deploy the customer workflow before live acceptance.');
const config = JSON.parse(await readFile('firebase-applet-config.json', 'utf8'));
assert.equal(config.projectId, project);
const cleanupOnly = process.argv.includes('--cleanup-only');
const run = cleanupOnly ? process.argv[process.argv.indexOf('--cleanup-only') + 1] : randomUUID().slice(0, 12);
assert.match(run, /^[a-f0-9]{8}-[a-f0-9]{3}$/, 'Only an exact disposable acceptance run may be cleaned.');
const uid = `connector-acceptance-${run}`;
const family = `${uid}-family`, business = `${uid}-business`, forbidden = `${uid}-forbidden`;
const spaces = [family, business, forbidden], clients = [], grantIds = [];
const nativeServer = `teluva_acceptance_${run.replaceAll('-', '_')}`;
const executable = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const nativeBinary = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const nativeConfig = ['-c', `mcp_servers.${nativeServer}.url=${JSON.stringify(origin + '/mcp')}`];
let nativeLoginAttempted = false;
const report = { release: 'v380', run, syntheticIdentity: uid, checks: [], originals: [], privateBillCopied: false, noPaidAi: true, cleanup: false, approvalIdentityMode: backendFixture ? 'loopback disposable-identity fixture; production Firebase sign-in not exercised' : 'production Firebase sign-in' };
report.verificationScope = { deployedOAuthExchange: true, deployedMcpTools: true, productionFirebaseSignIn: !backendFixture, productionConsentApi: !backendFixture, productionReviewApi: !backendFixture, customerBrowserUi: false };
const hash = value => createHash('sha256').update(value).digest('hex');
// Reuse the operator's existing authorised gcloud credential without printing it
// or modifying credentials, IAM, browser sessions or persistent MCP settings.
const app = initializeApp({ projectId: project, serviceAccountId: '1000796646145-compute@developer.gserviceaccount.com', credential: { getAccessToken: async () => ({ access_token: execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), expires_in: 3300 }) } }, uid);
const operatorClient = new OAuth2Client();
operatorClient.quotaProjectId = project;
operatorClient.setCredentials({ access_token: (await app.options.credential.getAccessToken()).access_token, expiry_date: Date.now() + 3300000 });
const db = new Firestore({ projectId: project, databaseId: 'teluva-prod', auth: new GoogleAuth({ authClient: operatorClient }) });
const auth = getAuth(app), bucket = new Storage({ projectId: project, authClient: operatorClient }).bucket('gen-lang-client-0384516171-vault');
let idToken, testUserCreated = false, activeNative, fixtureServer, fixtureOrigin;
const sourceHeaders = token => token ? { Authorization: `Bearer ${token}` } : {};
async function request(path, { method = 'GET', token, body, form = false } = {}) {
  const base = backendFixture && path.startsWith('/api/') ? fixtureOrigin : origin;
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...sourceHeaders(token),
    ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }) },
    ...(body === undefined ? {} : { body: form ? new URLSearchParams(body) : JSON.stringify(body) }) });
  const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = null; }
  return { status: response.status, data, headers: response.headers };
}
async function nativeLogin(space, documentIds) {
  nativeLoginAttempted = true;
  const child = spawn(executable, ['mcp', 'login', nativeServer, ...nativeConfig, '--no-browser', '--scopes', 'documents:read,inbox:write', '--oauth-client-registration', 'dcr'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const record = { owner: '01a18887-16e5-7061-a8dd-1f4f05f4cd5b', checkout: process.cwd(), pid: child.pid, command: executable + ' mcp login ' + nativeServer + ' --no-browser', port: null, session: nativeServer, startedAt: new Date().toISOString() };
  await writeFile(resolve(output, 'active-process.json'), JSON.stringify(record, null, 2));
  let buffer = '';
  try {
    const authUrl = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('Native OAuth did not return an authorization URL.')), 45000);
      const observe = chunk => { buffer += chunk.toString(); const match = buffer.match(/https:\/\/teluva-x3k4bua7pq-nw\.a\.run\.app\/oauth\/authorize\?[^\s"<>]+/); if (match) { clearTimeout(timer); done(new URL(match[0])); } };
      child.stdout.on('data', observe); child.stderr.on('data', observe);
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Native OAuth login exited before authorization (${code}).`)); });
    });
    clients.push(authUrl.searchParams.get('client_id'));
    const authorization = await request(authUrl.pathname + authUrl.search); assert.equal(authorization.status, 302);
    const requestId = new URL(authorization.headers.get('location')).searchParams.get('connector_authorize');
    const approved = await request(`/api/connectors/authorization/${requestId}`, { method: 'POST', token: idToken, body: { approve: true, spaceId: space, scopes: ['documents:read', 'inbox:write'], documentIds } });
    assert.equal(approved.status, 200);
    const exited = once(child, 'exit'); child.stdin.write(approved.data.redirectUrl + '\n');
    const [code] = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('Native OAuth callback timed out.')), 45000))]);
    assert.equal(code, 0, 'Native client completes PKCE exchange and stores only its isolated test credentials.');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const command = execFileSync('ps', ['-ww', '-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' }); assert.ok(command.includes(nativeServer) && command.includes('mcp login')); child.kill('SIGTERM'); await once(child, 'exit'); }
    await writeFile(resolve(output, 'active-process.json'), JSON.stringify({ ...record, stoppedAt: new Date().toISOString() }, null, 2));
  }
}
async function nativeClient() {
  const server = nativeServer;
  const args = ['app-server', '--stdio', ...nativeConfig];
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  const processRecord = { owner: '01a18887-16e5-7061-a8dd-1f4f05f4cd5b', checkout: process.cwd(), pid: child.pid, command: executable + ' app-server --stdio (ephemeral test configuration)', port: null, session: server, startedAt: new Date().toISOString() };
  await writeFile(resolve(output, 'active-process.json'), JSON.stringify(processRecord, null, 2));
  const pending = new Map(); let seq = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => { let value; try { value = JSON.parse(line); } catch { return; } const waiter = pending.get(value.id); if (waiter) { pending.delete(value.id); clearTimeout(waiter.timer); value.error ? waiter.reject(new Error(`Native MCP request failed (${value.error.code})`)) : waiter.resolve(value.result); } });
  const rpc = (method, params) => new Promise((resolveResult, reject) => { report.phase = method === 'mcpServer/tool/call' ? `tool:${params.tool}` : method; console.log(`Acceptance phase: ${report.phase}`); const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native MCP timeout: ${method}`)); }, 45000); pending.set(id, { resolve: resolveResult, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const command = execFileSync('ps', ['-ww', '-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' }).replace('/bin/../', '/');
      await writeFile(resolve(output, 'native-process-identity.json'), JSON.stringify({ pid: child.pid, command, loadedFiles: execFileSync('lsof', ['-a', '-p', String(child.pid), '-d', 'cwd,txt', '-Fn'], { encoding: 'utf8' }).split('\n').filter(line => line.includes('codex') || line.includes(process.cwd())) }, null, 2));
      assert.ok((command.includes(executable) || command.includes(nativeBinary)) && command.includes('app-server') && command.includes(server), 'Only this recorded acceptance child can be stopped.');
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(done => setTimeout(done, 5000))]);
      if (child.exitCode === null && child.signalCode === null) throw Error('Owned native test process did not stop gracefully.');
    }
    lines.close(); for (const value of pending.values()) clearTimeout(value.timer); pending.clear();
    await writeFile(resolve(output, 'active-process.json'), JSON.stringify({ ...processRecord, stoppedAt: new Date().toISOString() }, null, 2));
  };
  activeNative = { stop };
  await rpc('initialize', { clientInfo: { name: 'teluva_isolated_acceptance', version: '0.2.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write('{"method":"initialized","params":{}}\n');
  const thread = (await rpc('thread/start', { ephemeral: true })).thread.id;
  const status = await rpc('mcpServerStatus/list', { serverName: server, threadId: thread, detail: 'toolsAndAuthOnly' });
  const entry = status.data.find(item => item.name === server) || status.data.find(item => item.tools?.import_original);
  assert.ok(entry?.tools?.import_original, 'Native host discovers original-attachment tool.');
  return { stop, call: async (name, args = {}) => { const result = await rpc('mcpServer/tool/call', { threadId: thread, server, tool: name, arguments: args }); assert.equal(result.isError, false, `Native tool failed: ${name}`); return result.structuredContent; } };
}
try {
  if (cleanupOnly) { const profile = await db.doc(`users/${uid}`).get(); assert.equal(profile.data()?.syntheticAcceptance, run); testUserCreated = true; nativeLoginAttempted = true; report.passed = true; }
  else {
  const password = randomBytes(36).toString('base64url'), email = `${uid}@example.invalid`;
  await auth.createUser({ uid, email, emailVerified: true, password, displayName: 'Disposable Teluva customer acceptance' }); testUserCreated = true;
  if (backendFixture) {
    // Only the disposable account's consent/review is supplied by this local
    // fixture. OAuth discovery, DCR, PKCE, token exchange and every MCP call use
    // the deployed server. Never install this adapter in the production app.
    idToken = randomBytes(48).toString('base64url');
    const integration = createConnectorIntegration({ db, bucket, getUserIdentity: candidate => { assert.equal(candidate, uid); return auth.getUser(uid); },
      getPolicy: async (_space, _path, metadata, caller) => ({ estate: false, ownerAllowed: caller.uid === uid && metadata.metadata?.teluvaOwnerUid === uid }), aiReady: false });
    const module = createConnectorAuth({ db, verifyFirebaseToken: async token => { assert.equal(token, idToken); return { uid, email_verified: true }; }, resolveMembership: integration.resolveMembership, canReadDocument: integration.canReadDocument });
    const inbox = createImportInbox({ db, ...integration });
    const local = express(); local.use(module.router); local.use('/api/import-inbox', createImportInboxRouter({ service: inbox, authenticateFirebase: module.requireFirebase }));
    local.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code || 'FIXTURE_ERROR' }));
    fixtureServer = local.listen(0, '127.0.0.1'); await once(fixtureServer, 'listening'); fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
    await writeFile(resolve(output, 'loopback-process.json'), JSON.stringify({ owner: '01a18887-16e5-7061-a8dd-1f4f05f4cd5b', checkout: process.cwd(), pid: process.pid, command: 'node scripts/verify-connector-customer.mjs --run-live --backend-fixture', port: fixtureServer.address().port, startedAt: new Date().toISOString() }, null, 2));
  } else {
  let signedIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: origin + '/' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }).then(res => res.json());
  if (!signedIn.idToken && /OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(signedIn.error?.message || '')) {
    // Admin generates a disposable verification link without sending email.
    // Use only an enabled provider; never change provider settings or IAM.
    try {
      const link = new URL(await auth.generateSignInWithEmailLink(email, { url: origin, handleCodeInApp: true }));
      signedIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${config.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: origin + '/' }, body: JSON.stringify({ email, oobCode: link.searchParams.get('oobCode'), returnSecureToken: true }) }).then(res => res.json());
    } catch { /* An unavailable provider is not a reason to enable it. */ }
    if (!signedIn.idToken) {
      const customToken = await auth.createCustomToken(uid);
      signedIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${config.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: origin + '/' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }).then(res => res.json());
    }
  }
  assert.ok(signedIn.idToken, `Synthetic test sign-in unavailable: ${signedIn.error?.message || 'no token'}`); idToken = signedIn.idToken;
  }
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), { familyId: business, familyIds: [family, business], role: 'admin', syntheticAcceptance: run, aiConsent: { granted: false, version: 1 } });
  for (const [space, type] of [[family, 'family'], [business, 'business'], [forbidden, 'family']]) {
    batch.set(db.doc(`families/${space}/info/info`), { name: `Disposable Teluva acceptance ${type}`, type, syntheticAcceptance: run });
    if (space !== forbidden) batch.set(db.doc(`families/${space}/roles/${uid}`), { role: 'admin' });
  }
  await batch.commit();
  for (const space of [family, business]) {
    const path = `families/${space}/documents/selected-seed/original.txt`, bytes = Buffer.from(`Synthetic selected seed for ${space}`);
    await bucket.file(path).save(bytes, { resumable: false, metadata: { contentType: 'text/plain', metadata: { teluvaOwnerUid: uid } } });
    await db.doc(`families/${space}/reference/documents`).set({ docs: [{ id: 'selected-seed', name: 'Synthetic selected seed', category: 'Other', storagePath: path, downloadUrl: `/api/files/content?path=${encodeURIComponent(path)}`, fileType: 'text/plain', fileSize: bytes.length, contentHash: hash(bytes) }] });
  }
  await nativeLogin(family, ['selected-seed']);
  const host = await nativeClient();
  const state = await host.call('get_connection'); assert.equal(state.spaceId, family); assert.equal(state.originalImportsSupported, true);
  assert.equal((await host.call('search', { query: 'seed' })).results.length, 1);
  assert.match((await host.call('fetch', { id: 'selected-seed' })).text, new RegExp(family));
  for (const [index, fixture] of input.fixtures.entries()) {
    const source = await downloadHostFile(fixture.file.download_url);
    const args = { requestId: `original-${index}`, file: fixture.file, source: fixture.source, proposal: fixture.proposal, sha256: hash(source.bytes) };
    const imported = await host.call('import_original', args);
    if (!fixture.synthetic) report.privateBillCopied = true;
    const retry = await host.call('import_original', args);
    const duplicate = await host.call('import_original', { ...args, requestId: `duplicate-${index}` });
    assert.equal(imported.item.id, retry.item.id); assert.equal(imported.item.id, duplicate.item.id);
    assert.equal(imported.item.status, 'pending'); assert.equal(imported.item.source.hasOriginalDocument, true);
    const vault = (await db.doc(`families/${family}/reference/documents`).get()).data().docs;
    const original = vault.find(doc => doc.id === imported.original.documentId);
    assert.equal(vault.filter(doc => doc.id === original.id).length, 1);
    assert.equal(original.contentHash, hash(source.bytes));
    const binaryPath = `/api/files/content?path=${encodeURIComponent(original.storagePath)}`;
    assert.equal((await fetch(origin + binaryPath)).status, 401);
    const copied = backendFixture ? (await bucket.file(original.storagePath).download())[0] : await (async () => { const response = await fetch(origin + binaryPath, { headers: sourceHeaders(idToken) }); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()); })();
    assert.equal(Buffer.compare(copied, source.bytes), 0, 'Stored original is byte identical to the authorised source.');
    if (fixture.synthetic) {
      const applied = await request(`/api/import-inbox/${imported.item.id}/apply?spaceId=${family}`, { method: 'POST', token: idToken, body: { expectedRevision: imported.item.revision } });
      assert.equal(applied.status, 200); assert.equal(applied.data.item.status, 'applied');
      const second = await request(`/api/import-inbox/${imported.item.id}/apply?spaceId=${family}`, { method: 'POST', token: idToken, body: {} });
      assert.equal(second.status, 200); assert.equal(second.data.item.appliedRecordId, applied.data.item.appliedRecordId);
      if (fixture.proposal.kind === 'asset') { const asset = await db.doc(`families/${family}/assets/${applied.data.item.appliedRecordId}`).get(); assert.deepEqual(asset.data().documentIds, [original.id]); assert.equal(asset.data().category, fixture.proposal.asset.category); }
    }
    report.originals.push({ fixture: fixture.synthetic ? 'synthetic-drive-export' : 'explicitly-authorised-utility-bill', bytes: source.bytes.length, sha256: original.contentHash, originalLinked: true, anonymousAccessRejected: true, byteComparison: backendFixture ? 'operator-only storage read' : 'authenticated production file API', pendingBeforeReview: true, reviewed: fixture.synthetic });
  }
  const prefs = await host.call('submit_import', { requestId: 'preferences', sourceName: 'Explicit synthetic customer preference request', sourceText: 'Please use German and dark appearance.', analyze: false, proposal: { kind: 'preferences', preferences: { language: 'de', theme: 'dark' } } });
  assert.equal((await db.doc(`users/${uid}/preferences/teluva`).get()).exists, false);
  assert.equal((await request(`/api/import-inbox/${prefs.item.id}/apply?spaceId=${family}`, { method: 'POST', token: idToken, body: {} })).status, 200);
  const preferences = await request(`/api/import-inbox/preferences?spaceId=${family}`, { token: idToken }); assert.equal(preferences.data.preferences.language, 'de'); assert.equal(preferences.data.preferences.theme, 'dark');
  assert.equal((await request(`/api/import-inbox?spaceId=${forbidden}`, { token: idToken })).status, 403);
  const management = await request(`/api/connectors?spaceId=${family}`, { token: idToken }); assert.equal(management.data.connectors.length, 1); assert.ok(management.data.connectors[0].lastUsedAt);
  await request(`/api/connectors/${management.data.connectors[0].id}`, { method: 'DELETE', token: idToken });
  await assert.rejects(host.call('get_connection'), /Native (?:MCP request|tool) failed/, 'The native client cannot use its revoked credential.');
  await host.stop(); activeNative = null;
  execFileSync(executable, ['mcp', 'logout', nativeServer, ...nativeConfig], { stdio: ['ignore', 'ignore', 'ignore'] });
  await nativeLogin(business, ['selected-seed']);
  const secondHost = await nativeClient(); assert.equal((await secondHost.call('get_connection')).spaceId, business);
  const synthetic = input.fixtures.find(fixture => fixture.synthetic && fixture.proposal.kind === 'asset');
  if (synthetic) {
    const familyBefore = (await db.collection(`families/${family}/importInbox`).get()).docs.map(row => row.data());
    const imported = await secondHost.call('import_original', { requestId: 'business-asset', file: synthetic.file, source: synthetic.source, proposal: synthetic.proposal });
    assert.equal(imported.spaceId, business); assert.equal(imported.item.status, 'pending');
    const applied = await request(`/api/import-inbox/${imported.item.id}/apply?spaceId=${business}`, { method: 'POST', token: idToken, body: { expectedRevision: imported.item.revision } });
    assert.equal(applied.status, 200); assert.equal(applied.data.item.status, 'applied');
    const asset = await db.doc(`families/${business}/assets/${applied.data.item.appliedRecordId}`).get();
    assert.deepEqual(asset.data().documentIds, [imported.original.documentId]);
    // Content-derived IDs may legitimately match in separate collections.
    // Isolation requires the other space's records to remain unchanged.
    assert.deepEqual((await db.collection(`families/${family}/importInbox`).get()).docs.map(row => row.data()), familyBefore);
    const businessVault = (await db.doc(`families/${business}/reference/documents`).get()).data().docs;
    assert.ok(businessVault.find(row => row.id === imported.original.documentId).storagePath.startsWith(`families/${business}/`));
    report.checks.push('business original import and durable linked asset apply');
  }
  const documentBytes = Buffer.from('Synthetic business inventory reference. Acceptance fixture only.');
  const businessDocument = await secondHost.call('import_original', { requestId: 'business-document', contentBase64: documentBytes.toString('base64'), fileName: 'synthetic-business-reference.txt', mimeType: 'text/plain', source: { provider: 'local', sourceId: 'synthetic-business-reference', label: 'Synthetic business reference', representation: 'original' }, proposal: { kind: 'document', document: { name: 'Synthetic business reference', category: 'Other' } } });
  assert.equal(businessDocument.original.sha256, hash(documentBytes));
  const documentApplied = await request(`/api/import-inbox/${businessDocument.item.id}/apply?spaceId=${business}`, { method: 'POST', token: idToken, body: {} });
  assert.equal(documentApplied.status, 200); assert.equal(documentApplied.data.item.status, 'applied');
  const documents = (await db.doc(`families/${business}/reference/documents`).get()).data().docs;
  assert.equal(documents.find(item => item.id === businessDocument.original.documentId).name, 'Synthetic business reference');
  await secondHost.stop(); activeNative = null;
  report.checks.push('business original document categorisation and durable apply', 'supported native host discovery', 'OAuth DCR and PKCE with disposable Firebase identity', 'authorised provider file references', 'protected originals and exact checksums', 'request and content deduplication', 'categorised pending review', 'durable idempotent synthetic apply', 'self-approved persistent preferences', 'pinned-space routing despite another active pointer', 'forbidden-space access rejection', 'authenticated-use status', 'live revocation and reconnect to another permitted space');
  report.passed = true;
  }
} catch (error) {
  report.passed = false; report.error = String(error.message || 'acceptance-failed').replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 500);
  await writeFile(resolve(output, 'live-customer-acceptance.json'), JSON.stringify(report, null, 2));
  throw error;
} finally {
  // A process-observation failure must not strand an authorised private copy.
  // Preserve the failure for the report and continue independent data cleanup.
  if (fixtureServer) { try { await new Promise((done, reject) => fixtureServer.close(error => error ? reject(error) : done())); await writeFile(resolve(output, 'loopback-process.json'), JSON.stringify({ owner: '01a18887-16e5-7061-a8dd-1f4f05f4cd5b', pid: process.pid, stoppedAt: new Date().toISOString() }, null, 2)); } catch { report.fixtureProcessCleanupFailed = true; } }
  if (activeNative) { try { await activeNative.stop(); } catch { report.nativeProcessCleanupFailed = true; } }
  if (nativeLoginAttempted) { try { execFileSync(executable, ['mcp', 'logout', nativeServer, ...nativeConfig], { stdio: ['ignore', 'ignore', 'ignore'] }); } catch { report.nativeCredentialCleanupFailed = true; } }
  try {
    const grants = await db.collection('connector_grants').where('uid', '==', uid).get();
    for (const row of grants.docs) {
      if (!clients.includes(row.data().clientId)) clients.push(row.data().clientId);
      grantIds.push(row.id);
      for (const collection of ['connector_tokens', 'connector_codes']) { const rows = await db.collection(collection).where('grantId', '==', row.id).get(); for (const item of rows.docs) await item.ref.delete(); }
      await row.ref.delete();
    }
    for (const client of clients) { for (const collection of ['connector_authorizations', 'connector_codes']) { const rows = await db.collection(collection).where('clientId', '==', client).get(); for (const item of rows.docs) await item.ref.delete(); } await db.doc(`connector_clients/${client}`).delete(); }
    for (const space of spaces) {
      assert.ok(space.startsWith('connector-acceptance-') && space.includes(run));
      const info = await db.doc(`families/${space}/info/info`).get();
      if (info.exists) { assert.equal(info.data().syntheticAcceptance, run); const [files] = await bucket.getFiles({ prefix: `families/${space}/` }); for (const file of files) await file.delete(); await db.recursiveDelete(db.doc(`families/${space}`)); }
      await db.doc(`connector_owners/${connectorOwnerKey(uid, space)}`).delete();
    }
    const profile = await db.doc(`users/${uid}`).get(); if (profile.exists) assert.equal(profile.data().syntheticAcceptance, run);
    await db.recursiveDelete(db.doc(`users/${uid}`));
    if (testUserCreated) await auth.deleteUser(uid);
    report.cleanup = !report.fixtureProcessCleanupFailed && !report.nativeProcessCleanupFailed && !report.nativeCredentialCleanupFailed;
  } finally {
    await writeFile(resolve(output, 'live-customer-acceptance.json'), JSON.stringify(report, null, 2));
    await db.terminate(); await deleteApp(app);
  }
}
assert.equal(report.cleanup, true, 'All owned test data and resources must be cleaned before acceptance passes.');
console.log(JSON.stringify({ passed: report.passed, originalCount: report.originals.length, checks: report.checks.length, cleanup: report.cleanup, noPaidAi: report.noPaidAi }));
