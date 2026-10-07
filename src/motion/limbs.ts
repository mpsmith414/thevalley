import type { Role } from '../recipe/schema';
import { dist } from '../util/vec';
import type { Skeleton } from '../builder/skeleton';

export type LimbKind = 'leg' | 'wing' | 'fin';
export type Limb = {
  kind: LimbKind;
  chain: number[]; // bone indices, root → tip
  side: -1 | 0 | 1; // +1 = the creature's left (+x)
  rank: number; // 0 = frontmost on its side
  length: number;
};

const CHAIN_ROLES: Record<LimbKind, Role[]> = { leg: ['leg', 'foot'], wing: ['wing'], fin: ['fin'] };

/** Find every leg, wing and fin chain, with its side and front-to-back rank. */
export function findLimbs(sk: Skeleton): Limb[] {
  const { bones } = sk;
  const limbs: Limb[] = [];
  for (const kind of ['leg', 'wing', 'fin'] as LimbKind[]) {
    const roles = CHAIN_ROLES[kind];
    const found: Limb[] = [];
    bones.forEach((b, i) => {
      if (b.role !== kind || (b.parent >= 0 && roles.includes(bones[b.parent].role))) return;
      const chain = [i];
      for (;;) {
        const last = chain[chain.length - 1];
        const next = bones.findIndex((c) => c.parent === last && roles.includes(c.role));
        if (next < 0) break;
        chain.push(next);
      }
      const x = b.start.x;
      found.push({
        kind, chain,
        side: Math.abs(x) < 1e-6 ? 0 : x > 0 ? 1 : -1,
        rank: 0,
        length: chain.reduce((s, k) => s + dist(bones[k].start, bones[k].end), 0),
      });
    });
    for (const side of [-1, 0, 1]) {
      found
        .filter((l) => l.side === side)
        .sort((a, b) => bones[b.chain[0]].start.z - bones[a.chain[0]].start.z)
        .forEach((l, r) => (l.rank = r));
    }
    limbs.push(...found);
  }
  return limbs;
}

export type ChainKind = 'tail' | 'neck' | 'spine' | 'ear' | 'antenna';

/** Bendy chains for follow-through: tails, necks (with the head), torso spines, ears and antennae. */
export function findChains(sk: Skeleton): { kind: ChainKind; chain: number[] }[] {
  const { bones } = sk;
  const out: { kind: ChainKind; chain: number[] }[] = [];
  const follow = (start: number, roles: Role[]) => {
    const chain = [start];
    for (;;) {
      const last = chain[chain.length - 1];
      const next = bones.findIndex((c) => c.parent === last && roles.includes(c.role));
      if (next < 0) break;
      chain.push(next);
    }
    return chain;
  };
  bones.forEach((b, i) => {
    const parentRole = b.parent >= 0 ? bones[b.parent].role : null;
    if (b.role === 'tail' && parentRole !== 'tail') out.push({ kind: 'tail', chain: follow(i, ['tail']) });
    if (b.role === 'neck' && parentRole !== 'neck') out.push({ kind: 'neck', chain: follow(i, ['neck', 'head']) });
    if (b.role === 'ear') out.push({ kind: 'ear', chain: follow(i, ['ear']) });
    if (b.role === 'antenna' && parentRole !== 'antenna') out.push({ kind: 'antenna', chain: follow(i, ['antenna']) });
  });
  // a torso made of several bones in a row (snakes, long bodies) bends as a spine
  const torso = follow(0, ['torso', 'head']);
  if (torso.length > 2) out.push({ kind: 'spine', chain: torso });
  return out;
}
