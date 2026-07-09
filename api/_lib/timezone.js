// api/_lib/timezone.js
// Vercel's Node runtime runs in UTC, not Europe/Oslo — plain Date getters
// (getDate/getHours/...) and toLocaleTimeString() without an explicit
// timeZone silently use UTC, which is off by 1-2 hours from Norwegian
// local time depending on daylight saving. These helpers make that explicit.

const OSLO_TZ = "Europe/Oslo";

// Breaks an absolute instant into its Europe/Oslo wall-clock parts.
export function getOsloParts(dateTimeStr) {
  const d = new Date(dateTimeStr);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OSLO_TZ,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = type => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")), // 1-12
    day: Number(get("day")),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function formatOsloTime(dateTimeStr) {
  const p = getOsloParts(dateTimeStr);
  return `${p.hour}:${p.minute}`;
}

// Converts a "date, time" pair meant as Europe/Oslo wall-clock time (e.g.
// from an admin <input type="date"> + <input type="time">) into the correct
// absolute instant, accounting for daylight saving.
export function osloWallTimeToUtc(dateStr, timeStr) {
  const [hh, mm, ss = "00"] = timeStr.split(":");
  const naiveUtc = new Date(`${dateStr}T${hh}:${mm}:${ss}Z`);
  const p = getOsloParts(naiveUtc);
  // Seconds aren't part of getOsloParts (DST offsets only ever land on whole
  // minutes), so reuse the input's seconds on both sides — they cancel out
  // in the diff below, leaving only the actual UTC/Oslo offset.
  const asIfOslo = Date.UTC(p.year, p.month - 1, p.day, Number(p.hour), Number(p.minute), Number(ss));
  return new Date(naiveUtc.getTime() + (naiveUtc.getTime() - asIfOslo));
}
