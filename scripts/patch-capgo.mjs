// Postinstall patch for @capgo/capacitor-updater 8.51.x.
//
// That release ships an Android file (DelayUpdateUtils.java) whose enum `switch` uses fully
// qualified case labels (`case DelayUntilNext.background:`), which is illegal Java and fails
// `assembleRelease`. This rewrites them to the required unqualified form. Runs on every install
// so the fix survives `npm install`; it is idempotent and never fails the install.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE =
  'node_modules/@capgo/capacitor-updater/android/src/main/java/ee/forgr/capacitor_updater/DelayUpdateUtils.java';

try {
  if (!existsSync(FILE)) {
    // Plugin not installed (or path changed) — nothing to do.
    process.exit(0);
  }

  const original = readFileSync(FILE, 'utf8');
  const patched = original.replace(
    /case\s+DelayUntilNext\.(background|kill|date|nativeVersion)\s*:/g,
    'case $1:',
  );

  if (patched !== original) {
    writeFileSync(FILE, patched);
    console.log('[patch-capgo] Fixed qualified enum switch labels in DelayUpdateUtils.java');
  } else {
    console.log('[patch-capgo] DelayUpdateUtils.java already patched — nothing to do');
  }
} catch (err) {
  // Never break `npm install` over this.
  console.warn('[patch-capgo] Skipped:', err?.message || err);
}
