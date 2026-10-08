import { useCallback, useEffect, useState } from 'preact/hooks';
import type { PartyConfig } from '../game/party';
import { isDailyLevel } from '../game/daily';
import type { SessionSnapshot } from '../game/session';
import type { GameShell, ShellState } from '../game/shell';
import { onLanguageChange, t } from '../i18n';
import { ChallengeMap } from './ChallengeMap';
import { ChallengeResultScreen } from './ChallengeResult';
import { DailyScreen } from './DailyScreen';
import { Hud } from './Hud';
import { PartySetup } from './PartySetup';
import { PauseOverlay } from './PauseOverlay';
import { ResultScreen } from './ResultScreen';
import { SettingsPanel } from './SettingsPanel';
import { StartScreen } from './StartScreen';
import { TouchTester } from './TouchTester';

export interface AppProps {
  shell?: GameShell | undefined;
  /** Show the device-test tools on the start screen (web preview build or `?spike`). */
  spike?: boolean;
  /** Open the touch tester right away (`?touchtest`). */
  touchTest?: boolean;
}

/** What the menu backdrop shows next to the start screen. */
type MenuView = 'start' | 'party' | 'challenges' | 'daily';

/** Where "leave" from a paused match goes back to. */
function leaveView(snapshot: SessionSnapshot | null): MenuView {
  if (snapshot?.mode !== 'challenge') return 'start';
  return snapshot.challenge && isDailyLevel({ id: snapshot.challenge.levelId })
    ? 'daily'
    : 'challenges';
}

/** Root of the DOM overlay drawn above the Pixi canvas. */
export function App({ shell, spike = false, touchTest = false }: AppProps) {
  const [, setRevision] = useState(0);
  const [tester, setTester] = useState(touchTest);
  const [settings, setSettings] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('start');
  const [mapWorld, setMapWorld] = useState(1);
  const [party, setParty] = useState<PartyConfig | null>(() => shell?.getParty().config ?? null);
  const [state, setState] = useState<ShellState | null>(shell ? shell.getState() : null);
  useEffect(() => onLanguageChange(() => setRevision((r) => r + 1)), []);
  useEffect(() => (shell ? shell.subscribe(setState) : undefined), [shell]);
  // Stars and the entitlement change what the map shows.
  useEffect(() => {
    if (!shell) return undefined;
    const bump = (): void => setRevision((r) => r + 1);
    const offProgress = shell.progress.subscribe(bump);
    const offDaily = shell.daily.subscribe(bump);
    const offPlus = shell.entitlements.subscribe(bump);
    return () => {
      offProgress();
      offDaily();
      offPlus();
    };
  }, [shell]);

  const screen = state?.screen;
  const result = state?.result;
  const challengeResult = state?.challengeResult;
  const paused = state?.snapshot?.paused === true;
  useEffect(() => {
    if (!shell || (screen !== 'playing' && screen !== 'lobby')) return undefined;
    // Desktop: Escape pauses the match (and resumes it); in the lobby it goes back.
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      if (screen === 'lobby') {
        shell.showMenu();
        setMenuView('party');
      } else shell.setPaused(!paused);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shell, screen, paused]);

  const toMenu = (view: MenuView = 'start'): void => {
    shell?.showMenu();
    setMenuView(view);
  };
  const stored = shell?.getParty();
  const prepareDaily = useCallback(
    () => (shell ? shell.prepareDaily() : Promise.reject(new Error('no shell'))),
    [shell],
  );
  const menu = shell && screen === 'menu' && !tester && !settings;

  return (
    <div class="overlay" data-testid="ui-root">
      {shell && menu && menuView === 'start' && (
        <StartScreen
          onStart={(m, bots) => shell.start(m, bots)}
          onParty={() => setMenuView('party')}
          onQuick={() => shell.startQuick()}
          onChallenges={() => setMenuView('challenges')}
          onDaily={() => setMenuView('daily')}
          dailyStreak={shell.daily.view(shell.today()).streak}
          quickLevel={stored?.quickLevel}
          onQuickLevel={(level) => {
            if (stored) shell.setParty({ ...stored, quickLevel: level });
            setRevision((r) => r + 1);
          }}
          spike={spike}
          onTouchTest={() => setTester(true)}
          cornerBots={shell.options.bots}
          onSettings={() => setSettings(true)}
        />
      )}
      {shell && menu && menuView === 'party' && party && (
        <PartySetup
          config={party}
          hasPlus={shell.hasPlus()}
          onChange={(next) => {
            setParty(next);
            shell.setParty({ config: next, quickLevel: stored?.quickLevel ?? 2 });
          }}
          onPlay={(config) => shell.startLobby(config)}
          onBack={() => setMenuView('start')}
        />
      )}
      {shell && menu && menuView === 'challenges' && (
        <ChallengeMap
          progress={shell.progress}
          hasPlus={shell.hasPlus()}
          world={mapWorld}
          onPlay={(id) => {
            setMapWorld(Number(id.charAt(1)) || 1);
            shell.startChallenge(id);
          }}
          onBack={() => setMenuView('start')}
        />
      )}
      {shell && menu && menuView === 'daily' && (
        <DailyScreen
          prepare={prepareDaily}
          view={(day) => shell.daily.view(day)}
          onPlay={() => shell.startDaily()}
          onBack={() => setMenuView('start')}
        />
      )}
      {shell && screen === 'menu' && settings && (
        <SettingsPanel store={shell.settings} onBack={() => setSettings(false)} />
      )}
      {tester && <TouchTester onBack={() => setTester(false)} />}
      {shell &&
        (screen === 'playing' || screen === 'lobby' || screen === 'result') &&
        state?.snapshot && (
          <Hud
            snapshot={state.snapshot}
            banners={screen === 'playing'}
            onPause={() => shell.setPaused(true)}
            onTurnSeat={(seat) => shell.turnSeat(seat)}
            onReadyAll={() => shell.readyAll()}
            onLeave={() => toMenu('party')}
          />
        )}
      {shell && screen === 'playing' && paused && (
        <PauseOverlay
          onResume={() => shell.setPaused(false)}
          onRestart={() => shell.again()}
          onLeave={() => toMenu(leaveView(state?.snapshot ?? null))}
        />
      )}
      {shell && screen === 'result' && result && result.mode !== 'attract' && (
        <ResultScreen result={result} onAgain={() => shell.again()} onMenu={() => toMenu()} />
      )}
      {shell && screen === 'challengeResult' && challengeResult && (
        <ChallengeResultScreen
          result={challengeResult}
          hasNext={shell.nextChallengeId() !== null}
          onRetry={() => shell.again()}
          onNext={() => shell.startNextChallenge()}
          onMap={() => toMenu(challengeResult.daily ? 'daily' : 'challenges')}
        />
      )}
      <div class="rotate-hint" role="status">
        {t('rotateDevice')}
      </div>
    </div>
  );
}
