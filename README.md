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

`--mandatory` is not a courtesy flag, and it is stronger than it sounds: a mandatory bundle applies
**inline, destroying the JS context wherever the guard is standing**, on every device not currently
on shift. On 2026-08-14 that reloaded the app under a guard adding a photo to an incident report and
lost the report and the photo. Bundle 1.1.25 gates it on an idle device and on
`holdLiveUpdates()`, but it is still the one flag that can interrupt somebody mid-task — use it only
for a genuine emergency, and read the CLAUDE.md section before you do.

If a mandatory bundle is already out and causing harm, you do **not** need a new bundle to stop it:
`UPDATE ota_bundles SET is_mandatory = false` for that version. It then stages and applies on the
next background/restart instead.

## Data capture and upload — where a guard's work can be lost

**This is the part of the app that matters.** A guard's shift produces evidence: patrol trails,
checkpoint captures, gate entries, incident reports and their photos. Every one of those is captured
on a handset that is frequently offline and that Android will kill without warning. If a change
touches any path below, treat losing a record as the failure mode to design against — a missing
patrol or a vanished incident is not a cosmetic bug, it is a gap in a security record that somebody
will later be asked to account for.

The chain is: **capture → device storage → outbox → Supabase.** Every hand-off between those is a
place where something can go missing, and most of them fail *silently* — the guard sees a normal
screen and assumes the record is safe.

### The durability layers, and what each one guarantees

| Layer | File | Guarantee |
|---|---|---|
| `localStorage` on Android | [src/lib/nativeStorage.js](src/lib/nativeStorage.js) | Not the browser's. It is replaced by a filesystem-backed proxy; `CRITICAL_KEYS` (outbox, patrol session, scans, shift) skip the debounce and flush immediately |
| Crash-safe file writes | [src/lib/atomicFile.js](src/lib/atomicFile.js) | temp → rename, keeps a `.bak`; reads try primary → backup → staged temp, and distinguish corruption from emptiness |
| Native patrol buffer | [PatrolBuffer.java](android/app/src/main/java/com/nightguard/nightguardtrack/PatrolBuffer.java) | temp + `fsync` + rename, under a lock, capped |
| The outbox | [src/hooks/useOfflineQueue.js](src/hooks/useOfflineQueue.js) | Retries transient failures forever; counts rejections and dead-letters rather than deleting |

These are good and were built deliberately. The risks below are the seams *between* them.

### Known risk areas

Ranked by what it costs when it goes wrong. Nothing here is theoretical — each is a real property of
the current code.

**1. Unsaved entry forms live only in React state.** [VehicleTab](src/screens/home/VehicleTab.jsx)
and [PedestrianTab](src/screens/home/PedestrianTab.jsx) hold the typed fields and the captured photo
in component state. Both **require** a photo, so every gate entry passes through a camera intent that
backgrounds the app — and a low-RAM handset routinely gets reclaimed there. The typed fields come
*before* the photo button, so the maximum amount of work is at risk at the moment of maximum danger.
There is no draft and no `holdLiveUpdates` hold. `IncidentScreen` was fixed this way
([src/lib/incidentDraft.js](src/lib/incidentDraft.js)); these two have not been. **Still open.**

**2. The native patrol drain is at-most-once.** `PatrolBuffer.drain()` returns the route and captures
*and clears them in the same locked step*. `drainBackgroundPatrol()` then persists them JS-side. A
process kill in that window, or a throw from `persistPatrolScan`, loses the walk — it is already gone
from the native buffer and was never handed to the outbox. The catch at
[backgroundPatrol.js:176](src/lib/backgroundPatrol.js#L176) only warns. Making this safe means
acknowledging the drain after the JS side has persisted, not before.

**3. A corrupt patrol buffer silently starts from empty.** `PatrolBuffer.read()` returns `empty()` on
unparseable JSON, deliberately — a corrupt buffer would otherwise block every future write. But it
has **no `.bak`**, unlike `atomicFile.js` on the JS side. The more fragile half (a service killed
mid-write, in a pocket, for an hour) has the weaker recovery.

**4. The outbox has no size cap, and every write rewrites everything.** `enqueueOfflineItem` appends
without limit, and queued incident photos are base64 megabytes. Because `nightguard_offline_queue` is
in `CRITICAL_KEYS`, each mutation calls `flushPersistNow()` → `serialiseState()`, which serialises
**the entire storage state** to one file. Cost per write therefore grows with queue size: a device
offline for a long stretch with photos makes every subsequent capture slower.

**5. `saveQueue()` reports failure only to the console.** A failed write means the outbox delta is
gone with no user-visible signal and no retry. This is why queued photo bytes must live in exactly
one place — see the note in CLAUDE.md.

**6. The final flush is fire-and-forget.** `flushPersistNow()` is not awaited, including on
`appStateChange(false)` and `pagehide`. That is the last moment before Android may kill the app, and
the write can still be in flight.

**7. Some sync failures are dropped without a trace.** `classifySyncFailure` returns `drop` for
404/409/410, and the drop path `continue`s without dead-lettering. A 409 conflict is discarded
entirely — no record, nothing to inspect later.

**8. A long patrol loses the start of its trail.** `appendRoutePoint` trims the oldest half at
`MAX_ROUTE_POINTS = 5000`. With 6 m / 20 s minimum spacing that is a very long walk, but a patrol
left running reaches it and the earliest points go silently.

### Rules for changing any of this

- **A record must be durable before the guard is told it is saved.** Optimistic UI is fine; a success
  message with nothing on disk is not.
- **Never clear a source before the destination has acknowledged.** See risk 2.
- **Never let a photo's bytes exist in two storage keys.** They are megabytes and they share a quota.
- **Treat corruption and emptiness as different things.** A parse failure must not be read as "new
  device" — that is how a whole shift disappears.
- **A camera intent is a process-death event.** Anything unsaved when the picker opens must already
  be on disk.
- **`--mandatory` reloads the app wherever the guard is standing.** See CLAUDE.md; this cost a real
  incident report on 2026-08-14.

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
