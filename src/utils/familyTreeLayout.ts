import type { KinLink, KinRef } from '../types';
import { generations, type KinGraph, type KinPerson } from './kin';

export const TREE_NODE_WIDTH = 176;
export const TREE_NODE_HEIGHT = 78;
export const TREE_COLUMN_GAP = 42;
export const TREE_ROW_GAP = 92;
export const TREE_PADDING_X = 42;
export const TREE_PADDING_Y = 42;
export const TREE_MIN_WIDTH = 680;

export interface FamilyTreeLayoutNode {
  ref: KinRef;
  person: KinPerson;
  generation: number;
  x: number;
  y: number;
}

export interface FamilyTreeLayout {
  nodes: FamilyTreeLayoutNode[];
  byRef: Map<KinRef, FamilyTreeLayoutNode>;
  width: number;
  height: number;
  minGeneration: number;
  maxGeneration: number;
}

export interface FamilyTreeParentGroup {
  /** A child generation and its exact recorded set of parents. */
  key: string;
  parentGeneration: number;
  childGeneration: number;
  parentRefs: KinRef[];
  childRefs: KinRef[];
  links: KinLink[];
  /** False when any edge is adoptive, step or foster and must stay distinct. */
  allBirth: boolean;
}

export interface FamilyTreeConnectorSegment {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function personSort(a: KinPerson, b: KinPerson): number {
  return (a.birthYear ?? Number.MAX_SAFE_INTEGER) - (b.birthYear ?? Number.MAX_SAFE_INTEGER)
    || a.name.localeCompare(b.name)
    || a.ref.localeCompare(b.ref);
}

/** Keep partners next to one another, then order family units predictably. */
function orderedRow(graph: KinGraph, refs: KinRef[], focus: KinRef): KinRef[] {
  const rowSet = new Set(refs);
  const seen = new Set<KinRef>();
  const groups: KinRef[][] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    const group: KinRef[] = [];
    const queue = [ref];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current) || !rowSet.has(current)) continue;
      seen.add(current);
      group.push(current);
      for (const partner of graph.partners.get(current) || []) queue.push(partner);
    }
    group.sort((a, b) => personSort(graph.index.get(a)!, graph.index.get(b)!));
    groups.push(group);
  }
  groups.sort((a, b) => personSort(graph.index.get(a[0])!, graph.index.get(b[0])!));
  const selectedIndex = groups.findIndex(group => group.includes(focus));
  if (selectedIndex >= 0) {
    const [selected] = groups.splice(selectedIndex, 1);
    groups.splice(Math.floor(groups.length / 2), 0, selected);
  }
  return groups.flat();
}

/** Deterministic geometry for the connected family around the selected person. */
export function buildFamilyTreeLayout(graph: KinGraph, focus: KinRef): FamilyTreeLayout {
  const generationByRef = generations(graph, focus);
  if (!generationByRef.size) {
    return { nodes: [], byRef: new Map(), width: TREE_MIN_WIDTH, height: 0, minGeneration: 0, maxGeneration: 0 };
  }
  const levels = [...generationByRef.values()];
  const minGeneration = Math.min(...levels);
  const maxGeneration = Math.max(...levels);
  const rows = new Map<number, KinRef[]>();
  for (const [ref, generation] of generationByRef) {
    const row = rows.get(generation);
    if (row) row.push(ref); else rows.set(generation, [ref]);
  }
  const maxCount = Math.max(...[...rows.values()].map(row => row.length));
  const contentWidth = maxCount * TREE_NODE_WIDTH + Math.max(0, maxCount - 1) * TREE_COLUMN_GAP;
  const width = Math.max(TREE_MIN_WIDTH, contentWidth + TREE_PADDING_X * 2);
  const height = (maxGeneration - minGeneration + 1) * TREE_NODE_HEIGHT
    + (maxGeneration - minGeneration) * TREE_ROW_GAP
    + TREE_PADDING_Y * 2;
  const nodes: FamilyTreeLayoutNode[] = [];
  for (let generation = minGeneration; generation <= maxGeneration; generation += 1) {
    const refs = orderedRow(graph, rows.get(generation) || [], focus);
    const rowWidth = refs.length * TREE_NODE_WIDTH + Math.max(0, refs.length - 1) * TREE_COLUMN_GAP;
    const startX = (width - rowWidth) / 2;
    const y = TREE_PADDING_Y + (generation - minGeneration) * (TREE_NODE_HEIGHT + TREE_ROW_GAP);
    refs.forEach((ref, index) => {
      const person = graph.index.get(ref);
      if (person) nodes.push({ ref, person, generation, x: startX + index * (TREE_NODE_WIDTH + TREE_COLUMN_GAP), y });
    });
  }
  return { nodes, byRef: new Map(nodes.map(node => [node.ref, node])), width, height, minGeneration, maxGeneration };
}

