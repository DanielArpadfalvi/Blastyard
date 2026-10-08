import { useRef, useState } from 'preact/hooks';
import type { HudModel, SeatHud } from '../game/hud';
import { formatClock } from '../game/hud';
import type { LobbySeatView } from '../game/lobby';
import type { SeatPlan } from '../game/modes';
import type { ChallengeHud, SessionSnapshot } from '../game/session';
import { localSize, zoneScreenPoint, type SeatOrientation } from '../input/rotation';
import { t, type TranslationKey } from '../i18n';
import { SeatBadge } from './SeatBadge';
import { isSoloHuman, seatName } from './seats';

interface Placed {
  x: number;
  y: number;
  rotate: number;
}

function placedStyle(p: Placed) {
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    transform: `translate(-50%, -50%) rotate(${p.rotate}deg)`,
  };
}

/** Hold time of the pause button (PLAN §1.3: a stray touch must not pause the table). */
export const PAUSE_HOLD_MS = 600;

/** Strip (screen side) a face-off seat belongs to: even seats left, odd seats right. */
function stripOf(snapshot: SessionSnapshot, seat: number) {
  return seat % 2 === 0 ? snapshot.zones.left : snapshot.zones.right;
}

/**
 * Where each seat's panel goes: at the far edge of the seat's zone as its player sees it, rotated
 * toward them – top of the strip in solo, the arena side of the strip in face-off, the middle of
 * the strip (away from the hand) in the four-corner layout. Bot seats have no zone: a lone bot
 * takes the strip / corner a player there would get, several bots become compact chips stacked in
 * the free strip (solo) or along the strip's far edge (face-off).
 */
function panelPlace(snapshot: SessionSnapshot, plan: SeatPlan): Placed & { compact: boolean } {
  const { left, right, zones } = snapshot.zones;
  const kind = snapshot.kind;
  const bots = snapshot.plan.filter((p) => p.kind === 'bot');
  const zone = kind === 'solo' ? undefined : zones.find((z) => z.seat === plan.seat);
  if (plan.kind === 'human' || zone) {
    const area = zone?.rect ?? (plan.seat % 2 === 0 ? left : right);
    const inset = plan.orientation === 0 && kind !== 'corners' ? 44 : 48;
    const local = localSize(area, plan.orientation);
    const at = zoneScreenPoint(area, plan.orientation, local.w / 2, inset);
    return { x: at.x, y: at.y, rotate: plan.orientation, compact: false };
  }
  const k = bots.findIndex((b) => b.seat === plan.seat);
  if (kind === 'corners') {
    // Bot corner: same rectangle a player there would get.
    let area = plan.seat % 2 === 0 ? left : right;
    const h = area.h / 2;
    area = plan.seat < 2 ? { ...area, h } : { ...area, y: area.y + h, h };
    const local = localSize(area, plan.orientation);
    const at = zoneScreenPoint(area, plan.orientation, local.w / 2, 48);
    return { x: at.x, y: at.y, rotate: plan.orientation, compact: false };
  }
  if (kind === 'solo') {
    if (bots.length <= 1) {
      return { x: right.x + right.w / 2, y: right.y + 44, rotate: 0, compact: false };
    }
    return { x: right.x + right.w / 2, y: right.y + 28 + k * 46, rotate: 0, compact: true };
  }
  // Face-off: a bot sits along the far edge of its strip, turned towards the strip's side.
  const area = stripOf(snapshot, plan.seat);
  const orientation = (snapshot.plan[plan.seat % 2]?.orientation ??
    (plan.seat % 2 === 0 ? 90 : 270)) as SeatOrientation;
  const mates = bots.filter((b) => b.seat % 2 === plan.seat % 2);
  const j = mates.findIndex((b) => b.seat === plan.seat);
  const ownerHuman = snapshot.plan[plan.seat % 2]?.kind === 'human';
  const fractions = ownerHuman
    ? mates.length === 1
      ? [0.14]
      : [0.14, 0.86]
    : mates.map((_, i) => (i + 1) / (mates.length + 1));
  const local = localSize(area, orientation);
  const at = zoneScreenPoint(area, orientation, local.w * (fractions[j] ?? 0.5), 30);
  return { x: at.x, y: at.y, rotate: orientation, compact: true };
}

