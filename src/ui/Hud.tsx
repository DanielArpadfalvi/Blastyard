import type { HudModel, SeatHud } from '../game/hud';
import { formatClock } from '../game/hud';
import type { SeatPlan } from '../game/modes';
import { localSize, zoneScreenPoint } from '../input/rotation';
import type { SessionSnapshot } from '../game/session';
import { t } from '../i18n';
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

/**
 * Where each seat's panel goes: at the far edge of the seat's zone as its player sees it, rotated
 * toward them – top of the strip in solo, the arena side of the strip in face-off, the middle of
 * the strip (away from the hand) in the four-corner layout. Seats without a zone (solo bot, corner
 * bots) use their strip / corner area.
 */
function panelPlace(snapshot: SessionSnapshot, plan: SeatPlan): Placed {
  const { left, right, zones } = snapshot.zones;
  const corners = snapshot.mode === 'corners';
  const zone = snapshot.mode === 'solo' ? undefined : zones.find((z) => z.seat === plan.seat);
  let area = zone?.rect ?? (plan.seat % 2 === 0 ? left : right);
  if (!zone && corners) {
    // Bot corner: same rectangle a player there would get.
    const h = area.h / 2;
    area = plan.seat < 2 ? { ...area, h } : { ...area, y: area.y + h, h };
  }
  const inset = plan.orientation === 0 && !corners ? 44 : 48;
  const local = localSize(area, plan.orientation);
  const at = zoneScreenPoint(area, plan.orientation, local.w / 2, inset);
  return { x: at.x, y: at.y, rotate: plan.orientation };
}

/** Banner offset (fraction of the arena) toward a player's edge, per orientation. */
const BANNER_SHIFT: Record<SeatPlan['orientation'], { x: number; y: number }> = {
  0: { x: 0, y: 0.2 },
  90: { x: -0.2, y: 0 },
  180: { x: 0, y: -0.2 },
  270: { x: 0.2, y: 0 },
};

function bannerText(hud: HudModel, plan: readonly SeatPlan[], viewer: number): string | null {
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
}) {
  const { snapshot, plan, seat, showClock } = props;
  const hud = snapshot.hud;
  const cls = `seat-panel${seat.alive ? '' : ' seat-out'}`;
  return (
    <div
      class={cls}
      data-testid={`seat-panel-${seat.seat}`}
      style={placedStyle(panelPlace(snapshot, plan))}
    >
      <div class="seat-head">
        <SeatBadge seat={seat.seat} />
        <span class="seat-name">{seatName(snapshot.plan, seat.seat)}</span>
        <WinPips wins={seat.wins} target={hud.winsToMatch} />
        {showClock && <span class="seat-clock">{formatClock(hud.seconds)}</span>}
      </div>
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
    </div>
  );
}

/** Match HUD: round clock, per-seat panels rotated toward their seats, round banners. */
export function Hud({
  snapshot,
  banners: showBanners = true,
}: {
  snapshot: SessionSnapshot;
  banners?: boolean;
}) {
  const { hud, layout, plan } = snapshot;
  const humans = plan.filter((p) => p.kind === 'human');
  const faceoff = humans.length > 1;
  const a = layout.arena;
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
    <div class="hud" data-testid="hud">
      <div
        class={hud.suddenDeath ? 'hud-clock hud-clock-sd' : 'hud-clock'}
        data-testid="hud-clock"
        style={{ left: `${layout.width / 2}px`, top: `${Math.max(14, a.y / 2)}px` }}
      >
        <span class="hud-round">{t('roundLabel', { n: Math.max(1, hud.round) })}</span>
        <b>{formatClock(hud.seconds)}</b>
        <span class="hud-round">{t('firstTo', { n: hud.winsToMatch })}</span>
      </div>
      {plan
        .filter((p) => p.kind !== 'off')
        .map((p) => (
          <SeatPanel
            key={p.seat}
            snapshot={snapshot}
            plan={p}
            seat={hud.seats[p.seat] as SeatHud}
            showClock={faceoff}
          />
        ))}
      {showBanners &&
        banners.map((b) => {
          const text = bannerText(hud, plan, b.viewer);
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
