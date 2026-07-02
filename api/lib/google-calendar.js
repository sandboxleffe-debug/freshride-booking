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
