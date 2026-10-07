import type { CapacitorConfig } from '@capacitor/cli';

const BACKGROUND = '#0b0a14';

const config: CapacitorConfig = {
  appId: 'com.arpadfalvi.blastyard',
  appName: 'Blastyard',
  webDir: 'dist',
  backgroundColor: BACKGROUND,
  android: { backgroundColor: BACKGROUND },
};

export default config;
