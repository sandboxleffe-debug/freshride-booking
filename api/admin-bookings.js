// api/admin-bookings.js — admin only (x-admin-password header)
//
// POST { action: "create", date, startTime, durationMinutes }
//   -> creates a new "Ledig" slot -> { ok: true, event: { id, start, end } }
//
// POST { action: "reopen", eventId }
//   -> reverts a booked event back to an open "Ledig" slot -> { ok: true }
//
// PATCH { eventId, name?, phone?, services?, date?, startTime?, durationMinutes? }
//   -> edits a booking in place -> { ok: true }
//
// DELETE { eventId }
//   -> permanently deletes the calendar event -> { ok: true }
//
// Merged from admin-booking.js + admin-create-slot.js to stay within
// Vercel's function count limit (Hobby plan: 12 per deployment).

import { getCalendarClient, CALENDAR_ID } from "./_lib/google-calendar.js";
import { checkAdminPassword, getSupabaseAdmin } from "./_lib/supabase.js";
import { osloWallTimeToUtc } from "./_lib/timezone.js";
import { createDraftJobLog } from "./_lib/customers.js";

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";

// Removes the auto-created draft job log tied to a cancelled/deleted booking
// — never touches a job that's already been completed, only a still-pending
// draft, so finished work is never silently wiped by a later calendar edit.
async function deleteDraftJobByCode(code) {
  if (!code) return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("freshride_jobs").delete().eq("booking_code", code).eq("status", "draft");
  } catch (err) {
    console.error("deleteDraftJobByCode error:", err);
  }
}

export default async function handler(req, res) {
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: "Feil passord" });
  }

  const calendar = getCalendarClient();

  if (req.method === "POST") {
    const { action } = req.body || {};

    if (action === "create") {
      const { date, startTime, durationMinutes } = req.body || {};
      if (!date || !startTime || !durationMinutes) {
        return res.status(400).json({ error: "Missing date, startTime, or durationMinutes" });
      }
      try {
        const start = osloWallTimeToUtc(date, startTime);
        const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);

        const { data: existing } = await calendar.events.list({
          calendarId: CALENDAR_ID,
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: true,
        });
        const overlapsBooking = (existing.items || []).some(ev => ev.summary && ev.summary !== "Ledig");
        if (overlapsBooking) {
          return res.status(409).json({ error: "Det er allerede en booking i dette tidsrommet" });
        }

        const { data } = await calendar.events.insert({
          calendarId: CALENDAR_ID,
          requestBody: {
            summary: "Ledig",
            start: { dateTime: start.toISOString(), timeZone: "Europe/Oslo" },
            end: { dateTime: end.toISOString(), timeZone: "Europe/Oslo" },
          },
        });
        return res.status(200).json({ ok: true, event: { id: data.id, start: data.start.dateTime, end: data.end.dateTime } });
      } catch (err) {
        console.error("admin-bookings create error:", err);
        return res.status(500).json({ error: "Klarte ikke å opprette ledig tid" });
      }
    }

    if (action === "reopen") {
      const { eventId } = req.body || {};
      if (!eventId) return res.status(400).json({ error: "Missing eventId" });
      try {
        const { data: existing } = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        const code = existing.extendedProperties?.private?.freshride_code;

        await calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId,
          requestBody: {
            summary: "Ledig",
            description: "",
            location: "",
            extendedProperties: { private: { freshride_code: "" } },
          },
        });
        await deleteDraftJobByCode(code);
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("admin-bookings reopen error:", err);
        return res.status(500).json({ error: "Klarte ikke å sette tiden ledig igjen" });
      }
    }

    // Manual version of the auto-draft that book-slot.js creates on new
    // bookings — for bookings made before that existed, or whenever the
    // admin wants to log a job ahead of time.
    if (action === "create-job-draft") {
      const { eventId } = req.body || {};
      if (!eventId) return res.status(400).json({ error: "Missing eventId" });
      try {
        const { data: existing } = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        if (!existing.summary || existing.summary === "Ledig") {
          return res.status(400).json({ error: "Denne tiden er ikke booket" });
        }
        const parts = existing.summary.split(" - ");
        const name = parts[0] || "Ukjent";
        const phone = parts[1] || "";
        const services = (existing.description || "").replace(/^Tjeneste:\s*/i, "");
        const code = existing.extendedProperties?.private?.freshride_code || null;
        const jobDate = (existing.start?.dateTime || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

        const supabase = getSupabaseAdmin();
        const result = await createDraftJobLog(supabase, { name, phone, services, jobDate, code });
        if (!result.ok && result.reason === "exists") {
          return res.status(409).json({ error: "Det finnes allerede en jobblogg for denne bookingen" });
        }
        if (!result.ok) {
          return res.status(500).json({ error: "Klarte ikke å opprette jobblogg" });
        }
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("admin-bookings create-job-draft error:", err);
        return res.status(500).json({ error: "Klarte ikke å opprette jobblogg" });
      }
    }

    return res.status(400).json({ error: "Missing or unsupported action" });
  }

  if (req.method === "PATCH") {
    const { eventId, name, phone, services, date, startTime, durationMinutes } = req.body || {};
    if (!eventId) return res.status(400).json({ error: "Missing eventId" });

    try {
      const { data: existing } = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
      const requestBody = {};

      const currentParts = (existing.summary || "").split(" - ");
      const newName = name !== undefined ? name : currentParts[0];
      const newPhone = phone !== undefined ? phone : currentParts[1];
      if (name !== undefined || phone !== undefined) {
        requestBody.summary = `${newName} - ${newPhone}`;
      }

      if (services !== undefined) {
        requestBody.description = `Tjeneste: ${Array.isArray(services) ? services.join(", ") : services}`;
      }

      if (date && startTime && durationMinutes) {
        const startDt = osloWallTimeToUtc(date, startTime);
        const endDt = new Date(startDt.getTime() + Number(durationMinutes) * 60 * 1000);
        requestBody.start = { dateTime: startDt.toISOString(), timeZone: "Europe/Oslo" };
        requestBody.end = { dateTime: endDt.toISOString(), timeZone: "Europe/Oslo" };
      }

      requestBody.location = existing.location || BUSINESS_ADDRESS;

      await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("admin-bookings PATCH error:", err);
      return res.status(500).json({ error: "Klarte ikke å lagre endringen" });
    }
  }

  if (req.method === "DELETE") {
    const { eventId } = req.body || {};
    if (!eventId) return res.status(400).json({ error: "Missing eventId" });
    try {
      let code;
      try {
        const { data: existing } = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
        code = existing.extendedProperties?.private?.freshride_code;
      } catch (_) { /* event already gone — nothing to look up */ }

      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      await deleteDraftJobByCode(code);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("admin-bookings DELETE error:", err);
      return res.status(500).json({ error: "Klarte ikke å slette" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
