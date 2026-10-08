/**
 * One online match on this phone: the rollback engine (`src/net/rollback.ts`) driven by the
 * session's tick loop through a `Stepper`, input packets out every `SEND_EVERY` ticks, remote
 * packets in from the lobby room, desync detection with periodic state hashes, and dropping a
 * player who went silent (the host picks the tick, everyone applies it).
 */

import type { SimState } from '../core';
import { humanSeats, type MatchStart, type NetMessage } from '../net/lobby';
import { Rollback } from '../net/rollback';
import type { Stepper } from './matchRunner';
import type { SeatPlan } from './modes';

/** Input packets per second = 60 / SEND_EVERY (kept low for the realtime service's quotas). */
export const SEND_EVERY = 2;
/** How often the host checks for silent players (ticks). */
const SILENCE_CHECK = 30;

export interface NetMatchLink {
  readonly isHost: boolean;
  send(msg: NetMessage): void;
  onMatchMessage(fn: (msg: NetMessage) => void): () => void;
  /** Host: member ids not heard from for a while. */
  silentMembers(): string[];
}

export interface NetMatchCallbacks {
  /** The phones disagree about the game state (should never happen; the match is abandoned). */
  onDesync?(tick: number): void;
}

export class NetMatch {
  readonly rollback: Rollback;
  readonly stepper: Stepper;
  private ticks = 0;
  private readonly off: () => void;
  private readonly localHashes = new Map<number, number>();
  private readonly remoteHashes = new Map<number, number>();
  private readonly dropped = new Set<number>();
  private desynced = false;
  /** State hashes that matched another phone's (desync checks passed). */
  private matched = 0;

  constructor(
    state: SimState,
    readonly start: MatchStart,
    readonly localSeat: number,
    private readonly link: NetMatchLink,
    private readonly callbacks: NetMatchCallbacks = {},
  ) {
    this.rollback = new Rollback(state, { localSeat, remoteSeats: humanSeats(start) });
    this.stepper = (_state, inputs, capture) => this.step(inputs[localSeat] ?? 0, capture);
    this.off = link.onMatchMessage((msg) => this.receive(msg));
  }

  get isDesynced(): boolean {
    return this.desynced;
  }

  get matchedHashes(): number {
    return this.matched;
  }

  private step(local: number, capture: () => void): ReturnType<Stepper> {
    const r = this.rollback.advance(local, capture);
    this.ticks++;
    if (this.ticks % SEND_EVERY === 0) {
      this.link.send({ t: 'input', round: this.start.round, packet: this.rollback.outgoing() });
    }
    for (const [tick, hash] of this.rollback.finalHashes()) {
      this.localHashes.set(tick, hash);
      this.link.send({
        t: 'hash',
        round: this.start.round,
        from: this.start.seats[this.localSeat] ?? '',
        tick,
        hash,
      });
      this.compare(tick);
    }
    if (this.link.isHost && this.ticks % SILENCE_CHECK === 0) this.dropSilent();
    return r.stepped ? r.events : null;
  }

  /** Host: a silent player's seat plays no input from a tick everyone can still roll back to. */
  private dropSilent(): void {
    for (const id of this.link.silentMembers()) {
      const seat = this.start.seats.indexOf(id);
      if (seat < 0 || seat === this.localSeat || this.dropped.has(seat)) continue;
      const tick = this.rollback.tick;
      this.dropped.add(seat);
      this.rollback.drop(seat, tick);
      this.link.send({ t: 'drop', round: this.start.round, seat, tick });
    }
  }

  private receive(msg: NetMessage): void {
    if ('round' in msg && msg.round !== this.start.round) return;
    switch (msg.t) {
      case 'input':
        this.rollback.receive(msg.packet);
        break;
      case 'hash':
        if (msg.from === this.start.seats[this.localSeat]) return;
        this.remoteHashes.set(msg.tick * 8 + this.start.seats.indexOf(msg.from), msg.hash);
        this.compare(msg.tick);
        break;
      case 'drop':
        if (!this.dropped.has(msg.seat) && msg.seat !== this.localSeat) {
          this.dropped.add(msg.seat);
          this.rollback.drop(msg.seat, msg.tick);
        }
        break;
      case 'leave': {
        // A player left on purpose: the host drops the seat for everyone.
        if (!this.link.isHost) break;
        const seat = this.start.seats.indexOf(msg.from);
        if (seat < 0 || this.dropped.has(seat)) break;
        const tick = this.rollback.tick;
        this.dropped.add(seat);
        this.rollback.drop(seat, tick);
        this.link.send({ t: 'drop', round: this.start.round, seat, tick });
        break;
      }
      default:
        break;
    }
  }

  private compare(tick: number): void {
    const mine = this.localHashes.get(tick);
    if (mine === undefined || this.desynced) return;
    for (let seat = 0; seat < this.start.seats.length; seat++) {
      const theirs = this.remoteHashes.get(tick * 8 + seat);
      if (theirs === undefined) continue;
      // A dropped player's late hashes are not evidence of anything.
      if (this.dropped.has(seat)) continue;
      if (theirs !== mine) {
        this.desynced = true;
        this.callbacks.onDesync?.(tick);
        return;
      }
      this.matched++;
      this.remoteHashes.delete(tick * 8 + seat);
    }
  }

  dispose(): void {
    this.off();
  }
}

/** This phone's seat plan: the local player, remote players (named) and bots. */
export function onlinePlan(
  start: MatchStart,
  localSeat: number,
  names: ReadonlyMap<string, string>,
): SeatPlan[] {
  return start.seats.map((id, seat): SeatPlan => {
    if (seat === localSeat) return { seat, kind: 'human', orientation: 0 };
    if (id !== null) {
      return { seat, kind: 'bot', orientation: 0, remote: true, name: names.get(id) ?? '?' };
    }
    const bot = start.bots[seat] ?? 0;
    return bot > 0
      ? { seat, kind: 'bot', orientation: 0, botLevel: bot }
      : { seat, kind: 'off', orientation: 0 };
  });
}
