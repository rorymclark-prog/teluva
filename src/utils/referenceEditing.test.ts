import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { persistReferenceEdit } from './referenceEditing';
import { demoProfileMembers, DEMO_BUSINESS_MEMBERS, DEMO_MEMBERS } from './demoData';
import { actionPeople } from './actions';

const applied: unknown[] = [], writes: unknown[] = [], cloudResults: boolean[] = [];
let allowed = false;
const options = {
  canEdit: () => allowed, demo: false,
  apply: (value: unknown) => { applied.push(value); },
  save: async (value: unknown) => { writes.push(value); return true; },
  onCloudResult: (saved: boolean) => { cloudResults.push(saved); },
};
assert.equal(await persistReferenceEdit({ address: 'Viewer edit' }, options), false);
assert.deepEqual([applied, writes, cloudResults], [[], [], []], 'denied edits cannot even change optimistic local state');
allowed = true;
assert.equal(await persistReferenceEdit({ address: 'Allowed edit' }, options), true);
assert.deepEqual(writes, [{ address: 'Allowed edit' }]);
const heldCallback = () => persistReferenceEdit({ address: 'Stale edit' }, options);
allowed = false;
assert.equal(await heldCallback(), false, 'a pre-downgrade callback rereads the current capability');
assert.equal(applied.length, 1);
assert.equal(writes.length, 1);
allowed = true;
assert.equal(await persistReferenceEdit({ address: 'Demo edit' }, { ...options, demo: true }), true);
assert.equal(applied.length, 2);
assert.equal(writes.length, 1, 'a writable demo stays local and never touches a real account/cache');
assert.equal(cloudResults.length, 1, 'a demo cannot claim a cloud write');

const employee = demoProfileMembers('business', false);
assert.deepEqual(employee.map(person => person.id), ['demo-biz-manager']);
assert.equal(demoProfileMembers('business', true), DEMO_BUSINESS_MEMBERS);
assert.equal(demoProfileMembers('family', false), DEMO_MEMBERS);
const directory = actionPeople(employee, DEMO_BUSINESS_MEMBERS);
assert.equal(directory.length, 5);
assert.ok(directory.every(person => Object.keys(person).sort().join(',') === 'id,name'), 'the preview directory cannot carry colleague HR fields');
assert.equal(employee.length, 1, 'building the public roster cannot widen confidential profiles');