/** Banner offset (fraction of the arena) toward a player's edge, per orientation. */
const BANNER_SHIFT: Record<SeatPlan['orientation'], { x: number; y: number }> = {
  0: { x: 0, y: 0.2 },
  90: { x: -0.2, y: 0 },
  180: { x: 0, y: -0.2 },
  270: { x: 0.2, y: 0 },
};

function bannerText(
  hud: HudModel,
  plan: readonly SeatPlan[],
  viewer: number,
  teams: readonly number[] | null,
): string | null {
  const b = hud.banner;
  switch (b.kind) {
    case 'countdown':
      return String(b.value);
    case 'go':
      return t('go');
    case 'suddenDeath':
      return t('suddenDeath');
    case 'roundOver':
      if (b.winner < 0) return t('roundDraw');
      if (teams) return t('roundWonTeam', { n: b.winner + 1 });
      return isSoloHuman(plan, b.winner) && viewer === b.winner
        ? t('roundWonYou')
        : t('roundWonBy', { name: seatName(plan, b.winner) });
    default:
      return null;
  }
}

function WinPips({ wins, target }: { wins: number; target: number }) {
  return (
    <span class="pips" aria-label={`${wins}/${target}`}>
      {Array.from({ length: target }, (_, i) => (
        <span class={i < wins ? 'pip pip-on' : 'pip'} />
      ))}
    </span>
  );
}

function SeatPanel(props: {
  snapshot: SessionSnapshot;
  plan: SeatPlan;
  seat: SeatHud;
  showClock: boolean;
  pips: boolean;
}) {
  const { snapshot, plan, seat, showClock, pips } = props;
  const hud = snapshot.hud;
  const place = panelPlace(snapshot, plan);
  const cls = `seat-panel${seat.alive ? '' : ' seat-out'}${place.compact ? ' seat-chip' : ''}`;
  return (
    <div class={cls} data-testid={`seat-panel-${seat.seat}`} style={placedStyle(place)}>
      <div class="seat-head">
        <SeatBadge seat={seat.seat} />
        <span class="seat-name">{seatName(snapshot.plan, seat.seat)}</span>
        {snapshot.teams && (
          <span class="team-tag" data-testid={`team-tag-${seat.seat}`}>
            {t('teamTag', { n: (snapshot.teams[seat.seat] ?? 0) + 1 })}
          </span>
        )}
        {pips && <WinPips wins={seat.wins} target={hud.winsToMatch} />}
        {showClock && <span class="seat-clock">{formatClock(hud.seconds)}</span>}
      </div>
      {!place.compact && (
        <div class="seat-stats">
          <span>
            {t('statPops')} <b>{seat.bombs}</b>
          </span>
          <span>
            {t('statFlame')} <b>{seat.range}</b>
          </span>
          <span>
            {t('statSpeed')} <b>{seat.speed}</b>
          </span>
        </div>
      )}
    </div>
  );
}

/** Where a lobby seat's prompt and turn arrow go, in the seat's zone as its player sees it. */
function lobbyPlace(snapshot: SessionSnapshot, plan: SeatPlan): { prompt: Placed; arrow: Placed } {
  const index = snapshot.zones.zones.findIndex((z) => z.seat === plan.seat);
  const zone = snapshot.zones.zones[index];
  if (!zone) {
    const c = { x: snapshot.layout.width / 2, y: snapshot.layout.height / 2, rotate: 0 };
    return { prompt: c, arrow: c };
  }
  if (snapshot.kind === 'solo') {
    const at = snapshot.zones.stickHints[index] ?? { x: zone.rect.x + 80, y: zone.rect.y + 80 };
    return {
      prompt: { x: at.x, y: at.y - 70, rotate: 0 },
      arrow: { x: at.x, y: at.y, rotate: 0 },
    };
  }
  const local = localSize(zone.rect, zone.orientation);
  const prompt = zoneScreenPoint(zone.rect, zone.orientation, local.w * 0.5, local.h * 0.3);
  const arrow = zoneScreenPoint(zone.rect, zone.orientation, local.w * 0.86, local.h * 0.14);
  return {
    prompt: { ...prompt, rotate: zone.orientation },
    arrow: { ...arrow, rotate: zone.orientation },
  };
}

