// api/_lib/google-calendar.js
// Shared auth helper for talking to Google Calendar as the service account.
// Requires these Vercel env vars to be set:
//   GOOGLE_CLIENT_EMAIL
//   GOOGLE_PRIVATE_KEY   (with literal \n line breaks preserved)
//   GOOGLE_CALENDAR_ID

import { google } from "googleapis";

export function getCalendarClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return google.calendar({ version: "v3", auth });
}

export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

/* ---------------- Short booking codes (e.g. "A12") ----------------
   Stored in the event's extendedProperties.private so they survive
   however the event is later read (get-slots, admin-overview, etc).
   Meant to be given to the customer (in the SMS) so they — or a future
   chatbot/automation — can reference "code + phone number" to look up
   or change a booking without needing the long Google event ID. */

function randomCode() {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${letter}${digits}`;
}

// Collects codes already in use within a window around "now" so new codes
// don't collide. Small business scale — a few hundred events at most — so
// one list call covering a wide window is cheap enough.
export async function getUsedCodes(calendar, calendarId) {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 30);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 180);

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    maxResults: 2500,
  });

  const used = new Set();
  for (const e of data.items || []) {
    const code = e.extendedProperties?.private?.freshride_code;
    if (code) used.add(code);
  }
  return used;
}

export function generateUniqueCode(usedCodes) {
  let code = randomCode();
  let attempts = 0;
  while (usedCodes.has(code) && attempts < 50) {
    code = randomCode();
    attempts++;
  }
  return code;
}

export function normalizePhone(p) {
  return (p || "").replace(/\D/g, "");
}

// Shared by booking-lookup.js and calendar-invite.js — both need to find a
// booking by its short code and verify the caller's phone matches before
// revealing anything.
export async function findBookingByCode(calendar, calendarId, code) {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 7);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 180);

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    maxResults: 2500,
    privateExtendedProperty: `freshride_code=${code}`,
  });

  return (data.items || [])[0] || null;
}

// Same lookup as findBookingByCode, but with a window reaching further into
// the past — used for the completion-SMS-forgotten check, where a job could
// in principle have sat un-notified for weeks, not just the ~7 days
// findBookingByCode covers (that one's tuned for customers looking up a
// booking they just made, not for finding an arbitrarily old one).
export async function findPastBookingByCode(calendar, calendarId, code) {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - 60);

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: now.toISOString(),
    singleEvents: true,
    maxResults: 2500,
    privateExtendedProperty: `freshride_code=${code}`,
  });

  return (data.items || [])[0] || null;
}
