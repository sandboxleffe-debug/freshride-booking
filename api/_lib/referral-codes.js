// api/_lib/referral-codes.js
// Permanent, reusable "tips en venn"-code — one per customer, generated
// lazily the first time it's needed (attached to a thank-you/completion
// SMS). Unlike freshride_discount_codes (one-time-use, admin-generated),
// this code never expires and never gets marked "used" — it just keeps a
// running tally of how many brand-new customers have booked with it.
//
// Reward model: referring N new customers unlocks (10 + 5*(N-1))% off the
// referrer's OWN next booking, redeemed by typing their own code in at
// booking time. Redeeming resets the tally back down to 1 (still worth
// 10%), not to 0 — the code keeps paying out at least the base rate once
// it's ever referred anyone. Only brand-new customers (no prior job on
// file) count toward the tally, so an existing customer can't farm stars
// by re-using a friend's code on themselves.

import { findCustomerByPhone } from "./customers.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — same alphabet as discount-codes.js

function randomSuffix(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function referralTierPercent(pendingCount) {
  const n = Number(pendingCount) || 0;
  if (n < 1) return 0;
  return 10 + 5 * (n - 1);
}

// Lazily creates a customer's permanent referral code the first time it's
// needed. Leading "V" keeps it visually distinct from one-time discount
// codes while staying the same 5-character length as the booking form's
// existing rabattkode input.
export async function getOrCreateReferralCode(supabase, customerNumber) {
  const number = String(customerNumber);
  const { data: existing } = await supabase
    .from("freshride_customers")
    .select("referral_code")
    .eq("customer_number", number)
    .maybeSingle();
  if (existing?.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = "V" + randomSuffix(4);
    const { error } = await supabase
      .from("freshride_customers")
      .upsert({ customer_number: number, referral_code: code, updated_at: new Date().toISOString() });
    if (!error) return code;
    if (error.code !== "23505") throw error; // anything but a code collision is unexpected
  }
  return null;
}

// Read-only check for the booking form's "✓ 15% rabatt" preview — never
// writes anything. `phone` is whatever the customer has typed into the
// phone field so far, used to tell an owner previewing their own code
// (tiered %) apart from a brand-new customer previewing someone else's
// (always 0%, but still a "valid" code).
export async function previewReferralCode(supabase, code, phone) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return null;
  const { data } = await supabase
    .from("freshride_customers")
    .select("customer_number, referral_pending_count")
    .eq("referral_code", clean)
    .maybeSingle();
  if (!data) return null; // not a referral code at all

  const match = await findCustomerByPhone(supabase, phone);
  const isOwner = match && String(match.customer_number) === String(data.customer_number);

  if (isOwner) {
    const percent = referralTierPercent(data.referral_pending_count);
    return { valid: percent > 0, percent, kind: "owner" };
  }
  if (match) return { valid: false, percent: 0, kind: "not_owner" }; // existing customer, someone else's code — no effect
  return { valid: true, percent: 0, kind: "referred" }; // brand-new customer — no discount, credits the owner on redeem
}

// Called once a booking actually goes through (book-slot.js). `customerNumber`
// is the CURRENT booker's own existing customer number if they have one
// (null for a brand-new customer) — resolved by the caller via
// findCustomerByPhone before this runs, since the draft job log hasn't
// allocated one yet at this point.
export async function redeemReferralCode(supabase, code, { customerNumber } = {}) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return { ok: false };
  const { data } = await supabase
    .from("freshride_customers")
    .select("customer_number, referral_pending_count, referral_lifetime_count")
    .eq("referral_code", clean)
    .maybeSingle();
  if (!data) return { ok: false };

  const isOwner = customerNumber && String(customerNumber) === String(data.customer_number);

  if (isOwner) {
    const percent = referralTierPercent(data.referral_pending_count);
    if (percent <= 0) return { ok: false };
    await supabase
      .from("freshride_customers")
      .update({ referral_pending_count: 1 })
      .eq("customer_number", data.customer_number);
    return { ok: true, percent, kind: "owner" };
  }

  if (customerNumber) return { ok: false }; // existing customer, not the owner — no effect, prevents star-farming

  const nextPending = (Number(data.referral_pending_count) || 0) + 1;
  const nextLifetime = (Number(data.referral_lifetime_count) || 0) + 1;
  await supabase
    .from("freshride_customers")
    .update({ referral_pending_count: nextPending, referral_lifetime_count: nextLifetime })
    .eq("customer_number", data.customer_number);
  return { ok: true, percent: 0, kind: "referred", referrerCustomerNumber: data.customer_number };
}
