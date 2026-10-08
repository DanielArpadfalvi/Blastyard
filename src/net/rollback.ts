/**
 * Rollback netcode (online private lobbies, PLAN §3.2): every phone runs the same deterministic
 * simulation; only the input bytes travel. The local player's input is scheduled `delay` ticks
 * ahead; remote inputs that have not arrived yet are predicted (the seat's last known byte). When
 * a remote input arrives and differs from the prediction used, the state is restored from the
 * snapshot of that tick and re-simulated up to the present – within `maxRollback` ticks. If a
 * remote player falls further behind, the simulation waits (a short stall instead of a desync).
 *
 * Pure: no DOM, no timers, no transport – the session feeds it local bytes once per tick and
 * remote packets whenever they arrive. Bots and monsters run inside `step`, so they need no input.
 */

import {
  MAX_SEATS,
  STATE_BYTES,
  restore,
  snapshotInto,
  stateHash,
  step,
  type SimEvent,
  type SimState,
} from '../core';

/** Ticks of input history kept (must exceed delay + maxRollback + the redundancy window). */
const RING = 256;
const mod = (t: number): number => ((t % RING) + RING) % RING;

export interface RollbackOptions {
  /** The seat this device controls. */
  readonly localSeat: number;
  /** Seats driven by other devices (humans on remote phones). */
  readonly remoteSeats: readonly number[];
  /** Local input delay in ticks (default 3 ≈ 50 ms). */
  readonly delay?: number;
  /** Furthest the simulation may run ahead of the slowest remote seat (default 10). */
  readonly maxRollback?: number;
  /** Local input bytes repeated in every packet (packet-loss cover, default 12). */
  readonly redundancy?: number;
  /** A state hash is taken every this many ticks for desync detection (default 120). */
  readonly hashEvery?: number;
}

/**
 * One input packet: `bytes[i]` is the seat's input for tick `from + i`; `acks[s]` is the highest
 * tick of seat `s` the sender has received in full (so the other side knows what to resend).
 */
export interface InputPacket {
  readonly seat: number;
  readonly from: number;
  readonly bytes: readonly number[];
  readonly acks?: readonly number[];
}

/** Most bytes one packet carries (a long outage is caught up over several packets). */
export const MAX_PACKET_BYTES = 64;

export interface TickResult {
  /** False when the simulation waited for a remote player this tick. */
  readonly stepped: boolean;
  /** Events of the newly simulated tick (re-simulated ticks do not repeat theirs). */
  readonly events: readonly SimEvent[];
  /** Ticks re-simulated because a prediction was wrong (0 = none). */
  readonly rolledBack: number;
}

export class Rollback {
  readonly localSeat: number;
  readonly remoteSeats: readonly number[];
  readonly delay: number;
  readonly maxRollback: number;
  readonly redundancy: number;
  readonly hashEvery: number;
  /** Ticks simulated so far (the next tick to simulate). */
  private frame = 0;
  /** Input bytes per seat per tick (ring), and whether they are real (not predicted). */
  private readonly bytes: Uint8Array[];
  private readonly known: Uint8Array[];
  /** What the simulation actually used per seat per tick (to detect wrong predictions). */
  private readonly used: Uint8Array[];
  /** Highest tick up to which every input of the seat is known (contiguous), −1 = none. */
  private readonly confirmed: number[];
  /** Ticks from which input is fixed to 0 (a dropped player), per seat. */
  private readonly droppedAt: number[];
  private readonly snaps: Uint8Array[];
  private readonly snapTick: Int32Array;
  private rollbackFrom = Infinity;
  private readonly hashes = new Map<number, number>();
  private readonly inputs = new Uint8Array(MAX_SEATS);
  /** Local input scheduled so far (the last tick with a local byte). */
  private localUpTo: number;
  /** Per remote seat: the highest of our ticks it has confirmed receiving. */
  private readonly acked: number[];

