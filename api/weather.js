// api/weather.js — public
// GET /api/weather -> { days: { "YYYY-MM-DD": "partlycloudy_day", ... } }
//
// Wraps MET Norway's Locationforecast API (the actual data source behind
// Yr) so the browser never talks to api.met.no directly — that avoids CORS
// issues and keeps the required identifying User-Agent header server-side.
// One fixed location (Lyngdal town centre) is close enough for a weather
// indicator; precision below "which town" doesn't matter for this.
const LAT = 58.1375;
const LON = 7.0672;

// MET Norway's Terms of Service require a real identifying User-Agent
// (app name + a way to contact the operator) — generic/fake strings get a
// permanent ban, not just a 403.
const USER_AGENT = "FreshRide-Booking/1.0 (https://freshride.no; sandboxleffe@gmail.com)";

let cache = { data: null, expiresAt: 0 };

function extractSymbol(entry) {
  const d = entry.data || {};
  return d.next_1_hours?.summary?.symbol_code
    || d.next_6_hours?.summary?.symbol_code
    || d.next_12_hours?.summary?.symbol_code
    || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (cache.data && Date.now() < cache.expiresAt) {
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=3600");
      return res.status(200).json(cache.data);
    }

    const metRes = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!metRes.ok) {
      return res.status(502).json({ error: "Yr/MET Norge svarte ikke som ventet" });
    }
    const metData = await metRes.json();
    const timeseries = metData.properties?.timeseries || [];

    // Pick, per date, whichever entry sits closest to local noon — near
    // term that's usually an hourly (next_1_hours) reading, further out MET
    // only returns 6/12-hourly resolution, so this always finds the best
    // available representative symbol for "the weather that day" instead of
    // just grabbing the first entry (which could be a stray 03:00 forecast).
    const best = {}; // dateKey -> { hourDiff, symbol }
    for (const entry of timeseries) {
      const symbol = extractSymbol(entry);
      if (!symbol) continue;
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(entry.time));
      const get = t => parts.find(p => p.type === t)?.value;
      const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
      const hourDiff = Math.abs(Number(get("hour")) - 12);
      if (!best[dateKey] || hourDiff < best[dateKey].hourDiff) {
        best[dateKey] = { hourDiff, symbol };
      }
    }

    const days = {};
    for (const [date, v] of Object.entries(best)) days[date] = v.symbol;

    cache = { data: { days }, expiresAt: Date.now() + 60 * 60 * 1000 };
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json({ days });
  } catch (err) {
    console.error("weather error:", err);
    return res.status(500).json({ error: "Klarte ikke å hente værvarsel" });
  }
}
