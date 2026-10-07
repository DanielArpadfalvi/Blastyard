/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the GitHub Pages preview build: device-test tools on the start screen (T2.4). */
  readonly VITE_SPIKE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
