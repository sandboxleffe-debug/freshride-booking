// api/admin-overview.js
// GET /api/admin-overview?days=14
// Header: x-admin-password: <ADMIN_PASSWORD>
// -> { days: [{ date, available: [...], booked: [...] }, ...] }

import { getCalendarClient, CALENDAR_ID } from "./_lib/google-calendar.js";
import { checkAdminPassword, getSupabaseAdmin } from "./_lib/supabase.js";
import { getOsloParts, osloWallTimeToUtc } from "./_lib/timezone.js";
import { buildPhoneCustomerMap, lookupCustomerNumber, buildCarLookupMaps, lookupCar } from "./_lib/customers.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: "Feil passord" });
  }

  const { date } = req.query;
  const daysAhead = Math.min(Number(req.query.days) || 14, 60);

  try {
    const calendar = getCalendarClient();

    // Single-day mode — used by the "Opprett tid" day timeline, since the
    // picked date may fall outside the rolling window fetched below.
    if (date) {
      const timeMin = osloWallTimeToUtc(date, "00:00").toISOString();
      const timeMax = osloWallTimeToUtc(date, "23:59:59").toISOString();
      const [{ data }, phoneMap, carMaps] = await Promise.all([
        calendar.events.list({
          calendarId: CALENDAR_ID, timeMin, timeMax, singleEvents: true, orderBy: "startTime",
        }),
        buildPhoneCustomerMap(getSupabaseAdmin()),
        buildCarLookupMaps(getSupabaseAdmin()),
      ]);
      const available = [], booked = [];
      for (const e of data.items || []) {
        if (e.summary === "Ledig") {
          available.push({ id: e.id, start: e.start?.dateTime, end: e.end?.dateTime });
        } else {
          const parts = (e.summary || "Ukjent").split(" - ");
          const phone = parts[1] || "";
          const code = e.extendedProperties?.private?.freshride_code || null;
          booked.push({
            id: e.id,
            start: e.start?.dateTime,
            end: e.end?.dateTime,
            name: parts[0] || "Ukjent",
            phone,
            code,
            customerNumber: lookupCustomerNumber(phoneMap, phone),
            car: lookupCar(carMaps, code, phone),
            services: (e.description || "").replace(/^Tjeneste:\s*/i, ""),
          });
        }
      }
      return res.status(200).json({ date, available, booked });
    }

    const today = getOsloParts(new Date());
    const pad = n => String(n).padStart(2, "0");
    const start = osloWallTimeToUtc(`${today.year}-${pad(today.month)}-${pad(today.day)}`, "00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + daysAhead);

    const [{ data }, phoneMap, carMaps] = await Promise.all([
      calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
      }),
      buildPhoneCustomerMap(getSupabaseAdmin()),
      buildCarLookupMaps(getSupabaseAdmin()),
    ]);

    const byDate = {};
    for (const e of data.items || []) {
      const startStr = e.start?.dateTime || e.start?.date;
      if (!startStr) continue;
      const dateKey = startStr.slice(0, 10);
      if (!byDate[dateKey]) byDate[dateKey] = { available: [], booked: [] };

      const code = e.extendedProperties?.private?.freshride_code || null;

      if (e.summary === "Ledig") {
        byDate[dateKey].available.push({
          id: e.id,
          start: e.start?.dateTime,
          end: e.end?.dateTime,
        });
      } else {
        const parts = (e.summary || "Ukjent").split(" - ");
        const phone = parts[1] || "";
        byDate[dateKey].booked.push({
          id: e.id,
          code,
          start: e.start?.dateTime,
          end: e.end?.dateTime,
          name: parts[0] || "Ukjent",
          phone,
          customerNumber: lookupCustomerNumber(phoneMap, phone),
          car: lookupCar(carMaps, code, phone),
          services: (e.description || "").replace(/^Tjeneste:\s*/i, ""),
          location: e.location || "",
        });
      }
    }

    const days = Object.keys(byDate)
      .sort()
      .map(date => ({ date, ...byDate[date] }));

    return res.status(200).json({ days });
  } catch (err) {
    console.error("admin-overview error:", err);
    return res.status(500).json({ error: "Klarte ikke å hente oversikt", detail: err.message });
  }
}
