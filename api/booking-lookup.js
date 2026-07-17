// api/booking-lookup.js — public, authenticated by code + phone (not admin password)
// Meant for future self-service tools (chatbot, IVR, etc.) — a customer
// or automation proves it's their booking by supplying both the short
// code (e.g. "A12") AND the phone number used when booking.
//
// GET /api/booking-lookup?code=A12&phone=91234567
//   -> { found: true, booking: { code, name, phone, start, end, services, location } }
//   -> { found: false } if no match
//
// POST { code, phone, action: "cancel" }
//   -> cancels the booking (reverts the slot back to "Ledig")
//   -> { ok: true }

import { getCalendarClient, CALENDAR_ID, findBookingByCode, normalizePhone } from "./_lib/google-calendar.js";

export default async function handler(req, res) {
  const code = (req.method === "GET" ? req.query.code : req.body?.code || "").toString().toUpperCase();
  const phone = req.method === "GET" ? req.query.phone : req.body?.phone;

  if (!code || !phone) {
    return res.status(400).json({ error: "Missing code or phone" });
  }

  try {
    const calendar = getCalendarClient();
    const event = await findBookingByCode(calendar, CALENDAR_ID, code);

    if (!event) return res.status(200).json({ found: false });

    const parts = (event.summary || "").split(" - ");
    const eventPhone = normalizePhone(parts[1]);
    if (eventPhone !== normalizePhone(phone)) {
      // Code exists but phone doesn't match — don't reveal anything.
      return res.status(200).json({ found: false });
    }

    const booking = {
      code,
      name: parts[0] || "",
      phone: parts[1] || "",
      start: event.start?.dateTime,
      end: event.end?.dateTime,
      services: (event.description || "").replace(/^Tjeneste:\s*/i, ""),
      location: event.location || "",
    };

    if (req.method === "GET") {
      return res.status(200).json({ found: true, booking });
    }

    if (req.method === "POST") {
      const { action } = req.body || {};
      if (action === "cancel") {
        await calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId: event.id,
          requestBody: {
            summary: "Ledig",
            description: "",
            location: "",
            extendedProperties: { private: { freshride_code: "" } },
          },
        });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "Unsupported action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("booking-lookup error:", err);
    return res.status(500).json({ error: "Noe gikk galt" });
  }
}
