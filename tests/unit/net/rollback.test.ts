import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN } from '../../../src/content/arenas';
import { BotLevel, MAX_SEATS, createState, stateHash, step } from '../../../src/core';
import { Rollback, type InputPacket } from '../../../src/net/rollback';

/** A player's input at tick `t`: changes every 7–19 ticks, moves and pops. */
function inputOf(seat: number, t: number): number {
  const block = Math.floor(t / (7 + seat * 4));
  const h = Math.imul(block * 2654435761 + seat * 97, 0x9e3779b1) >>> 0;
  const dir = h % 5; // 0 = none, 1–4 = directions
  const pop = (h >>> 8) % 6 === 0 ? 0x10 : 0;
  return dir | pop;
}

const setup = (humans: number, bots = 0) => ({
  seed: 12345,
  arena: ARENA_GARDEN,
  seats: Array.from({ length: MAX_SEATS }, (_, s) => s < humans + bots),
  bots: Array.from({ length: MAX_SEATS }, (_, s) =>
    s >= humans && s < humans + bots ? BotLevel.NORMAL : BotLevel.NONE,
  ),
  rules: { winsToMatch: 1 },
});

/** Hashes of the offline simulation (every input known) at the ticks asked for. */
function reference(humans: number, bots: number, delay: number, ticks: readonly number[]) {
  const state = createState(setup(humans, bots));
  const inputs = new Uint8Array(MAX_SEATS);
  const out = new Map<number, number>();
  const last = Math.max(...ticks);
  for (let t = 0; t < last; t++) {
    for (let s = 0; s < humans; s++) inputs[s] = t < delay ? 0 : inputOf(s, t);
    step(state, inputs);
    if (ticks.includes(t + 1)) out.set(t + 1, stateHash(state));
  }
  return out;
}

/** Deterministic pseudo-random numbers for the network. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

interface NetOptions {
  readonly humans: number;
  readonly bots?: number;
  readonly ticks: number;
  readonly minLag: number;
  readonly maxLag: number;
  readonly loss: number;
  readonly sendEvery: number;
  readonly delay?: number;
}

/** Runs `humans` peers over a lossy, jittery network; returns every peer's final hashes. */
function simulate(o: NetOptions) {
  const delay = o.delay ?? 3;
  const seats = Array.from({ length: o.humans }, (_, s) => s);
  const peers = seats.map((seat) => {
    const state = createState(setup(o.humans, o.bots ?? 0));
    return {
      seat,
      state,
      rb: new Rollback(state, {
        localSeat: seat,
        remoteSeats: seats,
        delay,
        maxRollback: 10,
        hashEvery: 60,
      }),
      hashes: new Map<number, number>(),
      stalls: 0,
      rollbacks: 0,
    };
  });
  const random = rng(7);
  const inFlight: Array<{ at: number; to: number; packet: InputPacket }> = [];
  for (let now = 0; now < o.ticks; now++) {
    for (const p of peers) {
      const local = inputOf(p.seat, p.rb.nextLocalTick);
      const r = p.rb.advance(local);
      if (!r.stepped) p.stalls++;
      if (r.rolledBack > 0) p.rollbacks++;
      for (const [tick, hash] of p.rb.finalHashes()) p.hashes.set(tick, hash);
      if (now % o.sendEvery === 0) {
        const packet = p.rb.outgoing();
        for (const q of peers) {
          if (q === p || random() < o.loss) continue;
          const lag = o.minLag + Math.floor(random() * (o.maxLag - o.minLag + 1));
          inFlight.push({ at: now + lag, to: q.seat, packet });
        }
      }
    }
    for (let i = inFlight.length - 1; i >= 0; i--) {
      const m = inFlight[i]!;
      if (m.at > now) continue;
      peers[m.to]!.rb.receive(m.packet);
      inFlight.splice(i, 1);
    }
  }
  return { peers, delay };
}

describe('rollback netcode', () => {
  it('two phones, perfect network: identical to the offline simulation', () => {
    const { peers, delay } = simulate({
      humans: 2,
      ticks: 900,
      minLag: 0,
      maxLag: 0,
      loss: 0,
      sendEvery: 1,
    });
    const ticks = [...peers[0]!.hashes.keys()];
    expect(ticks.length).toBeGreaterThan(10);
    const ref = reference(2, 0, delay, ticks);
    for (const p of peers) for (const t of ticks) expect(p.hashes.get(t)).toBe(ref.get(t));
    expect(peers.every((p) => p.stalls === 0)).toBe(true);
  });

  it('four phones with lag, jitter, reordering and 15 % loss stay in sync', () => {
    const { peers, delay } = simulate({
      humans: 4,
      ticks: 1500,
      minLag: 2,
      maxLag: 9,
      loss: 0.15,
      sendEvery: 3,
    });
    const ticks = [...peers[0]!.hashes.keys()];
    expect(ticks.length).toBeGreaterThan(15);
    const ref = reference(4, 0, delay, ticks);
    for (const p of peers) {
      for (const t of ticks) expect(p.hashes.get(t), `seat ${p.seat} tick ${t}`).toBe(ref.get(t));
    }
    // Predictions do go wrong sometimes and get corrected.
    expect(peers.some((p) => p.rollbacks > 0)).toBe(true);
  });

  it('a bad connection (40 % loss, long lag) only stalls, never desyncs or deadlocks', () => {
    const { peers, delay } = simulate({
      humans: 3,
      ticks: 2400,
      minLag: 4,
      maxLag: 20,
      loss: 0.4,
      sendEvery: 3,
    });
    const ticks = [...peers[2]!.hashes.keys()];
    expect(Math.min(...peers.map((p) => p.rb.tick))).toBeGreaterThan(1000);
    const ref = reference(3, 0, delay, ticks);
    for (const p of peers) for (const t of ticks) expect(p.hashes.get(t)).toBe(ref.get(t));
  });

  it('two phones and two bots: the bots stay deterministic across rollbacks', () => {
    const { peers, delay } = simulate({
      humans: 2,
      bots: 2,
      ticks: 1200,
      minLag: 3,
      maxLag: 8,
      loss: 0.1,
      sendEvery: 2,
    });
    const ticks = [...peers[1]!.hashes.keys()];
    const ref = reference(2, 2, delay, ticks);
    for (const p of peers) for (const t of ticks) expect(p.hashes.get(t)).toBe(ref.get(t));
  });

  it('waits instead of running away when a remote player is silent', () => {
    const state = createState(setup(2));
    const rb = new Rollback(state, { localSeat: 0, remoteSeats: [0, 1], delay: 2, maxRollback: 5 });
    let stepped = 0;
    for (let i = 0; i < 30; i++) if (rb.advance(0).stepped) stepped++;
    // Ticks 0–1 are known (empty) for everyone, then at most 5 more may be predicted.
    expect(stepped).toBe(2 + 5);
    rb.receive({ seat: 1, from: 2, bytes: Array(20).fill(0) });
    expect(rb.advance(0).stepped).toBe(true);
  });

  it('a dropped player plays no input from the agreed tick on', () => {
    const state = createState(setup(2));
    const rb = new Rollback(state, { localSeat: 0, remoteSeats: [0, 1], delay: 2, maxRollback: 5 });
    rb.drop(1, 2);
    let stepped = 0;
    for (let i = 0; i < 50; i++) if (rb.advance(0).stepped) stepped++;
    expect(stepped).toBe(50);
  });
});
