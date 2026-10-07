/**
 * The 36 built-in challenge levels (T5.2, PLAN §1.7): three worlds of twelve. World 1 (*Backyard*)
 * is free; worlds 2 (*Scrapyard*) and 3 (*Rooftop*) belong to Blastyard+. The twelfth level of
 * every world is a gauntlet: three stages in a row against ever tougher bots.
 *
 * Only the authored part lives here. Seeds, star thresholds and the reference solutions are
 * produced by `scripts/solve-challenges.ts` (a bot plays the level through the real simulation)
 * into `tuning.ts` / `solutions.ts`, and `scripts/validate-content.ts` replays every solution in
 * `npm run check`.
 */

import { BotLevel, Ability, Monster, type MonsterSpawn } from '../../core';
import type { LevelDef, Objective, StageDef, StarKind } from '../../game/challenge';
import {
  ARENA_BASTIONS,
  ARENA_COURTYARD,
  ARENA_CROSSROADS,
  ARENA_FACTORY,
  ARENA_GARDEN,
  ARENA_MAZE,
  ARENA_MEADOW,
  ARENA_MIXED,
  ARENA_RINK,
  ARENA_RUBBLE,
  ARENA_TELEPORT_GARDEN,
  ARENA_TRAMPOLINE,
  ARENA_TUNNEL,
  variant,
} from './arenas';

export const WORLD_COUNT = 3;
export const LEVELS_PER_WORLD = 12;

const snail = (x: number, y: number): MonsterSpawn => ({ kind: Monster.SNAIL, x, y });
const hound = (x: number, y: number): MonsterSpawn => ({ kind: Monster.HOUND, x, y });
const hopper = (x: number, y: number): MonsterSpawn => ({ kind: Monster.HOPPER, x, y });

const crates = (seconds: number): Objective => ({ type: 'crates', seconds });
const monsters = (seconds: number): Objective => ({ type: 'monsters', seconds });
const flag = (seconds: number): Objective => ({ type: 'flag', seconds });
const survive = (seconds: number): Objective => ({ type: 'survive', seconds });
const win: Objective = { type: 'win' };
const collect = (count: number, seconds: number): Objective => ({
  type: 'collect',
  count,
  seconds,
});

const E = BotLevel.EASY;
const N = BotLevel.NORMAL;
const H = BotLevel.HARD;
const X = BotLevel.EXPERT;

/** A duel round that must end: 75 s, then the closing spiral. */
const DUEL = { roundSeconds: 75, suddenDeath: 'spiral' } as const;
/** No power-ups anywhere, one pop at a time: the restricted win. */
const BARE = { ...DUEL, startBombs: 1, powerupChance: 0 } as const;
/** Plenty of power-ups for the collecting levels. */
const RICH = { powerupChance: 70 } as const;

function level(
  world: number,
  index: number,
  stages: readonly StageDef[],
  stars: readonly [StarKind, StarKind],
): LevelDef {
  const nn = String(index).padStart(2, '0');
  return {
    id: `w${world}-${nn}`,
    world,
    index,
    nameKey: `chName_w${world}_${nn}`,
    stages,
    stars,
  };
}

const TIME_BOMBS = ['time', 'bombs'] as const;

