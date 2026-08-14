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

## Kiosk lock blocks launching any other app — release it first, on purpose

Android lock task mode refuses to start an activity outside the pinned task, and it refuses
*silently*. `WhatsAppScreen` navigated to `whatsapp://send` and nothing happened at all — no error,
no launch — and the "Open WhatsApp" fallback button was the same blocked navigation, so it did
nothing either. This is not a WhatsApp problem; it is true of the camera, the dialler and every
other app while the device is pinned.

The fix is a time-boxed **suspension**, not an exit: `KioskService.suspendForExternalApp(label)`
writes a grace marker (`nightguard_kiosk_suspended_until`, 3 min) **before** calling
`stopKioskMode`, then releases the lock. The marker matters — `ensureActive()` runs on a 20-second
watchdog and on every resume, and would otherwise re-pin the device in the gap before Android
switches tasks. `resumeFromExternalApp()` (wired into the `appStateChange` handler in
[App.jsx](src/App.jsx)) clears the marker and re-locks the moment the guard comes back.

The shift, the foreground service and the departure log are untouched by a suspension — the guard is
still on duty. `markAppBackgrounded` records `authorised: KioskService.isSuspended()` so the OB entry
says "opened WhatsApp from the app" rather than "the device lock was bypassed"; without that, every
sanctioned trip filed itself as a security incident.

### Letting them out is half the job — there must be a way back IN

Releasing the lock got the guard into WhatsApp and then stranded them there. Three separate things
were shutting the door behind them; fixed together in APK **1.21** / bundle **1.1.22**.

1. **`android:excludeFromRecents="true"` on MainActivity** (set in 1.8, removed in 1.21). It hid the
   whole NightGuard task from the overview screen, so Recents was empty of it and Back out of
   WhatsApp landed on the launcher. The only way back was to find the icon and start the app again —
   exactly what the guard reported. It bought nothing while pinned (lock task mode already disables
   the recents button), so the sole thing it ever changed was the sanctioned trip out. Do not add it
   back; it is also one leg of the Play Protect stalkerware signature noted further up.
2. **`GuardForegroundService`'s notification had no `setContentIntent`.** "Guard Session Active" sits
   in the shade for the whole shift and is the one route back that is visible *from inside WhatsApp*,
   and tapping it did nothing. It now uses the same `openAppIntent()` as `PatrolTrackingService`
   (`NEW_TASK | CLEAR_TOP`, which with `launchMode="singleTask"` resumes the shift rather than
   starting a second copy).
3. **The deep-link fallback fired even when the deep link worked.** `WhatsAppScreen` set a 2.5 s
   timer and then unconditionally loaded `https://wa.me/`. Capacitor's `Bridge.launchIntent` starts an
   external `ACTION_VIEW` for any URL outside the app's own origin — so ~2.5 s after WhatsApp came up,
   a *browser* opened on top of it. That is the "it opens WhatsApp in a new tab" complaint. The timer
   now bails if the app has lost the foreground (`visibilitychange` / `pagehide` / `appStateChange`);
   the fallback is only for the case it was written for — WhatsApp not installed, so the scheme went
   nowhere and we are still visible.

`WhatsAppScreen` also navigates home on resume. React Router does not remount a route you are already
on, so a guard who came back to a stale "Opening WhatsApp" screen found the sidebar's WhatsApp button
apparently dead.

There is no way to open WhatsApp *inside* the app: it is a native app, and `web.whatsapp.com` needs a
QR pairing and refuses to run in a WebView. Leaving the app is unavoidable — make coming back cheap.

## Incident photos: the wizard captured them and threw them away

Steps 3 and 4 of Report Incident ("Photo of Vehicle", "Incident Images") were **entirely
decorative**. `handlePhotoCapture` put data URLs in form state and rendered the thumbnails, and
`handleSubmit` never referenced them — no upload, no payload field. The `incidents` table had no
photo column either, so there was nowhere to put a URL even if something had uploaded one. The same
submit dropped `offenderDetails`, `offenderAddress`, `registration`, `makeModel` and `colour`:
collected, validated, never sent. A guard photographed a broken gate, saw the previews, tapped
Submit, and none of it existed.

Fixed end to end (2026-08-13). Four things had to line up:

