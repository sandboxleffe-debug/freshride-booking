// api/_lib/multi-use-codes.js
// "Kampanjekode" — unlike a one-time discount code (freshride_discount_codes,
// exactly one redemption ever) or a referral code (permanent, per-customer),
// this is a single code many different customers can type — good for a fixed
// number of uses William sets (e.g. "AUGUST" good for the first 20 bookings).
// The scarcity is the point: it creates urgency for a time-limited campaign
// instead of quietly working for anyone who wants it for the whole period.

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I — matches discount-codes.js

export function randomCampaignCode() {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

export async function listMultiUseCodes(supabase) {
  const { data, error } = await supabase.from("freshride_multi_use_codes").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createMultiUseCode(supabase, { code, percent, maxUses }) {
  const finalCode = (code || "").trim().toUpperCase() || randomCampaignCode();
  const { data, error } = await supabase.from("freshride_multi_use_codes")
    .insert({ code: finalCode, percent, max_uses: maxUses })
    .select().single();
  if (error) throw error;
  return data;
}

export async function setMultiUseCodeActive(supabase, code, active) {
  const { error } = await supabase.from("freshride_multi_use_codes").update({ active }).eq("code", code);
  if (error) throw error;
}

export async function deleteMultiUseCode(supabase, code) {
  const { error } = await supabase.from("freshride_multi_use_codes").delete().eq("code", code);
  if (error) throw error;
}

// Read-only check for the live "✓ 15% rabatt" preview as the customer types
// a code — never touches use_count, only actual redemption does that.
export async function previewMultiUseCode(supabase, code) {
  if (!code) return null;
  const { data } = await supabase.from("freshride_multi_use_codes")
    .select("percent, max_uses, use_count, active")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (!data || !data.active || data.use_count >= data.max_uses) return null;
  return { valid: true, percent: data.percent };
}

// Atomic — see the redeem_multi_use_code() function's own comment for why
// this has to be a single UPDATE, not a read-then-write from here.
export async function redeemMultiUseCode(supabase, code) {
  if (!code) return { ok: false };
  const { data, error } = await supabase.rpc("redeem_multi_use_code", { code_param: code.trim().toUpperCase() });
  if (error || !data || !data.length) return { ok: false };
  return { ok: true, percent: data[0].percent };
}
