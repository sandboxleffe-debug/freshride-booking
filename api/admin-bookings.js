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
import { checkAdminPassword } from "./_lib/supabase.js";

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";

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
        const start = new Date(`${date}T${startTime}:00`);
        const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);
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
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("admin-bookings reopen error:", err);
        return res.status(500).json({ error: "Klarte ikke å sette tiden ledig igjen" });
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
        const startDt = new Date(`${date}T${startTime}:00`);
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
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("admin-bookings DELETE error:", err);
      return res.status(500).json({ error: "Klarte ikke å slette" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
