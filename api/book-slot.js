// api/book-slot.js
// POST /api/book-slot { eventId, name, phone, services: string[], start, end }
// -> { ok: true, smsSent: boolean, emailSent: boolean, code: "A12" }
//
// 1. Books a "Ledig" slot in Google Calendar, assigns a short unique code.
//    The booked event's END TIME is adjusted based on the estimated
//    duration of the chosen service(s) — e.g. a 3-hour "Ledig" slot
//    shrinks to 1.5 hours if the customer only picks "Kun innvendig".
//    It never extends beyond the original slot, only shrinks.
// 2. Sends the booking details + code to Talkdesk for SMS confirmation.
// 3. Sends a reminder email to the business owner with the same info.

import { getCalendarClient, CALENDAR_ID, getUsedCodes, generateUniqueCode } from "./_lib/google-calendar.js";
import { sendOwnerEmail } from "./_lib/email.js";
import { getSupabaseAdmin } from "./_lib/supabase.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";
import { sendTalkdeskSms } from "./_lib/talkdesk-sms.js";
import { getOsloParts, formatOsloTime } from "./_lib/timezone.js";
import { createDraftJobLog } from "./_lib/customers.js";
import { redeemDiscountCode } from "./_lib/discount-codes.js";
import { buildBookingText } from "./_lib/sms-templates.js";

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";
const OWNER_PHONE = "921 33 900";

// Estimated duration per service, in minutes. Used to shrink the booked
// calendar event when the chosen service takes less time than the
// original "Ledig" slot. If multiple services are chosen, the longest
// estimate among them is used.
const SERVICE_DURATIONS_MIN = {
  "FreshRide Complete": 180,
  "FreshRide Interior": 90,
  "FreshRide Exterior": 90,
  "FreshRide Premium": 240,
  "FreshRide Interior+": 150,
};

function estimatedDurationMinutes(services) {
  const matched = services
    .map(s => SERVICE_DURATIONS_MIN[s])
    .filter(v => v !== undefined);
  if (!matched.length) return null; // unknown service — keep original slot length
  return Math.max(...matched);
}

const NO_MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];

function formatNorwegian(dateTimeStr) {
  if (!dateTimeStr) return { date: "", time: "" };
  const p = getOsloParts(dateTimeStr);
  const date = `${p.day} ${NO_MONTHS[p.month - 1]} ${p.year}`;
  const time = `${p.hour}:${p.minute}`;
  return { date, time };
}

async function logNotification({ channel, recipient, code, name, status }) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("freshride_notifications").insert({
      channel, recipient, booking_code: code, customer_name: name, status,
    });
  } catch (err) {
    console.error("logNotification error:", err);
  }
}

async function sendBookingSms({ phone, name, services, start, end, code }) {
  const { date, time } = formatNorwegian(start);
  const endTime = formatOsloTime(end);
  const message = buildBookingText({ name, phone, services, date, time, endTime, code });
  return sendTalkdeskSms({ toPhone: phone, name, time, date, services, address: BUSINESS_ADDRESS, message });
}

// Extra SMS to the business owner's own number(s), if enabled in admin
// (Om oss-fanen). Separate from the owner email — some prefer SMS.
async function sendOwnerSms({ name, phone, services, start, end, code }) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("freshride_about")
      .select("owner_sms_notify, owner_sms_phone")
      .eq("id", 1)
      .single();
    if (error || !data?.owner_sms_notify || !data?.owner_sms_phone) return false;

    const { date, time } = formatNorwegian(start);
    const endTime = formatOsloTime(end);
    const message = buildBookingText({ name, phone, services, date, time, endTime, code });

    const numbers = data.owner_sms_phone.split(",").map(n => n.trim()).filter(Boolean);
    const results = await Promise.all(
      numbers.map(async toPhone => {
        const ok = await sendTalkdeskSms({ toPhone, name, time, date, services, address: BUSINESS_ADDRESS, message });
        await logNotification({ channel: "sms_eier", recipient: toPhone, code, name, status: ok ? "ok" : "failed" });
        return ok;
      })
    );
    return results.some(Boolean);
  } catch (err) {
    console.error("sendOwnerSms error:", err);
    return false;
  }
}

