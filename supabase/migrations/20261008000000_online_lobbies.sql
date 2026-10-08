-- Blastyard online private lobbies: profiles (display name + friend code), friendships, invites.
-- Sign-in is anonymous (Supabase Auth → "Allow anonymous sign-ins" must be on). Lobbies
-- themselves live only in Realtime broadcast channels (`lobby:<CODE>`); nothing about a match is
-- stored. Every table has row level security; writes go through the functions below.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Player' check (char_length(name) between 1 and 16),
  friend_code text not null unique check (friend_code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  owner uuid not null references public.profiles (id) on delete cascade,
  friend uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, friend),
  check (owner <> friend)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  from_name text not null,
  to_id uuid not null references public.profiles (id) on delete cascade,
  lobby_code text not null check (lobby_code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  created_at timestamptz not null default now()
);
create index if not exists invites_to_idx on public.invites (to_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.invites enable row level security;

-- Read: yourself, and the profiles of your friends.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (select 1 from public.friendships f where f.owner = auth.uid() and f.friend = id)
  );
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select to authenticated
  using (owner = auth.uid());
-- Invites: the recipient reads (and Realtime delivers) them; either side may delete.
drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
  using (to_id = auth.uid());
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete to authenticated
  using (to_id = auth.uid() or from_id = auth.uid());

-- A new random friend code (6 characters of the lobby-code alphabet).
create or replace function public.new_friend_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end $$;

-- The caller's profile, created on first use.
create or replace function public.ensure_profile() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then
    insert into public.profiles (id, friend_code) values (auth.uid(), public.new_friend_code())
    returning * into me;
  end if;
  return me;
end $$;

create or replace function public.set_name(new_name text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
begin
  update public.profiles set name = left(btrim(regexp_replace(new_name, '\s+', ' ', 'g')), 16)
    where id = auth.uid() returning * into me;
  return me;
end $$;

-- Adds a friend by friend code; friendships are mutual. Null when the code is unknown.
create or replace function public.add_friend(code text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  other public.profiles;
begin
  select * into other from public.profiles where friend_code = upper(code);
  if not found or other.id = auth.uid() then return null; end if;
  insert into public.friendships (owner, friend) values (auth.uid(), other.id), (other.id, auth.uid())
    on conflict do nothing;
  return other;
end $$;

create or replace function public.remove_friend(other uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.friendships
    where (owner = auth.uid() and friend = other) or (owner = other and friend = auth.uid());
$$;

create or replace function public.my_friends() returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.friendships f join public.profiles p on p.id = f.friend
    where f.owner = auth.uid() order by p.name;
$$;

-- Invites a friend to a lobby (friends only; at most one pending invite per pair and lobby).
create or replace function public.invite_friend(other uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
begin
  if not exists (select 1 from public.friendships where owner = auth.uid() and friend = other) then
    raise exception 'not a friend';
  end if;
  select * into me from public.profiles where id = auth.uid();
  delete from public.invites where created_at < now() - interval '1 day';
  delete from public.invites where from_id = auth.uid() and to_id = other and lobby_code = code;
  insert into public.invites (from_id, from_name, to_id, lobby_code)
    values (auth.uid(), me.name, other, upper(code));
end $$;

-- Deletes the caller's online profile, friendships and invites (Settings → delete online profile).
create or replace function public.delete_me() returns void
language sql security definer set search_path = public as $$
  delete from public.profiles where id = auth.uid();
$$;

revoke all on function public.new_friend_code() from public, anon, authenticated;
grant execute on function public.ensure_profile(), public.set_name(text), public.add_friend(text),
  public.remove_friend(uuid), public.my_friends(), public.invite_friend(uuid, text),
  public.delete_me() to authenticated;

-- Live invites for the recipient.
do $$ begin
  alter publication supabase_realtime add table public.invites;
exception when duplicate_object then null; end $$;
