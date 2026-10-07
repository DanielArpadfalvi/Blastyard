/**
 * Warm-up lobby bookkeeping (T5.1, PLAN §1.3): a seat *joins* the moment its zone is touched (or
 * a key is pressed), and gets *ready* by keeping a finger resting in the zone for one second
 * without steering or bombing. Moving or bombing again takes the ready mark away (the player is
 * still testing the controls). The match starts once every human seat is ready.
 *
 * Counted in simulation ticks, so it behaves identically under a manual test clock. Pure.
 */

/** Resting hold that makes a seat ready: 1 s. */
export const READY_HOLD_TICKS = 60;
/** Everybody ready → the match starts after this short beat (ticks), so the last mark is seen. */
export const START_DELAY_TICKS = 24;

export interface LobbySeatView {
  readonly seat: number;
  readonly joined: boolean;
  readonly ready: boolean;
  /** 0–1 progress of the current ready hold. */
  readonly progress: number;
}

export class LobbyTracker {
  private readonly joined: boolean[] = [false, false, false, false];
  private readonly ready: boolean[] = [false, false, false, false];
  private readonly hold: number[] = [0, 0, 0, 0];
  private allReadyTicks = 0;

  constructor(private readonly seats: readonly number[]) {}

  /**
   * Feeds one tick of `seat`: is a finger down in its zone, and which input byte did the seat
   * produce (`0` = resting).
   */
  update(seat: number, touching: boolean, input: number): void {
    if (touching || input !== 0) this.joined[seat] = true;
    if (input !== 0) {
      this.ready[seat] = false;
      this.hold[seat] = 0;
    } else if (touching) {
      this.hold[seat] = (this.hold[seat] as number) + 1;
      if ((this.hold[seat] as number) >= READY_HOLD_TICKS) this.ready[seat] = true;
    } else {
      this.hold[seat] = 0;
    }
  }

  /** Marks every human seat ready at once (accessibility / desktop "start now"). */
  readyAll(): void {
    for (const s of this.seats) {
      this.joined[s] = true;
      this.ready[s] = true;
    }
  }

  isReady(seat: number): boolean {
    return this.ready[seat] === true;
  }

  allReady(): boolean {
    return this.seats.length > 0 && this.seats.every((s) => this.ready[s] === true);
  }

  /**
   * Call once per tick after the `update`s: counts the beat after everybody got ready and reports
   * when the match should start.
   */
  tickStart(): boolean {
    this.allReadyTicks = this.allReady() ? this.allReadyTicks + 1 : 0;
    return this.allReadyTicks >= START_DELAY_TICKS;
  }

  /** Per-seat state for the HUD. */
  views(): LobbySeatView[] {
    return this.seats.map((seat) => ({
      seat,
      joined: this.joined[seat] === true,
      ready: this.ready[seat] === true,
      progress: Math.min(1, (this.hold[seat] as number) / READY_HOLD_TICKS),
    }));
  }

  /** Change-detection key for the HUD (progress in 10 % steps). */
  key(): string {
    return this.views()
      .map((v) => `${+v.joined}${+v.ready}${Math.floor(v.progress * 10)}`)
      .join('|');
  }
}