1. **The columns.** `supabase/migrations/20260813_incident_photos.sql` in the *dashboard* repo adds
   `picture_url text` and `photo_urls jsonb`. **This requires a manual run in the SQL editor** —
   there is no DDL path from here: PostgREST cannot run DDL, no `exec_sql` RPC exists, and the CLI
   has no access token. Until it is run, incidents still save; they just save without photos.
2. **`createIncident` must survive the columns being absent.** PostgREST answers an insert naming an
   unknown column with `PGRST204` and a **400**, which `classifySyncFailure` counts as a rejection
   and eventually dead-letters — so shipping the bundle before the migration would have cost the
   *incident*, not just its pictures. It detects that one error and retries without the two columns.
   Do not broaden the detection: an RLS denial or a not-null violation must still fail loudly.
3. **Storage needed no change.** Files go to `entry-pictures/<site_id>/incidents/<tempId>[-n].jpg`
   next to `vehicles/` and `pedestrians/`. The bucket is public-read and the anon insert policy is
   path-agnostic — verified by uploading to an `incidents/` key with the anon key.
4. **Reading them back is deliberately forgiving.** One reader,
   [src/lib/incidentPhotos.js](src/lib/incidentPhotos.js), because the same incident arrives as a
   jsonb array, a stringified array, an offline copy holding local data URLs, or a pre-migration row
   with neither.

### A queued photo must never be written to two localStorage keys

The offline queue (`nightguard_offline_queue`) and the incident display cache (`cached_incidents`,
mirrored by [reportCache.js](src/lib/reportCache.js)) are **both localStorage**. Putting a queued
incident's base64 photos in both puts multiple megabytes in the same quota twice, and `saveQueue()`'s
only failure handling is a `console.error` — a quota exception there silently discards the entire
outbox. The bytes live in the queue alone; the cache keeps `_pendingPhotoCount` so the card can still
say the photos exist. Photos are also downscaled to 1600 px on capture and capped at 6 per incident.

Use `createImageBitmap(blob, { imageOrientation: 'from-image' })` to decode before drawing to the
canvas. Drawing the raw file bakes in the *unrotated* pixels and every portrait photo comes out
sideways, because the rotation lives in an EXIF flag that only the renderer honours.

### `forceQueue` is what makes a pending photo actually upload

`_pendingPhoto` / `_pendingPhotos` are only ever consumed by the offline-queue drain. If the entry
posts **directly** instead, `createIncident` / `createVehicle` / `createPedestrian` strip them as
non-columns and the picture is gone with no error anywhere. That is not a hypothetical: it happens
whenever the storage upload fails while the database is still reachable. Every screen that can hold a
pending photo now passes `forceQueue: Boolean(pendingPhoto)` to `post()`.

Related: gate the upload attempt on `isAppOnline()`, not `navigator.onLine`. `useOfflineApi.shouldQueue`
uses the former, and when the two disagree nothing uploads while the post goes straight online.

## A refresh is not a page load — never re-raise `loading` on a background reload

**Symptom:** the OB and Incident pages "keep switching on and off" — the list vanishes to black and
then the content comes back, over and over. Every other page looked fine.

**Cause:** those two screens refreshed by calling the same loader they use on mount, and it opens
with `setLoading(true)`. That swaps the whole list for a bare "Loading entries…" div on a dark page,
which reads as the screen going black. The report screens never re-raised `loading` after the first
paint (`run()` only ever calls `setLoading(false)`) — that, and nothing else, is why they were fine.

It fires far more often than it looks. `NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT` is dispatched with
`forceRecheck` on every `visibilitychange`, `focus`, `pageshow` and native network change (see
`refreshConnectivityState` in [src/lib/connectivity.js](src/lib/connectivity.js)), **and** from
`confirmAppOnline()` after *each* successfully synced queue item — debounced to one every 1.5 s, so
draining a dozen queued entries strobes the list for as long as the drain lasts. The queue's own 60 s
auto-retry keeps that going while anything is pending.

[src/hooks/useLiveRefresh.js](src/hooks/useLiveRefresh.js) is now the one way to wire those three
events (`nightguard_sync_complete`, `online`, recheck) to a screen. It coalesces the burst — 600 ms
trailing debounce, no overlapping runs, 5 s floor between completed reads — and the handler it takes
must be **silent**:

- `loadX({ silent: true })` — do not touch `loading`.
- Render the spinner as `loading && rows.length === 0`, never `loading` alone.
- A failed refresh must not blank the list. What is on screen is still true, and offline is the
  expected condition on a guard's handset, not a fault worth shouting about.
