import { useEffect, useState } from 'preact/hooks';
import { getLanguage, t, type TranslationKey } from '../i18n';
import {
  PRODUCT_PLUS,
  PRODUCT_SUPPORTER,
  type BuyResult,
  type Entitlements,
  type ProductId,
  type RestoreResult,
  type StoreProduct,
} from '../platform/entitlement';
import { openExternal, siteUrl } from '../platform/links';

/** What the status line says. */
type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'buying'; readonly id: ProductId }
  | { readonly kind: 'bought'; readonly id: ProductId; readonly result: BuyResult }
  | { readonly kind: 'restoring' }
  | { readonly kind: 'restored'; readonly result: RestoreResult };

const BUY_TEXT: Readonly<Record<Exclude<BuyResult, 'purchased'>, TranslationKey>> = {
  pending: 'paywallPending',
  cancelled: 'paywallCancelled',
  failed: 'paywallFailed',
  unavailable: 'paywallUnavailable',
};

const RESTORE_TEXT: Readonly<Record<RestoreResult, TranslationKey>> = {
  restored: 'restoreRestoredAny',
  nothing: 'restoreNothing',
  unavailable: 'restoreUnavailable',
};

const FEATURES: readonly TranslationKey[] = [
  'paywallArenas',
  'paywallWorlds',
  'paywallRules',
  'paywallLooks',
];

function statusText(status: Status, loading: boolean, store: boolean): string | null {
  if (loading) return t('paywallLoading');
  switch (status.kind) {
    case 'buying':
    case 'restoring':
      return t('paywallBuying');
    case 'bought':
      if (status.result === 'purchased') {
        return status.id === PRODUCT_PLUS ? t('paywallSuccess') : null;
      }
      return t(BUY_TEXT[status.result]);
    case 'restored':
      return t(RESTORE_TEXT[status.result]);
    default:
      return store ? null : t('paywallUnavailable');
  }
}

/**
 * The Blastyard+ paywall (T8.1, PLAN §2): what Plus adds, its store price, buy, restore, the
 * optional Supporter pack, Terms / Privacy. Opens only from a locked item, the settings or the
 * one-off card after the 5th match – never by itself. Every outcome of the store (pending,
 * cancelled, failed, no store) is spelled out; nothing unlocks unless the store says so.
 */
