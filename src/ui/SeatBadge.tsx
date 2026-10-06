import { seatCss } from './seats';

/** Seat colour disc with the seat number (colour + number identity, PLAN §1.12). */
export function SeatBadge({ seat }: { seat: number }) {
  return (
    <span class="seat-badge" style={{ background: seatCss(seat) }} aria-hidden="true">
      {seat + 1}
    </span>
  );
}
