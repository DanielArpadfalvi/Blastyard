import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { xcconfig } from '../../scripts/native-config';

const read = (p: string): string => readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };

describe('release prep (T9.5)', () => {
  it('one version: package.json drives Android, iOS and the About screen', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain("rootProject.file('../package.json')");
    expect(gradle).toContain('versionName blastyardVersion');
    expect(gradle).not.toMatch(/versionName\s*\(?\s*["']\d/);
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbx.match(/MARKETING_VERSION = "\$\(BLASTYARD_VERSION\)";/g)).toHaveLength(2);
    expect(pbx.match(/CURRENT_PROJECT_VERSION = "\$\(BLASTYARD_BUILD\)";/g)).toHaveLength(2);
    expect(pbx).not.toMatch(/MARKETING_VERSION = \d/);
    expect(xcconfig('com.example.app', pkg.version, '42')).toContain(
      `BLASTYARD_VERSION = ${pkg.version}\nBLASTYARD_BUILD = 42\n`,
    );
    expect(read('vite.config.ts')).toContain("readFileSync('package.json'");
  });

  it('source maps never ship: hidden and moved out of dist', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("sourcemap: 'hidden'");
    expect(vite).toContain("const SOURCEMAP_DIR = 'sourcemaps'");
  });

  it('the iOS privacy manifest matches the store answers and is bundled', () => {
    const manifest = read('ios/App/App/PrivacyInfo.xcprivacy');
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    const types = [
      ...manifest.matchAll(/<string>NSPrivacyCollectedDataType(?!Purpose)(\w+)<\/string>/g),
    ].map((m) => m[1]);
    expect(types).toEqual(['PurchaseHistory', 'UserID']);
    expect(manifest).not.toMatch(/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbx).toContain('PrivacyInfo.xcprivacy in Resources */,');
  });

  it('the release workflow builds from the tag of the package version, signed', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain('"v$version"');
    expect(wf).toContain('ANDROID_KEYSTORE_FILE');
    expect(wf).toContain('app-store-connect');
    expect(read('android/app/build.gradle')).toContain('signingConfig signingConfigs.release');
  });
});
