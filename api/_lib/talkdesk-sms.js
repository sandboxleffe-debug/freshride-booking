// api/_lib/talkdesk-sms.js
// Shared "send an SMS via the Talkdesk flow" helper — used by book-slot.js
// (booking confirmation) and admin-data.js (job-complete notice + admin's
// test-send). Every caller funnels through the same flow, so the "services"
// field always gets a plain string (the flow itself may or may not use it,
// but keeping the shape identical avoids surprises).

import { getTalkdeskAccessToken } from "./talkdesk-auth.js";

const TALKDESK_URL = "https://api.talkdeskapp.eu/flows/8767c122bb494be38cec8453794ee659/interactions";

export function toE164Norway(rawPhone) {
  const raw = (rawPhone || "").trim();
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  return `+47${digits}`;
}

export async function sendTalkdeskSms({ toPhone, name, time, date, services, address, message }) {
  let token;
  try {
    token = await getTalkdeskAccessToken();
  } catch (err) {
    // Falls back to the old manually-pasted token until TALKDESK_CLIENT_ID/
    // TALKDESK_CLIENT_SECRET are configured in Vercel — see talkdesk-auth.js.
    console.error("sendTalkdeskSms: OAuth token fetch failed, falling back to static token:", err.message);
    token = process.env.TALKDESK_ACCESS_TOKEN;
  }
  if (!token) {
    console.error("sendTalkdeskSms: no Talkdesk access token available");
    return false;
  }
  const res = await fetch(TALKDESK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      des_number: toE164Norway(toPhone),
      name: name || "",
      time: time || "",
      date: date || "",
      services: Array.isArray(services) ? services.join(", ") : (services || ""),
      address: address || "",
      message,
    }),
  });
  if (!res.ok) {
    console.error("sendTalkdeskSms failed:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
