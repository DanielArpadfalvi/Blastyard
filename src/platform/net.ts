/**
 * Online services behind the platform layer (online private lobbies): an anonymous identity with
 * a display name and a friend code, a friend list, lobby invites, and realtime rooms (one per
 * lobby code) that carry the lobby and input messages.
 *
 * Implementations: `supabaseNet.ts` (Supabase: anonymous auth, Postgres + Realtime), and here
 * `busNet` – the same behaviour over a message bus, used with an in-memory bus in unit tests and
 * with `BroadcastChannel` between browser tabs (`?net=local`, dev and e2e). Without a configured
 * backend the online mode says "not available".
 */

import { isNetMessage, makeCode, type NetMessage } from '../net/lobby';

export interface Identity {
  readonly id: string;
  readonly name: string;
  /** Short code friends type in to add each other. */
  readonly friendCode: string;
}

export interface Friend {
  readonly id: string;
  readonly name: string;
  readonly friendCode: string;
}

export interface Invite {
  readonly id: string;
  readonly fromId: string;
  readonly fromName: string;
  readonly lobbyCode: string;
  /** Milliseconds since the epoch (platform clock). */
  readonly at: number;
}

export interface Room {
  readonly code: string;
  send(msg: NetMessage): void;
  onMessage(fn: (msg: NetMessage) => void): () => void;
  close(): void;
}

export type AddFriendResult = Friend | 'not-found' | 'self';

export interface NetPort {
  /** Is an online backend configured in this build? */
  readonly available: boolean;
  /** Signs in (anonymously, once per install) and returns who we are. */
  identity(): Promise<Identity>;
  setName(name: string): Promise<Identity>;
  friends(): Promise<readonly Friend[]>;
  addFriend(friendCode: string): Promise<AddFriendResult>;
  removeFriend(id: string): Promise<void>;
  invite(friendId: string, lobbyCode: string): Promise<void>;
  /** Invites addressed to us, live, while the app runs. */
  onInvite(fn: (invite: Invite) => void): () => void;
  dismissInvite(id: string): Promise<void>;
  /** Joins (or creates) the realtime room of a lobby code. */
  openRoom(code: string): Promise<Room>;
  /** Deletes the online profile, friends and invites (Settings; store requirement). */
  deleteProfile(): Promise<void>;
}

/** Built when no backend is configured: every call fails, `available` is false. */
export function unavailableNet(): NetPort {
  const no = (): Promise<never> => Promise.reject(new Error('online not available'));
  return {
    available: false,
    identity: no,
    setName: no,
    friends: no,
    addFriend: no,
    removeFriend: no,
    invite: no,
    onInvite: () => () => undefined,
    dismissInvite: no,
    openRoom: no,
    deleteProfile: no,
  };
}

// ---------------------------------------------------------------------------------------------
// Bus-based implementation (tests, local tabs)

/** A broadcast medium: every subscriber (but the sender) gets every posted value. */
export interface Bus {
  post(value: unknown): void;
  subscribe(fn: (value: unknown) => void): () => void;
}

/** An in-memory bus; `endpoint()` gives one participant's view (no echo of its own posts). */
export function memoryHub(): { endpoint(): Bus } {
  const listeners = new Set<{ fn: (value: unknown) => void; owner: object }>();
  return {
    endpoint() {
      const owner = {};
      return {
        post(value) {
          const copy = JSON.parse(JSON.stringify(value)) as unknown;
          for (const l of [...listeners]) if (l.owner !== owner) queueMicrotask(() => l.fn(copy));
        },
        subscribe(fn) {
          const l = { fn, owner };
          listeners.add(l);
          return () => listeners.delete(l);
        },
      };
    },
  };
}

/** A bus between the tabs of one browser (`BroadcastChannel`). */
export function broadcastBus(name: string): Bus {
  const channel = new BroadcastChannel(name);
  return {
    post: (value) => channel.postMessage(value),
    subscribe(fn) {
      const h = (e: MessageEvent): void => fn(e.data);
      channel.addEventListener('message', h);
      return () => channel.removeEventListener('message', h);
    },
  };
}

type Envelope =
  | { readonly k: 'room'; readonly code: string; readonly msg: NetMessage }
  | { readonly k: 'who'; readonly q: string; readonly code: string; readonly from: string }
  | { readonly k: 'me'; readonly q: string; readonly friend: Friend }
  | { readonly k: 'invite'; readonly to: string; readonly invite: Invite }
  | { readonly k: 'befriend'; readonly to: string; readonly friend: Friend };

