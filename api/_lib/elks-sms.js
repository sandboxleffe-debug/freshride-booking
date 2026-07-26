// api/_lib/elks-sms.js
// Shared "send an SMS via 46elks" helper — used by book-slot.js (booking
// confirmation) and admin-data.js (completion/thanks SMS + admin's test-send).
// Every caller funnels through this one function, so swapping providers again
// later only ever means touching this file.
//
// Requires these Vercel env vars:
//   ELKS_API_USERNAME
//   ELKS_API_PASSWORD
//   ELKS_FROM          (optional — defaults to "FreshRide"; must be a sender
//                        name/number already approved on the 46elks account)

const ELKS_URL = "https://api.46elks.com/a1/sms";

export function toE164Norway(rawPhone) {
  const raw = (rawPhone || "").trim();
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  return `+47${digits}`;
}

export async function sendSms({ toPhone, message }) {
  const username = process.env.ELKS_API_USERNAME;
  const password = process.env.ELKS_API_PASSWORD;
  if (!username || !password) {
    console.error("sendSms: ELKS_API_USERNAME/ELKS_API_PASSWORD is not set");
    return false;
  }

  const body = new URLSearchParams({
    from: process.env.ELKS_FROM || "FreshRide",
    to: toE164Norway(toPhone),
    message,
  });

  const res = await fetch(ELKS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    console.error("sendSms (46elks) failed:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
