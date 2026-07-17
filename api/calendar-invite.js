// api/calendar-invite.js — public, authenticated by code + phone (same model
// as booking-lookup.js). Linked from the booking confirmation SMS so a tap
// opens the native "Add to Calendar" flow on iOS/Android.
//
// GET /api/calendar-invite?code=A12&phone=91234567
//   -> text/calendar (.ics) attachment, or a plain-text error if not found.

import { getCalendarClient, CALENDAR_ID, findBookingByCode, normalizePhone } from "./_lib/google-calendar.js";

function icsEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function toIcsDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const code = (req.query.code || "").toString().toUpperCase();
  const phone = req.query.phone;
  if (!code || !phone) return res.status(400).send("Mangler kode eller mobilnummer");

  try {
    const calendar = getCalendarClient();
    const event = await findBookingByCode(calendar, CALENDAR_ID, code);
    if (!event) return res.status(404).send("Fant ikke bookingen");

    const parts = (event.summary || "").split(" - ");
    if (normalizePhone(parts[1]) !== normalizePhone(phone)) {
      return res.status(404).send("Fant ikke bookingen");
    }

    const services = (event.description || "").replace(/^Tjeneste:\s*/i, "");
    const location = event.location || "";
    const start = event.start?.dateTime;
    const end = event.end?.dateTime;
    if (!start || !end) return res.status(404).send("Fant ikke bookingen");

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//FreshRide//Booking//NO",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:freshride-${code}@freshride.no`,
      `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
      `DTSTART:${toIcsDate(start)}`,
      `DTEND:${toIcsDate(end)}`,
      `SUMMARY:${icsEscape(`FreshRide — ${services || "Bilvask"}`)}`,
      `DESCRIPTION:${icsEscape(`Booking ${code} hos FreshRide. Tjeneste: ${services}. Husk å levere bilen til avtalt tid.`)}`,
      `LOCATION:${icsEscape(location)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="freshride-${code}.ics"`);
    return res.status(200).send(ics);
  } catch (err) {
    console.error("calendar-invite error:", err);
    return res.status(500).send("Noe gikk galt");
  }
}
