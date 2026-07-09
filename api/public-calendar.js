// api/public-calendar.js — public
// GET /api/public-calendar?view=day&date=YYYY-MM-DD
//   -> { events: [{ id, start, end }, ...] }   (open "Ledig" slots that day)
// GET /api/public-calendar?view=month&year=YYYY&month=MM
//   -> { days: { "YYYY-MM-DD": "green"|"orange"|"red", ... } }
//
// Merged from get-slots.js + get-month-overview.js to stay within Vercel's
// function count limit (Hobby plan: 12 functions per deployment).

import { getCalendarClient, CALENDAR_ID } from "./_lib/google-calendar.js";
import { osloWallTimeToUtc } from "./_lib/timezone.js";

async function handleDay(req, res, calendar) {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing 'date' query param" });

  try {
    const timeMin = osloWallTimeToUtc(date, "00:00").toISOString();
    const timeMax = osloWallTimeToUtc(date, "23:59:59").toISOString();

    const { data } = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (data.items || [])
      .filter(e => e.summary === "Ledig")
      .map(e => ({ id: e.id, start: e.start.dateTime, end: e.end.dateTime }));

    return res.status(200).json({ events });
  } catch (err) {
    console.error("public-calendar day error:", err);
    return res.status(500).json({ error: "Klarte ikke å hente tider" });
  }
}

async function handleMonth(req, res, calendar) {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: "Missing 'year' or 'month' query param" });

  try {
    const pad = n => String(n).padStart(2, "0");
    const nextMonth = Number(month) === 12 ? 1 : Number(month) + 1;
    const nextYear = Number(month) === 12 ? Number(year) + 1 : Number(year);
    const start = osloWallTimeToUtc(`${year}-${pad(month)}-01`, "00:00");
    const end = osloWallTimeToUtc(`${nextYear}-${pad(nextMonth)}-01`, "00:00");

    const { data } = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
    });

    const counts = {};
    for (const e of data.items || []) {
      const startStr = e.start?.dateTime || e.start?.date;
      if (!startStr) continue;
      const dateKey = startStr.slice(0, 10);
      if (!counts[dateKey]) counts[dateKey] = { available: 0, booked: 0 };
      if (e.summary === "Ledig") counts[dateKey].available++;
      else counts[dateKey].booked++;
    }

    const days = {};
    for (const [date, c] of Object.entries(counts)) {
      if (c.available > 0 && c.booked > 0) days[date] = "orange";
      else if (c.available > 0) days[date] = "green";
      else if (c.booked > 0) days[date] = "red";
    }

    return res.status(200).json({ days });
  } catch (err) {
    console.error("public-calendar month error:", err);
    return res.status(500).json({ error: "Klarte ikke å hente måned" });
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const calendar = getCalendarClient();
  const { view } = req.query;

  if (view === "day") return handleDay(req, res, calendar);
  if (view === "month") return handleMonth(req, res, calendar);
  return res.status(400).json({ error: "Missing or invalid 'view' (expected 'day' or 'month')" });
}
