import assert from 'node:assert';
import type { FamilyMember, KinLink } from '../types';
import { buildKinGraph } from './kin';
import {
  buildFamilyTreeLayout, buildParentConnectorGroups, buildParentConnectorSegments, generationLabel,
  TREE_COLUMN_GAP, TREE_NODE_HEIGHT, TREE_NODE_WIDTH,
} from './familyTreeLayout';

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

// A blended family must produce two connector rails: Mum's child from an
// earlier relationship is not visually absorbed into Mum + Dad's family unit.
const blendedPeople: FamilyMember[] = ['rory', 'maria', 'nitai', 'kashi', 'sophie'].map(id => ({
  id, name: id[0].toUpperCase() + id.slice(1), role: ['nitai', 'kashi', 'sophie'].includes(id) ? 'Child' : 'Parent',
  avatarColor: 'bg-clay-500', clothingSizes: {}, documents: [],
}));
const blendedLinks: KinLink[] = [
  { id: 'partner', kind: 'partner', from: ref('rory'), to: ref('maria'), status: 'married' },
  { id: 'rn', kind: 'parent', from: ref('rory'), to: ref('nitai'), via: 'birth' },
  { id: 'rk', kind: 'parent', from: ref('rory'), to: ref('kashi'), via: 'birth' },
  { id: 'rs', kind: 'parent', from: ref('rory'), to: ref('sophie'), via: 'birth' },
  { id: 'ms', kind: 'parent', from: ref('maria'), to: ref('sophie'), via: 'birth' },
];
const blendedGraph = buildKinGraph({ members: blendedPeople }, blendedLinks);
const blendedLayout = buildFamilyTreeLayout(blendedGraph, ref('rory'));
const parentGroups = buildParentConnectorGroups(blendedGraph, blendedLayout);
assert.equal(parentGroups.length, 2, 'different biological parent sets get separate connector rails');
assert.deepEqual(
  parentGroups.map(group => ({ parents: group.parentRefs, children: group.childRefs })).sort((a, b) => a.parents.length - b.parents.length),
  [
    { parents: [ref('rory')], children: [ref('kashi'), ref('nitai')] },
    { parents: [ref('maria'), ref('rory')], children: [ref('sophie')] },
  ],
);

// Two people can be biological co-parents without a recorded partnership.
// Each card must actually meet a stem and the same child rail.
const unpartneredGraph = buildKinGraph({ members: people }, links.filter(link => link.kind !== 'partner'));
const unpartneredLayout = buildFamilyTreeLayout(unpartneredGraph, ref('child'));
const coParentGroup = buildParentConnectorGroups(unpartneredGraph, unpartneredLayout).find(group => group.childRefs.includes(ref('child')))!;
const trackY = unpartneredLayout.byRef.get(ref('child'))!.y - 24;
const segments = buildParentConnectorSegments(unpartneredGraph, unpartneredLayout, coParentGroup, trackY);
const rail = segments.find(segment => segment.key === 'rail')!;
for (const parentRef of coParentGroup.parentRefs) {
  const parent = unpartneredLayout.byRef.get(parentRef)!;
  const stem = segments.find(segment => segment.from.x === parent.x + TREE_NODE_WIDTH / 2 && segment.from.y === parent.y + TREE_NODE_HEIGHT);
  assert.ok(stem, `recorded parent ${parentRef} must have a connector touching their card`);
  assert.equal(stem!.to.y, rail.from.y, 'every parent stem reaches the shared child rail');
  assert.ok(stem!.to.x >= rail.from.x && stem!.to.x <= rail.to.x, 'the rail spans every parent stem');
}
for (const childRef of coParentGroup.childRefs) {
  const child = unpartneredLayout.byRef.get(childRef)!;
  assert.ok(segments.some(segment => segment.from.y === trackY && segment.to.x === child.x + TREE_NODE_WIDTH / 2 && segment.to.y === child.y), 'each child remains connected to the rail');
}
assert.ok(!segments.some(segment => segment.key === 'trunk'), 'co-parenthood does not invent a partner trunk');
const coupleGroup = parentGroups.find(group => group.parentRefs.length === 2)!;
assert.ok(buildParentConnectorSegments(blendedGraph, blendedLayout, coupleGroup, trackY).some(segment => segment.key === 'trunk'), 'a recorded couple keeps its shared trunk');
console.log('familyTreeLayout.test.ts: grouping, geometry and co-parent connectivity passed.');