  constructor(
    private readonly state: SimState,
    options: RollbackOptions,
  ) {
    this.localSeat = options.localSeat;
    this.remoteSeats = options.remoteSeats.filter((s) => s !== options.localSeat);
    this.delay = Math.max(0, options.delay ?? 3);
    this.maxRollback = Math.max(1, options.maxRollback ?? 10);
    this.redundancy = Math.max(1, options.redundancy ?? 12);
    this.hashEvery = Math.max(1, options.hashEvery ?? 120);
    this.bytes = Array.from({ length: MAX_SEATS }, () => new Uint8Array(RING));
    this.known = Array.from({ length: MAX_SEATS }, () => new Uint8Array(RING));
    this.used = Array.from({ length: MAX_SEATS }, () => new Uint8Array(RING));
    this.confirmed = Array.from({ length: MAX_SEATS }, () => -1);
    this.droppedAt = Array.from({ length: MAX_SEATS }, () => Infinity);
    // Room for corrections older than the normal window (a dropped player, agreed by the host).
    const slots = this.maxRollback * 3 + 2;
    this.snaps = Array.from({ length: slots }, () => new Uint8Array(STATE_BYTES));
    this.snapTick = new Int32Array(slots).fill(-1);
    // The first `delay` ticks have no local input yet: they are empty for everyone.
    this.localUpTo = this.delay - 1;
    this.acked = Array.from({ length: MAX_SEATS }, () => this.delay - 1);
    for (let t = 0; t < this.delay; t++) this.setKnown(this.localSeat, t, 0);
    this.confirmed[this.localSeat] = this.delay - 1;
    for (const s of this.remoteSeats) {
      for (let t = 0; t < this.delay; t++) this.setKnown(s, t, 0);
      this.confirmed[s] = this.delay - 1;
    }
  }

  /** The tick the next local input byte is scheduled for. */
  get nextLocalTick(): number {
    return this.localUpTo + 1;
  }

  /** The next tick to simulate (= ticks simulated so far). */
  get tick(): number {
    return this.frame;
  }

  /** The highest tick whose inputs are known for every seat. */
  get confirmedTick(): number {
    let min = this.confirmed[this.localSeat] as number;
    for (const s of this.remoteSeats) min = Math.min(min, this.effectiveConfirmed(s));
    return min;
  }

  private effectiveConfirmed(seat: number): number {
    const dropped = this.droppedAt[seat] as number;
    return dropped !== Infinity ? Number.MAX_SAFE_INTEGER : (this.confirmed[seat] as number);
  }

  private setKnown(seat: number, t: number, byte: number): void {
    const i = mod(t);
    (this.bytes[seat] as Uint8Array)[i] = byte;
    (this.known[seat] as Uint8Array)[i] = 1;
  }

  private isKnown(seat: number, t: number): boolean {
    return (this.known[seat] as Uint8Array)[mod(t)] === 1;
  }

  /** The byte a seat plays at tick `t`: real when known, else the last known one (prediction). */
  private inputFor(seat: number, t: number): number {
    if (t >= (this.droppedAt[seat] as number)) return 0;
    if (this.isKnown(seat, t) && t <= (this.confirmed[seat] as number) + RING / 2) {
      return (this.bytes[seat] as Uint8Array)[mod(t)] as number;
    }
    const c = this.confirmed[seat] as number;
    return c >= 0 ? ((this.bytes[seat] as Uint8Array)[mod(c)] as number) : 0;
  }

  /**
   * Remote input arrived. Bytes for ticks already simulated with a different prediction mark a
   * rollback; duplicates (redundant packets) are ignored.
   */
  receive(packet: InputPacket): void {
    const seat = packet.seat;
    if (!this.remoteSeats.includes(seat)) return;
    const ack = packet.acks?.[this.localSeat];
    if (typeof ack === 'number' && ack > (this.acked[seat] as number)) this.acked[seat] = ack;
    for (let i = 0; i < packet.bytes.length; i++) {
      const t = packet.from + i;
      if (t <= (this.confirmed[seat] as number) || t >= this.frame + RING / 2) continue;
      if (t < this.frame - RING / 2) continue;
      const byte = (packet.bytes[i] as number) & 0xff;
      this.setKnown(seat, t, byte);
    }
    // Advance the contiguous confirmation and check the newly confirmed ticks.
    let c = this.confirmed[seat] as number;
    while (this.isKnown(seat, c + 1) && c + 1 < this.frame + RING / 2) {
      c++;
      if (c < this.frame && (this.used[seat] as Uint8Array)[mod(c)] !== this.inputFor(seat, c)) {
        this.rollbackFrom = Math.min(this.rollbackFrom, c);
      }
    }
    this.confirmed[seat] = c;
  }

