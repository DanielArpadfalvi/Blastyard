import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineClient, TIMEOUT_MS } from '../../../src/game/online';
import {
  CODE_ALPHABET,
  canStart,
  cleanName,
  hostReduce,
  humanSeats,
  makeCode,
  matchStart,
  newLobby,
  normalizeCode,
  onlineMatchSetup,
  setRules,
} from '../../../src/net/lobby';
import { busNet, memoryHub, type Identity } from '../../../src/platform/net';
import { BotLevel } from '../../../src/core';

function seq(seed: number): () => number {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return x / 4294967296;
  };
}

describe('lobby protocol', () => {
  it('codes are six readable characters; typed codes are cleaned', () => {
    const code = makeCode(seq(1));
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{6}$`));
    expect(normalizeCode(` ${code.toLowerCase().slice(0, 3)}-${code.slice(3)} `)).toBe(code);
    expect(normalizeCode('ABC12')).toBeNull();
    expect(normalizeCode('ABCDE0')).toBeNull(); // no zero in the alphabet
    expect(cleanName('  Big   Bob the Very Long Name ')).toBe('Big Bob the Very');
    expect(cleanName('   ')).toBeNull();
  });

  it('the host admits up to four, tracks ready and lets players leave', () => {
    let s = newLobby('ABCDEF', { id: 'h', name: 'Host' });
    for (const id of ['a', 'b', 'c', 'd']) s = hostReduce(s, { t: 'hello', from: id, name: id });
    expect(s.members.map((m) => m.id)).toEqual(['h', 'a', 'b', 'c']);
    expect(canStart(s)).toBe(false);
    for (const id of ['a', 'b', 'c']) s = hostReduce(s, { t: 'ready', from: id, ready: true });
    expect(canStart(s)).toBe(true);
    s = hostReduce(s, { t: 'leave', from: 'b' });
    expect(s.members.map((m) => m.id)).toEqual(['h', 'a', 'c']);
    expect(hostReduce(s, { t: 'leave', from: 'h' })).toBe(s);
  });

  it('a lone host can start against bots; the match setup is the same on every phone', () => {
    let s = newLobby('ABCDEF', { id: 'h', name: 'Host' });
    expect(canStart(s)).toBe(false);
    s = setRules(s, { bots: BotLevel.HARD, preset: 'fast', winsToMatch: 5 });
    expect(canStart(s)).toBe(true);
    const start = matchStart(s, 42, 1);
    expect(start.seats).toEqual(['h', null, null, null]);
    expect(start.bots).toEqual([0, BotLevel.HARD, BotLevel.HARD, BotLevel.HARD]);
    expect(humanSeats(start)).toEqual([0]);
    const setup = onlineMatchSetup(start);
    expect(setup.seats).toEqual([true, true, true, true]);
    expect(setup.rules).toMatchObject({ winsToMatch: 5, startBombs: 2 });
    expect(onlineMatchSetup(JSON.parse(JSON.stringify(start)))).toEqual(setup);
  });
});

describe('online client over a shared bus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function clients(n: number) {
    const hub = memoryHub();
    return Array.from({ length: n }, (_, i) => {
      let saved: Identity | null = null;
      const net = busNet({
        bus: hub.endpoint(),
        load: () => saved,
        save: (id) => {
          saved = id;
        },
        random: seq(100 + i),
        lookupMs: 500,
      });
      return new OnlineClient(net, { random: seq(200 + i), now: () => Date.now() });
    });
  }

  const flush = () => vi.advanceTimersByTimeAsync(50);

  it('create, join by code, ready, start: every phone gets the same match', async () => {
    const [host, a, b] = clients(3) as [OnlineClient, OnlineClient, OnlineClient];
    await host.setName('Hosty');
    await host.createLobby();
    const v = host.get().view;
    if (v.phase !== 'lobby') throw new Error('no lobby');
    await a.setName('Anna');
    await a.joinLobby(v.lobby.code.toLowerCase());
    await b.joinLobby(v.lobby.code);
    await flush();
    const names = (c: OnlineClient) => {
      const w = c.get().view;
      return w.phase === 'lobby' ? w.lobby.members.map((m) => m.name) : [];
    };
    expect(names(host)).toEqual(['Hosty', 'Anna', 'Player']);
    expect(names(b)).toEqual(['Hosty', 'Anna', 'Player']);
    expect(host.startMatch()).toBe(false); // nobody ready yet
    a.setReady(true);
    b.setReady(true);
    await flush();
    expect(host.startMatch()).toBe(true);
    await flush();
    const starts = [host, a, b].map((c) => {
      const w = c.get().view;
      return w.phase === 'playing' ? w.start : null;
    });
    expect(starts[0]).not.toBeNull();
    expect(starts[1]).toEqual(starts[0]);
    expect(starts[2]).toEqual(starts[0]);
    expect([host, a, b].map((c) => c.localSeat())).toEqual([0, 1, 2]);
  });

  it('a wrong code times out as "not found"; a full lobby says so', async () => {
    const all = clients(6);
    const [host, ...rest] = all as [OnlineClient, ...OnlineClient[]];
    await rest[0]!.joinLobby('ZZZZZZ');
    await vi.advanceTimersByTimeAsync(6000);
    expect(rest[0]!.get()).toMatchObject({ view: { phase: 'idle' }, error: 'not-found' });
    await host.createLobby();
    const v = host.get().view;
    if (v.phase !== 'lobby') throw new Error('no lobby');
    for (const c of rest.slice(0, 4)) await c.joinLobby(v.lobby.code);
    await flush();
    expect(host.get().view.phase === 'lobby' && host.get().view).toBeTruthy();
    const full = rest[3]!.get();
    expect(full).toMatchObject({ view: { phase: 'idle' }, error: 'full' });
  });

  it('friend codes, invites and accepting an invite', async () => {
    const [host, friend] = clients(2) as [OnlineClient, OnlineClient];
    await host.start();
    await friend.start();
    const code = host.get().me!.friendCode;
    expect(await friend.addFriend(code)).toBe('added');
    expect(await friend.addFriend(friend.get().me!.friendCode)).toBe('self');
    const unknown = friend.addFriend('QQQQQQ');
    await vi.advanceTimersByTimeAsync(600);
    expect(await unknown).toBe('not-found');
    await flush();
    await host.refreshFriends();
    expect(host.get().friends.map((f) => f.id)).toEqual([friend.get().me!.id]);
    await host.createLobby();
    await host.inviteFriend(friend.get().me!.id);
    await flush();
    const invites = friend.get().invites;
    expect(invites).toHaveLength(1);
    expect(invites[0]!.fromName).toBe('Player');
    await friend.acceptInvite(invites[0]!.id);
    await flush();
    expect(friend.get().view.phase).toBe('lobby');
    expect(friend.get().invites).toHaveLength(0);
  });

  it('guests notice a closed or silent host; the host removes a silent guest', async () => {
    const [host, a, b] = clients(3) as [OnlineClient, OnlineClient, OnlineClient];
    await host.createLobby();
    const v = host.get().view;
    if (v.phase !== 'lobby') throw new Error('no lobby');
    await a.joinLobby(v.lobby.code);
    await b.joinLobby(v.lobby.code);
    await flush();
    // b goes silent (app killed): no more pings.
    (b as unknown as { leaveRoom(): void }).leaveRoom();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 4000);
    const members = (c: OnlineClient) => {
      const w = c.get().view;
      return w.phase === 'lobby' ? w.lobby.members.length : -1;
    };
    expect(members(host)).toBe(2);
    expect(members(a)).toBe(2);
    host.leave();
    await flush();
    expect(a.get()).toMatchObject({ view: { phase: 'idle' }, error: 'host-left' });
  });
});
