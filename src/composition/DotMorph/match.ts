/*
 * Greedy nearest-neighbor matching between two dot clouds.
 *
 * Each dot in `from` is paired to its nearest unused dot in `to`.
 * Excess dots in either cloud are returned as `extraFrom` / `extraTo`.
 *
 * Greedy is O(n*m) but plenty fast for ~600 dots and avoids the
 * complexity of full Hungarian matching. Good enough for visual morph.
 */

import type { DotPoint } from './sample';

export interface Pair {
  fromIndex: number;
  toIndex: number;
  from: DotPoint;
  to: DotPoint;
}

export interface MatchResult {
  pairs: Pair[];
  extraFromIndices: number[];
  extraToIndices: number[];
}

function dist2(a: DotPoint, b: DotPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function matchDots(from: DotPoint[], to: DotPoint[]): MatchResult {
  const usedTo = new Set<number>();
  const pairs: Pair[] = [];
  const extraFromIndices: number[] = [];

  for (let i = 0; i < from.length; i += 1) {
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < to.length; j += 1) {
      if (usedTo.has(j)) continue;
      const d = dist2(from[i], to[j]);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      usedTo.add(bestJ);
      pairs.push({ fromIndex: i, toIndex: bestJ, from: from[i], to: to[bestJ] });
    } else {
      extraFromIndices.push(i);
    }
  }

  const extraToIndices: number[] = [];
  for (let j = 0; j < to.length; j += 1) {
    if (!usedTo.has(j)) extraToIndices.push(j);
  }

  return { pairs, extraFromIndices, extraToIndices };
}
