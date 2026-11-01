import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(import.meta.dirname, '../..');
const state = {
  ctx: { uid: 'fixture-user', familyId: 'space-A', role: 'admin', isAdmin: true, canWrite: true, loading: false, aiConsent: false, spaces: [{ id: 'space-A', type: 'business', role: 'admin', name: 'Example workshop' }] },
  items: [{ id: 'draft-one', spaceId: 'space-A', createdBy: 'fixture-user', status: 'pending', source: { sourceName: 'Receipt email', sourceText: 'Synthetic purchase text' }, analysis: { status: 'ready' }, revision: 1, proposal: { kind: 'asset', asset: { name: 'Office television', category: 'Electronics', model: 'Fixture model', purchasePrice: '150', currency: 'GBP', warranties: [{ id: 'cover-one', kind: 'retailer', provider: 'Example retailer', startDate: '2026-10-01', endDate: '2027-10-01' }] } } }],
  docs: [{ id: 'original-one', name: 'Original receipt.pdf', fileType: 'application/pdf', fileName: 'Original receipt.pdf', storagePath: 'families/space-A/vault/original-one/file.pdf', downloadUrl: '/api/files/content/families/space-A/vault/original-one/file.pdf' }],
  request: { id: 'request-one', clientName: 'App supplied connector name', redirectHost: 'claude.ai', scopes: ['documents:read', 'inbox:write'], expiresAt: Date.now() + 600000 },
  selectedIds: [] as string[], scopes: ['inbox:write'], connections: [{ id: 'grant-one', clientName: 'Fixture connection', documentIds: ['original-one'], scopes: ['inbox:write'] }],
};
async function load(name: string) {
  let source = readFileSync(resolve(root, `src/components/${name}.tsx`), 'utf8');
  source = source.replace('useState<ImportInboxItem[]>([])', 'useState<ImportInboxItem[]>(globalThis.__fixture.items)')
    .replace('useState<ConnectorGrant[]>([])', 'useState<ConnectorGrant[]>(globalThis.__fixture.connections)')
    .replace('useState<ConnectorRequest | null>(null)', 'useState<ConnectorRequest | null>(globalThis.__fixture.request)')
    .replace('const [scopes, setScopes] = useState<string[]>([])', 'const [scopes, setScopes] = useState<string[]>(globalThis.__fixture.scopes)')
    .replace('[documentIds, setDocumentIds] = useState<string[]>([])', '[documentIds, setDocumentIds] = useState<string[]>(globalThis.__fixture.selectedIds)')
    .replace('useState<VaultDocument[]>([])', 'useState<VaultDocument[]>(globalThis.__fixture.docs)')
    .replace('useState(true)', 'useState(false)');
  const bundle = await build({ stdin: { contents: source, resolveDir: resolve(root, 'src/components'), sourcefile: `${name}.tsx`, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
    plugins: [{ name: 'synthetic-readers', setup(api) {
      api.onResolve({ filter: /(?:\/contexts\/FamilyContext|\/lib\/firebase|\/utils\/db$|\/utils\/serviceDocUpload|^firebase\/firestore$|^\.\/ServiceDocs$)/ }, () => ({ path: 'readers', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `
        import React from 'react';
        export const useFamilyCtx = () => globalThis.__fixture.ctx;
        export const FAMILY_ID = 'space-A';
        export const auth = { get currentUser() { return { uid: globalThis.__fixture.ctx.uid, getIdToken: async () => { throw Error('No network in render tests'); } }; } }, db = {};
        export const useVaultDocs = disabled => ({ docs: disabled ? [] : globalThis.__fixture.docs, adopt: () => {} });
        export const ServiceDocChips = ({ ids, docs }) => React.createElement('div', { 'data-originals': true }, (ids || []).flatMap(id => docs.find(doc => doc.id === id)?.name || []).join(' · '));
        export const uploadServiceDocFile = () => { throw Error('No real uploads in render tests'); };
        export const doc = (...parts) => parts;
        export const getDocFromServer = () => { throw Error('No database calls in render tests'); };
      ` }));
    } }],
  });
  const context = { console, process, setTimeout, clearTimeout, require: createRequire(import.meta.url), module: { exports: {} as Record<string, any> }, exports: {} as Record<string, any>, crypto: { randomUUID }, __fixture: state };
  context.exports = context.module.exports;
  runInNewContext(bundle.outputFiles[0].text, context);
  return context.module.exports;
}
const { default: ImportInbox, ProposalFields } = await load('ImportInbox');
const { default: ConnectorCenter } = await load('ConnectorCenter');
const { default: ConnectorAuthorization } = await load('ConnectorAuthorization');
const render = (component: any, props = {}) => renderToStaticMarkup(React.createElement(component, props));
const admin = render(ImportInbox);
assert.match(admin, /Add reviewed asset/);
assert.match(admin, /Text reference only/);
assert.match(admin, /No original receipt is linked/);
assert.match(admin, /Receipt email/);
assert.match(admin, /Example retailer/);
assert.match(admin, /value="GBP"/);
assert.match(admin, /multiple=""/);
assert.match(admin, /up to 20|Up to 20/);
assert.match(admin, /open=drive/);
assert.match(admin, /open=vault/);
assert.match(admin, /<button[^>]*disabled=""[^>]*>.*?Analyze again/s, 'analysis requires AI consent');
assert.doesNotMatch(admin, /JSON|access token|API key/);
state.ctx = { ...state.ctx, role: 'member', isAdmin: false, spaces: [{ ...state.ctx.spaces[0], role: 'member' }] };
const member = render(ImportInbox);
assert.doesNotMatch(member, /Add reviewed asset|Save reviewed document/);
assert.match(member, /An administrator reviews/);
assert.match(member, /Save review/);
state.items[0].status = 'applied';
const terminal = render(ImportInbox);
// Terminal items are filtered out of the default pending view, not offered for re-apply.
assert.doesNotMatch(terminal, /Add reviewed asset|Dismiss draft|Office television/);
state.items[0].status = 'pending';
state.ctx = { ...state.ctx, role: 'child', canWrite: false, spaces: [{ ...state.ctx.spaces[0], role: 'child' }] };
assert.doesNotMatch(render(ImportInbox), /Office television|Choose originals|Upload originals|Save review/);
assert.doesNotMatch(render(ConnectorCenter), /Fixture connection|>Revoke</);
state.ctx = { ...state.ctx, role: 'member', canWrite: true, spaces: [{ ...state.ctx.spaces[0], role: 'member' }] };
const consent = render(ConnectorAuthorization, { requestId: 'request-one', onClose: () => {} });
assert.match(consent, /Only a business administrator can grant document access/);
assert.match(consent, /name is supplied by the connecting app/);
assert.match(consent, /checkbox[^>]*disabled=""/);
assert.doesNotMatch(consent, /Original receipt\.pdf/, 'employee consent must not expose business document choices');
assert.match(consent, /An administrator must review/);
state.ctx.spaces[0].role = 'admin';
assert.doesNotMatch(render(ConnectorAuthorization, { requestId: 'request-one', onClose: () => {} }), /Original receipt\.pdf/, 'current authoritative member role overrides a stale cached admin space role');
state.ctx.spaces[0].role = 'member';
assert.match(consent, />Deny</);
assert.match(consent, /Approve selected access/);
state.ctx = { ...state.ctx, role: 'admin', isAdmin: true, spaces: [{ ...state.ctx.spaces[0], role: 'admin' }] };
state.scopes = ['documents:read', 'inbox:write'];
const ownerConsent = render(ConnectorAuthorization, { requestId: 'request-one', onClose: () => {} });
assert.match(ownerConsent, /Original receipt\.pdf/);
assert.match(ownerConsent, /new uploads will not be added automatically/);
assert.match(ownerConsent, /No access to another space is granted/);
const originalDocs = state.docs;
state.docs = Array.from({ length: 51 }, (_, index) => ({ ...originalDocs[0], id: `proof-${index}`, name: `Proof ${index + 1}` }));
state.selectedIds = state.docs.slice(0, 50).map(document => document.id);
const fifty = render(ConnectorAuthorization, { requestId: 'request-one', onClose: () => {} });
assert.match(fifty, /up to 50/);
const labels = fifty.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) || [];
assert.match(labels.find(label => label.includes('Proof 51')) || '', /disabled=""/, 'the 51st document cannot be added');
assert.doesNotMatch(labels.find(label => label.includes('Proof 1<')) || '', /disabled=""/, 'checked documents stay available to deselect');
state.docs = originalDocs; state.selectedIds = [];
state.request.expiresAt = Date.now() - 1000;
assert.match(render(ConnectorAuthorization, { requestId: 'request-one', onClose: () => {} }), /This request expired/);
const setup = render(ConnectorCenter);
assert.match(setup, /https:\/\/teluva-x3k4bua7pq-nw\.a\.run\.app\/mcp/);
assert.match(setup, /No API key or pasted token is needed/);
assert.match(setup, /Official setup guide/);
assert.match(setup, /Fixture connection/);
assert.match(setup, /Name supplied by the connecting app/);
assert.doesNotMatch(setup, /app-directory|published connector|access_token/);
const document = render(ProposalFields, { proposal: { kind: 'document', document: { name: 'Invoice', category: 'Financial', docDate: '2026-10-01' } }, onChange: () => {} });
assert.match(document, /Date on document/);
assert.doesNotMatch(document, /Warranty|Serial/);
console.log('connectorUi.test.ts: actual JSX renders enforce child/member/admin gates, explicit consent and evidence copy');