const LOBBY_MESSAGE: Record<'idle' | 'joined' | 'ready', TranslationKey> = {
  idle: 'lobbyJoin',
  joined: 'lobbyHold',
  ready: 'lobbyReady',
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M12 3 L20 13 H15 V21 H9 V13 H4 Z"
        fill="currentColor"
        stroke="#2b2118"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function LobbySeat(props: {
  snapshot: SessionSnapshot;
  plan: SeatPlan;
  view: LobbySeatView;
  onTurn: (seat: number) => void;
}) {
  const { snapshot, plan, view, onTurn } = props;
  const place = lobbyPlace(snapshot, plan);
  const state = view.ready ? 'ready' : view.joined ? 'joined' : 'idle';
  return (
    <>
      <div
        class={`lobby-panel lobby-${state}`}
        data-testid={`lobby-seat-${plan.seat}`}
        data-state={state}
        style={placedStyle(place.prompt)}
      >
        <div class="seat-head">
          <SeatBadge seat={plan.seat} />
          <span class="seat-name">{seatName(snapshot.plan, plan.seat)}</span>
        </div>
        <span class="lobby-msg">{t(LOBBY_MESSAGE[state])}</span>
        <div class="ready-bar" aria-hidden="true">
          <i style={{ width: `${Math.round((view.ready ? 1 : view.progress) * 100)}%` }} />
        </div>
        <span class="lobby-tip">{t('lobbyControls')}</span>
      </div>
      {snapshot.kind !== 'solo' && (
        <button
          type="button"
          class="turn-arrow"
          data-testid={`turn-seat-${plan.seat}`}
          aria-label={t('turnSeat')}
          style={placedStyle(place.arrow)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onTurn(plan.seat)}
        >
          <ArrowIcon />
        </button>
      )}
    </>
  );
}

/** Hold-to-pause button at the top edge of the arena (0.6 s, PLAN §1.3). */
function PauseButton(props: { x: number; y: number; onPause: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = (e: PointerEvent): void => {
    e.stopPropagation();
    cancel();
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      props.onPause();
    }, PAUSE_HOLD_MS);
  };
  return (
    <button
      type="button"
      class={holding ? 'pause-btn pause-holding' : 'pause-btn'}
      data-testid="pause-button"
      aria-label={t('pauseHold')}
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span class="pause-icon" aria-hidden="true" />
    </button>
  );
}

const OBJECTIVE_KEY: Record<string, TranslationKey> = {
  crates: 'hudCrates',
  monsters: 'hudMonsters',
  flag: 'hudFlag',
  survive: 'hudSurvive',
  win: 'hudWin',
  collect: 'hudCollect',
  chain: 'hudChain',
};

function ChallengeBar(props: { challenge: ChallengeHud; x: number; y: number }) {
  const { challenge, x, y } = props;
  const p = challenge.progress;
  const showCount = p.type === 'crates' || p.type === 'monsters' || p.type === 'collect';
  return (
    <div
      class="challenge-bar"
      data-testid="challenge-bar"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <span class="challenge-goal">{t(OBJECTIVE_KEY[p.type] ?? 'hudWin')}</span>
      {showCount && (
        <b data-testid="challenge-count">
          {p.done}/{p.target}
        </b>
      )}
      {p.secondsLeft !== null && <b class="challenge-time">{formatClock(p.secondsLeft)}</b>}
      {p.stages > 1 && (
        <span class="challenge-stage" data-testid="challenge-stage">
          {t('hudStage', { n: p.stage, total: p.stages })}
        </span>
      )}
    </div>
  );
}

