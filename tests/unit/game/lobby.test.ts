import { describe, expect, it } from 'vitest';
import { LobbyTracker, READY_HOLD_TICKS, START_DELAY_TICKS } from '../../../src/game/lobby';
import { INPUT_BOMB } from '../../../src/core';

function hold(lobby: LobbyTracker, seat: number, ticks: number, input = 0): void {
  for (let t = 0; t < ticks; t++) lobby.update(seat, true, input);
}

describe('lobby readiness', () => {
  it('a seat joins on touch (or a key) and is ready after a one-second hold', () => {
    const lobby = new LobbyTracker([0, 1]);
    expect(lobby.views().every((v) => !v.joined && !v.ready)).toBe(true);
    lobby.update(0, true, 0);
    expect(lobby.views()[0]!.joined).toBe(true);
    expect(lobby.views()[1]!.joined).toBe(false);
    lobby.update(1, false, 0x02); // a key press joins too
    expect(lobby.views()[1]!.joined).toBe(true);
    hold(lobby, 0, READY_HOLD_TICKS - 2);
    expect(lobby.isReady(0)).toBe(false);
    expect(lobby.views()[0]!.progress).toBeGreaterThan(0.9);
    hold(lobby, 0, 2);
    expect(lobby.isReady(0)).toBe(true);
  });

  it('moving or bombing resets the hold and takes the ready mark away', () => {
    const lobby = new LobbyTracker([0]);
    hold(lobby, 0, READY_HOLD_TICKS);
    expect(lobby.isReady(0)).toBe(true);
    lobby.update(0, true, INPUT_BOMB);
    expect(lobby.isReady(0)).toBe(false);
    hold(lobby, 0, READY_HOLD_TICKS - 1);
    lobby.update(0, true, 0x01); // steering restarts the count
    hold(lobby, 0, READY_HOLD_TICKS - 1);
    expect(lobby.isReady(0)).toBe(false);
  });

  it('lifting the finger keeps the mark but a short touch never makes one', () => {
    const lobby = new LobbyTracker([0]);
    hold(lobby, 0, READY_HOLD_TICKS - 1);
    lobby.update(0, false, 0);
    expect(lobby.isReady(0)).toBe(false);
    hold(lobby, 0, READY_HOLD_TICKS);
    lobby.update(0, false, 0);
    expect(lobby.isReady(0)).toBe(true);
  });

  it('the match starts a beat after the last human is ready, never for an empty lobby', () => {
    const lobby = new LobbyTracker([0, 2]);
    hold(lobby, 0, READY_HOLD_TICKS);
    for (let t = 0; t < START_DELAY_TICKS + 5; t++) expect(lobby.tickStart()).toBe(false);
    hold(lobby, 2, READY_HOLD_TICKS);
    let started = -1;
    for (let t = 0; t < START_DELAY_TICKS + 5 && started < 0; t++) {
      if (lobby.tickStart()) started = t;
    }
    expect(started).toBe(START_DELAY_TICKS - 1);
    expect(new LobbyTracker([]).allReady()).toBe(false);
  });

  it('"everyone ready" marks all human seats at once and the key tracks changes', () => {
    const lobby = new LobbyTracker([0, 1, 3]);
    const before = lobby.key();
    lobby.readyAll();
    expect(lobby.allReady()).toBe(true);
    expect(lobby.key()).not.toBe(before);
  });
});
