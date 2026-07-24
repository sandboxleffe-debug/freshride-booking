// api/_lib/discount-codes.js
// One-time-use discount codes: admin generates a 5-char code with a fixed
// percent in Innstillinger, hands it to a specific customer, and it can be
// typed in once at booking time.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids codes that are hard to read aloud or tell apart

function randomCode() {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export async function generateDiscountCode(supabase, percent) {
  const pct = Math.max(1, Math.min(100, Math.round(Number(percent) || 0)));
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const { data, error } = await supabase
      .from("freshride_discount_codes")
      .insert({ code, percent: pct })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw error; // anything but a PK collision is unexpected
  }
  throw new Error("Klarte ikke å generere en unik kode");
}

export async function listDiscountCodes(supabase) {
  const { data, error } = await supabase
    .from("freshride_discount_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteUnusedDiscountCode(supabase, code) {
  const { error } = await supabase
    .from("freshride_discount_codes")
    .delete()
    .eq("code", (code || "").toUpperCase())
    .eq("used", false)
    .is("given_away_at", null);
  return !error;
}

export async function getDiscountCodeInfo(supabase, code) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return null;
  const { data } = await supabase
    .from("freshride_discount_codes")
    .select("code, percent, used, given_away_at")
    .eq("code", clean)
    .maybeSingle();
  return data || null;
}

// Marks a code as handed to a specific customer (e.g. attached to a
// thank-you SMS) without redeeming it — the customer still types it in at
// booking time to actually get the discount (see redeemDiscountCode). The
// atomic WHERE (not used, not already given away) means the same code can
// never be handed to two customers by mistake — it really is one-time-use,
// just with two steps: given away, then redeemed.
export async function markDiscountCodeGivenAway(supabase, code, { customerNumber, name } = {}) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return { ok: false };
  const { data, error } = await supabase
    .from("freshride_discount_codes")
    .update({
      given_away_at: new Date().toISOString(),
      given_to_customer_number: customerNumber || null,
      given_to_name: name || null,
    })
    .eq("code", clean)
    .eq("used", false)
    .is("given_away_at", null)
    .select()
    .maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true };
}

// Read-only check for the booking form to show a live "✓ 15% rabatt" as the
// customer types — never marks the code as used.
export async function validateDiscountCode(supabase, code) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return { valid: false };
  const { data } = await supabase
    .from("freshride_discount_codes")
    .select("percent, used")
    .eq("code", clean)
    .maybeSingle();
  if (!data || data.used) return { valid: false };
  return { valid: true, percent: data.percent };
}

// Atomic single-use redemption — the WHERE used:false means only one caller
// can ever win this update, so two people racing on the same code can't both
// get the discount. Called from book-slot.js once a booking actually goes
// through, never from the public validate check above.
export async function redeemDiscountCode(supabase, code, { phone, customerNumber } = {}) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return { ok: false };
  const { data, error } = await supabase
    .from("freshride_discount_codes")
    .update({
      used: true,
      used_at: new Date().toISOString(),
      used_by_phone: phone || null,
      used_by_customer_number: customerNumber || null,
    })
    .eq("code", clean)
    .eq("used", false)
    .select()
    .maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, percent: data.percent };
}
