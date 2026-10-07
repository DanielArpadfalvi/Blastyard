/**
 * Game-facing audio (T3.2): turns simulation events and the per-tick state into effect cues,
 * the fuse sizzle and the music track (menu → match → sudden death). Never touches the core
 * state; it only reads it.
 */

import { EventKind, type SimEvent } from '../core';
import type { ReadonlySimState } from '../render/readonlyState';
import { cuesForEvents, fuseBeepCue, sizzleLevel } from './cues';
import { AudioEngine } from './engine';

export { AudioEngine, type AudioStats } from './engine';
export type { MusicTrack } from './music';

export class GameAudio {
  private sizzle = -1;

  constructor(readonly engine: AudioEngine = new AudioEngine()) {}

  setVolumes(music: number, sfx: number): void {
    this.engine.setVolumes(music, sfx);
  }

  /** Menu / result screens: calm music, no fuse hiss. */
  menu(): void {
    this.engine.setTrack('menu');
    this.setSizzle(0);
  }

  /** A match starts: the match groove, seeded per match. */
  match(seed: number): void {
    this.engine.setTrack('match', seed >>> 0);
  }

  /** One simulated tick's events. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.kind === EventKind.SUDDEN_DEATH) this.engine.setTrack('suddenDeath');
      else if (e.kind === EventKind.ROUND_START) this.engine.setTrack('match');
    }
    for (const cue of cuesForEvents(events)) this.engine.play(cue);
  }

  /** After every simulated tick: fuse beeps and the sizzle level. */
  onTick(state: ReadonlySimState): void {
    const beep = fuseBeepCue(state);
    if (beep) this.engine.play(beep);
    this.setSizzle(sizzleLevel(state));
  }

  /** Stops the fuse hiss (match left or paused). */
  quiet(): void {
    this.setSizzle(0);
  }

  private setSizzle(level: number): void {
    if (level === this.sizzle) return;
    this.sizzle = level;
    this.engine.setSizzle(level);
  }
}
