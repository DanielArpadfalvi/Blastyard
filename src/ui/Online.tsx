import { useEffect, useState } from 'preact/hooks';
import { BotLevel, RULE_PRESETS, WINS_TO_MATCH_OPTIONS, type PresetId } from '../core';
import type { OnlineClient, OnlineError, OnlineSnapshot } from '../game/online';
import { t, type TranslationKey } from '../i18n';
import { canStart, CODE_LENGTH, NAME_MAX, type LobbyState } from '../net/lobby';
import { shareText } from '../platform/share';
import { levelName } from './PartySetup';
import { Segmented } from './Segmented';
import { SeatBadge } from './SeatBadge';

const ERROR_KEY: Readonly<Record<OnlineError, TranslationKey>> = {
  unavailable: 'onlineErrUnavailable',
  'not-found': 'onlineErrNotFound',
  full: 'onlineErrFull',
  'host-left': 'onlineErrHostLeft',
  'bad-code': 'onlineErrBadCode',
  network: 'onlineErrNetwork',
  desync: 'onlineErrDesync',
};

const PRESET_KEY: Readonly<Record<PresetId, TranslationKey>> = {
  classic: 'presetClassic',
  fast: 'presetFast',
  chaos: 'presetChaos',
};

/** The client's state, re-rendered on every change. */
export function useOnline(client: OnlineClient): OnlineSnapshot {
  const [snap, setSnap] = useState(client.get());
  useEffect(() => client.subscribe(setSnap), [client]);
  return snap;
}

function ErrorLine({ client, error }: { client: OnlineClient; error: OnlineError | null }) {
  if (!error) return null;
  return (
    <p class="online-error" role="alert" data-testid="online-error">
      {t(ERROR_KEY[error])}{' '}
      <button type="button" class="link-button" onClick={() => client.clearError()}>
        {t('paywallClose')}
      </button>
    </p>
  );
}

function CodeInput(props: {
  testId: string;
  placeholder: string;
  value: string;
  onInput: (v: string) => void;
}) {
  return (
    <input
      class="code-input"
      data-testid={props.testId}
      value={props.value}
      maxLength={CODE_LENGTH + 2}
      autoCapitalize="characters"
      autoComplete="off"
      spellcheck={false}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value.toUpperCase())}
    />
  );
}

/**
 * Online hub: your name and friend code, create a lobby, join one by code, friends (add by code)
 * and the invites you got.
 */
