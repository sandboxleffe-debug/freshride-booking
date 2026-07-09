// api/_lib/rate-limit.js
// Basic fixed-window rate limiter backed by Supabase, for public endpoints
// (Vercel functions are stateless, so this can't live in memory).

import { getSupabaseAdmin } from "./supabase.js";

export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Returns true if the request is allowed, false if the caller has hit the limit.
export async function checkRateLimit({ key, maxRequests, windowSeconds }) {
  const supabase = getSupabaseAdmin();
  const now = new Date();

  const { data } = await supabase
    .from("freshride_rate_limit")
    .select("count, window_start")
    .eq("key", key)
    .single();

  if (!data || now - new Date(data.window_start) > windowSeconds * 1000) {
    await supabase.from("freshride_rate_limit").upsert({ key, count: 1, window_start: now.toISOString() });
    return true;
  }

  if (data.count >= maxRequests) return false;

  await supabase.from("freshride_rate_limit").update({ count: data.count + 1 }).eq("key", key);
  return true;
}
