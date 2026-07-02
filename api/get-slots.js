// api/get-slots.js
// Vercel serverless function — replaces netlify/functions/get-slots.js
//
// Contract (unchanged from the Netlify version, so the frontend needs no edits
// beyond the /api/ path):
//   GET /api/get-slots?date=YYYY-MM-DD
//   -> 200 { events: [{ id, start, end }, ...] }
//
// NOTE: This is a placeholder. Your original Netlify function likely reads
// from Google Calendar (the id/start/end shape matches a Calendar Events
// list response). Paste the real netlify/functions/get-slots.js source and
// this file can be ported 1:1, including whatever calendar/DB credentials
// it used. Until then, this returns example open slots so the UI is fully
// testable end-to-end.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: "Missing 'date' query param" });
  }

  // --- Example/placeholder data --------------------------------------
  // Replace this block with your real source (Google Calendar API,
  // a database, etc). Keep the same { id, start, end } shape.
  const slotsToday = [9, 10, 11, 13, 14, 15].map((hour, i) => {
    const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    return {
      id: `${date}-slot-${i}`,
      start: start.toISOString(),
      end: end.toISOString(),
    };
  });
  // ---------------------------------------------------------------------

  return res.status(200).json({ events: slotsToday });
}