export interface BusNetOptions {
  readonly bus: Bus;
  /** Persisted identity (tests: in memory; tabs: `sessionStorage`). */
  readonly load: () => Identity | null;
  readonly save: (identity: Identity) => void;
  readonly random?: () => number;
  readonly now?: () => number;
  /** How long `addFriend` waits for the owner of a friend code to answer (ms). */
  readonly lookupMs?: number;
}

/**
 * The online port over a bus. Friend lookup asks every participant ("who has this code?"); adding
 * a friend makes the friendship mutual, like the Supabase backend's `add_friend`.
 */
export function busNet(o: BusNetOptions): NetPort {
  const random = o.random ?? Math.random;
  const now = o.now ?? (() => Date.now());
  let me = o.load();
  if (!me) {
    me = {
      id: `u${makeCode(random)}${makeCode(random)}`.toLowerCase(),
      name: 'Player',
      friendCode: makeCode(random),
    };
    o.save(me);
  }
  const friends = new Map<string, Friend>();
  const inviteListeners = new Set<(invite: Invite) => void>();
  const pending = new Map<string, (friend: Friend) => void>();
  const asFriend = (i: Identity): Friend => ({ id: i.id, name: i.name, friendCode: i.friendCode });

  o.bus.subscribe((raw) => {
    const e = raw as Envelope;
    if (!e || typeof e !== 'object') return;
    const self = me as Identity;
    switch (e.k) {
      case 'who':
        if (e.code === self.friendCode && e.from !== self.id) {
          o.bus.post({ k: 'me', q: e.q, friend: asFriend(self) } satisfies Envelope);
        }
        break;
      case 'me':
        pending.get(e.q)?.(e.friend);
        break;
      case 'invite':
        if (e.to === self.id) for (const fn of [...inviteListeners]) fn(e.invite);
        break;
      case 'befriend':
        if (e.to === self.id) friends.set(e.friend.id, e.friend);
        break;
      default:
        break;
    }
  });

  return {
    available: true,
    identity: () => Promise.resolve(me as Identity),
    setName(name) {
      me = { ...(me as Identity), name };
      o.save(me);
      return Promise.resolve(me);
    },
    friends: () => Promise.resolve([...friends.values()]),
    addFriend(code) {
      const self = me as Identity;
      if (code === self.friendCode) return Promise.resolve('self');
      const q = makeCode(random);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(q);
          resolve('not-found');
        }, o.lookupMs ?? 800);
        pending.set(q, (friend) => {
          clearTimeout(timer);
          pending.delete(q);
          friends.set(friend.id, friend);
          o.bus.post({ k: 'befriend', to: friend.id, friend: asFriend(self) } satisfies Envelope);
          resolve(friend);
        });
        o.bus.post({ k: 'who', q, code, from: self.id } satisfies Envelope);
      });
    },
    removeFriend(id) {
      friends.delete(id);
      return Promise.resolve();
    },
    invite(friendId, lobbyCode) {
      const self = me as Identity;
      const invite: Invite = {
        id: makeCode(random),
        fromId: self.id,
        fromName: self.name,
        lobbyCode,
        at: now(),
      };
      o.bus.post({ k: 'invite', to: friendId, invite } satisfies Envelope);
      return Promise.resolve();
    },
    onInvite(fn) {
      inviteListeners.add(fn);
      return () => inviteListeners.delete(fn);
    },
    dismissInvite: () => Promise.resolve(),
    openRoom(code) {
      const listeners = new Set<(msg: NetMessage) => void>();
      const off = o.bus.subscribe((raw) => {
        const e = raw as Envelope;
        if (e?.k !== 'room' || e.code !== code || !isNetMessage(e.msg)) return;
        for (const fn of [...listeners]) fn(e.msg);
      });
      return Promise.resolve({
        code,
        send: (msg) => o.bus.post({ k: 'room', code, msg } satisfies Envelope),
        onMessage(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        close() {
          off();
          listeners.clear();
        },
      });
    },
    deleteProfile() {
      friends.clear();
      return Promise.resolve();
    },
  };
}

/** Local multi-tab backend (`?net=local`): identity per tab, rooms over `BroadcastChannel`. */
export function localTabsNet(): NetPort {
  const KEY = 'blastyard.net.identity';
  return busNet({
    bus: broadcastBus('blastyard-net'),
    load() {
      try {
        const raw = sessionStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as Identity) : null;
      } catch {
        return null;
      }
    },
    save(identity) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(identity));
      } catch {
        // Private mode: the identity lasts for this page only.
      }
    },
  });
}
