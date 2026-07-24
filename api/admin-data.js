// api/admin-data.js — admin only (x-admin-password header)
// All content-management CRUD, routed by ?resource=
//   about | services | reviews | promotions | prices | jobs | completion-alerts | customer-cars | discount-codes | expenses | accounting | gallery
//
// Merged into one file to stay within Vercel's function count limit
// (Hobby plan: 12 functions per deployment).

import { getSupabaseAdmin, checkAdminPassword } from "./_lib/supabase.js";
import { getVisitorSummary } from "./_lib/analytics.js";
import { upsertCustomerCars, upsertCustomerAvatar, renameCarForCustomer, syncCarToCustomer } from "./_lib/customers.js";
import { sendTalkdeskSms } from "./_lib/talkdesk-sms.js";
import { generateDiscountCode, listDiscountCodes, deleteUnusedDiscountCode, getDiscountCodeInfo, markDiscountCodeGivenAway } from "./_lib/discount-codes.js";
import { getCalendarClient, CALENDAR_ID, findPastBookingByCode } from "./_lib/google-calendar.js";
import { buildBookingTextCustomer, buildCompletionSmsText, buildThanksSmsText, buildThanksSmsTextWithDiscount } from "./_lib/sms-templates.js";
import { logNotification } from "./_lib/notifications.js";

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";

