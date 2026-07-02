// api/get-slots.js
// GET /api/get-slots?date=YYYY-MM-DD -> { events: [{ id, start, end }, ...] }
//
// Assumption (adjust to match how your calendar is actually organized):
// open slots are pre-created calendar events with the title "Ledig".
// This lists that day's events and returns only the ones still marked
// "Ledig" (i.e. not yet booked).

import { getCalendarClient, CALENDAR_ID } from "./_lib/google-calendar.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: "Missing 'date' query param" });
  }

  try {
    const calendar = getCalendarClient();

    const timeMin = new Date(`${date}T00:00:00`).toISOString();
    const timeMax = new Date(`${date}T23:59:59`).toISOString();

    const { data } = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (data.items || [])
      .filter(e => e.summary === "Ledig") // only unbooked slots
      .map(e => ({
        id: e.id,
        start: e.start.dateTime,
        end: e.end.dateTime,
      }));

    return res.status(200).json({ events });
  } catch (err) {
    console.error("get-slots error:", err);
    return res.status(500).json({ error: "Klarte ikke å hente tider" });
  }
}