export function OnlineScreen(props: { client: OnlineClient; onBack: () => void }) {
  const { client, onBack } = props;
  const snap = useOnline(client);
  const [code, setCode] = useState('');
  const [friendCode, setFriendCode] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [friendMsg, setFriendMsg] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void client.start();
  }, [client]);

  if (!client.available) {
    return (
      <div class="screen online-screen" data-testid="online-screen">
        <div class="card online-card">
          <h2 class="settings-title">{t('onlineTitle')}</h2>
          <p class="setting-hint" data-testid="online-unavailable">
            {t('onlineErrUnavailable')}
          </p>
          <div class="result-buttons">
            <button
              type="button"
              class="mode-button compact"
              data-testid="online-back"
              onClick={onBack}
            >
              <span class="mode-name">{t('back')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const me = snap.me;
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const addFriend = (): void =>
    void run(async () => {
      const r = await client.addFriend(friendCode);
      setFriendMsg(
        r === 'added'
          ? 'onlineFriendAdded'
          : r === 'self'
            ? 'onlineFriendSelf'
            : r === 'bad-code'
              ? 'onlineErrBadCode'
              : 'onlineFriendNotFound',
      );
      if (r === 'added') setFriendCode('');
    });

  return (
    <div class="screen online-screen" data-testid="online-screen">
      <div class="card online-card">
        <h2 class="settings-title">{t('onlineTitle')}</h2>
        <ErrorLine client={client} error={snap.error} />
        <section class="settings-section">
          <h3 class="settings-section-title">{t('onlineYou')}</h3>
          <div class="setting-row">
            <input
              class="name-input"
              data-testid="online-name"
              maxLength={NAME_MAX}
              value={name ?? me?.name ?? ''}
              aria-label={t('onlineName')}
              placeholder={t('onlineName')}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
              onBlur={() => {
                if (name !== null) void client.setName(name).then(() => setName(null));
              }}
            />
            <span class="friend-code" data-testid="online-friend-code">
              {t('onlineFriendCode')} <b>{me?.friendCode ?? '······'}</b>
            </span>
          </div>
        </section>
        <div class="online-actions">
          <button
            type="button"
            class="mode-button tile hero"
            data-testid="online-create"
            disabled={busy || !me}
            onClick={() => void run(() => client.createLobby())}
          >
            <span class="mode-name">{t('onlineCreate')}</span>
            <span class="mode-hint">{t('onlineCreateHint')}</span>
          </button>
          <div class="join-box">
            <CodeInput
              testId="online-code"
              placeholder={t('onlineCodePlaceholder')}
              value={code}
              onInput={setCode}
            />
            <button
              type="button"
              class="mode-button compact"
              data-testid="online-join"
              disabled={busy || code.replace(/[\s-]/g, '').length < CODE_LENGTH}
              onClick={() => void run(() => client.joinLobby(code))}
            >
              <span class="mode-name">{t('onlineJoin')}</span>
            </button>
          </div>
        </div>
        {snap.invites.length > 0 && (
          <section class="settings-section" data-testid="online-invites">
            <h3 class="settings-section-title">{t('onlineInvites')}</h3>
            {snap.invites.map((inv) => (
              <div class="setting-row" key={inv.id}>
                <span class="setting-name">{t('onlineInvitedBy', { name: inv.fromName })}</span>
                <button
                  type="button"
                  class="bots-toggle"
                  data-testid={`invite-join-${inv.lobbyCode}`}
                  onClick={() => void run(() => client.acceptInvite(inv.id))}
                >
                  {t('onlineJoin')}
                </button>
                <button
                  type="button"
                  class="bots-toggle"
                  onClick={() => client.dismissInvite(inv.id)}
                >
                  {t('plusCardDismiss')}
                </button>
              </div>
            ))}
          </section>
        )}
        <section class="settings-section" data-testid="online-friends">
          <h3 class="settings-section-title">{t('onlineFriends')}</h3>
          {snap.friends.length === 0 && <p class="setting-hint">{t('onlineNoFriends')}</p>}
          {snap.friends.map((f) => (
            <div class="setting-row" key={f.id}>
              <span class="setting-name">{f.name}</span>
              <span class="friend-code">{f.friendCode}</span>
              <button
                type="button"
                class="bots-toggle"
                onClick={() => void run(() => client.removeFriend(f.id))}
              >
                {t('onlineRemove')}
              </button>
            </div>
          ))}
          <div class="join-box">
            <CodeInput
              testId="online-friend-input"
              placeholder={t('onlineFriendPlaceholder')}
              value={friendCode}
              onInput={setFriendCode}
            />
            <button
              type="button"
              class="bots-toggle"
              data-testid="online-add-friend"
              disabled={busy || friendCode.length < CODE_LENGTH}
              onClick={addFriend}
            >
              {t('onlineAddFriend')}
            </button>
          </div>
          {friendMsg && (
            <p class="setting-hint" role="status" data-testid="online-friend-status">
              {t(friendMsg)}
            </p>
          )}
        </section>
        <p class="setting-hint">{t('onlinePrivacy')}</p>
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="online-back"
            onClick={onBack}
          >
            <span class="mode-name">{t('back')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function shareMessage(lobby: LobbyState): string {
  return t('onlineShareText', { code: lobby.code });
}

/** The lobby: its code to share, the players, invites to friends, rules (host) and start. */
export function LobbyScreen(props: { client: OnlineClient }) {
  const { client } = props;
  const snap = useOnline(client);
  const [shared, setShared] = useState<string | null>(null);
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const v = snap.view;
  if (v.phase === 'joining') {
    return (
      <div class="screen online-screen" data-testid="lobby-joining">
        <div class="card online-card">
          <h2 class="settings-title">{t('onlineJoining', { code: v.code })}</h2>
          <div class="result-buttons">
            <button
              type="button"
              class="mode-button secondary compact"
              onClick={() => client.leave()}
            >
              <span class="mode-name">{t('back')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (v.phase !== 'lobby') return null;
  const lobby = v.lobby;
  const me = snap.me;
  const host = client.isHost;
  const mine = lobby.members.find((m) => m.id === me?.id);
  const members = lobby.members.map((m) => m.id);
  const share = (): void => {
    void shareText(shareMessage(lobby)).then((r) =>
      setShared(r === 'copied' ? t('onlineCopied') : r === 'shared' ? t('onlineShared') : null),
    );
  };
  return (
    <div class="screen online-screen" data-testid="online-lobby">
      <div class="card online-card">
        <h2 class="settings-title">{t('onlineLobby')}</h2>
        <ErrorLine client={client} error={snap.error} />
        <div class="lobby-code-row">
          <span class="lobby-code" data-testid="lobby-code" aria-label={t('onlineCodeLabel')}>
            {lobby.code}
          </span>
          <button
            type="button"
            class="mode-button compact"
            data-testid="lobby-share"
            onClick={share}
          >
            <span class="mode-name">{t('onlineShare')}</span>
          </button>
        </div>
        {shared && (
          <p class="setting-hint" role="status">
            {shared}
          </p>
        )}
        <ul class="lobby-members" data-testid="lobby-members">
          {[0, 1, 2, 3].map((seat) => {
            const m = lobby.members[seat];
            return (
              <li key={seat} class={m ? 'lobby-member' : 'lobby-member lobby-empty'}>
                <SeatBadge seat={seat} />
                <span class="setting-name">
                  {m
                    ? m.name
                    : lobby.rules.bots > 0
                      ? t('seatBotLevel', { level: levelName(lobby.rules.bots) })
                      : t('onlineWaiting')}
                </span>
                {m && m.id === lobby.hostId && <span class="lock-badge">{t('onlineHost')}</span>}
                {m && m.id !== lobby.hostId && (
                  <span
                    class={m.ready ? 'ready-tag ready-on' : 'ready-tag'}
                    data-testid={`lobby-ready-${seat}`}
                  >
                    {m.ready ? t('onlineReady') : t('onlineNotReady')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {host ? (
          <section class="settings-section">
            <div class="setting-row">
              <span class="setting-name">{t('partyRules')}</span>
              <Segmented<PresetId>
                testId="lobby-preset"
                value={lobby.rules.preset}
                options={Object.keys(RULE_PRESETS) as PresetId[]}
                label={(p) => t(PRESET_KEY[p])}
                onChange={(preset) => client.setRules({ preset })}
              />
            </div>
            <div class="setting-row">
              <span class="setting-name">{t('partyWins')}</span>
              <Segmented<number>
                testId="lobby-wins"
                value={lobby.rules.winsToMatch}
                options={WINS_TO_MATCH_OPTIONS}
                label={(n) => String(n)}
                onChange={(winsToMatch) => client.setRules({ winsToMatch })}
              />
            </div>
            <div class="setting-row">
              <span class="setting-name">{t('onlineFillBots')}</span>
              <Segmented<number>
                testId="lobby-bots"
                value={lobby.rules.bots}
                options={[0, BotLevel.EASY, BotLevel.NORMAL, BotLevel.HARD, BotLevel.EXPERT]}
                label={(n) => (n === 0 ? t('toggleOff') : levelName(n))}
                onChange={(bots) => client.setRules({ bots })}
              />
            </div>
          </section>
        ) : (
          <p class="setting-hint">{t('onlineHostPicks')}</p>
        )}
        {snap.friends.length > 0 && (
          <section class="settings-section" data-testid="lobby-friends">
            <h3 class="settings-section-title">{t('onlineInviteFriends')}</h3>
            {snap.friends
              .filter((f) => !members.includes(f.id))
              .map((f) => (
                <div class="setting-row" key={f.id}>
                  <span class="setting-name">{f.name}</span>
                  <button
                    type="button"
                    class="bots-toggle"
                    data-testid={`lobby-invite-${f.friendCode}`}
                    disabled={invited.has(f.id)}
                    onClick={() => {
                      void client.inviteFriend(f.id);
                      setInvited(new Set([...invited, f.id]));
                    }}
                  >
                    {invited.has(f.id) ? t('onlineInvited') : t('onlineInvite')}
                  </button>
                </div>
              ))}
          </section>
        )}
        <div class="result-buttons">
          {host ? (
            <button
              type="button"
              class="mode-button"
              data-testid="lobby-start"
              disabled={!canStart(lobby)}
              onClick={() => client.startMatch()}
            >
              <span class="mode-name">{t('onlineStart')}</span>
            </button>
          ) : (
            <button
              type="button"
              class={mine?.ready ? 'mode-button secondary' : 'mode-button'}
              data-testid="lobby-ready"
              onClick={() => client.setReady(!mine?.ready)}
            >
              <span class="mode-name">{mine?.ready ? t('onlineUnready') : t('onlineReadyUp')}</span>
            </button>
          )}
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="lobby-leave"
            onClick={() => client.leave()}
          >
            <span class="mode-name">{t('onlineLeave')}</span>
          </button>
        </div>
        {host && !canStart(lobby) && (
          <p class="setting-hint" data-testid="lobby-start-hint">
            {t('onlineStartHint')}
          </p>
        )}
      </div>
    </div>
  );
}

/** "Anna invited you" – shown over the menus when an invite arrives. */
export function InviteToast(props: { client: OnlineClient; onJoin: () => void }) {
  const { client, onJoin } = props;
  const snap = useOnline(client);
  const invite = snap.invites[0];
  if (!invite || snap.view.phase !== 'idle') return null;
  return (
    <div class="invite-toast" role="alert" data-testid="invite-toast">
      <span>{t('onlineInvitedBy', { name: invite.fromName })}</span>
      <button
        type="button"
        class="bots-toggle"
        data-testid="invite-toast-join"
        onClick={() => {
          onJoin();
          void client.acceptInvite(invite.id);
        }}
      >
        {t('onlineJoin')}
      </button>
      <button
        type="button"
        class="bots-toggle"
        data-testid="invite-toast-dismiss"
        onClick={() => client.dismissInvite(invite.id)}
      >
        {t('plusCardDismiss')}
      </button>
    </div>
  );
}