- Read the cache **first**, before any network work and whatever `isAppOnline()` says, so the page is
  readable the instant it opens with no signal.

Load errors need their own state (`listError` on the OB screen). Sharing `error` with the form let a
background refresh wipe "Nature of Occurrence cannot be empty" out from under the guard mid-typing.

A refresh in flight when the guard hits Save used to resolve with server data that predated the
entry and overwrite both the list and the display cache — the entry appeared to vanish. Both screens
now bump a `submitSeq` ref when a save starts and discard any load answer from before it.

### `device_id` on ob_entries/incidents — two traps, both live in the data

The lists filter to this handset's own rows, with the per-device breakdown below
([src/lib/deviceAttribution.js](src/lib/deviceAttribution.js),
[src/components/DeviceBreakdown.jsx](src/components/DeviceBreakdown.jsx)). Two things will bite:

1. **It is the `devices` table ROW id (a uuid), not the hardware `NG-<ANDROID_ID>`.** `createObEntry`
   and `createIncident` write `device_id: currentDeviceRowId()`, which is
   `getCurrentDeviceRecord()?.id`. Matching on `getDeviceId()` matches nothing.
2. **It is null on everything written before `ensureDeviceRecord()` existed** — 14 of the 17 OB
   entries on record as of 2026-08-14 (incidents: 0 of 3, they are all newer). Those rows are
   history, **not a second device**. Counting the null bucket as a device makes a one-handset site
   claim two; filtering them out wipes most of the occurrence book off the guard's screen.

So the filter only engages when a second device has *genuinely* written (`writingDeviceCount > 1`),
and never when this handset has not resolved its own device record. On the current single-device
site it is a no-op: all 17 entries show and the breakdown panel renders nothing.

## Shift durations are DERIVED — those columns do not exist

`shifts` stores `started_at` and `ended_at` and nothing else about length. Both shift reports used to
read `shift.duration_hours`, `duration_minutes`, `duration_ms` and `is_sunday` straight off the row.
**Nothing has ever written any of them.** Every duration rendered as `undefinedm`, the total-hours
tile read `0h`, and the per-guard rollup added zeroes together.

Everything is computed at read time in [src/lib/shiftAnalytics.js](src/lib/shiftAnalytics.js), which
is the only place a shift number may be derived. Two rules it encodes:

- **A shift over 16 h, or closed with `superseded_by_new_shift` / `abandoned_backfill`, is not worked
  time.** It is still listed — it is evidence of a handover problem — but its hours are excluded from
  any total a client sees, or a single forgotten End Shift adds days of phantom cover.
- **Activity is attributed by `shift_id` first, then by time window.** An id-only join reports "0
  patrols" for shifts that were fully walked, because `shift_id` is null on a lot of history (the
  local `shift_<ts>` id is dropped by `nullableUuid()` until the server id is adopted — see
  `reconcileShiftSessionId`).

`endShiftRecord` now writes `payload.ended_at` rather than `new Date()`. A shift ended offline sits in
the queue until the handset finds signal, so "now" stretched a 12 h night into whatever time the phone
next saw a tower.

## "Checkpoint coverage 100%" was measuring the scan list against itself

The patrol dashboard computed `scanned / totalCheckpoints` where both came from the **scan** list — a
scan row exists precisely because somebody scanned, so the numerator was the whole list, `missed` was
`length - length`, and every device reported 100% coverage and 0 missed points forever.

Coverage needs the configured points as the denominator: distinct points reached, over
`getPatrolConfig().checkpoints`. A site with no points configured has **no measurable coverage** —
render `n/a` and say why. Never fall back to a percentage there; 100% of nothing is the bug above,
wearing a different mask.

Same rule for charts: "Acknowledged" and "Missing" are complements, so plotting both is one fact
drawn twice. The space belongs to *which* points were missed.

## There is no email delivery, and there never was

The "Email delivery" panel on every report collected recipients, a subject and a nightly send time,
and wrote them to a `report_schedules` table nothing has ever read. Its Send button did not send: it
opened the Android share sheet and pasted the recipient list into the message body as text. An admin
who typed the client's address in and switched it to Enabled had every reason to think reports went
out nightly. They never did.