// Render the actual section JSX. Only the external data/file boundaries are
// replaced; none of the controls or capability branches are mocked. Adding
// exports in the in-memory bundle avoids creating production-only test APIs.
const root = resolve(import.meta.dirname, '../..');
async function sections(file: string, names: string[]) {
  // Hydration is synthetic and already complete; effects never run during
  // this render. Every capability branch and form field is the source JSX.
  const source = readFileSync(resolve(root, 'src/components', file), 'utf8')
    .replace('const [loaded, setLoaded] = useState(false);', 'const [loaded, setLoaded] = useState(true);');
  const result = await build({
    stdin: { contents: source + `\nexport { ${names.join(',')} };`, loader: 'tsx', resolveDir: resolve(root, 'src/components'), sourcefile: file },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    plugins: [{ name: 'synthetic-reference-data', setup(api) {
      api.onResolve({ filter: /(?:\/utils\/db|\/lib\/firebase|\/hooks\/useSharedDoc|^\.\/ServiceDocs)$/ }, () => ({ path: 'reference-data', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        import React from 'react';
        export const loadHousehold = async () => null, saveHousehold = async () => true,
          loadFamilyInfo = async () => null, saveFamilyInfo = async () => true,
          loadAssets = async () => [], loadSpaceInfo = async () => null;
        export const auth = { currentUser: null }, useSharedDoc = () => false;
        export const useVaultDocs = () => ({ docs: [], adopt: () => {} });
        export const AttachServiceDoc = () => null;
        export const ServiceDocChips = () => React.createElement('a', { href: '#receipt' }, 'Read receipt');
      `, resolveDir: root }));
    } }],
  });
  const module = { exports: {} as Record<string, React.ComponentType<any>> };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), console, process, setTimeout, clearTimeout });
  return module.exports;
}
const household = await sections('HouseholdView.tsx', ['LocationsSection', 'UtilitiesSection', 'UtilityCard', 'HomeServiceSection']);
const info = await sections('ImportantInfo.tsx', ['NumbersSection', 'ContactsSection', 'ProvidersSection', 'VendorsSection', 'MilestoneSection']);
const noop = () => {};
const mutationButtons = (html: string) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
  .map(match => match[1].replace(/<[^>]+>/g, '').trim())
  .filter(text => /^(?:Add|Log work|Save|Write a note|Write a new one)$/.test(text));
const shared = { isBusinessSpace: true, country: 'AT', onAdd: noop, onUpdate: noop, onDelete: noop };
const cases: [React.ComponentType<any>, Record<string, unknown>, string][] = [
  [household.LocationsSection, { ...shared, entries: [{ id: 'location', label: 'North branch', address: 'Synthetic Street' }] }, 'North branch'],
  [household.UtilitiesSection, { ...shared, entries: [{ id: 'power', type: 'Electricity', provider: 'Synthetic Power' }] }, 'Synthetic Power'],
  [household.HomeServiceSection, { ...shared, entries: Array.from({ length: 7 }, (_, i) => ({ id: `job-${i}`, date: '2026-01-01', work: 'Boiler serviced' })), vendors: [], assets: [], docs: [], onAdoptDoc: noop, demo: true }, 'Boiler serviced'],
  [info.NumbersSection, { ...shared, entries: [{ id: 'vat', label: 'VAT reference', value: 'SYNTHETIC' }] }, 'VAT reference'],
  [info.ContactsSection, { ...shared, entries: [{ id: 'contact', name: 'Synthetic Office', phone: '+430000' }] }, 'Synthetic Office'],
  [info.ProvidersSection, { ...shared, entries: [{ id: 'adviser', name: 'Synthetic Adviser', type: 'Accountant' }] }, 'Synthetic Adviser'],
  [info.VendorsSection, { ...shared, entries: [{ id: 'vendor', name: 'Synthetic Plumber', trade: 'Plumber' }] }, 'Synthetic Plumber'],
];
for (const [Component, props, visible] of cases) {
  const readonly = renderToStaticMarkup(React.createElement(Component, { ...props, canEdit: false }));
  assert.ok(readonly.includes(visible), 'a viewer retains the record contents');
  assert.doesNotMatch(readonly, /title="(?:Edit|Delete)"|aria-label="Delete |>(?:Add|Log work)<\/button>/, 'viewer mutation controls must be absent');
  assert.deepEqual(mutationButtons(readonly), [], 'read-only screens do not offer Add, Save or generation actions');
  const editable = renderToStaticMarkup(React.createElement(Component, { ...props, canEdit: true }));
  assert.match(editable, /title="Edit"/, 'the same records remain editable for authorized adults');
}
const utility = renderToStaticMarkup(React.createElement(household.UtilityCard, {
  canEdit: false, country: 'AT', open: true, onToggle: noop, onEdit: noop, onDelete: noop, onAddReading: noop,
  utility: { id: 'power', type: 'Electricity', provider: 'Synthetic Power', faultPhone: '+430000', readings: [{ id: 'reading', date: '2026-01-01', value: '123', unit: 'kWh' }] },
}));
assert.match(utility, /aria-expanded="true"/, 'read-only utility details can still expand');
assert.match(utility, /href="tel:/, 'fault calls remain available');
assert.match(utility, /123/);
assert.doesNotMatch(utility, /title="(?:Edit|Delete)"|> Add<\/button>/);
assert.deepEqual(mutationButtons(utility), []);
const readOnlyPremises = renderToStaticMarkup(React.createElement(household.default, { canEdit: false, isBusinessSpace: true, demo: true }));
assert.equal((readOnlyPremises.match(/readOnly=""/gi) || []).length, 5, 'the premises fields stay selectable but cannot be edited');
assert.deepEqual(mutationButtons(readOnlyPremises), []);
const milestone = renderToStaticMarkup(React.createElement(info.MilestoneSection, {
  canEdit: false, spaceInfo: { name: 'Synthetic Business', foundingDate: '2020-01-01' }, noteLoading: false, noteError: null, onGenerateNote: noop,
}));
assert.doesNotMatch(milestone, /<button/, 'a viewer cannot generate and persist a business milestone note');
console.log('referenceEditing.test.ts: viewer controls, live capability guards, local demo edits and private employee preview passed');
