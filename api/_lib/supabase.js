// api/_lib/supabase.js
// Server-side Supabase client using the SERVICE ROLE key — this bypasses
// Row Level Security entirely, which is why it must only ever be used in
// serverless functions (never sent to the browser). Public-facing reads
// go through this same client but only ever select what's meant to be
// public (active services, about content).
//
// Requires these Vercel env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export function checkAdminPassword(req) {
  const password = req.headers["x-admin-password"];
  return !!password && password === process.env.ADMIN_PASSWORD;
}