It is gone — panel, `loadReportSchedules`, `saveReportSchedule`, and the local settings behind them.
Each report now has one `ShareButton` that builds the PDF and hands it to the OS share sheet
(`exportPdfDocument(..., { preferShare: true })`), where the admin picks WhatsApp, Gmail or Drive.
**Do not add scheduled email back without a server-side sender that actually sends it** — a form that
implies delivery is worse than no form.

## Checkpoint radius lives in TWO places

`GEOFENCE_RADIUS_METERS` exists in both [src/lib/geo.js](src/lib/geo.js) and
[PatrolGeo.java](android/app/src/main/java/com/nightguard/nightguardtrack/PatrolGeo.java). Change
them together or a patrol walked with the screen off scores differently from the same walk with the
screen on. Currently **10 m**: 1.0.16 tightened it to 3 m, which plus the 5 m margin cap gave an
~8 m effective radius that consumer GPS beside a building routinely misses — guards walked whole
routes that registered nothing.

## Three tables were empty, and every failure was silent

**`devices` — nothing ever inserted a row.** The app only ever *read* it, matching against rows an
admin was expected to type into the dashboard by hand. Nobody ever did, so `getCurrentDeviceRecord()`
always returned null, both `latest_sync_update` writes were dead code against a record that did not
exist, and the dashboard's device roster and "devices online" counter sat permanently at zero.
`ensureDeviceRecord()` in [src/services/schemaData.js](src/services/schemaData.js) now self-registers
on the hardware-bound id (`NG-<ANDROID_ID>`, survives reinstall), called from `recordDeviceSyncLog`
so it happens after every offline-queue drain. Select-then-insert rather than upsert on purpose:
with no DDL access a unique index on `device_id` cannot be assumed. It is best-effort — a handset
that cannot register must still be able to work a shift.

**`guards` — empty, so nothing is attributable to a person.** With no guards provisioned every
device signs in as the built-in General Guard, which is *deliberately* local-only and never synced
(`enqueueOfflineItem` skips it explicitly). `resolveGuardRefs` therefore correctly returns
`{ guard_id: null, local_guard_id: null }`, and every scan, patrol and shift lands with no guard
attached — 253 of 253 scans and 40 of 40 patrols as of 2026-08-11. **This is not a code bug and no
code change fixes it**: someone has to create guards in the admin panel. Don't go hunting for the
broken join. The dashboard's Settings → System page now states this out loud instead of leaving it
invisible.

**`shifts` — they accumulate forever.** Starting a shift was a bare insert that never looked at what
was already open, so a guard who did not tap End Shift left an `active` row behind permanently; 14
had piled up (oldest 28 days) and were closed by hand on 2026-08-11 with
`end_reason: 'abandoned_backfill'`. `startShiftRecord` now stamps `shifts.device_id` and closes what
that handset left open (`end_reason: 'superseded_by_new_shift'`). Scoped to the device deliberately —
a site can legitimately run several guards at once, and closing a colleague's live shift would be
worse than the bug being fixed.

## Two different words for a finished shift

The guard app writes `status: 'closed'` (`endShiftRecord` in [src/services/api.js](src/services/api.js));
the Express backend in `Desktop/NightGuardTrackApp` writes `'completed'`. Both mean finished. A read
that filters on one silently loses every shift ended by the other — which is exactly why the manager
dashboard's completed-shifts list was permanently empty. Always filter
`.in("status", ["completed", "closed"])`.

## `steps_taken` is an estimate and it has ONE meaning

There is no pedometer. `steps_taken` is `distance walked / 0.75 m` — see `estimateStepsFromDistance`
in [src/lib/geo.js](src/lib/geo.js), derived from the GPS trail and never counted.

It used to be written three different ways for the same patrol: the distance estimate to the server,
the **checkpoint count** into the local cache, and rendered as "N points" on the dashboard. Guards
and managers saw three different numbers for one walk. `endPatrolSession` now builds the completion
payload once and uses that single `steps_taken` for both the outbox and the cached patrol, so they
cannot drift apart again. Checkpoint counts belong in `checkpoints_completed` / `total_checkpoints`.

A real step count would be Android's `TYPE_STEP_COUNTER` inside the foreground service that is
already running — not a change to this number.

## The manager dashboard is a separate repo

`Desktop/NightGuardTrackApp`: an Express backend (Render), a Supabase `functions/` + `migrations/`
folder, and a frontend that is **one 160 KB `frontend/public/index.html`** published by Netlify.

