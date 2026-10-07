import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN, ARENA_MAZE } from '../../../src/content/arenas';
import { BotLevel, Hdr, createState } from '../../../src/core';
import {
  DEFAULT_PARTY,
  RANDOM_ARENA,
  arenaUnlocked,
  cycleSeat,
  isPlayable,
  partyMatchSetup,
  pickArena,
  resolveParty,
  seatChoices,
  setArena,
  setLayout,
  setPreset,
  setTeams,
  setWins,
  turnSeat,
  type PartyConfig,
} from '../../../src/game/party';
import {
  DEFAULT_STORED,
  PARTY_KEY,
  PartyStore,
  sanitizeStored,
} from '../../../src/game/partyStore';
import { keyBindingsFor, zonesForPlan } from '../../../src/game/modes';
import { hapticsEnabled as hapticsEnabledFor } from '../../../src/game/settings';
import { memoryStore } from '../../../src/platform/storage';
import { mockEntitlements } from '../../../src/platform/entitlement';
import { solveLayout } from '../../../src/render/layout';

const human = { kind: 'human' as const, level: BotLevel.NORMAL };
const off = { kind: 'off' as const, level: BotLevel.NORMAL };
const bot = (level: number) => ({ kind: 'bot' as const, level });

function with4(config: PartyConfig, kinds: PartyConfig['seats']): PartyConfig {
  return { ...config, seats: kinds };
}

describe('party seats', () => {
  it('face-off seats 3 and 4 cannot be human; the cycle runs bots Easy..Expert then empty', () => {
    expect(seatChoices('faceoff', 2).map((c) => c.kind)).toEqual([
      'bot',
      'bot',
      'bot',
      'bot',
      'off',
    ]);
    expect(seatChoices('corners', 2)[0]!.kind).toBe('human');
    let config = DEFAULT_PARTY;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      config = cycleSeat(config, 2);
      const s = config.seats[2]!;
      seen.push(s.kind === 'bot' ? `bot${s.level}` : s.kind);
    }
    expect(seen).toEqual(['bot1', 'bot2', 'bot3', 'bot4', 'off']);
  });

  it('never removes the last human or leaves fewer than two seats', () => {
    const solo = with4(DEFAULT_PARTY, [human, bot(2), off, off]);
    expect(isPlayable(solo)).toBe(true);
    // Seat 0 is the only human: cycling it skips "bot / off" and returns to human.
    expect(cycleSeat(solo, 0).seats[0]!.kind).toBe('human');
    expect(isPlayable(with4(DEFAULT_PARTY, [human, off, off, off]))).toBe(false);
  });

  it('2v2 is only possible with four seats in play', () => {
    expect(setTeams(DEFAULT_PARTY, true).teams).toBe(false);
    const full = with4(DEFAULT_PARTY, [human, human, bot(2), bot(2)]);
    expect(setTeams(full, true).teams).toBe(true);
    // Emptying a seat drops the flag again.
    let config = setTeams(full, true);
    config = cycleSeat(config, 3); // bot -> next kind, then off after enough taps
    for (let i = 0; i < 4 && config.seats[3]!.kind !== 'off'; i++) config = cycleSeat(config, 3);
    expect(config.seats[3]!.kind).toBe('off');
    expect(config.teams).toBe(false);
  });

  it('switching layout turns face-off seats 3/4 into bots and resets orientations', () => {
    const corners = with4({ ...DEFAULT_PARTY, layout: 'corners' }, [human, human, human, human]);
    const turned = turnSeat(corners, 0);
    expect(turned.orientations[0]).toBe(270);
    const faceoff = setLayout(turned, 'faceoff');
    expect(faceoff.seats.map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot']);
    expect(faceoff.orientations.every((o) => o === null)).toBe(true);
  });

  it('presets, rounds-to-win and arena are validated', () => {
    expect(setPreset(DEFAULT_PARTY, 'chaos').preset).toBe('chaos');
    expect(setWins(DEFAULT_PARTY, 5).winsToMatch).toBe(5);
    expect(setWins(DEFAULT_PARTY, 4).winsToMatch).toBe(3);
    expect(setArena(DEFAULT_PARTY, 'maze').arena).toBe('maze');
    expect(setArena(DEFAULT_PARTY, 'nope').arena).toBe(RANDOM_ARENA);
  });
});