export function Paywall(props: { entitlements: Entitlements; onClose: () => void }) {
  const { entitlements, onClose } = props;
  const [products, setProducts] = useState<readonly StoreProduct[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [owned, setOwned] = useState(() => ({
    plus: entitlements.hasPlus(),
    supporter: entitlements.hasSupporter(),
  }));
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let live = true;
    entitlements.products().then(
      (list) => {
        if (!live) return;
        setProducts(list);
        setLoading(false);
      },
      () => {
        if (live) setLoading(false);
      },
    );
    const off = entitlements.subscribe(() =>
      setOwned({ plus: entitlements.hasPlus(), supporter: entitlements.hasSupporter() }),
    );
    return () => {
      live = false;
      off();
    };
  }, [entitlements]);

  const busy = status.kind === 'buying' || status.kind === 'restoring';
  const price = (id: ProductId): string | null => products?.find((p) => p.id === id)?.price ?? null;

  const buy = (id: ProductId): void => {
    setStatus({ kind: 'buying', id });
    entitlements.buy(id).then(
      (result) => {
        setStatus({ kind: 'bought', id, result });
        if (result === 'purchased' && id === PRODUCT_SUPPORTER) setThanks(true);
      },
      () => setStatus({ kind: 'bought', id, result: 'failed' }),
    );
  };
  const restore = (): void => {
    setStatus({ kind: 'restoring' });
    entitlements.restore().then(
      (result) => setStatus({ kind: 'restored', result }),
      () => setStatus({ kind: 'restored', result: 'unavailable' }),
    );
  };

  if (thanks) {
    return (
      <div class="screen paywall-screen" data-testid="supporter-thanks">
        <div class="card paywall-card thanks-card">
          <h2 class="settings-title">{t('supporterThanksTitle')}</h2>
          <p class="paywall-tagline">{t('supporterThanksText')}</p>
          <div class="result-buttons">
            <button
              type="button"
              class="mode-button"
              data-testid="thanks-close"
              onClick={() => setThanks(false)}
            >
              <span class="mode-name">{t('paywallClose')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const plusPrice = price(PRODUCT_PLUS);
  const supporterPrice = price(PRODUCT_SUPPORTER);
  const line = statusText(status, loading, products !== null);
  return (
    <div class="screen paywall-screen" data-testid="paywall">
      <div class="card paywall-card">
        <h2 class="settings-title">{t('paywallTitle')}</h2>
        <p class="paywall-tagline">{t('paywallTagline')}</p>
        <ul class="paywall-features">
          {FEATURES.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <p class="setting-hint">{t('paywallFree')}</p>
        {owned.plus ? (
          <p class="paywall-owned" data-testid="paywall-owned">
            {t('paywallOwned')}
          </p>
        ) : (
          <button
            type="button"
            class="mode-button"
            data-testid="paywall-buy"
            disabled={busy || plusPrice === null}
            onClick={() => buy(PRODUCT_PLUS)}
          >
            <span class="mode-name">
              {plusPrice === null ? t('paywallTitle') : t('paywallBuy', { price: plusPrice })}
            </span>
          </button>
        )}
        <div class="paywall-supporter">
          <h3 class="paywall-subtitle">{t('paywallSupporterTitle')}</h3>
          <p class="setting-hint">{t('paywallSupporterText')}</p>
          {owned.supporter ? (
            <p class="paywall-owned" data-testid="paywall-supporter-owned">
              {t('paywallSupporterOwned')}
            </p>
          ) : (
            <button
              type="button"
              class="mode-button secondary compact"
              data-testid="paywall-supporter"
              disabled={busy || supporterPrice === null}
              onClick={() => buy(PRODUCT_SUPPORTER)}
            >
              <span class="mode-name">
                {supporterPrice === null
                  ? t('paywallSupporterTitle')
                  : t('paywallSupporterBuy', { price: supporterPrice })}
              </span>
            </button>
          )}
        </div>
        <p class="setting-hint paywall-status" role="status" data-testid="paywall-status">
          {line ?? ''}
        </p>
        <div class="about-buttons">
          <button
            type="button"
            class="bots-toggle"
            data-testid="paywall-restore"
            disabled={busy}
            onClick={restore}
          >
            {t('restorePurchases')}
          </button>
          <button
            type="button"
            class="bots-toggle"
            data-testid="paywall-terms"
            onClick={() => openExternal(siteUrl('terms', getLanguage()))}
          >
            {t('paywallTerms')}
          </button>
          <button
            type="button"
            class="bots-toggle"
            data-testid="paywall-privacy"
            onClick={() => openExternal(siteUrl('privacy', getLanguage()))}
          >
            {t('paywallPrivacy')}
          </button>
        </div>
        <div class="result-buttons">
          <button
            type="button"
            class="mode-button secondary compact"
            data-testid="paywall-close"
            onClick={onClose}
          >
            <span class="mode-name">{t('paywallClose')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** The one-off, non-blocking Blastyard+ card under a match result (after the 5th match). */
export function PlusCard(props: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div class="plus-card" data-testid="plus-card" role="note">
      <b>{t('plusCardTitle')}</b>
      <span>{t('plusCardText')}</span>
      <div class="plus-card-buttons">
        <button
          type="button"
          class="bots-toggle"
          data-testid="plus-card-open"
          onClick={props.onOpen}
        >
          {t('paywallMore')}
        </button>
        <button
          type="button"
          class="bots-toggle"
          data-testid="plus-card-dismiss"
          onClick={props.onDismiss}
        >
          {t('plusCardDismiss')}
        </button>
      </div>
    </div>
  );
}
