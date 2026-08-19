// api/_lib/booking-shared.js
// Booking-finalization logic shared between the normal instant-booking path
// (book-slot.js) and the admin's "Bekreft tid" action on a pending time
// request (admin-bookings.js) — both end up doing the exact same thing
// (redeem a code, send the customer their confirmation SMS), just triggered
// from different places.

import { sendSms } from "./elks-sms.js";
import { findCustomerByPhone } from "./customers.js";
import { redeemDiscountCode } from "./discount-codes.js";
import { redeemReferralCode } from "./referral-codes.js";
import { getOsloParts, formatOsloTime } from "./timezone.js";
import { buildBookingTextCustomer, buildTimeRequestTextCustomer } from "./sms-templates.js";

// Estimated duration per service, in minutes. Used both to shrink a real
// "Ledig" slot's booked duration and to size a brand-new calendar event
// when there's no existing slot to inherit a duration from. If multiple
// services are chosen, the longest estimate among them is used.
export const SERVICE_DURATIONS_MIN = {
  "FreshRide Complete": 180,
  "FreshRide Interior": 90,
  "FreshRide Exterior": 90,
  "FreshRide Premium": 240,
  "FreshRide Interior+": 150,
};

export function estimatedDurationMinutes(services) {
  const matched = (services || [])
    .map(s => SERVICE_DURATIONS_MIN[s])
    .filter(v => v !== undefined);
  if (!matched.length) return null; // unknown service — caller picks a fallback
  return Math.max(...matched);
}

const NO_MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];

export function formatNorwegian(dateTimeStr) {
  if (!dateTimeStr) return { date: "", time: "" };
  const p = getOsloParts(dateTimeStr);
  const date = `${p.day} ${NO_MONTHS[p.month - 1]} ${p.year}`;
  const time = `${p.hour}:${p.minute}`;
  return { date, time };
}

// Same wording as formatNorwegian's date half, but for a plain "YYYY-MM-DD"
// string (a time request's requested_date is already Oslo wall-clock — no
// absolute-instant timezone conversion needed to display it).
export function formatNorwegianDateOnly(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d}. ${NO_MONTHS[m - 1]} ${y}`;
}

// One-time discount code first; if that's not a real discount code, falls
// back to a personal "tips en venn" referral code (either crediting whoever
// owns it, or letting the owner cash in their own earned tier discount).
// Never throws — a redemption failure (already used, typo, race) just means
// no discount gets attached, it never blocks the booking itself.
export async function redeemCodeForBooking(supabase, discountCode, phone) {
  if (!discountCode) return { discountPercent: null, referredBy: null };
  try {
    const result = await redeemDiscountCode(supabase, discountCode, { phone });
    if (result.ok) return { discountPercent: result.percent, referredBy: null };
    // Not a valid one-time code (unknown/already used) — fall through and
    // try it as a personal referral code instead, same as book-slot.js
    // always has.
  } catch (err) {
    console.error("redeemCodeForBooking discount error:", err);
  }
  try {
    const match = await findCustomerByPhone(supabase, phone);
    const referralResult = await redeemReferralCode(supabase, discountCode, { customerNumber: match ? match.customer_number : null });
    if (referralResult?.kind === "owner" && referralResult.percent > 0) {
      return { discountPercent: referralResult.percent, referredBy: null };
    }
    if (referralResult?.kind === "referred") {
      return { discountPercent: null, referredBy: referralResult.referrerCustomerNumber };
    }
  } catch (err) {
    console.error("redeemCodeForBooking referral error:", err);
  }
  return { discountPercent: null, referredBy: null };
}

// Sends the customer their booking-confirmed SMS (code, time, services,
// calendar link) — the one moment in the flow a customer actually learns
// their booking is real.
export async function sendCustomerBookingSms({ phone, name, services, start, end, code }) {
  const { date, time } = formatNorwegian(start);
  const endTime = formatOsloTime(end);
  const message = buildBookingTextCustomer({ services, phone, date, time, endTime, code });
  const ok = await sendSms({ toPhone: phone, message });
  return { ok, message };
}

// Sent to the customer the moment they submit a "Foreslå tid" request —
// same shape as the real booking SMS above, minus the code/calendar link
// (nothing's actually booked yet), plus a note that a second SMS follows
// once William confirms the time in admin.
export async function sendTimeRequestReceivedSms({ phone, services, requestedDate, requestedTime }) {
  const date = formatNorwegianDateOnly(requestedDate);
  const message = buildTimeRequestTextCustomer({ services, date, time: requestedTime });
  const ok = await sendSms({ toPhone: phone, message });
  return { ok, message };
}
