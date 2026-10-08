# Online private lobbies

Friends play on their own phones: one creates a lobby and shares its six-character code (or
invites friends from the friend list – they get a notification in the app), the others join with
the code or the invite, the host picks the rules and starts. Up to four players; empty seats can
be bots. No matchmaking with strangers, no rankings.

## How it works
| Part | File | Notes |
|---|---|---|
| Lobby protocol (pure) | `src/net/lobby.ts` | codes, host-authoritative lobby state, match start → identical `MatchSetup` on every phone |
| Rollback netcode (pure) | `src/net/rollback.ts` | input delay 3 ticks, prediction = last known input, snapshot / restore re-simulation (≤ 10 ticks, wider for an agreed drop), acks + resend, stall instead of runaway, state hashes every 2 s |
| Match driver | `src/game/netMatch.ts` | rollback ↔ session (`Stepper` in `MatchRunner`), 30 input packets / s, desync check, host drops a silent player at an agreed tick |
| Client | `src/game/online.ts` | identity, friends, invites, create / join / ready / rules / start / leave, heartbeat (2 s ping, 9 s timeout) |
| Platform port | `src/platform/net.ts` | `NetPort`; bus implementation (unit tests: in memory; `?net=local`: tabs of one browser over BroadcastChannel) |
| Supabase backend | `src/platform/supabaseNet.ts`, `supabase/migrations/*_online_lobbies.sql` | anonymous sign-in, profiles / friendships / invites with RLS and security-definer functions, invites live via Postgres changes, one Realtime broadcast channel per lobby (`lobby:<CODE>`) |
| UI | `src/ui/Online.tsx` | Online hub, lobby, invite notification; Settings → About → Delete online profile |

Each phone runs the whole deterministic simulation; only input bytes travel. Bots run inside the
simulation, so they behave identically everywhere. Online matches cannot pause and always run at
100 % speed.

Tests: `tests/unit/net/rollback.test.ts` (2–4 phones over a simulated network with lag, jitter,
reordering and up to 40 % loss stay hash-identical to the offline simulation; stall; drop),
`tests/unit/net/online.test.ts` (lobby flow, full lobby, wrong code, friends, invites, host /
guest timeouts), `tests/e2e/online.spec.ts` (three browser tabs: friend code, invite notification,
join by code, a synced match with hash checks).

## Owner setup (to switch online play on)
1. Supabase project (the org's free tier allows two active projects – two are active now:
   pause one, upgrade, or use another org). Region: EU (e.g. `eu-central-1`).
2. SQL editor: run `supabase/migrations/20261008000000_online_lobbies.sql`.
3. Authentication → Sign In / Providers → **Allow anonymous sign-ins** on. (Recommended: enable
   CAPTCHA / rate limits for anonymous sign-ins against abuse.)
4. Realtime is on by default (broadcast + Postgres changes on `invites` are set by the migration).
5. GitHub → Settings → Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the public anon
   key). `android.yml`, `ios.yml`, `release.yml` and `pages.yml` pass them to the build. Without
   them the Online screen says "not available".
6. Push notifications for invites while the app is closed need FCM (Android) / APNs (iOS) keys
   and a Supabase Edge Function – not built yet (decision pending); today invites arrive live
   while the app is open and are listed when it is opened again.

## Limits (Supabase free tier)
Realtime: ~100 messages / s per project. A 4-phone match sends 4 × 30 = 120 input packets / s
plus pings – fine for a few parallel matches; raise `SEND_EVERY` in `netMatch.ts` (3 → 80 / s) or
move to a paid plan / WebRTC peer-to-peer for more.
