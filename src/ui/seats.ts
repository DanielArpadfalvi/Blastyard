import type { SeatPlan } from '../game/modes';
import { t } from '../i18n';
import { SEAT_COLORS } from '../render/palette';

/** CSS colour of a seat. */
export function seatCss(seat: number): string {
  return `#${(SEAT_COLORS[seat] ?? 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Display name of a seat: "You" / "Bot" in solo, "Player n" otherwise. */
export function seatName(plan: readonly SeatPlan[], seat: number): string {
  const p = plan[seat];
  const humans = plan.filter((x) => x.kind === 'human').length;
  if (p?.kind === 'bot') {
    return plan.filter((x) => x.kind === 'bot').length > 1
      ? t('seatBotN', { n: seat + 1 })
      : t('seatBot');
  }
  if (p?.kind === 'human' && humans === 1) return t('seatYou');
  return t('seatPlayer', { n: seat + 1 });
}

/** True when `seat` is the only human (solo): texts address the player directly. */
export function isSoloHuman(plan: readonly SeatPlan[], seat: number): boolean {
  return plan[seat]?.kind === 'human' && plan.filter((x) => x.kind === 'human').length === 1;
}
