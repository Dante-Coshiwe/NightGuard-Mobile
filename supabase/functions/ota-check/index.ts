// ============================================================================
//  Edge Function: ota-check
//  The device asks "is there a newer web bundle for me?" and we answer with a
//  short-lived signed download URL if so.
//
//  Request (POST JSON):
//    {
//      "deviceId":       "NG-ABC123-XYZ",     // from the app (optional but logged)
//      "orgId":          "<uuid>",            // organization the device belongs to
//      "currentVersion": "1.3.0",             // web bundle currently running
//      "nativeVersion":  "1.0.0",             // installed APK versionName (optional)
//      "platform":       "android"            // 'android' | 'ios' | 'web'
//    }
//
//  Response 200:
//    { "updateAvailable": true,
//      "version": "1.4.0",
//      "url": "https://.../signed-url",       // valid ~5 min, download the zip
//      "checksum": "<sha256>",
//      "mandatory": false,
//      "releaseNotes": "…",
//      "channel": "production" }
//   or
//    { "updateAvailable": false }
//
//  Deploy:  supabase functions deploy ota-check --no-verify-jwt
//  (--no-verify-jwt because the app calls it with the anon key, not a user JWT.)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — long enough to download, short enough to not leak.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Service-role client: bypasses RLS so it can read the private catalog and
  // sign private storage objects. NEVER expose this key to the app.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const deviceId = (payload.deviceId ?? null) as string | null;
  const orgId = (payload.orgId ?? null) as string | null;
  const currentVersion = (payload.currentVersion ?? null) as string | null;
  const nativeVersion = (payload.nativeVersion ?? null) as string | null;
  const platform = (payload.platform ?? "android") as string;

  try {
    // Ask the DB which bundle this org/device should be on.
    const { data, error } = await supabase.rpc("ota_resolve_bundle", {
      p_org_id: orgId,
      p_native_version: nativeVersion,
    });

    if (error) {
      console.error("ota_resolve_bundle error:", error);
      return json({ error: "resolver_failed" }, 500);
    }

    const target = Array.isArray(data) ? data[0] : data;

    // Offer only genuine upgrades. Plain inequality would push a DOWNGRADE to a
    // device whose baked-in bundle is newer than the latest published one (e.g. a
    // fresh APK released before its bundle is published).
    const semver = (v: string | null) =>
      String(v ?? "").split(".").map((n) => parseInt(n, 10) || 0);
    const isNewer = (a: string | null, b: string | null) => {
      const [x, y] = [semver(a), semver(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
      }
      return false;
    };

    // No target, or the device already has the target version or newer → done.
    if (!target || (currentVersion && !isNewer(target.version, currentVersion))) {
      await supabase.from("ota_update_logs").insert({
        device_id: deviceId,
        organization_id: orgId,
        from_version: currentVersion,
        to_version: target?.version ?? null,
        status: "up_to_date",
        native_version: nativeVersion,
        platform,
      });
      return json({ updateAvailable: false });
    }

    // Mint a short-lived signed URL for the private bundle object.
    const { data: signed, error: signErr } = await supabase.storage
      .from("ota-bundles")
      .createSignedUrl(target.storage_path, SIGNED_URL_TTL_SECONDS);

    if (signErr || !signed?.signedUrl) {
      console.error("createSignedUrl error:", signErr);
      return json({ error: "signing_failed" }, 500);
    }

    // Log that we offered this update.
    await supabase.from("ota_update_logs").insert({
      device_id: deviceId,
      organization_id: orgId,
      bundle_id: target.bundle_id,
      from_version: currentVersion,
      to_version: target.version,
      status: "check",
      native_version: nativeVersion,
      platform,
    });

    return json({
      updateAvailable: true,
      version: target.version,
      url: signed.signedUrl,
      checksum: target.checksum ?? null,
      mandatory: target.is_mandatory ?? false,
      releaseNotes: target.release_notes ?? null,
      channel: target.channel_name ?? null,
    });
  } catch (err) {
    console.error("ota-check unexpected error:", err);
    return json({ error: "internal_error" }, 500);
  }
});
