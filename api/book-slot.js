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
import { getTalkdeskAccessToken } from "./_lib/talkdesk-auth.js";

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";
const TALKDESK_URL = "https://api.talkdeskapp.eu/flows/8767c122bb494be38cec8453794ee659/interactions";

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

function toE164Norway(rawPhone) {
  const digits = rawPhone.replace(/\D/g, "");
  if (rawPhone.trim().startsWith("+")) return rawPhone.trim();
  return `+47${digits}`;
}

const NO_MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];

function formatNorwegian(dateTimeStr) {
  if (!dateTimeStr) return { date: "", time: "" };
  const d = new Date(dateTimeStr);
  const date = `${d.getDate()} ${NO_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = d.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

// Shared plain-text body used for both the SMS and the owner email, so the
// two notifications always read identically.
function buildBookingText({ name, phone, services, date, time, endTime, code }) {
  return (
    `Ny booking mottatt\n\n` +
    `Kode: ${code}\n` +
    `Navn: ${name}\n` +
    `Mobil: ${phone}\n` +
    `Dato: ${date}\n` +
    `Tid: ${time} – ${endTime}\n` +
    `Tjeneste(r): ${services.join(", ")}\n` +
    `Adresse: ${BUSINESS_ADDRESS}\n`
  );
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

async function sendTalkdeskSms({ toPhone, name, time, date, services, message }) {
  let token;
  try {
    token = await getTalkdeskAccessToken();
  } catch (err) {
    // Falls back to the old manually-pasted token until TALKDESK_CLIENT_ID/
    // TALKDESK_CLIENT_SECRET are configured in Vercel — see talkdesk-auth.js.
    console.error("sendTalkdeskSms: OAuth token fetch failed, falling back to static token:", err.message);
    token = process.env.TALKDESK_ACCESS_TOKEN;
  }
  if (!token) {
    console.error("sendTalkdeskSms: no Talkdesk access token available");
    return false;
  }
  const res = await fetch(TALKDESK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      des_number: toE164Norway(toPhone), name, time, date,
      services: services.join(", "), address: BUSINESS_ADDRESS,
      message,
    }),
  });
  if (!res.ok) {
    console.error("sendTalkdeskSms failed:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

async function sendBookingSms({ phone, name, services, start, end, code }) {
  const { date, time } = formatNorwegian(start);
  const endTime = new Date(end).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  const message = buildBookingText({ name, phone, services, date, time, endTime, code });
  return sendTalkdeskSms({ toPhone: phone, name, time, date, services, message });
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
    const endTime = new Date(end).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
    const message = buildBookingText({ name, phone, services, date, time, endTime, code });

    const numbers = data.owner_sms_phone.split(",").map(n => n.trim()).filter(Boolean);
    const results = await Promise.all(
      numbers.map(async toPhone => {
        const ok = await sendTalkdeskSms({ toPhone, name, time, date, services, message });
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
  const endTime = new Date(end).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  return sendOwnerEmail({
    subject: `Ny booking: ${name} — ${date} kl. ${time}`,
    text: buildBookingText({ name, phone, services, date, time, endTime, code }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { eventId, name, phone, services, start, end } = req.body || {};
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
