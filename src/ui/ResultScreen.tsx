import { useEffect, useRef } from 'preact/hooks';
import type { MatchResult } from '../game/session';
import { t } from '../i18n';
import { SeatBadge } from './SeatBadge';
import { isSoloHuman, seatName } from './seats';

/** Match result overlay: winner, rounds won per seat, play again / back to the menu. */
export function ResultScreen(props: {
  result: MatchResult;
  onAgain: () => void;
  onMenu: () => void;
}) {
  const { result, onAgain, onMenu } = props;
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus(), []);
  const seats = result.plan.filter((p) => p.kind !== 'off');
  const teams = result.teams;
  const headline = teams
    ? t('matchWonTeam', { n: result.winner + 1 })
    : isSoloHuman(result.plan, result.winner)
      ? t('matchWonYou')
      : t('matchWonBy', { name: seatName(result.plan, result.winner) });
  const won = (seat: number): boolean =>
    teams ? teams[seat] === result.winner : seat === result.winner;
  return (
    <div class="screen result-screen" data-testid="result-screen">
      <div class="card result-card">
        <p class="result-kicker">{t('matchOver')}</p>
        <h2 class="result-title" data-testid="result-title">
          {!teams && result.winner >= 0 && <SeatBadge seat={result.winner} />}
          {headline}
        </h2>
        <p class="result-sub">{t('roundsWon')}</p>
        <ul class="result-seats">
          {seats.map((p) => (
            <li key={p.seat} class={won(p.seat) ? 'winner' : ''}>
              <SeatBadge seat={p.seat} />
              <span class="seat-name">{seatName(result.plan, p.seat)}</span>
              {teams && (
                <span class="team-tag">{t('teamTag', { n: (teams[p.seat] ?? 0) + 1 })}</span>
              )}
              <b data-testid={`result-wins-${p.seat}`}>{result.wins[p.seat] ?? 0}</b>
            </li>
          ))}
        </ul>
        <div class="result-buttons">
          <button
            type="button"
            ref={again}
            class="mode-button"
            data-testid="play-again"
            onClick={onAgain}
          >
            <span class="mode-name">{t('playAgain')}</span>
          </button>
          <button
            type="button"
            class="mode-button secondary"
            data-testid="to-menu"
            onClick={onMenu}
          >
            <span class="mode-name">{t('backToMenu')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
