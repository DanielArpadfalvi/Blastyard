/**
 * Online private lobbies (client side): creating a lobby (this phone hosts it), joining one by
 * code or from an invite, the friend list and invites, readiness, the host's rules and the match
 * start. Talks to the backend only through `NetPort` (platform layer); the lobby protocol itself
 * is pure (`src/net/lobby.ts`). The match netcode lives in `netMatch.ts`.
 *
 * Liveness: everybody pings the room every `PING_MS`; the host drops a member it has not heard
 * from for `TIMEOUT_MS`, guests leave when the host goes silent.
 */

import {
  canStart,
  cleanName,
  hostReduce,
  makeCode,
  matchStart,
  newLobby,
  normalizeCode,
  resetReady,
  setRules,
  type LobbyRules,
  type LobbyState,
  type MatchStart,
  type NetMessage,
} from '../net/lobby';
import type { Friend, Identity, Invite, NetPort, Room } from '../platform/net';

export const PING_MS = 2000;
export const TIMEOUT_MS = 9000;
/** How long joining waits for the host's answer. */
export const JOIN_TIMEOUT_MS = 5000;
/** Invites older than this are not shown. */
export const INVITE_TTL_MS = 10 * 60 * 1000;

export type OnlineError =
  'unavailable' | 'not-found' | 'full' | 'host-left' | 'bad-code' | 'network' | 'desync';

export type OnlineView =
  | { readonly phase: 'idle' }
  | { readonly phase: 'joining'; readonly code: string }
  | { readonly phase: 'lobby'; readonly lobby: LobbyState }
  | { readonly phase: 'playing'; readonly lobby: LobbyState; readonly start: MatchStart };

export interface OnlineSnapshot {
  readonly view: OnlineView;
  readonly me: Identity | null;
  readonly friends: readonly Friend[];
  readonly invites: readonly Invite[];
  readonly error: OnlineError | null;
}

export interface OnlineDeps {
  readonly now?: () => number;
  readonly random?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => () => void;
}