export interface HudProps {
  snapshot: SessionSnapshot;
  banners?: boolean;
  onPause?: () => void;
  onTurnSeat?: (seat: number) => void;
  onReadyAll?: () => void;
  onLeave?: () => void;
}

/** Match HUD: round clock, per-seat panels rotated toward their seats, round banners. */
export function Hud({
  snapshot,
  banners: showBanners = true,
  onPause,
  onTurnSeat,
  onReadyAll,
  onLeave,
}: HudProps) {
  const { hud, layout, plan } = snapshot;
  const humans = plan.filter((p) => p.kind === 'human');
  const faceoff = humans.length > 1;
  const a = layout.arena;
  const lobby = snapshot.lobby;
  const challenge = snapshot.challenge;
  const topY = Math.max(14, a.y / 2);
  // One banner per side of the table that has players, turned toward them.
  const sides = humans.filter(
    (p, i) => humans.findIndex((q) => q.orientation === p.orientation) === i,
  );
  const banners: Array<Placed & { viewer: number }> =
    sides.length > 1
      ? sides.map((p) => ({
          x: a.x + a.w * (0.5 + BANNER_SHIFT[p.orientation].x),
          y: a.y + a.h * (0.5 + BANNER_SHIFT[p.orientation].y),
          rotate: p.orientation,
          viewer: p.seat,
        }))
      : [
          {
            x: a.x + a.w / 2,
            y: a.y + a.h / 2,
            rotate: sides[0]?.orientation ?? 0,
            viewer: humans[0]?.seat ?? 0,
          },
        ];
  return (
    <div class="hud" data-testid="hud" data-paused={snapshot.paused ? '1' : '0'}>
      {lobby ? (
        <div
          class="lobby-bar"
          data-testid="lobby-bar"
          style={{ left: `${layout.width / 2}px`, top: `${topY}px` }}
        >
          <button
            type="button"
            class="lobby-btn"
            data-testid="lobby-back"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onLeave?.()}
          >
            {t('back')}
          </button>
          <span class="lobby-title">{t('lobbyTitle')}</span>
          <button
            type="button"
            class="lobby-btn"
            data-testid="lobby-ready-all"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onReadyAll?.()}
          >
            {t('lobbyReadyAll')}
          </button>
        </div>
      ) : challenge ? (
        <ChallengeBar challenge={challenge} x={layout.width / 2} y={topY} />
      ) : (
        <div
          class={hud.suddenDeath ? 'hud-clock hud-clock-sd' : 'hud-clock'}
          data-testid="hud-clock"
          style={{ left: `${layout.width / 2}px`, top: `${topY}px` }}
        >
          <span class="hud-round">{t('roundLabel', { n: Math.max(1, hud.round) })}</span>
          <b>{formatClock(hud.seconds)}</b>
          <span class="hud-round">{t('firstTo', { n: hud.winsToMatch })}</span>
        </div>
      )}
      {!lobby &&
        plan
          .filter((p) => p.kind !== 'off')
          .map((p) => (
            <SeatPanel
              key={p.seat}
              snapshot={snapshot}
              plan={p}
              seat={hud.seats[p.seat] as SeatHud}
              showClock={faceoff && !challenge}
              pips={!challenge}
            />
          ))}
      {lobby &&
        lobby.map((view) => (
          <LobbySeat
            key={view.seat}
            snapshot={snapshot}
            plan={plan[view.seat] as SeatPlan}
            view={view}
            onTurn={(seat) => onTurnSeat?.(seat)}
          />
        ))}
      {!lobby && onPause && <PauseButton x={layout.width / 2} y={topY + 34} onPause={onPause} />}
      {showBanners &&
        !lobby &&
        banners.map((b) => {
          const text = bannerText(hud, plan, b.viewer, snapshot.teams);
          if (!text) return null;
          const big = hud.banner.kind === 'countdown';
          return (
            <div
              key={b.viewer}
              class={big ? 'banner banner-big' : 'banner'}
              data-testid="hud-banner"
              style={{ ...placedStyle(b), maxWidth: `${a.h * 0.9}px` }}
            >
              {text}
            </div>
          );
        })}
    </div>
  );
}
