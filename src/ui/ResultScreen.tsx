import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { MatchResult } from '../game/session';
import { t } from '../i18n';
import { SeatBadge } from './SeatBadge';
import { isSoloHuman, seatName } from './seats';

/**
 * Match result overlay: winner, then per seat the rounds won and the match stats (knock-outs,
 * own-pop knock-outs, pops, power-ups); play again / back to the menu.
 */
export function ResultScreen(props: {
  result: MatchResult;
  onAgain: () => void;
  onMenu: () => void;
  /** Text of the "again" button (online: back to the lobby). */
  againLabel?: string;
  /** Shown under the buttons (the one-off Blastyard+ card). */
  children?: ComponentChildren;
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
        <table class="result-table" data-testid="result-table">
          <thead>
            <tr>
              <th />
              <th>{t('roundsWon')}</th>
              <th>{t('statKnockouts')}</th>
              <th>{t('statSelfKnockouts')}</th>
              <th>{t('statPops')}</th>
              <th>{t('statPowerUps')}</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((p) => {
              const st = result.stats[p.seat];
              return (
                <tr key={p.seat} class={won(p.seat) ? 'winner' : ''}>
                  <td class="result-who">
                    <SeatBadge seat={p.seat} />
                    <span class="seat-name">{seatName(result.plan, p.seat)}</span>
                    {teams && (
                      <span class="team-tag">{t('teamTag', { n: (teams[p.seat] ?? 0) + 1 })}</span>
                    )}
                  </td>
                  <td>
                    <b data-testid={`result-wins-${p.seat}`}>{result.wins[p.seat] ?? 0}</b>
                  </td>
                  <td data-testid={`result-ko-${p.seat}`}>{st?.knockouts ?? 0}</td>
                  <td>{st?.selfKnockouts ?? 0}</td>
                  <td>{st?.pops ?? 0}</td>
                  <td>{st?.powerUps ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div class="result-buttons">
          <button
            type="button"
            ref={again}
            class="mode-button"
            data-testid="play-again"
            onClick={onAgain}
          >
            <span class="mode-name">{props.againLabel ?? t('playAgain')}</span>
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
        {props.children}
      </div>
    </div>
  );
}
