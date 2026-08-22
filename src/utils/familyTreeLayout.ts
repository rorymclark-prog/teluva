import type { KinRef } from '../types';
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

export function generationLabel(level: number): string {
  if (level === 0) return 'Their generation';
  if (level === -1) return 'Parents';
  if (level === -2) return 'Grandparents';
  if (level < -2) return `${'Great-'.repeat(Math.abs(level) - 2)}grandparents`;
  if (level === 1) return 'Children';
  if (level === 2) return 'Grandchildren';
  return `${'Great-'.repeat(level - 2)}grandchildren`;
}
