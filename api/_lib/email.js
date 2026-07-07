// api/_lib/email.js
// Shared Resend helper for owner notification emails (bookings, feedback).

const OWNER_TO = "william.nesje@outlook.com";
const OWNER_BCC = ["leif.nesje@nconsulting.no", "sandboxleffe@gmail.com"];

export async function sendOwnerEmail({ subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("sendOwnerEmail: RESEND_API_KEY is not set");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "FreshRide <onboarding@resend.dev>",
      to: [OWNER_TO],
      bcc: OWNER_BCC,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    console.error("sendOwnerEmail failed:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
