/**
 * The system back action (T6.1, Android back button / gesture) behind the platform layer.
 *
 * The game registers one handler that walks back one step (close a panel, pause a match, go up a
 * menu level) and returns `false` when there is nothing left to go back to – on the start screen.
 * Native: the Capacitor App plugin's `backButton` event; when the handler declines, the app is
 * minimised (Android's usual "back on the home screen"). Web: there is no hardware back, the UI
 * maps Escape onto the same handler and tests call {@link BackPort.trigger}.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** Returns true when the back action was used, false to let the platform leave the app. */
export type BackHandler = () => boolean;

export interface BackPort {
  setHandler(handler: BackHandler | null): void;
  /** Runs the back action as if the system sent it; returns whether the game used it. */
  trigger(): boolean;
}

/** Shared bookkeeping: the current handler and what to do when it declines. */
function backPort(leave: () => void): BackPort {
  let handler: BackHandler | null = null;
  return {
    setHandler(next) {
      handler = next;
    },
    trigger() {
      const used = handler?.() ?? false;
      if (!used) leave();
      return used;
    },
  };
}

/** Web (and tests): declining does nothing – a browser tab is not ours to close. */
export function webBack(): BackPort {
  return backPort(() => undefined);
}

/** Android / iOS: the App plugin's back button; declining minimises the app. */
export function nativeBack(): BackPort {
  const port = backPort(() => {
    void App.minimizeApp().catch(() => undefined);
  });
  void App.addListener('backButton', () => {
    port.trigger();
  });
  return port;
}

export function platformBack(): BackPort {
  return Capacitor.isNativePlatform() ? nativeBack() : webBack();
}