describe('resolved party plan', () => {
  it('a lone human in seat 0 holds the device with both thumbs (solo layout)', () => {
    const plan = resolveParty(with4(DEFAULT_PARTY, [human, bot(3), bot(3), bot(3)]));
    expect(plan.layout).toBe('solo');
    expect(plan.seats.map((s) => [s.kind, s.orientation])).toEqual([
      ['human', 0],
      ['bot', 0],
      ['bot', 0],
      ['bot', 0],
    ]);
    expect(plan.seats[1]!.botLevel).toBe(3);
  });

  it('face-off puts the players at the short sides, corners along the long sides', () => {
    const faceoff = resolveParty(DEFAULT_PARTY);
    expect(faceoff.layout).toBe('faceoff');
    expect(faceoff.seats.slice(0, 2).map((s) => s.orientation)).toEqual([90, 270]);
    const corners = resolveParty(
      with4({ ...DEFAULT_PARTY, layout: 'corners' }, [human, human, human, human]),
    );
    expect(corners.seats.map((s) => s.orientation)).toEqual([180, 180, 0, 0]);
  });

  it('a turned orientation overrides the default, 2v2 pairs the seats that share a side', () => {
    const base = with4({ ...DEFAULT_PARTY, layout: 'corners', teams: true }, [
      human,
      human,
      human,
      human,
    ]);
    const plan = resolveParty(turnSeat(base, 2));
    expect(plan.seats[2]!.orientation).toBe(90);
    expect(plan.teams).toEqual([0, 0, 1, 1]);
    const faceoff = resolveParty(
      with4({ ...DEFAULT_PARTY, teams: true }, [human, human, bot(2), bot(2)]),
    );
    expect(faceoff.teams).toEqual([0, 1, 0, 1]);
  });

  it('carries the preset rules and best-of into the match setup', () => {
    const config = setWins(setPreset(DEFAULT_PARTY, 'fast'), 5);
    const plan = resolveParty(with4(config, [human, human, bot(4), off]));
    const setup = partyMatchSetup(plan, 9, ARENA_GARDEN);
    expect(setup.seats).toEqual([true, true, true, false]);
    expect(setup.bots).toEqual([0, 0, BotLevel.EXPERT, 0]);
    const state = createState(setup);
    expect(state.hdr[Hdr.ROUND_TICKS]).toBe(90 * 60);
    expect(state.hdr[Hdr.START_BOMBS]).toBe(2);
    expect(state.hdr[Hdr.WINS_TO_MATCH]).toBe(5);
  });

  it('the lobby setup is a harmless warm-up with idle bots', () => {
    const plan = resolveParty(with4(DEFAULT_PARTY, [human, human, bot(2), off]));
    const setup = partyMatchSetup(plan, 9, { ...ARENA_GARDEN, crateDensity: 0 }, true);
    expect(setup.warmup).toBe(true);
    expect(setup.bots).toEqual([0, 0, 0, 0]);
  });

  it('plans give zones only to humans, oriented as planned', () => {
    const layout = solveLayout({ width: 1600, height: 720 });
    const plan = resolveParty(with4(DEFAULT_PARTY, [human, human, bot(2), bot(2)]));
    expect(plan.layout).toBe('faceoff');
    expect(
      zonesForPlan(plan.layout, layout, plan.seats).zones.map((z) => [z.seat, z.orientation]),
    ).toEqual([
      [0, 90],
      [1, 270],
    ]);
    const corners = resolveParty(
      with4({ ...DEFAULT_PARTY, layout: 'corners' }, [human, bot(2), human, off]),
    );
    expect(
      zonesForPlan(corners.layout, layout, corners.seats).zones.map((z) => [z.seat, z.orientation]),
    ).toEqual([
      [0, 180],
      [2, 0],
    ]);
  });

  it('keyboard sets go to the first two humans; haptics follow the number of humans', () => {
    const plan = resolveParty(
      with4({ ...DEFAULT_PARTY, layout: 'corners' }, [bot(2), human, human, off]),
    );
    expect(keyBindingsFor('party', plan.seats).map((b) => b.seat)).toEqual([1, 2]);
    const solo = resolveParty(with4(DEFAULT_PARTY, [human, bot(2), off, off]));
    expect(keyBindingsFor('party', solo.seats).map((b) => b.seat)).toEqual([0, 0]);
    expect(hapticsEnabledFor('auto', 'party', 1)).toBe(true);
    expect(hapticsEnabledFor('auto', 'party', 3)).toBe(false);
    expect(hapticsEnabledFor('auto', 'challenge')).toBe(true);
    expect(hapticsEnabledFor('off', 'challenge')).toBe(false);
  });
});

describe('arena choice and the Blastyard+ mock', () => {
  it('Plus arenas are locked without the entitlement and open with it', () => {
    const plus = mockEntitlements(false);
    expect(arenaUnlocked(ARENA_GARDEN, plus.hasPlus())).toBe(true);
    expect(arenaUnlocked(ARENA_MAZE, plus.hasPlus())).toBe(false);
    let seen: boolean | null = null;
    plus.subscribe((v) => {
      seen = v;
    });
    plus.setPlus(true);
    expect(seen).toBe(true);
    expect(arenaUnlocked(ARENA_MAZE, plus.hasPlus())).toBe(true);
  });

  it('a locked choice falls back to the free pool; random stays inside the pool', () => {
    const maze = setArena(DEFAULT_PARTY, 'maze');
    expect(pickArena(maze, true, 1).id).toBe('maze');
    expect(pickArena(maze, false, 1).id).not.toBe('maze');
    for (let seed = 0; seed < 40; seed++) {
      expect(arenaUnlocked(pickArena(DEFAULT_PARTY, false, seed), false)).toBe(true);
    }
    const ids = new Set(Array.from({ length: 60 }, (_, s) => pickArena(DEFAULT_PARTY, true, s).id));
    expect(ids.size).toBeGreaterThan(6);
  });
});

describe('party store', () => {
  it('round-trips and survives corrupt data', () => {
    const store = memoryStore();
    const parties = new PartyStore(store);
    expect(parties.get()).toEqual(DEFAULT_STORED);
    const config = setPreset(setWins(DEFAULT_PARTY, 5), 'chaos');
    parties.set({ config, quickLevel: 4 });
    expect(new PartyStore(store).get()).toEqual({ config, quickLevel: 4 });
    store.set(PARTY_KEY, '{not json');
    expect(new PartyStore(store).get()).toEqual(DEFAULT_STORED);
    expect(
      sanitizeStored({ config: { seats: 5, preset: 'nope', winsToMatch: 7, arena: 'x' } }),
    ).toEqual(DEFAULT_STORED);
    // Invalid seats (no human) fall back to the default table.
    expect(
      sanitizeStored({ config: { seats: [off, off, off, off].map((s) => ({ ...s })) } }).config,
    ).toEqual(DEFAULT_PARTY);
  });
});
