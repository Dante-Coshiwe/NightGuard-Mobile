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

Snapshot **2026-08-04** (5 real devices): 3 on **APK 1.6**, 1 on 1.9, 1 on 1.11 (the dev phone
above). The 1.6 devices have no `PatrolTrackerPlugin`, so they cannot gather points with the screen
off — `useInAppWatch` is true there, which both holds the screen-wake lock and shows the amber
"Keep the screen on" banner. Both 1.6 and 1.9 are to be upgraded to 1.11 by hand; OTA cannot
deliver an APK.

Caveat when using git to date a native regression: `android/` was untracked before commit `4f4debd`
(Release 1.8) and `capacitor.config.json` before `f0c1bfc` (Release 1.0.15, which postdates the APK
1.6 build). Git cannot tell you what shipped in APKs older than those commits.

## A `location` foreground service must hold permission BEFORE `startForeground()`

Android 14+ validates the service type *inside* `startForeground()` and throws `SecurityException`
when no location permission is held. Thrown from `onStartCommand`, that kills the **whole app** —
this was the "app crashes the moment I start a patrol" bug (APK 1.8–1.10, fixed in 1.11).

```
java.lang.SecurityException: Starting FGS with type location ... targetSDK=36
  requires ... any of [ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION]
  and the app must be in the eligible state/exemptions
```

Three rules, all of which `PatrolTrackingService` now follows:

1. Check permission **before** `startForegroundNotification()`, not in `startTracking()` after it.
2. Wrap `ServiceCompat.startForeground` in `try/catch`. Permission is not sufficient — location is
   a *while-in-use* permission, so the platform also refuses when the app is not in an eligible
   (visible) state. That is precisely the case when Android restarts the service itself after a
   process kill, so a refusal is a NORMAL outcome and must never be fatal.
3. Return `START_NOT_STICKY` on that failure path. With `START_REDELIVER_INTENT` the system
   redelivers the same intent straight back into the same refusal — the original bug crash-looped
   three times in nine seconds.

Request the permission on the JS side before calling the plugin (`startBackgroundPatrol` does), or
the service is asked for something it can only refuse.

## Web NFC (`NDEFReader`) does not exist in a WebView

`'NDEFReader' in window` is **always false inside the APK**. Web NFC ships in Chrome for Android
only; a Capacitor WebView never exposes it. The old `useNFC` hook and `GuardPatrolConfig`'s
`readNfcTag` were both built on it, so NFC check-ins could not fire on any device — it only ever
appeared to work when tested in a desktop/Chrome browser. `window.Nfc` was likewise a global no
plugin ever defined.

Tag reading is native: `NfcReaderPlugin` uses `NfcAdapter.enableReaderMode` with
`FLAG_READER_SKIP_NDEF_CHECK` (the UID is all that is wanted, and blank/Mifare tags carry no NDEF).
Reader mode is bound to the activity, so it is re-armed in `handleOnResume`. **Android only
dispatches NFC to a foreground activity** — with the screen off or the app backgrounded no tag is
read, and GPS remains the recorder for a pocketed phone.

Compare tag UIDs with separators stripped (`normaliseTagUid`): native reports bare hex
(`045a1b2c`) while a `tag_uid` typed into the admin panel is usually `04:5A:1B:2C`.

## Checkpoint radius lives in TWO places

`GEOFENCE_RADIUS_METERS` exists in both [src/lib/geo.js](src/lib/geo.js) and
[PatrolGeo.java](android/app/src/main/java/com/nightguard/nightguardtrack/PatrolGeo.java). Change
them together or a patrol walked with the screen off scores differently from the same walk with the
screen on. Currently **10 m**: 1.0.16 tightened it to 3 m, which plus the 5 m margin cap gave an
~8 m effective radius that consumer GPS beside a building routinely misses — guards walked whole
routes that registered nothing.

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
