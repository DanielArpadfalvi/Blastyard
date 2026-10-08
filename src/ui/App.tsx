import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PartyConfig } from '../game/party';
import { isDailyLevel } from '../game/daily';
import type { SessionSnapshot } from '../game/session';
import type { GameShell, ShellState } from '../game/shell';
import { onLanguageChange, t } from '../i18n';
import { ChallengeMap } from './ChallengeMap';
import { ChallengeResultScreen } from './ChallengeResult';
import { DailyScreen } from './DailyScreen';
import { Customize } from './Customize';
import { TipBanner, TutorialDone, TutorialHint } from './Tutorial';
import { TUTORIAL_ID } from '../content/tutorial';
import { Hud } from './Hud';
import { PartySetup } from './PartySetup';
import { PauseOverlay } from './PauseOverlay';
import { Paywall, PlusCard } from './Paywall';
import { InviteToast, LobbyScreen, OnlineScreen } from './Online';
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
type MenuView = 'start' | 'party' | 'challenges' | 'daily' | 'customize' | 'online';

/** Where "leave" from a paused match goes back to. */
function leaveView(snapshot: SessionSnapshot | null): MenuView {
  if (snapshot?.challenge?.levelId === TUTORIAL_ID) return 'start';
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
  const [paywall, setPaywall] = useState(false);
  const [plusCardClosed, setPlusCardClosed] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('start');
  const [mapWorld, setMapWorld] = useState(1);
  const [party, setParty] = useState<PartyConfig | null>(() => shell?.getParty().config ?? null);
  const [state, setState] = useState<ShellState | null>(shell ? shell.getState() : null);
  useEffect(() => onLanguageChange(() => setRevision((r) => r + 1)), []);
  useEffect(() => (shell ? shell.subscribe(setState) : undefined), [shell]);
  // The touch tester is opaque and full screen: nothing behind it needs drawing.
  useEffect(() => {
    shell?.setCovered(tester);
    return () => shell?.setCovered(false);
  }, [shell, tester]);
  // Stars and the entitlement change what the map shows.
  useEffect(() => {
    if (!shell) return undefined;
    const bump = (): void => setRevision((r) => r + 1);
    const offProgress = shell.progress.subscribe(bump);
    const offDaily = shell.daily.subscribe(bump);
    const offPlus = shell.entitlements.subscribe(bump);
    // Online: entering / leaving a lobby switches the menu screen.
    let phase = shell.online.get().view.phase;
    const offOnline = shell.online.subscribe((snap) => {
      if (snap.view.phase === phase) return;
      if (phase === 'lobby' || phase === 'joining') {
        if (snap.view.phase === 'idle') setMenuView('online');
      }
      phase = snap.view.phase;
      bump();
    });
    return () => {
      offProgress();
      offDaily();
      offPlus();
      offOnline();
    };
  }, [shell]);

  const screen = state?.screen;
  const result = state?.result;
  const challengeResult = state?.challengeResult;
  const paused = state?.snapshot?.paused === true;
  const onlinePhase = shell?.online.get().view.phase ?? 'idle';
  const inLobby = onlinePhase === 'lobby' || onlinePhase === 'joining';
  const onlineMatch = state?.snapshot?.mode === 'online' || result?.mode === 'online';
  const toMenu = (view: MenuView = 'start'): void => {
    shell?.showMenu();
    setMenuView(view);
  };

  /**
   * One step back (Android back button, Escape on desktop; T6.1): close a panel, pause / resume
   * the match, leave the lobby or a result, go up a menu level. False on the start screen, where
   * the platform may leave the app.
   */
  const goBack = (): boolean => {
    if (!shell) return false;
    if (paywall) {
      setPaywall(false);
      return true;
    }
    if (tester) {
      setTester(false);
      return true;
    }
    if (settings) {
      setSettings(false);
      return true;
    }
    if (onlineMatch && (screen === 'playing' || screen === 'result')) {
      // Leaving an online match leaves its lobby too (the others play on without us).
      shell.online.leave();
      toMenu('online');
      return true;
    }
    if (screen === 'menu' && inLobby) {
      shell.online.leave();
      return true;
    }
    switch (screen) {
      case 'playing':
        shell.setPaused(!paused);
        return true;
      case 'lobby':
        toMenu('party');
        return true;
      case 'result':
      case 'tutorialDone':
        toMenu();
        return true;
      case 'challengeResult':
        toMenu(challengeResult?.daily ? 'daily' : 'challenges');
        return true;
      default:
        if (menuView === 'start') return false;
        setMenuView('start');
        return true;
    }
  };
  const back = useRef(goBack);
  back.current = goBack;
  useEffect(() => {
    if (!shell) return undefined;
    shell.back.setHandler(() => back.current());
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') shell.back.trigger();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      shell.back.setHandler(null);
    };
  }, [shell]);
  const stored = shell?.getParty();
  const prepareDaily = useCallback(
    () => (shell ? shell.prepareDaily() : Promise.reject(new Error('no shell'))),
    [shell],
  );
  const menu = shell && screen === 'menu' && !tester && !settings;
  const thumbnail = useCallback(
    (kind: 'puff' | 'hat' | 'pop', id: string, seat: number) =>
      shell ? shell.thumbnail(kind, id, seat) : Promise.reject(new Error('no shell')),
    [shell],
  );

  return (
    <div class="overlay" data-testid="ui-root">
      {shell && menu && inLobby && <LobbyScreen client={shell.online} />}
      {shell && menu && !inLobby && menuView === 'online' && (
        <OnlineScreen client={shell.online} onBack={() => setMenuView('start')} />
      )}
      {shell && menu && !inLobby && menuView !== 'online' && (
        <InviteToast client={shell.online} onJoin={() => setMenuView('online')} />
      )}
      {shell && menu && !inLobby && menuView === 'start' && (
        <StartScreen
          onStart={(m, bots) => shell.start(m, bots)}
          onParty={() => setMenuView('party')}
          onOnline={() => setMenuView('online')}
          onQuick={() => shell.startQuick()}
          onChallenges={() => setMenuView('challenges')}
          onDaily={() => setMenuView('daily')}
          dailyStreak={shell.daily.view(shell.today()).streak}
          onTutorial={() => shell.startTutorial()}
          onCustomize={() => setMenuView('customize')}
          onLanguage={(lang) => shell.settings.update({ language: lang })}
          tutorialDone={shell.tips.tutorialDone}
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
          onLocked={() => setPaywall(true)}
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
          onPlus={() => setPaywall(true)}
          {...(shell.online.available
            ? { onDeleteOnline: () => shell.online.deleteProfile() }
            : {})}
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
      {shell && menu && menuView === 'customize' && (
        <Customize
          looks={shell.looks}
          progress={shell.progressContext()}
          trophies={shell.trophyContext()}
          stats={shell.stats.get()}
          favouriteArena={shell.stats.favouriteArena()}
          thumbnail={thumbnail}
          onBack={() => {
            // New looks show on the menu backdrop right away.
            toMenu('start');
          }}
          onLocked={() => setPaywall(true)}
        />
      )}
      {shell && screen === 'menu' && settings && (
        <SettingsPanel
          store={shell.settings}
          entitlements={shell.entitlements}
          onTouchTest={() => {
            setSettings(false);
            setTester(true);
          }}
          onBack={() => setSettings(false)}
          onPlus={() => setPaywall(true)}
        />
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
      {shell &&
        screen === 'playing' &&
        state?.snapshot?.challenge?.levelId === TUTORIAL_ID &&
        !paused && (
          <TutorialHint
            snapshot={state.snapshot}
            retry={state.tutorialRetry === state.snapshot.challenge.progress.stage - 1}
            onSkip={() => {
              shell.skipTutorial();
              setMenuView('start');
            }}
          />
        )}
      {shell && screen === 'playing' && state?.tip && state.snapshot && (
        <TipBanner tip={state.tip} snapshot={state.snapshot} onDone={() => shell.clearTip()} />
      )}
      {shell && screen === 'tutorialDone' && (
        <TutorialDone onQuick={() => shell.startQuick()} onMenu={() => toMenu()} />
      )}
      {shell && screen === 'playing' && paused && (
        <PauseOverlay
          onResume={() => shell.setPaused(false)}
          onRestart={() => shell.again()}
          onLeave={() => toMenu(leaveView(state?.snapshot ?? null))}
        />
      )}
      {shell && screen === 'result' && result && result.mode === 'online' && (
        <ResultScreen
          result={result}
          againLabel={t('onlineBackToLobby')}
          onAgain={() => shell.backToOnlineLobby()}
          onMenu={() => {
            shell.online.leave();
            toMenu('online');
          }}
        />
      )}
      {shell &&
        screen === 'result' &&
        result &&
        result.mode !== 'attract' &&
        result.mode !== 'online' && (
          <ResultScreen result={result} onAgain={() => shell.again()} onMenu={() => toMenu()}>
            {state?.plusHint && !plusCardClosed && !shell.hasPlus() && (
              <PlusCard onOpen={() => setPaywall(true)} onDismiss={() => setPlusCardClosed(true)} />
            )}
          </ResultScreen>
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
      {shell && paywall && (
        <Paywall entitlements={shell.entitlements} onClose={() => setPaywall(false)} />
      )}
      <div class="rotate-hint" role="status">
        {t('rotateDevice')}
      </div>
    </div>
  );
}
