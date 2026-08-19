// api/book-slot.js
// POST /api/book-slot { eventId, name, phone, services: string[], start, end }
// -> { ok: true, smsSent: boolean, emailSent: boolean, code: "A12" }
//
// 1. Books a "Ledig" slot in Google Calendar, assigns a short unique code.
//    The booked event's END TIME is adjusted based on the estimated
//    duration of the chosen service(s) — e.g. a 3-hour "Ledig" slot
//    shrinks to 1.5 hours if the customer only picks "Kun innvendig".
//    It never extends beyond the original slot, only shrinks.
// 2. Sends the booking details + code via SMS (46elks) for confirmation.
// 3. Sends a reminder email to the business owner with the same info.
//
// POST { isTimeRequest: true, requestedDate, requestedTime, name, phone,
//        services, car?, discountCode? } -> { ok: true, pending: true, smsSent }
//
// "Foreslå tid" — the customer proposes their own start time instead of
// picking a real listed slot. Nothing is booked yet: this only logs a
// pending request (freshride_time_requests), notifies William, and sends
// the customer a "forespurt booking mottatt" SMS with a caveat that the
// time still needs confirming (buildTimeRequestTextCustomer — no code or
// calendar link yet, since nothing's actually booked). William reviews the
// request in admin and either confirms it as-is or adjusts the time first
// (admin-bookings.js "confirm-time-request" action does the actual calendar
// insert + the real confirmation SMS, with code and calendar link, once he
// does). This deliberately never touches the calendar here — an earlier
// version tried to "borrow" an existing Ledig slot to attach the request
// to, but there was no way to know which slot (if any) actually matched
// the requested time, so it sometimes moved the wrong slot and left a
// stale duplicate behind.

import { getCalendarClient, CALENDAR_ID, getUsedCodes, generateUniqueCode } from "./_lib/google-calendar.js";
import { sendOwnerEmail } from "./_lib/email.js";
import { getSupabaseAdmin } from "./_lib/supabase.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";
import { sendSms } from "./_lib/elks-sms.js";
import { getOsloParts, formatOsloTime } from "./_lib/timezone.js";
import { estimatedDurationMinutes, formatNorwegian, formatNorwegianDateOnly, redeemCodeForBooking, sendCustomerBookingSms, sendTimeRequestReceivedSms } from "./_lib/booking-shared.js";
import { createDraftJobLog } from "./_lib/customers.js";
import { buildBookingTextOwner, buildTimeRequestTextOwner } from "./_lib/sms-templates.js";
import { logNotification } from "./_lib/notifications.js";

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";

// Extra SMS to the business owner's own number(s), if enabled in admin
// (Om oss-fanen). Separate from the owner email — some prefer SMS.
async function sendOwnerSms({ name, phone, services, start, end, code }) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("freshride_about")
      .select("owner_sms_notify, owner_sms_phone")
      .eq("id", 1)
      .single();
    if (error || !data?.owner_sms_notify || !data?.owner_sms_phone) return false;

    const { date, time } = formatNorwegian(start);
    const endTime = formatOsloTime(end);
    const message = buildBookingTextOwner({ name, phone, services, date, time, endTime, code });

    const numbers = data.owner_sms_phone.split(",").map(n => n.trim()).filter(Boolean);
    const results = await Promise.all(
      numbers.map(async toPhone => {
        const ok = await sendSms({ toPhone, message });
        await logNotification({ channel: "sms_eier", recipient: toPhone, code, name, status: ok ? "ok" : "failed", message });
        return ok;
      })
    );
    return results.some(Boolean);
  } catch (err) {
    console.error("sendOwnerSms error:", err);
    return false;
  }
}

async function sendOwnerReminderEmail({ name, phone, services, start, end, code }) {
  const { date, time } = formatNorwegian(start);
  const endTime = formatOsloTime(end);
  const message = buildBookingTextOwner({ name, phone, services, date, time, endTime, code });
  const ok = await sendOwnerEmail({ subject: `Ny booking: ${name} — ${date} kl. ${time}`, text: message });
  return { ok, message };
}

// Notifies William that a new time request came in — nothing is booked
// yet, so unlike sendOwnerSms/sendOwnerReminderEmail above there's no code
// or calendar link. Email always sent (the assured channel); SMS only if
// enabled in admin.
async function notifyOwnerOfTimeRequest({ name, phone, services, requestedDate, requestedTime }) {
  const date = formatNorwegianDateOnly(requestedDate);
  const message = buildTimeRequestTextOwner({ name, phone, services, date, time: requestedTime });

  try {
    await sendOwnerEmail({ subject: `Ny tidsforespørsel: ${name} — ${date} kl. ${requestedTime}`, text: message });
  } catch (err) {
    console.error("notifyOwnerOfTimeRequest email error:", err);
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase.from("freshride_about").select("owner_sms_notify, owner_sms_phone").eq("id", 1).single();
    if (data?.owner_sms_notify && data?.owner_sms_phone) {
      const numbers = data.owner_sms_phone.split(",").map(n => n.trim()).filter(Boolean);
      await Promise.all(numbers.map(toPhone => sendSms({ toPhone, message })));
    }
  } catch (err) {
    console.error("notifyOwnerOfTimeRequest sms error:", err);
  }
}

