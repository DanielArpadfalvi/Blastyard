/**
 * Supabase-backed online services (schema: `supabase/migrations/*_online_lobbies.sql`):
 * anonymous sign-in (one anonymous user per install, kept by the SDK), the profile / friends /
 * invites tables through security-definer functions, live invites through Postgres changes, and
 * one Realtime broadcast channel per lobby code for the lobby and input messages. The SDK is
 * loaded on first use, so players who never open the online mode never download it.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { isNetMessage, type NetMessage } from '../net/lobby';
import type { AddFriendResult, Friend, Identity, Invite, NetPort, Room } from './net';

interface ProfileRow {
  readonly id: string;
  readonly name: string;
  readonly friend_code: string;
}

interface InviteRow {
  readonly id: string;
  readonly from_id: string;
  readonly from_name: string;
  readonly lobby_code: string;
  readonly created_at: string;
}

const toIdentity = (r: ProfileRow): Identity => ({
  id: r.id,
  name: r.name,
  friendCode: r.friend_code,
});
const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  fromId: r.from_id,
  fromName: r.from_name,
  lobbyCode: r.lobby_code,
  at: Date.parse(r.created_at),
});

export function supabaseNet(url: string, anonKey: string): NetPort {
  let client: Promise<SupabaseClient> | null = null;
  let me: Promise<Identity> | null = null;
  const inviteListeners = new Set<(invite: Invite) => void>();
  let inviteChannel: RealtimeChannel | null = null;

  const sdk = (): Promise<SupabaseClient> => {
    client ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'blastyard.online' },
        realtime: { params: { eventsPerSecond: 40 } },
      }),
    );
    return client;
  };

  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  const identity = (): Promise<Identity> => {
    me ??= (async () => {
      const sb = await sdk();
      const session = (await sb.auth.getSession()).data.session;
      if (!session) check(await sb.auth.signInAnonymously());
      const row = check(await sb.rpc('ensure_profile')) as ProfileRow;
      const id = toIdentity(row);
      listenInvites(sb, id.id);
      return id;
    })();
    me.catch(() => {
      me = null;
    });
    return me;
  };

  const listenInvites = (sb: SupabaseClient, userId: string): void => {
    if (inviteChannel) return;
    inviteChannel = sb
      .channel(`invites:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'invites', filter: `to_id=eq.${userId}` },
        (payload) => {
          const invite = toInvite(payload.new as InviteRow);
          for (const fn of [...inviteListeners]) fn(invite);
        },
      )
      .subscribe();
    // Invites that arrived while the app was closed.
    void (async () => {
      const r = await sb
        .from('invites')
        .select('id, from_id, from_name, lobby_code, created_at')
        .eq('to_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      for (const row of (r.data ?? []) as InviteRow[]) {
        for (const fn of [...inviteListeners]) fn(toInvite(row));
      }
    })();
  };

  return {
    available: true,
    identity,
    async setName(name) {
      await identity();
      const sb = await sdk();
      const row = check(await sb.rpc('set_name', { new_name: name })) as ProfileRow;
      const id = toIdentity(row);
      me = Promise.resolve(id);
      return id;
    },
    async friends() {
      await identity();
      const sb = await sdk();
      const rows = check(await sb.rpc('my_friends')) as ProfileRow[];
      return rows.map((r): Friend => toIdentity(r));
    },
    async addFriend(code): Promise<AddFriendResult> {
      const self = await identity();
      if (code === self.friendCode) return 'self';
      const sb = await sdk();
      const row = check(await sb.rpc('add_friend', { code })) as ProfileRow | null;
      return row?.id ? toIdentity(row) : 'not-found';
    },
    async removeFriend(id) {
      const sb = await sdk();
      check(await sb.rpc('remove_friend', { other: id }));
    },
    async invite(friendId, lobbyCode) {
      await identity();
      const sb = await sdk();
      check(await sb.rpc('invite_friend', { other: friendId, code: lobbyCode }));
    },
    onInvite(fn) {
      inviteListeners.add(fn);
      return () => inviteListeners.delete(fn);
    },
    async dismissInvite(id) {
      const sb = await sdk();
      check(await sb.from('invites').delete().eq('id', id));
    },
    async openRoom(code): Promise<Room> {
      await identity();
      const sb = await sdk();
      const channel = sb.channel(`lobby:${code}`, {
        config: { broadcast: { self: false, ack: false } },
      });
      const listeners = new Set<(msg: NetMessage) => void>();
      channel.on('broadcast', { event: 'm' }, ({ payload }) => {
        if (!isNetMessage(payload)) return;
        for (const fn of [...listeners]) fn(payload);
      });
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error(`room ${status}`));
          }
        });
      });
      return {
        code,
        send(msg) {
          void channel.send({ type: 'broadcast', event: 'm', payload: msg });
        },
        onMessage(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        close() {
          listeners.clear();
          void sb.removeChannel(channel);
        },
      };
    },
    async deleteProfile() {
      const sb = await sdk();
      check(await sb.rpc('delete_me'));
      if (inviteChannel) void sb.removeChannel(inviteChannel);
      inviteChannel = null;
      await sb.auth.signOut();
      me = null;
    },
  };
}
