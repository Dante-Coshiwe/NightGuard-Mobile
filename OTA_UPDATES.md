# Over-the-air (OTA) updates — Capgo

NightGuard uses [Capgo](https://capgo.app) (`@capgo/capacitor-updater`) to push **web-layer**
updates to devices without reinstalling the APK.

## What OTA can and cannot update

| Change | OTA (Capgo)? |
|---|---|
| React screens, patrol/GPS logic, forms, validation, styling, offline/photo fixes | ✅ Yes — push instantly |
| Native code (`KioskPlugin.java`, permissions, plugins, app icon, `versionCode`) | ❌ No — needs a new signed APK |

Rule of thumb: if it lives in `src/`, OTA can ship it. If it lives in `android/`, it needs a new APK.

## How devices receive updates (already wired)

- `capacitor.config.json` → `CapacitorUpdater`: `autoUpdate: true`, `directUpdate: false`.
  Each launch the app checks Capgo, downloads a newer bundle in the background, and swaps it in on
  the **next app restart/background** — non-disruptive while a guard is on shift or the device is
  kiosked.
- `src/main.jsx` calls `notifyLiveUpdateReady()` on boot. This confirms the new bundle works; if it
  ever failed to boot, Capgo auto-rolls-back to the previous bundle (`appReadyTimeout` = 20s).
- `resetWhenUpdate: true` means installing a new **APK** always supersedes any OTA bundle.

## One-time setup (you must do this once)

1. Create a free account at https://capgo.app and copy your API key.
2. From the project root:
   ```bash
   npm run ota:login -- <YOUR_API_KEY>
   npm run ota:init
   ```
   `init` registers app id `com.nightguard.nightguardtrack` with Capgo.
3. Rebuild and install the signed APK **once** so the device has the Capgo-enabled native shell
   (any APK built after this change already has it).

## Publishing an update (every time)

After making changes under `src/`:

```bash
npm run ota:publish
```

This builds `dist/` and uploads it to the **production** channel. Devices pick it up on their next
launch and apply it on the following restart.

- Bump the app version in `package.json` before publishing so Capgo can order releases.
- Use `npx @capgo/cli bundle upload --channel beta` to test on a beta channel first.
- Roll back from the Capgo dashboard if a bundle misbehaves (or it auto-rolls-back on boot failure).

## Self-hosting instead of Capgo Cloud (optional)

Capgo can run against your own backend instead of their cloud. If you prefer that, add
`updateUrl` / `statsUrl` / `channelUrl` under `CapacitorUpdater` in `capacitor.config.json`
pointing at your endpoints (e.g. a Supabase Edge Function) — ask and I can wire that path instead.