  /**
   * A player left: from tick `atTick` on (agreed by the host) the seat plays no input. Ticks
   * already simulated past it are corrected by a rollback.
   */
  drop(seat: number, atTick: number): void {
    if (!this.remoteSeats.includes(seat)) return;
    this.droppedAt[seat] = Math.max(0, atTick);
    if (atTick < this.frame) this.rollbackFrom = Math.min(this.rollbackFrom, atTick);
  }

  /** Whether the simulation may advance now (no remote seat too far behind). */
  canAdvance(): boolean {
    for (const s of this.remoteSeats) {
      if (this.frame - this.effectiveConfirmed(s) > this.maxRollback) return false;
    }
    return true;
  }

  /**
   * One real-time tick: schedules the local input `delay` ticks ahead and, unless a remote player
   * is too far behind, simulates the next tick (re-simulating mispredicted ticks first).
   * `beforeStep` runs right before the new tick is simulated (render interpolation history).
   */
  advance(localByte: number, beforeStep?: () => void): TickResult {
    // Schedule the local input (only once per real tick, also while stalled).
    if (this.localUpTo < this.frame + this.delay) {
      this.localUpTo++;
      this.setKnown(this.localSeat, this.localUpTo, localByte & 0xff);
      this.confirmed[this.localSeat] = this.localUpTo;
    }
    const rolledBack = this.resimulate();
    if (!this.canAdvance()) return { stepped: false, events: [], rolledBack };
    beforeStep?.();
    const events = this.simulate(this.frame);
    this.frame++;
    return { stepped: true, events, rolledBack };
  }

  /** Restores the oldest mispredicted tick and re-simulates up to the present. */
  private resimulate(): number {
    if (this.rollbackFrom === Infinity) return 0;
    const from = Math.max(this.rollbackFrom, this.frame - this.snaps.length + 1);
    this.rollbackFrom = Infinity;
    const slot = this.slotOf(from);
    if (slot < 0) throw new Error(`rollback: no snapshot for tick ${from}`);
    restore(this.state, this.snaps[slot] as Uint8Array);
    const to = this.frame;
    for (let t = from; t < to; t++) this.simulate(t);
    return to - from;
  }

  private slotOf(t: number): number {
    const slot = t % this.snaps.length;
    return this.snapTick[slot] === t ? slot : -1;
  }

  /** Snapshot, gather inputs, step tick `t`; returns its events. */
  private simulate(t: number): readonly SimEvent[] {
    const slot = t % this.snaps.length;
    snapshotInto(this.state, this.snaps[slot] as Uint8Array);
    this.snapTick[slot] = t;
    this.inputs.fill(0);
    const seats = [this.localSeat, ...this.remoteSeats];
    for (const s of seats) {
      const byte = this.inputFor(s, t);
      this.inputs[s] = byte;
      (this.used[s] as Uint8Array)[mod(t)] = byte;
    }
    const events = step(this.state, this.inputs);
    if ((t + 1) % this.hashEvery === 0) this.hashes.set(t + 1, stateHash(this.state));
    return events;
  }

  /**
   * The packet to send now: every local byte some remote seat has not acknowledged yet (at least
   * the latest `redundancy`), plus our acknowledgements of their inputs.
   */
  outgoing(): InputPacket {
    let oldest = this.localUpTo - this.redundancy + 1;
    for (const s of this.remoteSeats) {
      if ((this.droppedAt[s] as number) === Infinity) {
        oldest = Math.min(oldest, (this.acked[s] as number) + 1);
      }
    }
    const from = Math.max(0, oldest, this.localUpTo - MAX_PACKET_BYTES + 1);
    const bytes: number[] = [];
    for (let t = from; t <= this.localUpTo; t++) {
      bytes.push((this.bytes[this.localSeat] as Uint8Array)[mod(t)] as number);
    }
    return { seat: this.localSeat, from, bytes, acks: [...this.confirmed] };
  }

  /**
   * State hashes of ticks every input of which is final (safe to compare between devices):
   * `[tick, hash]` pairs, oldest first; each is reported once.
   */
  finalHashes(): Array<[number, number]> {
    const done = Math.min(this.confirmedTick, this.frame - 1);
    const out: Array<[number, number]> = [];
    for (const [tick, hash] of [...this.hashes].sort((a, b) => a[0] - b[0])) {
      if (tick - 1 > done) break;
      out.push([tick, hash]);
      this.hashes.delete(tick);
    }
    return out;
  }
}
