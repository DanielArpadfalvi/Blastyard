/**
 * Persists the party setup (seats, rules, arena) and the Quick Match bot level, so the next
 * session starts where the table left off. JSON through the platform key-value store; every field
 * is validated, anything wrong falls back to the default (a corrupt entry never breaks the game).
 */

import { BotLevel, RULE_PRESETS, WINS_TO_MATCH_OPTIONS } from '../core';
import { SEAT_ORIENTATIONS, type SeatOrientation } from '../input/rotation';
import type { KeyValueStore } from '../platform/storage';
import {
  DEFAULT_PARTY,
  RANDOM_ARENA,
  isPlayable,
  setLayout,
  type PartyConfig,
  type PartySeat,
  type RulesChoice,
} from './party';
import { arenaById } from '../content/arenas';
import { sanitizeCustom } from './customRules';

export const PARTY_KEY = 'blastyard.party.v1';

export interface StoredParty {
  readonly config: PartyConfig;
  /** Difficulty of the bots in Quick Match (`BotLevel` 1–4). */
  readonly quickLevel: number;
}

export const DEFAULT_STORED: StoredParty = { config: DEFAULT_PARTY, quickLevel: BotLevel.NORMAL };

function level(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4
    ? value
    : fallback;
}

function seat(raw: unknown, fallback: PartySeat): PartySeat {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = o.kind === 'human' || o.kind === 'bot' || o.kind === 'off' ? o.kind : fallback.kind;
  return { kind, level: level(o.level, fallback.level) };
}

/** Validates an untrusted stored value field by field. */
export function sanitizeStored(raw: unknown): StoredParty {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = (o.config !== null && typeof o.config === 'object' ? o.config : {}) as Record<
    string,
    unknown
  >;
  const base = DEFAULT_PARTY;
  const seats = Array.isArray(c.seats)
    ? base.seats.map((fallback, i) => seat((c.seats as unknown[])[i], fallback))
    : base.seats;
  const orientations = Array.isArray(c.orientations)
    ? base.orientations.map((_, i) => {
        const v = (c.orientations as unknown[])[i];
        return SEAT_ORIENTATIONS.includes(v as SeatOrientation) ? (v as SeatOrientation) : null;
      })
    : base.orientations;
  const arena =
    typeof c.arena === 'string' && (c.arena === RANDOM_ARENA || arenaById(c.arena))
      ? c.arena
      : base.arena;
  let config: PartyConfig = {
    layout: c.layout === 'corners' ? 'corners' : 'faceoff',
    seats,
    orientations,
    preset:
      typeof c.preset === 'string' && (c.preset in RULE_PRESETS || c.preset === 'custom')
        ? (c.preset as RulesChoice)
        : base.preset,
    custom: sanitizeCustom(c.custom),
    winsToMatch: WINS_TO_MATCH_OPTIONS.includes(c.winsToMatch as number)
      ? (c.winsToMatch as number)
      : base.winsToMatch,
    teams: c.teams === true,
    arena,
  };
  // Keep face-off consistent (seats 3 and 4 cannot be human) and the table playable.
  config = setLayout(config, config.layout);
  if (!isPlayable(config)) config = base;
  return { config, quickLevel: level(o.quickLevel, BotLevel.NORMAL) };
}

export class PartyStore {
  private value: StoredParty;

  constructor(private readonly store: KeyValueStore) {
    this.value = this.load();
  }

  get(): StoredParty {
    return this.value;
  }

  set(next: StoredParty): void {
    this.value = next;
    this.store.set(PARTY_KEY, JSON.stringify(next));
  }

  private load(): StoredParty {
    const raw = this.store.get(PARTY_KEY);
    if (raw === null) return DEFAULT_STORED;
    try {
      return sanitizeStored(JSON.parse(raw));
    } catch {
      return DEFAULT_STORED;
    }
  }
}
