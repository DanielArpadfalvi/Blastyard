import type { SafeInsets } from './layout';

let probe: HTMLElement | undefined;

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Current safe-area insets (notch, home indicator) in CSS px, read via a hidden probe element. */
export function readSafeInsets(): SafeInsets {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
      'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    document.body.appendChild(probe);
  }
  const style = getComputedStyle(probe);
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}