/** World 1 – Backyard (free arenas). */
const WORLD_1: readonly LevelDef[] = [
  level(
    1,
    1,
    [{ arena: variant(ARENA_GARDEN, 'w1-garden-sparse', 40), objective: crates(120) }],
    TIME_BOMBS,
  ),
  level(
    1,
    2,
    [{ arena: variant(ARENA_CROSSROADS, 'w1-crossroads', 60), objective: crates(100) }],
    TIME_BOMBS,
  ),
  level(1, 3, [{ arena: ARENA_COURTYARD, rules: RICH, objective: collect(3, 90) }], TIME_BOMBS),
  level(
    1,
    4,
    [{ arena: ARENA_MEADOW, monsters: [snail(11, 11), snail(9, 5)], objective: monsters(90) }],
    TIME_BOMBS,
  ),
  level(
    1,
    5,
    [
      {
        arena: variant(ARENA_GARDEN, 'w1-garden-dash', 55),
        flag: { x: 11, y: 11 },
        objective: flag(75),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    1,
    6,
    [{ arena: ARENA_CROSSROADS, bots: [E], objective: survive(40) }],
    ['bombs', 'pickups'],
  ),
  level(
    1,
    7,
    [
      {
        arena: variant(ARENA_GARDEN, 'w1-garden-snail', 50),
        monsters: [snail(11, 11)],
        objective: crates(100),
      },
    ],
    TIME_BOMBS,
  ),
  level(1, 8, [{ arena: ARENA_BASTIONS, bots: [N], rules: DUEL, objective: win }], TIME_BOMBS),
  level(
    1,
    9,
    [
      {
        arena: ARENA_MEADOW,
        monsters: [hound(11, 11), snail(9, 5)],
        startAbilities: Ability.SHIELD,
        objective: monsters(100),
      },
    ],
    ['time', 'noDamage'],
  ),
  level(
    1,
    10,
    [
      {
        arena: ARENA_COURTYARD,
        monsters: [snail(5, 5), snail(7, 7)],
        flag: { x: 6, y: 6 },
        objective: flag(100),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    1,
    11,
    [
      {
        arena: variant(ARENA_GARDEN, 'w1-garden-hop', 45),
        monsters: [hopper(11, 11), hopper(11, 1), snail(1, 11)],
        objective: monsters(110),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    1,
    12,
    [
      { arena: ARENA_GARDEN, bots: [E], rules: DUEL, objective: win },
      { arena: ARENA_CROSSROADS, bots: [N], rules: DUEL, objective: win },
      { arena: ARENA_BASTIONS, bots: [N, E], rules: DUEL, objective: win },
    ],
    TIME_BOMBS,
  ),
];

/** World 2 – Scrapyard (Blastyard+). */
const WORLD_2: readonly LevelDef[] = [
  level(
    2,
    1,
    [{ arena: variant(ARENA_TUNNEL, 'w2-tunnel-crates', 55), objective: crates(120) }],
    TIME_BOMBS,
  ),
  level(
    2,
    2,
    [
      {
        arena: variant(ARENA_TUNNEL, 'w2-tunnel-dash', 50),
        flag: { x: 11, y: 11 },
        objective: flag(70),
      },
    ],
    TIME_BOMBS,
  ),
  level(2, 3, [{ arena: ARENA_RUBBLE, rules: RICH, objective: collect(5, 100) }], TIME_BOMBS),
  level(
    2,
    4,
    [
      {
        arena: variant(ARENA_RINK, 'w2-rink-snails', 35),
        monsters: [snail(11, 11), snail(1, 11), snail(11, 1)],
        objective: monsters(100),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    2,
    5,
    [
      {
        arena: variant(ARENA_FACTORY, 'w2-factory-hounds', 40),
        monsters: [hound(11, 11), hound(1, 11)],
        startAbilities: Ability.SHIELD,
        objective: monsters(110),
      },
    ],
    ['time', 'noDamage'],
  ),
  level(
    2,
    6,
    [{ arena: ARENA_TUNNEL, bots: [N, N], objective: survive(50) }],
    ['bombs', 'pickups'],
  ),
  level(
    2,
    7,
    [
      {
        arena: variant(ARENA_TRAMPOLINE, 'w2-trampoline-hop', 70),
        monsters: [hopper(11, 11), hopper(1, 11)],
        objective: crates(120),
      },
    ],
    TIME_BOMBS,
  ),
  level(2, 8, [{ arena: ARENA_RUBBLE, bots: [H], rules: BARE, objective: win }], TIME_BOMBS),
  level(
    2,
    9,
    [
      {
        arena: variant(ARENA_TELEPORT_GARDEN, 'w2-teleport-chase', 40),
        monsters: [hound(11, 11)],
        flag: { x: 11, y: 11 },
        startAbilities: Ability.SHIELD,
        objective: flag(80),
      },
    ],
    ['time', 'noDamage'],
  ),
  level(
    2,
    10,
    [
      {
        arena: variant(ARENA_FACTORY, 'w2-factory-bounty', 50),
        monsters: [snail(11, 11), snail(1, 11)],
        rules: RICH,
        objective: collect(6, 110),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    2,
    11,
    [
      {
        arena: variant(ARENA_RINK, 'w2-rink-zoo', 30),
        monsters: [hound(11, 11), hopper(11, 1), snail(1, 11)],
        objective: monsters(120),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    2,
    12,
    [
      { arena: ARENA_FACTORY, bots: [N], rules: DUEL, objective: win },
      { arena: ARENA_TUNNEL, bots: [N, N], objective: survive(40) },
      { arena: ARENA_RUBBLE, bots: [H], rules: DUEL, objective: win },
    ],
    TIME_BOMBS,
  ),
];

/** World 3 – Rooftop (Blastyard+). */
const WORLD_3: readonly LevelDef[] = [
  level(3, 1, [{ arena: ARENA_MAZE, objective: crates(140) }], TIME_BOMBS),
  level(
    3,
    2,
    [
      {
        arena: variant(ARENA_MIXED, 'w3-mixed-dash', 75),
        flag: { x: 11, y: 11 },
        objective: flag(75),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    3,
    3,
    [
      {
        arena: variant(ARENA_MAZE, 'w3-maze-hounds', 30),
        monsters: [hound(11, 11), hound(11, 1)],
        objective: monsters(100),
      },
    ],
    TIME_BOMBS,
  ),
  level(3, 4, [{ arena: ARENA_MIXED, rules: RICH, objective: collect(6, 100) }], TIME_BOMBS),
  level(
    3,
    5,
    [
      {
        arena: variant(ARENA_TRAMPOLINE, 'w3-bounce', 35),
        monsters: [snail(11, 11), hopper(1, 11), hopper(11, 1), hound(6, 9)],
        objective: monsters(130),
      },
    ],
    TIME_BOMBS,
  ),
  level(3, 6, [{ arena: ARENA_MAZE, bots: [N, H], objective: survive(60) }], ['bombs', 'pickups']),
  level(3, 7, [{ arena: ARENA_MIXED, bots: [H], rules: BARE, objective: win }], TIME_BOMBS),
  level(
    3,
    8,
    [
      {
        arena: variant(ARENA_TUNNEL, 'w3-tunnel-pack', 40),
        monsters: [hound(11, 11), hound(1, 11)],
        flag: { x: 11, y: 11 },
        startAbilities: Ability.SHIELD,
        objective: flag(80),
      },
    ],
    ['time', 'noDamage'],
  ),
  level(
    3,
    9,
    [
      {
        arena: variant(ARENA_MAZE, 'w3-maze-hops', 60),
        monsters: [hopper(11, 11), hopper(1, 11), hopper(11, 1)],
        objective: crates(140),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    3,
    10,
    [{ arena: ARENA_MIXED, bots: [N, N, N], objective: survive(60) }],
    ['bombs', 'pickups'],
  ),
  level(
    3,
    11,
    [
      {
        arena: variant(ARENA_TELEPORT_GARDEN, 'w3-teleport-zoo', 30),
        monsters: [hound(11, 11), hopper(11, 1), hopper(1, 11), snail(9, 3), snail(3, 9)],
        startAbilities: Ability.SHIELD,
        objective: monsters(130),
      },
    ],
    TIME_BOMBS,
  ),
  level(
    3,
    12,
    [
      { arena: ARENA_MAZE, bots: [H], rules: DUEL, objective: win },
      { arena: ARENA_MIXED, bots: [N, N, N], objective: survive(45) },
      { arena: ARENA_TRAMPOLINE, bots: [X], rules: DUEL, objective: win },
    ],
    TIME_BOMBS,
  ),
];

/** All 36 levels in campaign order. */
export const LEVELS: readonly LevelDef[] = [...WORLD_1, ...WORLD_2, ...WORLD_3];

export function levelById(id: string | null | undefined): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** The levels of one world (1–3) in order. */
export function worldLevels(world: number): readonly LevelDef[] {
  return LEVELS.filter((l) => l.world === world);
}

/** Is `level` the world's gauntlet (the twelfth level)? */
export function isGauntlet(level: LevelDef): boolean {
  return level.index === LEVELS_PER_WORLD;
}

/** Worlds 2 and 3 need Blastyard+. */
export function worldNeedsPlus(world: number): boolean {
  return world >= 2;
}