That frontend talks to Supabase directly and **never calls the Express backend** — no `API_BASE`, no
`/api/` fetch anywhere in it. Before "fixing" a backend controller, check whether anything still
calls it. Leaflet is vendored into `frontend/public/vendor/leaflet/` rather than loaded from unpkg,
because a blocked CDN left `L` undefined and took the whole Patrol Routes page down with it.

### Cover & Activity is a PORT, not a second implementation

The dashboard's Cover & Activity panel computes the same figures as
[src/lib/shiftAnalytics.js](src/lib/shiftAnalytics.js), and that file is the source of truth for the
rules. **Change one, change both**, or a manager and a guard read different numbers off the same
shift. Both apply the same two rules, and both need to:

- Shifts left `active`, closed with `superseded_by_new_shift` / `abandoned_backfill`, or longer than
  16 h do not count toward hours. On 2026-08-12 that was **27 of 33** shifts on record, the longest
  running **621 hours**. Counting them would have claimed roughly 1,500 hours of cover nobody worked.
- Activity attaches by `shift_id` if it has one and by **time window** if it does not — only 12 of
  272 scans carry a `shift_id`.

Two traps the dashboard hit that the app did not:

1. **Never compute the "all locations" row from a pooled row set.** Time-window attribution then
   lets a visitor logged at site A fall inside site B's night shift, and the collective came out
   with more people in it than the sites it was made of. `sumCoverRows` adds the per-site rows up.
2. **`nfc_scans` is not a check-in list.** 190 of 272 rows are `method: 'route_point'` — breadcrumbs
   from the walked GPS trail. Filter them out (`method.is.null,method.neq.route_point`, same as
   `listNfcScans` does) or coverage runs past 100%.

### What the dashboard must NOT show

- **Dockets, Deliveries, Wheel Clamps.** No screen in the guard app creates any of them; all three
  tables have always held 0 rows. Removed 2026-08-12 — nav, tiles, shift-report sections and
  exports. Don't add them back without an app screen that writes them.
- **`ob_entries.entry_text`.** The app writes the occurrence into `nature_of_occurrence`; 0 of 17
  rows have ever had an `entry_text`.
- **A Guards page.** See below.

### One guard, and attribution is by device

The app runs a single built-in **General Guard** that is deliberately local-only and never synced,
so `guards` has always had 0 rows and always will. That is the design, not a gap: since bundle
1.1.19 the handset opens its own session and every patrol, scan and gate entry is filed against a
`device_id`. The dashboard's Guards module is gone, and the Settings health check now reports
**Device registration** instead of "Guards provisioned" — the old check warned an admin to go and
fix something that was working as intended. Anything that joins on `guard_id` will match nothing.

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

