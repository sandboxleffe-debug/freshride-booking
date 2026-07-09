// api/_lib/talkdesk-auth.js
// OAuth2 Client Credentials token for the Talkdesk API, cached in Supabase
// so serverless invocations don't each request a fresh token. Refreshes
// automatically once the cached token is close to expiry — no more manual
// copy-pasting a token that dies every ~30 min.
//
// Requires these Vercel env vars:
//   TALKDESK_CLIENT_ID
//   TALKDESK_CLIENT_SECRET
//   TALKDESK_TOKEN_URL   (optional — defaults to the EU endpoint below)
//   TALKDESK_SCOPE       (optional — only needed if Talkdesk requires one)

import { getSupabaseAdmin } from "./supabase.js";

const TOKEN_URL = process.env.TALKDESK_TOKEN_URL || "https://api.talkdeskapp.eu/oauth/token";
const REFRESH_MARGIN_MS = 60_000; // fetch a new token if the cached one expires within 60s

export async function getTalkdeskAccessToken() {
  const supabase = getSupabaseAdmin();

  const { data: cached } = await supabase
    .from("freshride_talkdesk_token")
    .select("access_token, expires_at")
    .eq("id", 1)
    .single();

  const now = Date.now();
  if (cached?.access_token && cached?.expires_at && new Date(cached.expires_at).getTime() - now > REFRESH_MARGIN_MS) {
    return cached.access_token;
  }

  const clientId = process.env.TALKDESK_CLIENT_ID;
  const clientSecret = process.env.TALKDESK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TALKDESK_CLIENT_ID/TALKDESK_CLIENT_SECRET is not set");
  }

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (process.env.TALKDESK_SCOPE) body.set("scope", process.env.TALKDESK_SCOPE);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Talkdesk token request failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const expiresAt = new Date(now + (Number(json.expires_in) || 3600) * 1000).toISOString();

  await supabase.from("freshride_talkdesk_token").upsert({ id: 1, access_token: json.access_token, expires_at: expiresAt });

  return json.access_token;
}
