/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the GitHub Pages preview build: device-test tools on the start screen (T2.4). */
  readonly VITE_SPIKE?: string;
}

/** package.json version (vite `define`). */
declare const __APP_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
