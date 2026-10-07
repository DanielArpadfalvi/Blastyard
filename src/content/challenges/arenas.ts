/**
 * Arenas made for the challenge campaign: derived variants of the twelve built-in arenas (other
 * crate density, so a monster or a flag has room) and one open playground. They are plain
 * `ArenaDef`s and pass the same validator as every other arena.
 */

import type { ArenaDef } from '../../core';
import {
  ARENA_BASTIONS,
  ARENA_COURTYARD,
  ARENA_CROSSROADS,
  ARENA_FACTORY,
  ARENA_GARDEN,
  ARENA_MAZE,
  ARENA_MIXED,
  ARENA_RINK,
  ARENA_RUBBLE,
  ARENA_TELEPORT_GARDEN,
  ARENA_TRAMPOLINE,
  ARENA_TUNNEL,
} from '../arenas';

/** A built-in arena with its own id and crate density (everything else is shared). */
export function variant(
  base: ArenaDef,
  id: string,
  crateDensity: number,
  powerupWeights?: readonly number[],
): ArenaDef {
  return {
    ...base,
    id,
    crateDensity,
    ...(powerupWeights ? { powerupWeights } : {}),
  };
}

/** Wide lanes and few pillars: room for monsters to roam and for a bomb to be dodged. */
export const ARENA_MEADOW: ArenaDef = {
  id: 'c-meadow',
  theme: 'meadow',
  size: 13,
  crateDensity: 40,
  rows: [
    '#############',
    '#1.??...??.2#',
    '#.o.o?o?o.o.#',
    '#?..?...?..?#',
    '#.o.o?o?o.o.#',
    '#?...?.?...?#',
    '#.o?o...o?o.#',
    '#?...?.?...?#',
    '#.o.o?o?o.o.#',
    '#?..?...?..?#',
    '#.o.o?o?o.o.#',
    '#3.??...??.4#',
    '#############',
  ],
};

export {
  ARENA_BASTIONS,
  ARENA_COURTYARD,
  ARENA_CROSSROADS,
  ARENA_FACTORY,
  ARENA_GARDEN,
  ARENA_MAZE,
  ARENA_MIXED,
  ARENA_RINK,
  ARENA_RUBBLE,
  ARENA_TELEPORT_GARDEN,
  ARENA_TRAMPOLINE,
  ARENA_TUNNEL,
};
