// api/book-slot.js
// Vercel serverless function — replaces netlify/functions/book-slot.js
//
// Contract (unchanged from the Netlify version):
//   POST /api/book-slot
//   body: { eventId, name, phone }
//   -> 200 { ok: true }
//
// NOTE: Placeholder implementation — paste your real
// netlify/functions/book-slot.js source (likely writing/patching a
// Google Calendar event, or a DB row) and this can be ported 1:1.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { eventId, name, phone } = req.body || {};
  if (!eventId || !name || !phone) {
    return res.status(400).json({ error: "Missing eventId, name, or phone" });
  }

  // --- Replace with real booking logic --------------------------------
  // e.g. patch the Google Calendar event's summary/description with the
  // customer's name and phone number, or insert a row into your DB.
  console.log("Booking received:", { eventId, name, phone });
  // ----------------------------------------------------------------------

  return res.status(200).json({ ok: true });
}
