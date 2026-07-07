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

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";
const TALKDESK_URL = "https://api.talkdeskapp.eu/flows/8767c122bb494be38cec8453794ee659/interactions";

// Estimated duration per service, in minutes. Used to shrink the booked
// calendar event when the chosen service takes less time than the
// original "Ledig" slot. If multiple services are chosen, the longest
// estimate among them is used.
const SERVICE_DURATIONS_MIN = {
  "Full pakke": 180,
  "Kun innvendig": 90,
  "Kun utvendig": 90,
  "Premium pakke": 240,
  "Innvendig med rens av seter": 150,
};

function estimatedDurationMinutes(services) {
  const matched = services
    .map(s => Object.keys(SERVICE_DURATIONS_MIN).find(key => s.startsWith(key)))
    .filter(Boolean)
    .map(key => SERVICE_DURATIONS_MIN[key]);
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

async function sendBookingSms({ phone, name, services, start, code }) {
  const token = process.env.TALKDESK_ACCESS_TOKEN;
  if (!token) {
    console.error("sendBookingSms: TALKDESK_ACCESS_TOKEN is not set");
    return false;
  }
  const { date, time } = formatNorwegian(start);
  const res = await fetch(TALKDESK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      des_number: toE164Norway(phone), name, time,
      services: services.join(", "), address: BUSINESS_ADDRESS, date, code,
    }),
  });
  if (!res.ok) {
    console.error("sendBookingSms failed:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

async function sendOwnerReminderEmail({ name, phone, services, start, end, code }) {
  const { date, time } = formatNorwegian(start);
  const endTime = new Date(end).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  return sendOwnerEmail({
    subject: `Ny booking: ${name} — ${date} kl. ${time}`,
    text:
      `Ny booking mottatt\n\n` +
      `Kode: ${code}\n` +
      `Navn: ${name}\n` +
      `Mobil: ${phone}\n` +
      `Dato: ${date}\n` +
      `Tid: ${time} – ${endTime}\n` +
      `Tjeneste(r): ${services.join(", ")}\n` +
      `Adresse: ${BUSINESS_ADDRESS}\n`,
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
    smsSent = await sendBookingSms({ phone, name, services, start, code });
  } catch (err) {
    console.error("book-slot sms error:", err);
  }

  let emailSent = false;
  try {
    emailSent = await sendOwnerReminderEmail({ name, phone, services, start, end: finalEnd, code });
  } catch (err) {
    console.error("book-slot email error:", err);
  }

  return res.status(200).json({ ok: true, smsSent, emailSent, code });
}