(The on-shift exemption is deliberate — never reload out from under a guard on duty. Don't "fix" it.)

### `mandatory` does not bypass the version check

`ota-check` decides whether an update exists **before** it ever reads `is_mandatory`: `isNewer(target,
current)` runs first, and `mandatory` only appears in the response payload afterwards. So publishing
a bundle whose version is equal to — or below — what the handset already runs does nothing at all,
whatever flags are on it.

The trap is the **built-in** bundle. An APK bakes in the bundle that was current when it was built,
and `resetWhenUpdate` makes a fresh install run that one. APK 1.21 carries bundle 1.1.22, so
production's newest published bundle (1.1.21) was correctly refused as a *downgrade* and every
device on that APK logged `up_to_date` forever. Always publish above the built-in version.

### The JS auto-apply never fires any more — Capgo's native swap is what delivers

`applyStagedUpdateIfSafe()` returns `deferred: shift_running` while `getShiftSession()` is truthy,
and under the device-session model `ensureDeviceSession()` opens a session on boot that only
`logout()` or an admin unbind ever clears. That gate therefore never opens, and neither does
`applyNow` at [liveUpdate.js:291](src/services/liveUpdate.js#L291) — the rationale recorded above
("a kiosk between shifts is idle") stopped holding when shifts stopped ending.

Staged bundles still install, because `next()` hands the decision to the plugin, which activates the
new bundle **natively on the next background event**. Screen off is enough. Two things that are not:
`am force-stop` + relaunch (the process dies before the lifecycle event), and the Settings override —
the guard sidebar has no Settings entry, so on a kiosk handset there is no manual route at all.

Verify a rollout by watching `ota_update_logs` go `check` → `download_started` → `downloaded` →
(background event) → the device reporting the new version as its `from_version`.

### `--mandatory` reloads the app WHEREVER the guard is standing

**Symptom (2026-08-14):** a guard adding a photo to an incident report had the app "do a weird
refresh". The report and the photo were gone. Nothing was logged as an error.

`ota_update_logs` told the whole story: `downloaded` 07:48:49.183, `applied` 07:48:49.678 — half a
second apart, the same `runOtaUpdate` call. Not a background swap. An inline reload, from
[liveUpdate.js:291](src/services/liveUpdate.js#L291):

```js
const applyNow = immediate || (check.mandatory === true && !shiftRunning);
if (applyNow) { await updater.set({ id: bundle.id }); }   // destroys the JS context
```

Three things made it land exactly on the photo:

1. `check()` runs on **every resume**, and returning from the camera or the photo picker *is* a
   resume. So coming back from a photo was precisely when this fired.
2. The 90-second idle rule — whose comment already said *"a reload while somebody is typing a
   visitor's name throws the form away"* — lives on `applyStagedUpdateIfSafe()`, which **never
   runs**: it returns `deferred: shift_running` first, and under the device-session model that
   session never clears. The careful gate was on the dead path; the live path had none.
3. `shiftRunning` was false, so nothing else stopped it.

Fixed by gating the inline apply the same way (`deviceIsIdle()`), and by adding
`holdLiveUpdates(reason)` — an explicit hold any screen with unsaved work can take. Idle time alone
is not enough: a guard standing in the camera for two minutes looks perfectly idle from inside the
updater. `IncidentScreen` holds it for as long as the wizard is open. The resume handler also calls
`touch()` **before** `check()`, so returning from the camera is never mistaken for an idle device.

**Immediate mitigation with no new bundle:** `UPDATE ota_bundles SET is_mandatory = false` for the
version. `applyNow` goes false, the bundle stages instead, and it applies on the next
background/restart. That is what was done to 1.1.24 on the day.

### React state is not storage — an unfinished incident report must be on disk

The wizard held everything in React state, so anything that destroyed the JS context threw away the
guard's written account AND the photos, silently. OTA was only the newest cause; the common one has
nothing to do with OTA at all — **taking a photo launches an external activity, and a low-RAM
handset routinely reclaims the app behind it.**

[src/lib/incidentDraft.js](src/lib/incidentDraft.js) persists the draft, restores it behind a
"Unfinished report — Resume / Discard" banner, and clears it on submit or explicit Back (a reload is
not a decision to abandon; pressing Back is).

Two things it must keep doing:

- **The draft goes to the FILESYSTEM on native, never localStorage.** Photos are base64 megabytes,
  and the offline queue shares that quota — `saveQueue()`'s only failure handling is a
  `console.error`, so a quota exception there silently discards the entire outbox. Saving one unsent
  form must never cost every queued write. On web it keeps text only, for the same reason.
- **Rehydrate `blob` from the data URL on restore.** `uploadEntryPhotos()` filters on `p?.blob`, so
  a restored photo without one is dropped on submit with no error — the exact class of bug the
  draft exists to prevent.

### Bundles now install themselves — the Settings button is the override

Staging was never a rollout. `next()` applies on the next app **start**, and a gatehouse tablet is
launched once and left running for weeks, so a published bundle sat downloaded-but-dormant until
somebody walked over and tapped "Check for updates now".

`installLiveUpdateAutomation()` (called once from [main.jsx](src/main.jsx)) checks on launch, on
resume and every 30 minutes, and calls `applyStagedUpdateIfSafe()` on resume and on a 60-second
timer. Two gates guard the apply, and **neither may be relaxed**:

1. **Never while a shift is running.** `set()` destroys the JS context and reloads. Nothing is lost —
   shift session, offline queue and Supabase session all live in storage that survives — but a screen
   going blank mid-patrol reads as a crash to the guard holding it.
2. **Never mid-interaction.** 90 s of no touch input first, tracked by capture-phase listeners on
   `pointerdown`/`keydown`/`touchstart`/`wheel`. A reload while somebody is typing a visitor's name
   throws the form away. Coming back from the background skips this gate (`requireIdle: false`) —
   nothing is half-typed there.

Both open by themselves on a real device: a kiosk between shifts is idle, and a pocketed phone is
backgrounded. `getNextBundle()` is optional-chained, so an APK carrying an older updater plugin
simply never auto-applies rather than throwing.

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