// Best-effort wrapper — never blocks the booking itself if the draft
// job log creation fails for some reason.
async function createDraftJobLogForBooking({ name, phone, services, start, code, car, discountCode, discountPercent, referredBy }) {
  try {
    const supabase = getSupabaseAdmin();
    const p = getOsloParts(start);
    const pad = n => String(n).padStart(2, "0");
    const jobDate = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    await createDraftJobLog(supabase, { name, phone, services, jobDate, code, car, discountCode, discountPercent, referredBy });
  } catch (err) {
    console.error("createDraftJobLogForBooking error:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    eventId, name, phone, services, car, discountCode,
    isTimeRequest, requestedDate, requestedTime,
  } = req.body || {};
  const { start, end } = req.body || {};
  if (!name || !phone || !Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: "Missing name, phone, or services" });
  }

  const ip = getClientIp(req);
  const allowed = await checkRateLimit({ key: `book-slot:${ip}`, maxRequests: 5, windowSeconds: 600 });
  if (!allowed) {
    return res.status(429).json({ error: "For mange bookingforsøk. Prøv igjen om litt." });
  }

  // "Foreslå tid": log a pending request and notify William — no calendar
  // event exists until he confirms it in admin.
  if (isTimeRequest) {
    if (!requestedDate || !requestedTime) {
      return res.status(400).json({ error: "Missing requestedDate or requestedTime" });
    }
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("freshride_time_requests").insert({
        requested_date: requestedDate,
        requested_time: requestedTime,
        name, phone, car: car || null,
        services,
        discount_code: discountCode || null,
      });
      if (error) throw error;
    } catch (err) {
      console.error("book-slot time-request insert error:", err);
      return res.status(500).json({ error: "Klarte ikke å sende forespørselen" });
    }

    await notifyOwnerOfTimeRequest({ name, phone, services, requestedDate, requestedTime });

    let smsSent = false;
    try {
      const result = await sendTimeRequestReceivedSms({ phone, services, requestedDate, requestedTime });
      smsSent = result.ok;
      await logNotification({ channel: "sms_kunde", recipient: phone, code: null, name, status: smsSent ? "ok" : "failed", message: result.message });
    } catch (err) {
      console.error("book-slot time-request customer sms error:", err);
      await logNotification({ channel: "sms_kunde", recipient: phone, code: null, name, status: "failed" });
    }

    return res.status(200).json({ ok: true, pending: true, smsSent });
  }

  if (!eventId) {
    return res.status(400).json({ error: "Missing eventId" });
  }
  if (!start || !end) {
    return res.status(400).json({ error: "Missing start or end" });
  }

  let code;
  let finalEnd = end;
  try {
    const calendar = getCalendarClient();

    const usedCodes = await getUsedCodes(calendar, CALENDAR_ID);
    code = generateUniqueCode(usedCodes);

    // Shrink the booked event's duration if the chosen service(s) need
    // less time than the original slot — never extend beyond it.
    const originalDurationMin = (new Date(end) - new Date(start)) / 60000;
    const estimatedMin = estimatedDurationMinutes(services);
    if (estimatedMin && estimatedMin < originalDurationMin) {
      finalEnd = new Date(new Date(start).getTime() + estimatedMin * 60000).toISOString();
    }

    const requestBody = {
      summary: `${name} - ${phone}`,
      location: BUSINESS_ADDRESS,
      description: `Tjeneste: ${services.join(", ")}`,
      extendedProperties: { private: { freshride_code: code } },
      start: { dateTime: start, timeZone: "Europe/Oslo" },
    };
    if (finalEnd !== end) {
      requestBody.end = { dateTime: finalEnd, timeZone: "Europe/Oslo" };
    }

    await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody });
  } catch (err) {
    console.error("book-slot calendar error:", err);
    return res.status(500).json({ error: "Klarte ikke å bekrefte booking" });
  }

  const supabase = getSupabaseAdmin();
  const { discountPercent: redeemedDiscountPercent, referredBy } = await redeemCodeForBooking(supabase, discountCode, phone);
  await createDraftJobLogForBooking({
    name, phone, services, start, code, car,
    discountCode: redeemedDiscountPercent ? discountCode.trim().toUpperCase() : null,
    discountPercent: redeemedDiscountPercent,
    referredBy,
  });

  let smsSent = false;
  try {
    const result = await sendCustomerBookingSms({ phone, name, services, start, end: finalEnd, code });
    smsSent = result.ok;
    await logNotification({ channel: "sms_kunde", recipient: phone, code, name, status: smsSent ? "ok" : "failed", message: result.message });
  } catch (err) {
    console.error("book-slot sms error:", err);
    await logNotification({ channel: "sms_kunde", recipient: phone, code, name, status: "failed" });
  }

  let emailSent = false;
  try {
    const result = await sendOwnerReminderEmail({ name, phone, services, start, end: finalEnd, code });
    emailSent = result.ok;
    await logNotification({ channel: "epost_eier", recipient: "eier", code, name, status: emailSent ? "ok" : "failed", message: result.message });
  } catch (err) {
    console.error("book-slot email error:", err);
    await logNotification({ channel: "epost_eier", recipient: "eier", code, name, status: "failed" });
  }

  try {
    await sendOwnerSms({ name, phone, services, start, end: finalEnd, code });
  } catch (err) {
    console.error("book-slot owner sms error:", err);
  }

  return res.status(200).json({ ok: true, smsSent, emailSent, code });
}