/**
 * Family-tree connectors are grouped by the child's exact parent set.
 *
 * This distinction matters in blended families. If Rory is the biological
 * parent of Nitai and Kashi, while Rory and Maria are both Sophie's biological
 * parents, those are two family units. Drawing every parent edge on the same
 * horizontal rail visually turns all three children into children of the
 * couple even though the stored links are correct.
 */
export function buildParentConnectorGroups(
  graph: KinGraph,
  layout: FamilyTreeLayout,
): FamilyTreeParentGroup[] {
  const linksByChild = new Map<KinRef, KinLink[]>();
  for (const link of graph.links) {
    if (link.kind !== 'parent' || !layout.byRef.has(link.from) || !layout.byRef.has(link.to)) continue;
    const parentNode = layout.byRef.get(link.from)!;
    const childNode = layout.byRef.get(link.to)!;
    // Only route ordinary adjacent-generation edges into a shared family rail.
    // A malformed/imported cross-generation edge still renders separately in
    // the canvas rather than being silently bent into the wrong generation.
    if (childNode.generation !== parentNode.generation + 1) continue;
    const bucket = linksByChild.get(link.to);
    if (bucket) bucket.push(link); else linksByChild.set(link.to, [link]);
  }

  const groups = new Map<string, FamilyTreeParentGroup>();
  for (const [childRef, childLinks] of linksByChild) {
    const parentGeneration = layout.byRef.get(childLinks[0].from)!.generation;
    const childGeneration = layout.byRef.get(childRef)!.generation;
    const parentRefs = [...new Set(childLinks.map(link => link.from))].sort();
    const key = `${parentGeneration}>${childGeneration}|${parentRefs.join('|')}`;
    const existing = groups.get(key);
    if (existing) {
      existing.childRefs.push(childRef);
      existing.links.push(...childLinks);
      existing.allBirth = existing.allBirth && childLinks.every(link => !link.via || link.via === 'birth');
    } else {
      groups.set(key, {
        key,
        parentGeneration,
        childGeneration,
        parentRefs,
        childRefs: [childRef],
        links: [...childLinks],
        allBirth: childLinks.every(link => !link.via || link.via === 'birth'),
      });
    }
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      childRefs: group.childRefs.sort((a, b) => layout.byRef.get(a)!.x - layout.byRef.get(b)!.x),
    }))
    .sort((a, b) => a.parentGeneration - b.parentGeneration
      || averageX(a.childRefs, layout) - averageX(b.childRefs, layout)
      || a.key.localeCompare(b.key));
}

function averageX(refs: KinRef[], layout: FamilyTreeLayout): number {
  return refs.reduce((sum, ref) => sum + layout.byRef.get(ref)!.x, 0) / Math.max(1, refs.length);
}

/**
 * Connect every recorded birth parent to the children's rail. Only a recorded
 * partner edge lets us start a shared trunk between two cards; co-parenthood
 * alone must neither imply a partnership nor leave the parent cards floating.
 */
export function buildParentConnectorSegments(
  graph: KinGraph,
  layout: FamilyTreeLayout,
  group: FamilyTreeParentGroup,
  trackY: number,
): FamilyTreeConnectorSegment[] {
  if (!group.allBirth) return [];
  const parents = group.parentRefs.map(ref => layout.byRef.get(ref)).filter((node): node is FamilyTreeLayoutNode => !!node);
  const children = group.childRefs.map(ref => layout.byRef.get(ref)).filter((node): node is FamilyTreeLayoutNode => !!node);
  if (!parents.length || !children.length) return [];
  const partneredPair = parents.length === 2 && graph.partners.get(parents[0].ref)?.includes(parents[1].ref);
  const starts = partneredPair
    ? [{ key: 'trunk', x: (parents[0].x + parents[1].x) / 2 + TREE_NODE_WIDTH / 2, y: parents[0].y + TREE_NODE_HEIGHT / 2 }]
    : parents.map(node => ({ key: `parent:${node.ref}`, x: node.x + TREE_NODE_WIDTH / 2, y: node.y + TREE_NODE_HEIGHT }));
  const childXs = children.map(node => node.x + TREE_NODE_WIDTH / 2);
  return [
    ...starts.map(start => ({ key: start.key, from: { x: start.x, y: start.y }, to: { x: start.x, y: trackY } })),
    { key: 'rail', from: { x: Math.min(...starts.map(start => start.x), ...childXs), y: trackY }, to: { x: Math.max(...starts.map(start => start.x), ...childXs), y: trackY } },
    ...children.map(node => ({ key: `child:${node.ref}`, from: { x: node.x + TREE_NODE_WIDTH / 2, y: trackY }, to: { x: node.x + TREE_NODE_WIDTH / 2, y: node.y } })),
  ];
}

export function generationLabel(level: number): string {
  if (level === 0) return 'Their generation';
  if (level === -1) return 'Parents';
  if (level === -2) return 'Grandparents';
  if (level < -2) return `${'Great-'.repeat(Math.abs(level) - 2)}grandparents`;
  if (level === 1) return 'Children';
  if (level === 2) return 'Grandchildren';
  return `${'Great-'.repeat(level - 2)}grandchildren`;
}
