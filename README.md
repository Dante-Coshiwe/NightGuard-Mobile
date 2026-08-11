# NightGuard Track

Android app for security guards — patrol tracking, pedestrian/vehicle registers, occurrence book,
incident reports. React + Vite in a Capacitor 8 native shell, with self-hosted over-the-air updates
on Supabase.

For agent/contributor gotchas that will bite you, read [CLAUDE.md](CLAUDE.md) first.

## The three surfaces

This repo is only the guard's handset. Two others sit beside it on the Desktop and are not in this
repository:

| Surface | Where | Ships by |
|---|---|---|
| **Guard app** (this repo) | `Desktop/nightguardtrackAPPFINAL` | OTA bundle, or a signed APK for native changes |
| **Manager dashboard** | `Desktop/NightGuardTrackApp` — Express backend on Render, plus a single-file `frontend/public/index.html` | Netlify (frontend), Render (backend) |
| **Public download page** | `Desktop/NightGuard-webdownlaod` — one static `index.html`, not a git repo | `firebase deploy --only hosting --project test-deb3a34e` |

The dashboard frontend reads Supabase directly and never calls its own Express backend; check
whether a controller is still reachable before fixing it.

## Two version numbers, and they are not the same thing

This trips people up constantly:

| | What it is | Where it lives | How it reaches devices |
|---|---|---|---|
| **Native version** (e.g. `1.9`) | The APK — `versionName` / `versionCode` | `android/app/build.gradle` | Manual install of a signed APK |
| **Bundle version** (e.g. `1.1.7`) | The web layer — everything in `dist/` | `OTA_CURRENT_VERSION` in [src/services/liveUpdate.js](src/services/liveUpdate.js), `version` in `package.json` | OTA, automatically |

The app's Info screen shows the **bundle** version. The download page shows the **native** version.
They are deliberately on different schemes and will never match.

## What OTA can and cannot ship

OTA replaces **only** the contents of `dist/`.

- ✅ React screens, patrol/GPS logic, forms, validation, styling, offline fixes — anything in `src/`
- ❌ Anything in `android/`: the manifest, native plugins, permissions, app icon, `versionCode`, and
  the `capacitor.config.json` that `npx cap sync` bakes into `android/app/src/main/assets/`

Rule of thumb: **if it lives in `src/`, OTA can ship it. If it lives in `android/`, it needs a new
signed APK.** No amount of OTA will deliver a native change.

## Releasing a new APK

Signing reads `android/key.properties` (gitignored) with the keystore at
`android/app/nightguard-release.jks`. **Without that file a "release" build silently falls back to
the debug signature** — fine for an emulator, never for distribution. Verify before shipping:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

The certificate must read `CN=NightGuard Track` (SHA-256 `d816c241…`), not `CN=Android Debug`.
Keeping that same cert is what lets the APK upgrade in place — guards never uninstall, and no data
is lost. (v1/JAR signing shows as false; that is fine and expected with `minSdk 24` — v2/v3 covers
every supported device, and v1 only matters below Android 7.0.)

Bump **both** `versionCode` and `versionName` in `android/app/build.gradle` or devices refuse the
upgrade.

Publish:

```bash
cp android/app/build/outputs/apk/release/app-release.apk "$HOME/Desktop/app-release.apk"
gh release upload Version1 "$HOME/Desktop/app-release.apk" --clobber --repo Dante-Coshiwe/nightguard-APPS
```

The asset filename must stay exactly `app-release.apk` — the public download page hardcodes that
URL. Don't touch `night-guard-inspect.apk`; it is a different app.

Then update the hand-written version label on the download page
(`Desktop/NightGuard-webdownlaod/index.html`, the NightGuard Track `<div class="version">`) and
redeploy with `firebase deploy --only hosting --project test-deb3a34e`.

> `gh release upload --clobber` **resets the asset's download counter**. Don't read download counts
> as evidence about a previous build after replacing it — use OTA check-in telemetry instead.

## Publishing an OTA bundle

```bash
npm run build
node scripts/ota-publish.mjs --channel production --notes "..."
```

Needs `SUPABASE_SERVICE_ROLE_KEY`. Keep `OTA_CURRENT_VERSION`, `package.json` `version`, and the
published version in sync.

**Check who is actually in the field before you publish.** Query `ota_update_logs` for
`native_version` — do not assume devices run the newest APK. A bundle whose feature depends on a
native plugin must wait until the APK carrying that plugin is confirmed in the field.

`--mandatory` is not a courtesy flag: a mandatory bundle applies immediately and reloads the app on
every device that is not currently on shift. Use it only for genuine emergency fixes.

## Development

```bash
npm install
npm run dev
```

Debug build on a connected device or emulator:

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Gradle release builds need ~2 GB free RAM; the daemon JVM-crashes when Docker Desktop and an
emulator are both running. Close the emulator, build, then restart it.

## Further reading

- [CLAUDE.md](CLAUDE.md) — manifest/XML pitfalls, the keyboard black-bar fix, rollout ordering
- [OTA_UPDATES.md](OTA_UPDATES.md), [OTA_SETUP.md](OTA_SETUP.md) — OTA mechanics and setup
- [SITE_BINDING_ROLLOUT.md](SITE_BINDING_ROLLOUT.md) — per-device site binding
