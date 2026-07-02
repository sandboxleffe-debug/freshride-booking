// api/book-slot.js
// POST /api/book-slot { eventId, name, phone } -> { ok: true }
//
// Booker en "Ledig"-tid: endrer tittelen til "VASK <mobilnummer>" slik at
// den forsvinner fra get-slots (som kun viser summary === "Ledig"), og
// legger navn + mobil i beskrivelsen så dere ser hvem som har booket.

import { getCalendarClient, CALENDAR_ID } from "./_lib/google-calendar.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { eventId, name, phone } = req.body || {};
  if (!eventId || !name || !phone) {
    return res.status(400).json({ error: "Missing eventId, name, or phone" });
  }

  try {
    const calendar = getCalendarClient();

    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      requestBody: {
        summary: `VASK ${phone}`,
        description: `Navn: ${name}\nMobil: ${phone}`,
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("book-slot error:", err);
    return res.status(500).json({ error: "Klarte ikke å bekrefte booking" });
  }
}
