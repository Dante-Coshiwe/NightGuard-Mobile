# Working notes for this repo

Hard-won gotchas. Read before touching the Android shell or the keyboard/layout code.

## AndroidManifest.xml — comments may NOT sit between attributes

XML comments are **elements**, not attribute-level annotations. This is a parse error and fails the
build with `ManifestMerger2$MergeFailureException: Error parsing ...AndroidManifest.xml`:

```xml
<!-- WRONG — breaks the manifest merger -->
<activity
    android:launchMode="singleTask"
    <!-- explanation -->
    android:windowSoftInputMode="adjustResize">
```

Put the comment **above the element** instead:

```xml
<!-- RIGHT -->
<!-- explanation -->
<activity
    android:launchMode="singleTask"
    android:windowSoftInputMode="adjustResize">
```

Same rule for any XML in `android/app/src/main/res/`. `capacitor.config.json` is strict JSON and
takes **no comments at all** — document config decisions here or in the manifest instead.

## The keyboard "black bar" — do not regress this

**Symptom:** with the soft keyboard open, a large black band appears between the bottom of the page
content and the top of the keyboard. The header also scrolls off the top.

**Cause:** the keyboard's height was subtracted from the layout *three ways at once*, and the gap
that opened up exposed the decor background, which `MainActivity.applyImmersiveBlackBars()` paints
`Color.BLACK` — hence a *black* bar.

1. `android:adjustMarginsForEdgeToEdge: "force"` (capacitor.config.json) turns on Capacitor's
   `SystemBars` inset listener. It pads the WebView's parent by `imeInsets.bottom` when the keyboard
   is visible — see `initWindowInsetsListener()` in
   `node_modules/@capacitor/android/.../plugin/SystemBars.java`. **This alone is correct and
   sufficient.**
2. `Keyboard.resizeOnFullScreen: true` made the Keyboard plugin *also* run the legacy Cordova-era
   `possiblyResizeChildOfContent()`, shrinking `content.getChildAt(0)` a second time.
3. `android:windowSoftInputMode="adjustPan"` made the window *also* pan upward.

**Fix (both halves are required):**

| File | Setting |
|---|---|
| `capacitor.config.json` | `plugins.Keyboard.resizeOnFullScreen: false` |
| `android/app/src/main/AndroidManifest.xml` | `android:windowSoftInputMode="adjustResize"` |

Keep `adjustMarginsForEdgeToEdge: "force"` — it is the thing doing the correct single adjustment.

### `plugins.Keyboard.resize` is a no-op on Android

Don't try to fix keyboard layout by changing `resize`. In Capacitor 8 the Android plugin never reads
it: `KeyboardPlugin.load()` only reads `resizeOnFullScreen`, and `setResizeMode()` is
`call.unimplemented()`. The key is kept as `"body"` only because it is meaningful if iOS is added.

### Don't add CSS padding for the keyboard

Native already sizes the WebView to the space above the keyboard, so `visualViewport.height` is
correct on its own. `src/lib/mobileKeyboard.js` *sets* `--keyboard-height` for the
`body.keyboard-open` styling, but nothing must consume it as extra `padding-bottom` — that would
reintroduce the same double-subtraction in CSS.

## This fix cannot ship over the air

OTA (Capgo) replaces **only** the `dist/` web bundle. Anything under `android/` — the manifest, and
the native-side `capacitor.config.json` baked into `android/app/src/main/assets/` at
`npx cap sync` — reaches devices **only through a new signed APK**. Publishing an OTA bundle will
not deliver this keyboard fix.

The black bar in particular is *outside* the WebView: it is native decor showing through where the
WebView no longer reaches. No CSS or JS in the bundle can paint there. Don't go looking for a
web-layer workaround — there isn't one.

## Check what the fleet actually runs before deciding a rollout

Never assume field devices are on the newest APK. `ota_update_logs` records a `native_version`
(the APK `versionName`) on every check-in. Query it with the service key before reasoning about who
is affected by anything:

```
GET {SUPABASE_URL}/rest/v1/ota_update_logs
    ?select=device_id,native_version,to_version,status,created_at
    &order=created_at.desc&limit=400
```

Service key is `SUPABASE_SERVICE_KEY` in `Desktop/NightGuardTrackApp/backend/.env` (not in this
repo's `.env`). Real devices have hardware-bound ids `NG-<16 hex>`; ids like `VERIFY-*`,
`RELEASE-*`, `V11*` and `NG-PUBLISH-VERIFY` are synthetic test rows — exclude them.

Snapshot **2026-08-03**: every real field device was on **APK 1.6**. APK 1.8 ran on exactly one
handset (`NG-B4D60C7CB96F8727`), which walked 1.6→1.7→1.8→1.9 in a single morning — a dev phone,
not a guard. So the keyboard bug, which arrived with the 1.8 `adjustPan` commit, never reached a
real user. Re-run the query rather than trusting this paragraph.

Caveat when using git to date a native regression: `android/` was untracked before commit `4f4debd`
(Release 1.8) and `capacitor.config.json` before `f0c1bfc` (Release 1.0.15, which postdates the APK
1.6 build). Git cannot tell you what shipped in APKs older than those commits.

## Rollout order: APK before any bundle that needs it

A bundle whose feature depends on a native plugin must not be published until the APK carrying that
plugin is actually in the field. Bundle **1.1.7** (background patrol tracking) is held back for
exactly this reason: field devices on APK 1.6 have no `PatrolTrackerPlugin`, so its main feature is
inert there.

Publishing it `--mandatory` would be worse than useless. [liveUpdate.js:291](src/services/liveUpdate.js#L291)
computes `applyNow = immediate || (check.mandatory === true && !shiftRunning)`, and `set()` destroys
the JS context and reloads — so a mandatory bundle force-reloads every device that is not currently
on shift. Correct order: ship the APK, confirm check-ins show the new `native_version`, then publish
the bundle.

(The on-shift exemption at [liveUpdate.js:285-286](src/services/liveUpdate.js#L285-L286) is
deliberate — never reload out from under a guard on duty. Don't "fix" it.)

## Release build

Signing comes from `android/key.properties` (gitignored) with the keystore at
`android/app/nightguard-release.jks`. Without that file a "release" build silently falls back to the
**debug** signature, which is fine for emulator testing but must never be distributed.

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Bump `versionCode` **and** `versionName` in `android/app/build.gradle` for every distributed APK, or
devices refuse the upgrade. Native `versionName` (e.g. `1.9`) is numbered separately from the OTA
web-bundle version (`OTA_CURRENT_VERSION` in `src/services/liveUpdate.js`, e.g. `1.1.7`) — they are
not meant to match.
