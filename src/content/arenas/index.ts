/** All twelve arenas: six free (four classic + Ice Rink + Teleport Garden) and six Blastyard+. */

import type { ArenaDef } from '../../core';
import { CLASSIC_ARENAS } from './classic';
import { MECHANIC_ARENAS } from './mechanics';

export {
  ARENA_BASTIONS,
  ARENA_COURTYARD,
  ARENA_CROSSROADS,
  ARENA_GARDEN,
  CLASSIC_ARENAS,
} from './classic';
export {
  ARENA_FACTORY,
  ARENA_MAZE,
  ARENA_MIXED,
  ARENA_RINK,
  ARENA_RUBBLE,
  ARENA_TELEPORT_GARDEN,
  ARENA_TRAMPOLINE,
  ARENA_TUNNEL,
  MECHANIC_ARENAS,
} from './mechanics';

/** Free arenas, in rotation order. */
export const FREE_ARENAS: readonly ArenaDef[] = [...CLASSIC_ARENAS, ...MECHANIC_ARENAS.slice(0, 2)];
/** Blastyard+ arenas. */
export const PLUS_ARENAS: readonly ArenaDef[] = MECHANIC_ARENAS.slice(2);
export const ALL_ARENAS: readonly ArenaDef[] = [...FREE_ARENAS, ...PLUS_ARENAS];

export function arenaById(id: string | null | undefined): ArenaDef | undefined {
  return ALL_ARENAS.find((a) => a.id === id);
}

export function isPlusArena(arena: ArenaDef): boolean {
  return PLUS_ARENAS.includes(arena);
}
