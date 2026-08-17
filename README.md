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

Ranked by what it costs when it goes wrong. Nothing here is theoretical — each was a real property of
the code. All eight were closed for the multi-site rollout (APK **1.24** / bundle **1.1.26**); each
entry records what the failure was and what now prevents it, because the shape of the bug is what
stops it being reintroduced.

**1. Unsaved entry forms lived only in React state.** [VehicleTab](src/screens/home/VehicleTab.jsx)
and [PedestrianTab](src/screens/home/PedestrianTab.jsx) held the typed fields and the captured photo
in component state. Both **require** a photo, so every gate entry passes through a camera intent that
backgrounds the app — and a low-RAM handset routinely gets reclaimed there. The typed fields come
*before* the photo button, so the maximum amount of work was at risk at the moment of maximum danger.
**Closed:** both tabs now take a `holdLiveUpdates()` hold while the form is open and persist a draft
to the filesystem via [src/lib/entryDraft.js](src/lib/entryDraft.js), flushed on backgrounding and on
the photo button itself, and offered back on the list behind a Resume / Discard banner. Same design
as [src/lib/incidentDraft.js](src/lib/incidentDraft.js); the same storage rule applies — photos go to
the filesystem on native and are dropped on web, never into the localStorage quota the outbox shares.

**2. The native patrol drain was at-most-once.** `PatrolBuffer.drain()` returned the route and
captures *and cleared them in the same locked step*, so until `drainBackgroundPatrol()` had persisted
them the walk existed only in a JS variable — a kill there lost it, on the one path built for a phone
in a pocket. **Closed:** `PatrolBuffer.peek()` consumes nothing and `PatrolBuffer.acknowledge(n, m)`
drops only the leading items JS confirms it has stored, so the handover is at-least-once. A failed
`persistPatrolScan` now breaks the loop and leaves the rest buffered, and `markCheckpointReached` runs
*after* a successful persist rather than before — marking first would have made a failed scan look
"already reached" on the retry and acknowledged it away. The JS side feature-detects `peek`, so this
bundle still runs correctly on older shells that only have `drain`.

**3. A corrupt patrol buffer silently started from empty.** `PatrolBuffer.read()` returns `empty()` on
unparseable JSON, deliberately — a corrupt buffer would otherwise block every future write. But it had
**no `.bak`**, unlike `atomicFile.js` on the JS side: the more fragile half had the weaker recovery.
**Closed:** it now keeps a backup and reads primary → `.bak` → staged `.tmp`, the same ladder
`atomicFile.js` uses. `empty()` remains the last resort, for the same reason as before.

**4. Every outbox write rewrites the entire storage state.** `nightguard_offline_queue` is in
`CRITICAL_KEYS`, so each mutation calls `flushPersistNow()` → `serialiseState()`, and queued incident
photos are base64 megabytes — cost per capture grew with the backlog, on the device least able to
afford it. **Reduced, not eliminated:** `persistState()` now skips a write whose serialised content is
byte-identical to the last one, which removes the repeat flushes that lifecycle events arrive in
clusters of. The queue is still uncapped by design — a cap means deleting a guard's work.

**5. `saveQueue()` reported failure only to the console.** A failed write lost the outbox delta with
no user-visible signal and no retry. **Closed:** it retries after pruning the dead-letter list (those
items have already exhausted their retries; live work has not), returns whether the queue is durable,
and on final failure raises a non-dismissible banner — the guard is otherwise told an entry is saved
when it is not. This is still why queued photo bytes must live in exactly one storage key.

**6. The final flush was fire-and-forget.** **Narrowed:** `flushPersistNow()` returns the in-flight
write and the `appStateChange`/`pause` handlers await it. Capacitor does not hold the native side open
for a listener's promise, so this shrinks the window rather than closing it; anything that must be
durable before a guard is told so should await the exported `flushNativeStorageNow()`.

**7. Some sync failures were dropped without a trace.** `classifySyncFailure` returns `drop` for
404/409/410 and the drop path `continue`d without dead-lettering, so a 409 conflict was discarded with
nothing left to inspect. **Closed:** dropped items are dead-lettered with `terminal: true` and their
revivals already spent — the evidence is kept without the item being retried forever.

**8. A long patrol lost the start of its trail.** The native `appendRoutePoint` deleted the oldest
half at `MAX_ROUTE_POINTS = 5000`, so a patrol left running lost its first hour outright and silently.
**Closed:** it now halves the resolution of the older portion and keeps the last 500 points intact,
preserving the shape of the whole walk — the same thinning the JS side in
[src/lib/patrolSession.js](src/lib/patrolSession.js) already did.

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
