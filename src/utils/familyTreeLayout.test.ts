import assert from 'node:assert';
import type { FamilyMember, KinLink } from '../types';
import { buildKinGraph } from './kin';
import { buildFamilyTreeLayout, generationLabel, TREE_COLUMN_GAP, TREE_NODE_WIDTH } from './familyTreeLayout';

const people: FamilyMember[] = ['grandma', 'mum', 'dad', 'child', 'sibling'].map(id => ({
  id, name: id[0].toUpperCase() + id.slice(1), role: id === 'child' || id === 'sibling' ? 'Child' : 'Parent',
  avatarColor: 'bg-clay-500', clothingSizes: {}, documents: [],
}));
const ref = (id: string) => `member:${id}`;
const links: KinLink[] = [
  { id: '1', kind: 'parent', from: ref('grandma'), to: ref('mum') },
  { id: '2', kind: 'partner', from: ref('mum'), to: ref('dad'), status: 'married' },
  { id: '3', kind: 'parent', from: ref('mum'), to: ref('child') },
  { id: '4', kind: 'parent', from: ref('dad'), to: ref('child') },
  { id: '5', kind: 'parent', from: ref('mum'), to: ref('sibling') },
];
const layout = buildFamilyTreeLayout(buildKinGraph({ members: people }, links), ref('child'));
assert.equal(layout.byRef.get(ref('grandma'))?.generation, -2);
assert.equal(layout.byRef.get(ref('mum'))?.generation, -1);
assert.equal(layout.byRef.get(ref('child'))?.generation, 0);
assert.equal(Math.abs(layout.byRef.get(ref('mum'))!.x - layout.byRef.get(ref('dad'))!.x), TREE_NODE_WIDTH + TREE_COLUMN_GAP);
assert.ok(layout.width >= 680);
assert.equal(generationLabel(-2), 'Grandparents');
assert.equal(generationLabel(3), 'Great-grandchildren');
console.log('familyTreeLayout.test.ts: all assertions passed.');
