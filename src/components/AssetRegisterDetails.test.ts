import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssetItem, AssetWarranty } from '../types';

// Render source JSX with synthetic, already-loaded readers. Capability and
// selection branches are real; Firebase, vault viewers and effects stay local.
const root = resolve(import.meta.dirname, '../..');
const source = readFileSync(resolve(root, 'src/components/AssetRegisterDetails.tsx'), 'utf8')
  .replace('useState<PolicyOption[]>([])', 'useState<PolicyOption[]>(globalThis.__assetPolicies || [])')
  .replace("useState<'loading' | 'ready' | 'unavailable'>('loading')", "useState<'loading' | 'ready' | 'unavailable'>(globalThis.__assetPolicyStatus || 'ready')");
const bundle = await build({
  stdin: { contents: source, resolveDir: resolve(root, 'src/components'), sourcefile: 'AssetRegisterDetails.tsx', loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
  plugins: [{ name: 'synthetic-asset-readers', setup(api) {
    api.onResolve({ filter: /(?:\/contexts\/FamilyContext|\/hooks\/useSharedDoc|\/lib\/firebase|\/utils\/demoData|^firebase\/firestore$|^\.\/ServiceDocs$)/ }, () => ({ path: 'readers', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `
      import React from 'react';
      export const useFamilyCtx = () => globalThis.__assetContext;
      export const useSharedDoc = (name, apply, options) => { globalThis.__assetSubscriptions.push(options); return false; };
      export const useVaultDocs = disabled => ({ docs: disabled ? [] : globalThis.__assetDocs });
      export const ServiceDocChips = ({ ids, docs }) => React.createElement('div', { 'data-proof-chips': true }, (ids || []).map(id => docs.find(doc => doc.id === id)?.name || '').join(' · '));
      export const isDemoMode = () => !!globalThis.__assetDemo;
      export const demoSpaceType = () => globalThis.__assetContext.spaces[0]?.type || 'family';
      export const auth = { get currentUser() { return globalThis.__assetContext.uid ? { uid: globalThis.__assetContext.uid } : null; } }, db = {};
      export const doc = (...parts) => parts;
      export const getDocFromServer = () => { throw new Error('SSR must not contact a database'); };
    ` }));
  } }],
});
const context = {
  console, process, setTimeout, clearTimeout, require: createRequire(import.meta.url),
  module: { exports: {} as Record<string, any> }, exports: {} as Record<string, any>,
  __assetContext: { familyId: 'space-one', uid: 'synthetic-user', spaces: [{ id: 'space-one', type: 'business' }], isAdmin: true, canWrite: true, loading: false },
  __assetPolicies: [
    { id: 'reference', provider: 'Reference insurer', policyNumber: 'REF-1' },
    { id: 'listed', provider: 'Listed insurer', coveredAssetIds: ['asset-one'] },
    { id: 'unlinked', provider: 'Unlinked insurer', coveredAssetIds: [] },
  ],
  __assetDocs: [{ id: 'proof', name: 'Manufacturer certificate' }, { id: 'invoice', name: 'Retailer invoice' }, { id: 'unrelated', name: 'Unrelated vault file' }],
  __assetSubscriptions: [] as { disabled: boolean }[], __assetDemo: false, __assetPolicyStatus: 'ready',
};
context.exports = context.module.exports;
runInNewContext(bundle.outputFiles[0].text, context);
const { default: AssetRegisterDetails, addAssetWarranty, patchAssetWarranty } = context.module.exports;
const oldWarranty: AssetWarranty = { id: 'cover-old', kind: 'extended', provider: 'Original provider', endDate: '2027-11-01', documentIds: ['proof'], reminderDays: [60] };
const original = JSON.stringify(oldWarranty);
const added = addAssetWarranty([oldWarranty], 'cover-new') as AssetWarranty[];
assert.deepEqual(JSON.parse(JSON.stringify(added[1])), { id: 'cover-new', kind: 'manufacturer', reminderDays: [30, 7] });
assert.equal(added[0], oldWarranty);
assert.equal(added[1].startDate, undefined, 'adding cover never invents a legal start or duration');
const patched = patchAssetWarranty(added, 'cover-old', { id: 'replacement-id', provider: 'Corrected provider' }) as AssetWarranty[];
assert.equal(patched[0].id, 'cover-old');
assert.deepEqual(patched[0].documentIds, ['proof']);
assert.deepEqual(patched[0].reminderDays, [60]);
assert.equal(patched[1], added[1], 'editing one warranty cannot alter a different provider’s record');
assert.equal(JSON.stringify(oldWarranty), original, 'editing a record never mutates the saved source');

const item: AssetItem = {
  id: 'asset-one', name: 'Television', category: 'Electronics', createdAt: '2026-01-01',
  assignedMember: 'Custodian only', location: 'North office', purchaseReference: 'ORDER-23', purchaseContext: 'business',
  deliveryDate: '2026-01-02', purchaseCountry: 'Austria', retailerContact: 'Shop contact', returnByDate: '2026-01-30',
  warrantyUntil: '2028-01-01', warranties: [{ ...oldWarranty, documentIds: ['proof', 'unavailable-proof'] }, added[1]],
  documentIds: ['proof', 'invoice'], insurancePolicyIds: ['reference', 'unavailable-policy'], insuranceNotes: 'Recorded item limit',
  replacementValueCheckedAt: '2026-10-31', replacementValueSource: 'Written retailer quote',
};
const render = (edit = false, value = item) => {
  context.__assetSubscriptions.length = 0;
  return renderToStaticMarkup(React.createElement(AssetRegisterDetails, { item: value, ...(edit ? { onChange: () => {} } : {}) }));
};
const readonly = render();
assert.equal((readonly.match(/<details\b/g) || []).length, 4, 'the editor uses native keyboard-accessible collapsible sections');
assert.doesNotMatch(readonly, /<input|<select|<textarea|Add warranty|aria-label="Remove .*warranty/, 'no edit capability means no mutation controls');
assert.doesNotMatch(readonly, /Custodian only/, 'an assigned custodian must never become an inferred legal owner');
assert.match(readonly, /Legal owner/);
assert.match(readonly, /Earlier warranty date/);
assert.match(readonly, /ORDER-23/);
assert.match(readonly, /Written retailer quote/);
assert.match(readonly, /Reference insurer/);
assert.match(readonly, /Listed insurer/);
assert.doesNotMatch(readonly, /Unlinked insurer/);
assert.match(readonly, /Linked for reference/);
assert.match(readonly, /Listed on this policy/);
assert.match(readonly, /Manufacturer certificate/);
assert.match(readonly, /Linked proof document.*unavailable here/);
assert.doesNotMatch(readonly, /unavailable-proof|unavailable-policy/, 'unavailable references do not expose raw IDs');
assert.equal(context.__assetSubscriptions.at(-1)?.disabled, false);

const editable = render(true);
assert.match(editable, /Add warranty/);
assert.match(editable, /Warranty type/);
assert.match(editable, /Retailer invoice/, 'proof choices come from originals already attached to this item');
assert.doesNotMatch(editable, /Unrelated vault file/, 'a warranty cannot silently attach another vault document');
assert.match(editable, />60 days<\/label>/, 'a custom existing reminder remains editable');
const listedPolicy = (editable.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) || []).find(label => label.includes('Listed insurer')) || '';
assert.match(listedPolicy, /disabled=""/);
assert.match(listedPolicy, /checked=""/, 'policy-side coverage is honored and remains managed in Insurance');

for (const [type, isAdmin, canWrite] of [['business', false, true], ['family', false, false]] as const) {
  context.__assetContext = { ...context.__assetContext, spaces: [{ id: 'space-one', type }], isAdmin, canWrite };
  const restricted = render(true);
  assert.doesNotMatch(restricted, /Reference insurer|Listed insurer|REF-1/, 'old loaded policy data cannot survive a permission downgrade in the UI');
  assert.equal(context.__assetSubscriptions.at(-1)?.disabled, true, 'restricted accounts never subscribe to the finances document');
}
context.__assetContext = { ...context.__assetContext, spaces: [{ id: 'space-one', type: 'family' }], isAdmin: false, canWrite: true };
assert.match(render(), /Listed insurer/, 'family adults retain their authorized policy links');
context.__assetPolicyStatus = 'unavailable';
const unavailable = render(true);
assert.match(unavailable, /Policy details could not be loaded/);
assert.match(unavailable, /Existing links are kept/);
assert.doesNotMatch(unavailable, /No policies are recorded/, 'a read failure cannot claim that insurance records do not exist');

assert.ok(source.includes("getDocFromServer(doc(db, 'families', spaceId, 'reference', 'finances'))"));
assert.ok(source.includes('auth.currentUser?.uid === accountUid'));
assert.ok(source.includes("`${uid || ''}:${familyId || ''}:${props.item.id}`"), 'each account/space/item gets fresh scoped readers');
assert.equal(item.warrantyUntil, '2028-01-01');
console.log('AssetRegisterDetails.test.ts: warranty preservation, proof choices, read-only ownership, insurance boundaries and policy-side links passed');