async function sendOwnerReminderEmail({ name, phone, services, start, end, code }) {
  const { date, time } = formatNorwegian(start);
  const endTime = formatOsloTime(end);
  return sendOwnerEmail({
    subject: `Ny booking: ${name} — ${date} kl. ${time}`,
    text: buildBookingText({ name, phone, services, date, time, endTime, code }),
  });
}

// Best-effort wrapper — never blocks the booking itself if the draft
// job log creation fails for some reason.
async function createDraftJobLogForBooking({ name, phone, services, start, code, car, discountCode, discountPercent }) {
  try {
    const supabase = getSupabaseAdmin();
    const p = getOsloParts(start);
    const pad = n => String(n).padStart(2, "0");
    const jobDate = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    await createDraftJobLog(supabase, { name, phone, services, jobDate, code, car, discountCode, discountPercent });
  } catch (err) {
    console.error("createDraftJobLogForBooking error:", err);
  }
}

// Best-effort, one-time redemption of a customer-typed discount code — a
// failure here (already used, typo, race) must never fail the booking
// itself, it just means no discount gets attached to the draft job log.
async function redeemDiscountCodeForBooking(discountCode, phone) {
  if (!discountCode) return null;
  try {
    const result = await redeemDiscountCode(getSupabaseAdmin(), discountCode, { phone });
    return result.ok ? result.percent : null;
  } catch (err) {
    console.error("redeemDiscountCodeForBooking error:", err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { eventId, name, phone, services, start, end, car, discountCode } = req.body || {};
  if (!eventId || !name || !phone || !Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: "Missing eventId, name, phone, or services" });
  }

  const ip = getClientIp(req);
  const allowed = await checkRateLimit({ key: `book-slot:${ip}`, maxRequests: 5, windowSeconds: 600 });
  if (!allowed) {
    return res.status(429).json({ error: "For mange bookingforsøk. Prøv igjen om litt." });
  }

  let code;
  let finalEnd = end;
  try {
    const calendar = getCalendarClient();

    const usedCodes = await getUsedCodes(calendar, CALENDAR_ID);
    code = generateUniqueCode(usedCodes);

    // Shrink the booked event's duration if the chosen service(s) need
    // less time than the original slot — never extend beyond it.
    const originalDurationMin = (new Date(end) - new Date(start)) / 60000;
    const estimatedMin = estimatedDurationMinutes(services);
    if (estimatedMin && estimatedMin < originalDurationMin) {
      finalEnd = new Date(new Date(start).getTime() + estimatedMin * 60000).toISOString();
    }

    const requestBody = {
      summary: `${name} - ${phone}`,
      location: BUSINESS_ADDRESS,
      description: `Tjeneste: ${services.join(", ")}`,
      extendedProperties: { private: { freshride_code: code } },
    };
    if (finalEnd !== end) {
      requestBody.end = { dateTime: finalEnd, timeZone: "Europe/Oslo" };
    }

    await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody });
  } catch (err) {
    console.error("book-slot calendar error:", err);
    return res.status(500).json({ error: "Klarte ikke å bekrefte booking" });
  }

  const redeemedDiscountPercent = await redeemDiscountCodeForBooking(discountCode, phone);
  await createDraftJobLogForBooking({
    name, phone, services, start, code, car,
    discountCode: redeemedDiscountPercent ? discountCode.trim().toUpperCase() : null,
    discountPercent: redeemedDiscountPercent,
  });

  let smsSent = false;
  try {
    smsSent = await sendBookingSms({ phone, name, services, start, end: finalEnd, code });
  } catch (err) {
    console.error("book-slot sms error:", err);
  }
  await logNotification({ channel: "sms_kunde", recipient: phone, code, name, status: smsSent ? "ok" : "failed" });

  let emailSent = false;
  try {
    emailSent = await sendOwnerReminderEmail({ name, phone, services, start, end: finalEnd, code });
  } catch (err) {
    console.error("book-slot email error:", err);
  }
  await logNotification({ channel: "epost_eier", recipient: "eier", code, name, status: emailSent ? "ok" : "failed" });

  try {
    await sendOwnerSms({ name, phone, services, start, end: finalEnd, code });
  } catch (err) {
    console.error("book-slot owner sms error:", err);
  }

  return res.status(200).json({ ok: true, smsSent, emailSent, code });
}