/* ---------------- About ---------------- */
async function handleAbout(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_about").select("heading, body, use_hero_video, owner_sms_notify, owner_sms_phone").eq("id", 1).single();
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente innhold" }); }
    return res.status(200).json(data);
  }
  if (req.method === "PUT") {
    const { heading, body } = req.body || {};
    if (!heading || !body) return res.status(400).json({ error: "Missing heading or body" });
    const { error } = await supabase.from("freshride_about")
      .update({ heading, body, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å lagre" }); }
    return res.status(200).json({ ok: true });
  }
  if (req.method === "PATCH") {
    const { use_hero_video, owner_sms_notify, owner_sms_phone } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (typeof use_hero_video === "boolean") updates.use_hero_video = use_hero_video;
    if (typeof owner_sms_notify === "boolean") updates.owner_sms_notify = owner_sms_notify;
    if (typeof owner_sms_phone === "string") updates.owner_sms_phone = owner_sms_phone.trim() || null;
    if (Object.keys(updates).length === 1) return res.status(400).json({ error: "Nothing to update" });
    const { error } = await supabase.from("freshride_about").update(updates).eq("id", 1);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å lagre" }); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Services (+ price) ---------------- */
async function handleServices(req, res, supabase) {
  if (req.method === "GET") {
    const { data: services, error } = await supabase.from("freshride_services").select("*").order("sort_order", { ascending: true });
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente tjenester" }); }
    const ids = (services || []).map(s => s.id);
    let priceById = {};
    if (ids.length) {
      const { data: prices } = await supabase.from("freshride_prices").select("service_id, price_nok").in("service_id", ids);
      (prices || []).forEach(p => { priceById[p.service_id] = p.price_nok; });
    }
    return res.status(200).json({ services: (services || []).map(s => ({ ...s, price_nok: priceById[s.id] ?? null })) });
  }
  if (req.method === "POST") {
    const { label, description, long_description, sortOrder } = req.body || {};
    if (!label) return res.status(400).json({ error: "Missing label" });
    const { data, error } = await supabase.from("freshride_services")
      .insert({ label, description: description || null, long_description: long_description || null, sort_order: sortOrder ?? 99 }).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å opprette tjeneste" }); }
    return res.status(200).json({ ok: true, service: data });
  }
  if (req.method === "PATCH") {
    const { id, label, description, long_description, sortOrder, active, price_nok } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (description !== undefined) updates.description = description;
    if (long_description !== undefined) updates.long_description = long_description;
    if (sortOrder !== undefined) updates.sort_order = sortOrder;
    if (active !== undefined) updates.active = active;
    if (Object.keys(updates).length) {
      const { error } = await supabase.from("freshride_services").update(updates).eq("id", id);
      if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å oppdatere" }); }
    }
    if (price_nok !== undefined) {
      const { error: priceErr } = await supabase.from("freshride_prices")
        .upsert({ service_id: id, price_nok, updated_at: new Date().toISOString() }, { onConflict: "service_id" });
      if (priceErr) { console.error(priceErr); return res.status(500).json({ error: "Klarte ikke å oppdatere pris" }); }
    }
    return res.status(200).json({ ok: true });
  }
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { error } = await supabase.from("freshride_services").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Reviews ---------------- */
async function handleReviews(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_reviews").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente tilbakemeldinger" }); }
    return res.status(200).json({ reviews: data });
  }
  if (req.method === "PATCH") {
    const { id, approved } = req.body || {};
    if (!id || approved === undefined) return res.status(400).json({ error: "Missing id or approved" });
    const { error } = await supabase.from("freshride_reviews").update({ approved }).eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å oppdatere" }); }
    return res.status(200).json({ ok: true });
  }
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { error } = await supabase.from("freshride_reviews").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Promotions ---------------- */
async function handlePromotions(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_promotions").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente kampanjer" }); }
    return res.status(200).json({ promotions: data });
  }
  if (req.method === "POST") {
    const { title, discount_label, description, start_date, end_date } = req.body || {};
    if (!title || !discount_label || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const { data, error } = await supabase.from("freshride_promotions")
      .insert({ title, discount_label, description: description || null, start_date, end_date, status: "auto" })
      .select().single();
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å opprette kampanje" }); }
    return res.status(200).json({ ok: true, promotion: data });
  }
  if (req.method === "PATCH") {
    const { id, title, discount_label, description, start_date, end_date, status } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (discount_label !== undefined) updates.discount_label = discount_label;
    if (description !== undefined) updates.description = description;
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date;
    if (status !== undefined) updates.status = status;
    const { error } = await supabase.from("freshride_promotions").update(updates).eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å oppdatere kampanje" }); }
    return res.status(200).json({ ok: true });
  }
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { error } = await supabase.from("freshride_promotions").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Jobs (customer log + photos) ---------------- */
async function handleJobs(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_jobs").select("*").order("job_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente jobber" }); }

    // Turn stored photo paths into short-lived signed URLs (bucket is private)
    const signPaths = async paths => {
      if (!paths?.length) return [];
      const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(paths, 3600);
      return (signed || []).map((s, i) => ({ path: paths[i], url: s.signedUrl })).filter(p => p.url);
    };
    // photo_pairs is [{before: path|null, after: path|null}, ...] — resolve
    // both sides to signed URLs while keeping them paired by index.
    const signPairs = async pairs => {
      if (!pairs?.length) return [];
      const allPaths = [];
      pairs.forEach(p => { if (p.before) allPaths.push(p.before); if (p.after) allPaths.push(p.after); });
      if (!allPaths.length) return pairs.map(() => ({ before: null, after: null }));
      const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(allPaths, 3600);
      const urlByPath = {};
      (signed || []).forEach((s, i) => { if (s.signedUrl) urlByPath[allPaths[i]] = s.signedUrl; });
      return pairs.map(p => ({
        before: p.before ? { path: p.before, url: urlByPath[p.before] || null } : null,
        after: p.after ? { path: p.after, url: urlByPath[p.after] || null } : null,
      }));
    };
    const jobs = await Promise.all((data || []).map(async job => {
      const [photos, photosBefore, photosAfter, photoPairs] = await Promise.all([
        signPaths(job.photo_paths),
        signPaths(job.photo_paths_before),
        signPaths(job.photo_paths_after),
        signPairs(job.photo_pairs),
      ]);
      return { ...job, photos, photosBefore, photosAfter, photoPairs };
    }));

    const income = (data || []).reduce((sum, j) => sum + Number(j.price_paid || 0), 0);
    return res.status(200).json({ jobs, income });
  }

  if (req.method === "POST") {
    const { action } = req.body || {};

    if (action === "upload-photo") {
      const { jobId, imageBase64, mimeType, category } = req.body || {};
      if (!jobId || !imageBase64) return res.status(400).json({ error: "Missing jobId or imageBase64" });
      const column = category === "before" ? "photo_paths_before" : category === "after" ? "photo_paths_after" : "photo_paths";
      try {
        const buffer = Buffer.from(imageBase64, "base64");
        const ext = (mimeType || "image/jpeg").split("/")[1] || "jpg";
        const path = `${jobId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("job-photos").upload(path, buffer, {
          contentType: mimeType || "image/jpeg",
        });
        if (uploadErr) throw uploadErr;

        const { data: job, error: getErr } = await supabase.from("freshride_jobs").select(column).eq("id", jobId).single();
        if (getErr) throw getErr;
        const updatedPaths = [...(job[column] || []), path];
        const { error: updateErr } = await supabase.from("freshride_jobs").update({ [column]: updatedPaths }).eq("id", jobId);
        if (updateErr) throw updateErr;

        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("upload-photo error:", err);
        return res.status(500).json({ error: "Klarte ikke å laste opp bilde" });
      }
    }

    // Paired before/after photos — each pair represents one camera angle,
    // so "matching" happens at upload time (or after, by filling in the
    // missing side) instead of hoping two separately-uploaded lists happen
    // to line up. pairIndex === -1 (or omitted) starts a new pair.
    if (action === "upload-pair-photo") {
      const { jobId, pairIndex, side, imageBase64, mimeType } = req.body || {};
      if (!jobId || !imageBase64 || (side !== "before" && side !== "after")) {
        return res.status(400).json({ error: "Missing jobId, imageBase64, or invalid side" });
      }
      try {
        const buffer = Buffer.from(imageBase64, "base64");
        const ext = (mimeType || "image/jpeg").split("/")[1] || "jpg";
        const path = `${jobId}/pair-${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("job-photos").upload(path, buffer, {
          contentType: mimeType || "image/jpeg",
        });
        if (uploadErr) throw uploadErr;

        const { data: job, error: getErr } = await supabase.from("freshride_jobs").select("photo_pairs").eq("id", jobId).single();
        if (getErr) throw getErr;
        const pairs = job.photo_pairs || [];
        const idx = (pairIndex === undefined || pairIndex === null || pairIndex === -1) ? -1 : Number(pairIndex);
        if (idx === -1 || !pairs[idx]) {
          pairs.push({ before: null, after: null, [side]: path });
        } else {
          pairs[idx] = { ...pairs[idx], [side]: path };
        }
        const { error: updateErr } = await supabase.from("freshride_jobs").update({ photo_pairs: pairs }).eq("id", jobId);
        if (updateErr) throw updateErr;

        return res.status(200).json({ ok: true, pairs });
      } catch (err) {
        console.error("upload-pair-photo error:", err);
        return res.status(500).json({ error: "Klarte ikke å laste opp bilde" });
      }
    }

    if (action === "delete-pair-photo") {
      // Clears one side of a pair (keeps the row, e.g. so the other side
      // can still be replaced) — pass clearWholePair to drop the row too.
      const { jobId, pairIndex, side, clearWholePair } = req.body || {};
      if (!jobId || pairIndex === undefined || pairIndex === null) return res.status(400).json({ error: "Missing jobId or pairIndex" });
      try {
        const { data: job, error: getErr } = await supabase.from("freshride_jobs").select("photo_pairs").eq("id", jobId).single();
        if (getErr) throw getErr;
        const pairs = job.photo_pairs || [];
        const idx = Number(pairIndex);
        const pair = pairs[idx];
        if (!pair) return res.status(404).json({ error: "Fant ikke bildeparet" });

        const pathsToRemove = clearWholePair
          ? [pair.before, pair.after].filter(Boolean)
          : [pair[side]].filter(Boolean);
        if (pathsToRemove.length) await supabase.storage.from("job-photos").remove(pathsToRemove);

        if (clearWholePair) {
          pairs.splice(idx, 1);
        } else {
          pairs[idx] = { ...pair, [side]: null };
        }
        const { error: updateErr } = await supabase.from("freshride_jobs").update({ photo_pairs: pairs }).eq("id", jobId);
        if (updateErr) throw updateErr;

        return res.status(200).json({ ok: true, pairs });
      } catch (err) {
        console.error("delete-pair-photo error:", err);
        return res.status(500).json({ error: "Klarte ikke å slette bilde" });
      }
    }

    if (action === "delete-photo") {
      const { jobId, path } = req.body || {};
      if (!jobId || !path) return res.status(400).json({ error: "Missing jobId or path" });
      try {
        await supabase.storage.from("job-photos").remove([path]);
        const { data: job, error: getErr } = await supabase.from("freshride_jobs")
          .select("photo_paths, photo_paths_before, photo_paths_after").eq("id", jobId).single();
        if (getErr) throw getErr;
        const updates = {};
        if ((job.photo_paths || []).includes(path)) updates.photo_paths = job.photo_paths.filter(p => p !== path);
        if ((job.photo_paths_before || []).includes(path)) updates.photo_paths_before = job.photo_paths_before.filter(p => p !== path);
        if ((job.photo_paths_after || []).includes(path)) updates.photo_paths_after = job.photo_paths_after.filter(p => p !== path);
        if (Object.keys(updates).length) {
          const { error: updateErr } = await supabase.from("freshride_jobs").update(updates).eq("id", jobId);
          if (updateErr) throw updateErr;
        }
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("delete-photo error:", err);
        return res.status(500).json({ error: "Klarte ikke å slette bilde" });
      }
    }

    if (action === "send-completion-sms") {
      const { jobId } = req.body || {};
      if (!jobId) return res.status(400).json({ error: "Missing jobId" });
      try {
        const { data: job, error: getErr } = await supabase.from("freshride_jobs")
          .select("customer_name, customer_phone, services, job_date, booking_code").eq("id", jobId).single();
        if (getErr || !job) return res.status(404).json({ error: "Fant ikke jobben" });
        if (!job.customer_phone) return res.status(400).json({ error: "Kunden mangler mobilnummer" });

        const message = buildCompletionSmsText(job.customer_name);
        const ok = await sendTalkdeskSms({
          toPhone: job.customer_phone, name: job.customer_name,
          date: job.job_date || "", time: "", services: job.services || "",
          address: BUSINESS_ADDRESS, message,
        });
        await logNotification({
          channel: "sms_ferdig", recipient: job.customer_phone, code: job.booking_code,
          name: job.customer_name, status: ok ? "ok" : "failed", message,
        });
        if (!ok) return res.status(502).json({ error: "Klarte ikke å sende SMS" });

        const sentAt = new Date().toISOString();
        await supabase.from("freshride_jobs").update({ completion_sms_sent_at: sentAt }).eq("id", jobId);
        return res.status(200).json({ ok: true, sentAt });
      } catch (err) {
        console.error("send-completion-sms error:", err);
        return res.status(500).json({ error: "Klarte ikke å sende SMS" });
      }
    }

    // Used when William already told the customer in person/phone/Messenger
    // that the car is ready — sends just a thank-you + feedback link instead
    // of the "bilen er klar" message, but still counts as the customer
    // having been notified (same completion_sms_sent_at field), so it
    // correctly clears the VIKTIG MELDING reminder too.
    if (action === "send-thanks-sms") {
      const { jobId, discountCode } = req.body || {};
      if (!jobId) return res.status(400).json({ error: "Missing jobId" });
      try {
        const { data: job, error: getErr } = await supabase.from("freshride_jobs")
          .select("customer_name, customer_phone, customer_number, services, job_date, booking_code").eq("id", jobId).single();
        if (getErr || !job) return res.status(404).json({ error: "Fant ikke jobben" });
        if (!job.customer_phone) return res.status(400).json({ error: "Kunden mangler mobilnummer" });

        let message;
        if (discountCode) {
          // Re-check right before sending — even though the picker only ever
          // offers still-available codes, this closes the gap if two tabs
          // (or two clicks) tried to hand out the same code at once.
          const info = await getDiscountCodeInfo(supabase, discountCode);
          if (!info || info.used || info.given_away_at) {
            return res.status(409).json({ error: "Rabattkoden er ikke lenger tilgjengelig" });
          }
          message = buildThanksSmsTextWithDiscount(job.customer_name, info.code, info.percent);
        } else {
          message = buildThanksSmsText(job.customer_name);
        }

        const ok = await sendTalkdeskSms({
          toPhone: job.customer_phone, name: job.customer_name,
          date: job.job_date || "", time: "", services: job.services || "",
          address: BUSINESS_ADDRESS, message,
        });
        await logNotification({
          channel: "sms_takk", recipient: job.customer_phone, code: job.booking_code,
          name: job.customer_name, status: ok ? "ok" : "failed", message,
        });
        if (!ok) return res.status(502).json({ error: "Klarte ikke å sende SMS" });

        if (discountCode) {
          const given = await markDiscountCodeGivenAway(supabase, discountCode, { customerNumber: job.customer_number, name: job.customer_name });
          if (!given.ok) console.error("send-thanks-sms: SMS sent but failed to mark code given away:", discountCode);
        }

        const sentAt = new Date().toISOString();
        await supabase.from("freshride_jobs").update({ completion_sms_sent_at: sentAt }).eq("id", jobId);
        return res.status(200).json({ ok: true, sentAt });
      } catch (err) {
        console.error("send-thanks-sms error:", err);
        return res.status(500).json({ error: "Klarte ikke å sende SMS" });
      }
    }

    if (action === "send-test-thanks-sms") {
      const { phone, discountCode } = req.body || {};
      if (!phone) return res.status(400).json({ error: "Missing phone" });
      try {
        let message;
        if (discountCode) {
          const info = await getDiscountCodeInfo(supabase, discountCode);
          if (!info) return res.status(404).json({ error: "Fant ikke rabattkoden" });
          message = buildThanksSmsTextWithDiscount("Test Testesen", info.code, info.percent);
        } else {
          message = buildThanksSmsText("Test Testesen");
        }
        const ok = await sendTalkdeskSms({
          toPhone: phone, name: "Test Testesen", date: "", time: "",
          services: "Test", address: BUSINESS_ADDRESS, message,
        });
        if (!ok) return res.status(502).json({ error: "Klarte ikke å sende test-SMS" });
        return res.status(200).json({ ok: true, message });
      } catch (err) {
        console.error("send-test-thanks-sms error:", err);
        return res.status(500).json({ error: "Klarte ikke å sende test-SMS" });
      }
    }

    if (action === "send-test-completion-sms") {
      const { phone } = req.body || {};
      if (!phone) return res.status(400).json({ error: "Missing phone" });
      try {
        const message = buildCompletionSmsText("Test Testesen");
        const ok = await sendTalkdeskSms({
          toPhone: phone, name: "Test Testesen", date: "", time: "",
          services: "Test", address: BUSINESS_ADDRESS, message,
        });
        if (!ok) return res.status(502).json({ error: "Klarte ikke å sende test-SMS" });
        return res.status(200).json({ ok: true, message });
      } catch (err) {
        console.error("send-test-completion-sms error:", err);
        return res.status(500).json({ error: "Klarte ikke å sende test-SMS" });
      }
    }

    // Same buildBookingTextCustomer() used for the real booking-confirmation
    // SMS a customer receives (book-slot.js) — this just sends it with
    // plausible placeholder data so William can check the exact current
    // wording whenever it changes.
    if (action === "send-test-booking-sms") {
      const { phone } = req.body || {};
      if (!phone) return res.status(400).json({ error: "Missing phone" });
      try {
        const now = new Date();
        const message = buildBookingTextCustomer({
          phone, services: ["FreshRide Complete"],
          date: now.toLocaleDateString("no-NO", { day: "numeric", month: "long", year: "numeric" }),
          time: "12:00", endTime: "13:30", code: "T99",
        });
        const ok = await sendTalkdeskSms({
          toPhone: phone, name: "Test Testesen", date: "", time: "",
          services: "FreshRide Complete", address: BUSINESS_ADDRESS, message,
        });
        if (!ok) return res.status(502).json({ error: "Klarte ikke å sende test-SMS" });
        return res.status(200).json({ ok: true, message });
      } catch (err) {
        console.error("send-test-booking-sms error:", err);
        return res.status(500).json({ error: "Klarte ikke å sende test-SMS" });
      }
    }

    const { job_date, customer_name, customer_number, car_type, services, price_paid, notes, job_size, time_spent_minutes, campaign_price } = req.body || {};
    if (!customer_name || price_paid === undefined) return res.status(400).json({ error: "Missing customer_name or price_paid" });
    const { data, error } = await supabase.from("freshride_jobs")
      .insert({
        job_date: job_date || new Date().toISOString().slice(0, 10),
        customer_name, customer_number: customer_number || null, car_type: car_type || null, services: services || null,
        price_paid, notes: notes || null,
        job_size: job_size || null, time_spent_minutes: time_spent_minutes || null,
        campaign_price: !!campaign_price,
      }).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å lagre jobb" }); }
    if (car_type && customer_number) await syncCarToCustomer(supabase, customer_number, car_type);
    return res.status(200).json({ ok: true, job: data });
  }

  if (req.method === "PATCH") {
    const { id, customer_name, customer_number, customer_phone, car_type, services, price_paid, tip_amount, notes, job_size, time_spent_minutes, job_date, campaign_price, status, reference_product_name, show_as_reference } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const updates = {};
    if (customer_name !== undefined) updates.customer_name = customer_name;
    if (customer_number !== undefined) updates.customer_number = customer_number;
    if (customer_phone !== undefined) updates.customer_phone = customer_phone;
    if (car_type !== undefined) updates.car_type = car_type;
    if (services !== undefined) updates.services = services;
    if (price_paid !== undefined) updates.price_paid = price_paid;
    if (tip_amount !== undefined) updates.tip_amount = tip_amount;
    if (notes !== undefined) updates.notes = notes;
    if (job_size !== undefined) updates.job_size = job_size;
    if (time_spent_minutes !== undefined) updates.time_spent_minutes = time_spent_minutes;
    if (job_date !== undefined) updates.job_date = job_date;
    if (campaign_price !== undefined) updates.campaign_price = campaign_price;
    if (status !== undefined) updates.status = status;
    if (reference_product_name !== undefined) updates.reference_product_name = reference_product_name;

    if (show_as_reference !== undefined) {
      if (show_as_reference) {
        const { data: existingJob } = await supabase.from("freshride_jobs")
          .select("photo_pairs").eq("id", id).single();
        const hasCompletePair = (existingJob?.photo_pairs || []).some(p => p.before && p.after);
        if (!hasCompletePair) {
          return res.status(400).json({ error: "Trenger minst ett komplett bildepar (før + etter) for å vises som referanse" });
        }
      }
      updates.show_as_reference = show_as_reference;
    }

    const { error } = await supabase.from("freshride_jobs").update(updates).eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å oppdatere jobb" }); }

    if (car_type) {
      const syncCustomerNumber = customer_number !== undefined
        ? customer_number
        : (await supabase.from("freshride_jobs").select("customer_number").eq("id", id).single()).data?.customer_number;
      if (syncCustomerNumber) await syncCarToCustomer(supabase, syncCustomerNumber, car_type);
    }

    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { data: job } = await supabase.from("freshride_jobs")
      .select("photo_paths, photo_paths_before, photo_paths_after, photo_pairs").eq("id", id).single();
    const pairPaths = (job?.photo_pairs || []).flatMap(p => [p.before, p.after]).filter(Boolean);
    const allPaths = [...(job?.photo_paths || []), ...(job?.photo_paths_before || []), ...(job?.photo_paths_after || []), ...pairPaths];
    if (allPaths.length) {
      await supabase.storage.from("job-photos").remove(allPaths);
    }
    const { error } = await supabase.from("freshride_jobs").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Customer cars ---------------- */
// Cars per customer, keyed by customer_number — not tied to any one job.
async function handleCustomerCars(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_customers").select("customer_number, cars, avatar");
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente biler" }); }
    const cars = {};
    const avatars = {};
    (data || []).forEach(row => { cars[row.customer_number] = row.cars || []; avatars[row.customer_number] = row.avatar || null; });
    return res.status(200).json({ cars, avatars });
  }
  if (req.method === "PATCH") {
    const { customer_number, cars, avatar, carRenames } = req.body || {};
    if (!customer_number) return res.status(400).json({ error: "Missing customer_number" });
    if (cars !== undefined) {
      const ok = await upsertCustomerCars(supabase, customer_number, cars);
      if (!ok) return res.status(500).json({ error: "Klarte ikke å lagre biler" });
    }
    if (Array.isArray(carRenames)) {
      for (const r of carRenames) await renameCarForCustomer(supabase, customer_number, r.from, r.to);
    }
    if (avatar !== undefined) {
      const ok = await upsertCustomerAvatar(supabase, customer_number, avatar);
      if (!ok) return res.status(500).json({ error: "Klarte ikke å lagre avatar" });
    }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Expenses ---------------- */
async function handleExpenses(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_expenses").select("*").order("expense_date", { ascending: false });
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente utgifter" }); }
    const total = (data || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    return res.status(200).json({ expenses: data, total });
  }
  if (req.method === "POST") {
    const { expense_date, description, amount } = req.body || {};
    if (!description || amount === undefined) return res.status(400).json({ error: "Missing description or amount" });
    const { data, error } = await supabase.from("freshride_expenses")
      .insert({ expense_date: expense_date || new Date().toISOString().slice(0, 10), description, amount }).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å lagre utgift" }); }
    return res.status(200).json({ ok: true, expense: data });
  }
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { error } = await supabase.from("freshride_expenses").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Notifications (SMS/email log) ---------------- */
async function handleNotifications(req, res, supabase) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { data, error } = await supabase
    .from("freshride_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(150);
  if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente varslingslogg" }); }
  return res.status(200).json({ notifications: data });
}

/* ---------------- Accounting summary ---------------- */
async function handleAccounting(req, res, supabase) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { data: jobs, error: jobsErr } = await supabase.from("freshride_jobs").select("price_paid");
  const { data: expenses, error: expErr } = await supabase.from("freshride_expenses").select("amount");
  if (jobsErr || expErr) { console.error(jobsErr || expErr); return res.status(500).json({ error: "Klarte ikke å hente regnskap" }); }
  const income = (jobs || []).reduce((s, j) => s + Number(j.price_paid || 0), 0);
  const expenseTotal = (expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
  return res.status(200).json({ income, expenses: expenseTotal, net: income - expenseTotal });
}

/* ---------------- Analytics (GA4) ---------------- */
async function handleAnalytics(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const summary = await getVisitorSummary();
    return res.status(200).json(summary);
  } catch (err) {
    console.error("analytics error:", err);
    return res.status(500).json({ error: "Klarte ikke å hente besøksstatistikk", detail: err.message });
  }
}

/* ---------------- Gallery ("Se oss i aksjon" carousel on forsiden) ---------------- */
async function handleGallery(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_gallery").select("*").order("sort_order", { ascending: true });
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å hente galleri" }); }
    return res.status(200).json({ images: data || [] });
  }

  if (req.method === "POST") {
    const { imageBase64, mimeType, alt } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });
    try {
      const buffer = Buffer.from(imageBase64, "base64");
      const ext = (mimeType || "image/jpeg").split("/")[1] || "jpg";
      const path = `${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("gallery").upload(path, buffer, { contentType: mimeType || "image/jpeg" });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from("gallery").getPublicUrl(path);

      const { data: maxRows } = await supabase.from("freshride_gallery").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const nextSort = (maxRows && maxRows[0] ? maxRows[0].sort_order : -1) + 1;

      const { data, error } = await supabase.from("freshride_gallery")
        .insert({ path: pub.publicUrl, alt: alt || null, sort_order: nextSort }).select().single();
      if (error) throw error;
      return res.status(200).json({ ok: true, image: data });
    } catch (err) {
      console.error("gallery upload error:", err);
      return res.status(500).json({ error: "Klarte ikke å laste opp bilde" });
    }
  }

  if (req.method === "PATCH") {
    const { id, alt, reorder } = req.body || {};
    // Bulk reorder: client sends the full ordered list of ids after a drag/move,
    // server just re-numbers sort_order to match.
    if (Array.isArray(reorder)) {
      const results = await Promise.all(
        reorder.map((imgId, i) => supabase.from("freshride_gallery").update({ sort_order: i }).eq("id", imgId))
      );
      const failed = results.find(r => r.error);
      if (failed) { console.error(failed.error); return res.status(500).json({ error: "Klarte ikke å lagre rekkefølge" }); }
      return res.status(200).json({ ok: true });
    }
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { error } = await supabase.from("freshride_gallery").update({ alt: alt || null }).eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å oppdatere" }); }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { data: row } = await supabase.from("freshride_gallery").select("path").eq("id", id).single();
    // Only clean up the storage object for images actually hosted in our "gallery"
    // bucket — legacy rows pointing at static /assets files have nothing to remove.
    if (row?.path && row.path.includes("/storage/v1/object/public/gallery/")) {
      const objectPath = row.path.split("/storage/v1/object/public/gallery/")[1];
      if (objectPath) await supabase.storage.from("gallery").remove([objectPath]);
    }
    const { error } = await supabase.from("freshride_gallery").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Completion-SMS reminder ---------------- */
// A job's row only has a date, not the booking's actual start/end time —
// that lives on the Google Calendar event (matched by booking_code). So
// "1 hour past the booking's end" has to cross-reference the calendar, not
// just compare against job_date. Scale here is a handful of candidates at
// most (jobs missing a completion SMS), so one calendar lookup per
// candidate is cheap — no need to bulk-list a wide window up front.
async function handleCompletionAlerts(req, res, supabase) {
  if (req.method === "GET") {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: candidates, error } = await supabase
        .from("freshride_jobs")
        .select("id, customer_name, customer_phone, booking_code, job_date")
        .is("completion_sms_sent_at", null)
        .eq("completion_notice_dismissed", false)
        .not("customer_phone", "is", null)
        .not("booking_code", "is", null)
        .lte("job_date", today);
      if (error) throw error;
      if (!candidates?.length) return res.status(200).json({ alerts: [] });

      const calendar = getCalendarClient();
      const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour ago

      const alerts = [];
      for (const job of candidates) {
        const event = await findPastBookingByCode(calendar, CALENDAR_ID, job.booking_code).catch(() => null);
        const endTime = event?.end?.dateTime;
        if (endTime && new Date(endTime).getTime() < cutoff) {
          alerts.push({ jobId: job.id, customerName: job.customer_name, code: job.booking_code, endTime });
        }
      }
      alerts.sort((a, b) => new Date(a.endTime) - new Date(b.endTime));
      return res.status(200).json({ alerts });
    } catch (err) {
      console.error("completion-alerts error:", err);
      return res.status(500).json({ error: "Klarte ikke å sjekke varslingsstatus" });
    }
  }
  if (req.method === "PATCH") {
    const { jobId } = req.body || {};
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });
    const { error } = await supabase.from("freshride_jobs").update({ completion_notice_dismissed: true }).eq("id", jobId);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å avvise meldingen" }); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

/* ---------------- Discount codes ---------------- */
async function handleDiscountCodes(req, res, supabase) {
  if (req.method === "GET") {
    try {
      const codes = await listDiscountCodes(supabase);
      return res.status(200).json({ codes });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Klarte ikke å hente rabattkoder" });
    }
  }
  if (req.method === "POST") {
    const { percent } = req.body || {};
    if (!percent || Number(percent) <= 0) return res.status(400).json({ error: "Ugyldig rabatt" });
    try {
      const row = await generateDiscountCode(supabase, percent);
      return res.status(200).json({ ok: true, code: row.code, percent: row.percent });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Klarte ikke å generere kode" });
    }
  }
  if (req.method === "DELETE") {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "Missing code" });
    const ok = await deleteUnusedDiscountCode(supabase, code);
    if (!ok) return res.status(500).json({ error: "Klarte ikke å slette koden" });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

export default async function handler(req, res) {
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: "Feil passord" });
  }

  const supabase = getSupabaseAdmin();
  const resource = req.query.resource;

  if (resource === "about") return handleAbout(req, res, supabase);
  if (resource === "services") return handleServices(req, res, supabase);
  if (resource === "reviews") return handleReviews(req, res, supabase);
  if (resource === "promotions") return handlePromotions(req, res, supabase);
  if (resource === "jobs") return handleJobs(req, res, supabase);
  if (resource === "completion-alerts") return handleCompletionAlerts(req, res, supabase);
  if (resource === "customer-cars") return handleCustomerCars(req, res, supabase);
  if (resource === "discount-codes") return handleDiscountCodes(req, res, supabase);
  if (resource === "expenses") return handleExpenses(req, res, supabase);
  if (resource === "accounting") return handleAccounting(req, res, supabase);
  if (resource === "notifications") return handleNotifications(req, res, supabase);
  if (resource === "analytics") return handleAnalytics(req, res);
  if (resource === "gallery") return handleGallery(req, res, supabase);

  return res.status(400).json({ error: "Missing or invalid 'resource'" });
}