const defaultTimer = (fn: () => void, ms: number): (() => void) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export class OnlineClient {
  private snap: OnlineSnapshot = {
    view: { phase: 'idle' },
    me: null,
    friends: [],
    invites: [],
    error: null,
  };
  private readonly listeners = new Set<(s: OnlineSnapshot) => void>();
  private room: Room | null = null;
  private offRoom: (() => void) | null = null;
  private stopPing: (() => void) | null = null;
  private readonly lastSeen = new Map<string, number>();
  private matchRound = 0;
  private readonly matchListeners = new Set<(msg: NetMessage) => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private started = false;

  constructor(
    readonly net: NetPort,
    deps: OnlineDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? defaultTimer;
  }

  get available(): boolean {
    return this.net.available;
  }

  get(): OnlineSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: OnlineSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<OnlineSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of [...this.listeners]) fn(this.snap);
  }

  private get me(): Identity {
    if (!this.snap.me) throw new Error('online: not signed in');
    return this.snap.me;
  }

  get isHost(): boolean {
    const v = this.snap.view;
    return (v.phase === 'lobby' || v.phase === 'playing') && v.lobby.hostId === this.snap.me?.id;
  }

  /** Signs in and starts listening for invites (once). */
  async start(): Promise<boolean> {
    if (!this.net.available) {
      this.set({ error: 'unavailable' });
      return false;
    }
    if (this.started) return true;
    try {
      const me = await this.net.identity();
      this.started = true;
      this.set({ me, error: null });
      this.net.onInvite((invite) => {
        if (this.now() - invite.at > INVITE_TTL_MS) return;
        const invites = [
          invite,
          ...this.snap.invites.filter((i) => i.lobbyCode !== invite.lobbyCode),
        ];
        this.set({ invites });
      });
      void this.refreshFriends();
      return true;
    } catch {
      this.set({ error: 'network' });
      return false;
    }
  }

  clearError(): void {
    this.set({ error: null });
  }

  async setName(input: string): Promise<void> {
    const name = cleanName(input);
    if (!name) return;
    const me = await this.net.setName(name);
    this.set({ me });
  }

  async refreshFriends(): Promise<void> {
    try {
      this.set({ friends: await this.net.friends() });
    } catch {
      // Keep the last list.
    }
  }

  async addFriend(input: string): Promise<'added' | 'not-found' | 'self' | 'bad-code'> {
    const code = normalizeCode(input);
    if (!code) return 'bad-code';
    const r = await this.net.addFriend(code);
    if (r === 'not-found' || r === 'self') return r;
    await this.refreshFriends();
    return 'added';
  }

  async removeFriend(id: string): Promise<void> {
    await this.net.removeFriend(id);
    await this.refreshFriends();
  }

  async inviteFriend(friendId: string): Promise<void> {
    const v = this.snap.view;
    if (v.phase !== 'lobby') return;
    await this.net.invite(friendId, v.lobby.code);
  }

  dismissInvite(id: string): void {
    this.set({ invites: this.snap.invites.filter((i) => i.id !== id) });
    void this.net.dismissInvite(id).catch(() => undefined);
  }

  // -------------------------------------------------------------------------------------------
  // Lobby

  async createLobby(): Promise<void> {
    if (!(await this.start())) return;
    const code = makeCode(this.random);
    await this.enter(code);
    this.set({ view: { phase: 'lobby', lobby: newLobby(code, this.me) }, error: null });
    this.lastSeen.clear();
    void this.refreshFriends();
  }

  async joinLobby(input: string): Promise<void> {
    const code = normalizeCode(input);
    if (!code) {
      this.set({ error: 'bad-code' });
      return;
    }
    if (!(await this.start())) return;
    await this.enter(code);
    this.set({ view: { phase: 'joining', code }, error: null });
    this.send({ t: 'hello', from: this.me.id, name: this.me.name });
    const startedAt = this.now();
    // The host answers with the lobby state; resend hello once in case it got lost.
    const stop = this.setTimer(() => {
      if (this.snap.view.phase !== 'joining') {
        stop();
        return;
      }
      if (this.now() - startedAt >= JOIN_TIMEOUT_MS) {
        stop();
        this.leaveRoom();
        this.set({ view: { phase: 'idle' }, error: 'not-found' });
        return;
      }
      this.send({ t: 'hello', from: this.me.id, name: this.me.name });
    }, 1000);
  }

  /** Joins the lobby an invite points to (and forgets the invite). */
  async acceptInvite(id: string): Promise<void> {
    const invite = this.snap.invites.find((i) => i.id === id);
    if (!invite) return;
    this.dismissInvite(id);
    await this.joinLobby(invite.lobbyCode);
  }

  setReady(ready: boolean): void {
    const v = this.snap.view;
    if (v.phase !== 'lobby') return;
    const msg: NetMessage = { t: 'ready', from: this.me.id, ready };
    if (this.isHost) this.hostApply(msg);
    else this.send(msg);
  }

  /** Host: changes the match rules. */
  setRules(rules: Partial<LobbyRules>): void {
    const v = this.snap.view;
    if (v.phase !== 'lobby' || !this.isHost) return;
    this.publish(setRules(v.lobby, rules));
  }

  /** Host: starts the match when everyone is ready. */
  startMatch(): boolean {
    const v = this.snap.view;
    if (v.phase !== 'lobby' || !this.isHost || !canStart(v.lobby)) return false;
    this.matchRound++;
    const seed = (this.random() * 0x7fffffff) | 0;
    const start = matchStart(v.lobby, seed, this.matchRound);
    this.send({ t: 'start', match: start });
    this.set({ view: { phase: 'playing', lobby: v.lobby, start } });
    return true;
  }

  /** Back from a finished match to the lobby (everyone unready). */
  backToLobby(): void {
    const v = this.snap.view;
    if (v.phase !== 'playing') return;
    if (this.isHost) this.publish(resetReady(v.lobby));
    else this.set({ view: { phase: 'lobby', lobby: v.lobby } });
  }

  /** Deletes the online profile, friends and invites on the server (Settings). */
  async deleteProfile(): Promise<void> {
    this.leave();
    await this.net.deleteProfile();
    this.started = false;
    this.set({ me: null, friends: [], invites: [], error: null });
  }

  /** The phones disagreed about the game state: abandon the match, back to the lobby. */
  reportDesync(): void {
    this.set({ error: 'desync' });
    this.backToLobby();
  }

  leave(): void {
    const v = this.snap.view;
    if (v.phase !== 'idle' && this.snap.me) {
      this.send(this.isHost ? { t: 'closed' } : { t: 'leave', from: this.me.id });
    }
    this.leaveRoom();
    this.set({ view: { phase: 'idle' } });
  }

  /** Match traffic (input, hash, drop) to the netcode. */
  onMatchMessage(fn: (msg: NetMessage) => void): () => void {
    this.matchListeners.add(fn);
    return () => this.matchListeners.delete(fn);
  }

  send(msg: NetMessage): void {
    this.room?.send(msg);
  }

  /** The seat of this phone in the running match (−1 when not playing). */
  localSeat(): number {
    const v = this.snap.view;
    if (v.phase !== 'playing' || !this.snap.me) return -1;
    return v.start.seats.indexOf(this.snap.me.id);
  }

  /** The member ids not heard from for `TIMEOUT_MS` (host; the match drops their seats). */
  silentMembers(): string[] {
    const v = this.snap.view;
    if (v.phase === 'idle' || v.phase === 'joining') return [];
    const t = this.now();
    return v.lobby.members
      .filter((m) => m.id !== this.snap.me?.id)
      .filter((m) => t - (this.lastSeen.get(m.id) ?? t) > TIMEOUT_MS)
      .map((m) => m.id);
  }

  private async enter(code: string): Promise<void> {
    this.leaveRoom();
    this.room = await this.net.openRoom(code);
    this.offRoom = this.room.onMessage((msg) => this.receive(msg));
    this.stopPing = this.setTimer(() => this.heartbeat(), PING_MS);
  }

  private leaveRoom(): void {
    this.offRoom?.();
    this.offRoom = null;
    this.stopPing?.();
    this.stopPing = null;
    this.room?.close();
    this.room = null;
    this.lastSeen.clear();
  }

  private heartbeat(): void {
    const v = this.snap.view;
    if (v.phase === 'idle' || !this.snap.me) return;
    this.send({ t: 'ping', from: this.me.id });
    if (v.phase === 'joining') return;
    const silent = this.silentMembers();
    if (silent.length === 0) return;
    if (this.isHost) {
      // In a match the netcode drops the seat first (agreed tick); in the lobby just remove.
      if (v.phase === 'lobby') {
        let lobby = v.lobby;
        for (const id of silent) lobby = hostReduce(lobby, { t: 'leave', from: id });
        for (const id of silent) this.lastSeen.delete(id);
        this.publish(lobby);
      }
    } else if (silent.includes(v.lobby.hostId)) {
      this.leaveRoom();
      this.set({ view: { phase: 'idle' }, error: 'host-left' });
    }
  }

  private publish(lobby: LobbyState): void {
    const v = this.snap.view;
    this.send({ t: 'state', lobby });
    this.set({ view: v.phase === 'playing' ? { ...v, lobby } : { phase: 'lobby', lobby } });
  }

  private hostApply(msg: NetMessage): void {
    const v = this.snap.view;
    if (v.phase !== 'lobby' && v.phase !== 'playing') return;
    // A latecomer during a match is listed and plays from the next match on.
    if (msg.t === 'hello' && !v.lobby.members.some((m) => m.id === msg.from)) {
      if (v.lobby.members.length >= 4) {
        this.send({ t: 'full', to: msg.from });
        return;
      }
    }
    const next = hostReduce(v.lobby, msg);
    if (next !== v.lobby) this.publish(next);
    else if (msg.t === 'hello') this.send({ t: 'state', lobby: v.lobby });
  }

  private receive(msg: NetMessage): void {
    const v = this.snap.view;
    const me = this.snap.me;
    if (!me) return;
    if ('from' in msg && typeof msg.from === 'string') this.lastSeen.set(msg.from, this.now());
    switch (msg.t) {
      case 'hello':
      case 'ready':
      case 'leave':
        if (this.isHost) this.hostApply(msg);
        if (msg.t === 'leave' && v.phase === 'playing') this.forward(msg);
        return;
      case 'state': {
        if (this.isHost) return;
        const lobby = msg.lobby;
        if (!lobby.members.some((m) => m.id === me.id)) {
          if (v.phase === 'joining') return; // not admitted yet (or a stale state)
          this.leaveRoom();
          this.set({ view: { phase: 'idle' }, error: 'host-left' });
          return;
        }
        this.lastSeen.set(lobby.hostId, this.now());
        if (v.phase === 'joining') {
          this.set({ view: { phase: 'lobby', lobby } });
          void this.refreshFriends();
          return;
        }
        if (v.phase === 'lobby' && lobby.version >= v.lobby.version) {
          this.set({ view: { phase: 'lobby', lobby } });
        } else if (v.phase === 'playing' && lobby.version >= v.lobby.version) {
          this.set({ view: { ...v, lobby } });
        }
        return;
      }
      case 'full':
        if (msg.to === me.id && v.phase === 'joining') {
          this.leaveRoom();
          this.set({ view: { phase: 'idle' }, error: 'full' });
        }
        return;
      case 'closed':
        if (!this.isHost && v.phase !== 'idle') {
          this.leaveRoom();
          this.set({ view: { phase: 'idle' }, error: 'host-left' });
        }
        return;
      case 'start':
        if (this.isHost || (v.phase !== 'lobby' && v.phase !== 'playing')) return;
        if (!msg.match.seats.includes(me.id)) return;
        this.set({ view: { phase: 'playing', lobby: v.lobby, start: msg.match } });
        return;
      case 'input':
      case 'hash':
      case 'drop':
        this.forward(msg);
        return;
      default:
        return;
    }
  }

  private forward(msg: NetMessage): void {
    for (const fn of [...this.matchListeners]) fn(msg);
  }
}
