// ============================================================================
//  Edge Function: ota-report
//  The device reports the outcome of an update attempt. We append an audit log
//  row and, on success, update the matching `devices` row's app_version.
//
//  Request (POST JSON):
//    {
//      "deviceId":     "NG-ABC123-XYZ",
//      "orgId":        "<uuid>",
//      "bundleId":     "<uuid>",           // from the ota-check response (optional)
//      "fromVersion":  "1.3.0",
//      "toVersion":    "1.4.0",
//      "status":       "applied",          // 'download_started'|'downloaded'|'applied'|'failed'
//      "errorMessage": "…",                // when status = 'failed'
//      "nativeVersion":"1.0.0",
//      "platform":     "android"
//    }
//
//  Response: { "ok": true }
//
//  Deploy:  supabase functions deploy ota-report --no-verify-jwt
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

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

const VALID_STATUSES = new Set([
  "download_started",
  "downloaded",
  "applied",
  "failed",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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
  const bundleId = (payload.bundleId ?? null) as string | null;
  const fromVersion = (payload.fromVersion ?? null) as string | null;
  const toVersion = (payload.toVersion ?? null) as string | null;
  const status = (payload.status ?? "") as string;
  const errorMessage = (payload.errorMessage ?? null) as string | null;
  const nativeVersion = (payload.nativeVersion ?? null) as string | null;
  const platform = (payload.platform ?? "android") as string;

  if (!VALID_STATUSES.has(status)) {
    return json({ error: "invalid_status" }, 400);
  }

  try {
    await supabase.from("ota_update_logs").insert({
      device_id: deviceId,
      organization_id: orgId,
      bundle_id: bundleId,
      from_version: fromVersion,
      to_version: toVersion,
      status,
      error_message: errorMessage,
      native_version: nativeVersion,
      platform,
    });

    // On a successful apply, reflect the new web version on the device record.
    // `devices.device_id` is the app's NG-XXXX identifier (varchar unique).
    if (status === "applied" && deviceId && toVersion) {
      const { error: updErr } = await supabase
        .from("devices")
        .update({
          app_version: toVersion,
          latest_sync_update: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("device_id", deviceId);
      if (updErr) {
        // Non-fatal: log row is already written; just note it.
        console.warn("devices app_version update failed:", updErr.message);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("ota-report unexpected error:", err);
    return json({ error: "internal_error" }, 500);
  }
});
