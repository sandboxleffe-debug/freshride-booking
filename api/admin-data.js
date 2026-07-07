// api/admin-data.js — admin only (x-admin-password header)
// All content-management CRUD, routed by ?resource=
//   about | services | reviews | promotions | prices | jobs | expenses | accounting
//
// Merged into one file to stay within Vercel's function count limit
// (Hobby plan: 12 functions per deployment).

import { getSupabaseAdmin, checkAdminPassword } from "./_lib/supabase.js";
import { getVisitorSummary } from "./_lib/analytics.js";

/* ---------------- About ---------------- */
async function handleAbout(req, res, supabase) {
  if (req.method === "GET") {
    const { data, error } = await supabase.from("freshride_about").select("heading, body, use_hero_video").eq("id", 1).single();
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
    const { use_hero_video } = req.body || {};
    if (typeof use_hero_video !== "boolean") return res.status(400).json({ error: "Missing use_hero_video" });
    const { error } = await supabase.from("freshride_about")
      .update({ use_hero_video, updated_at: new Date().toISOString() }).eq("id", 1);
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
    const { label, description, sortOrder } = req.body || {};
    if (!label) return res.status(400).json({ error: "Missing label" });
    const { data, error } = await supabase.from("freshride_services")
      .insert({ label, description: description || null, sort_order: sortOrder ?? 99 }).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å opprette tjeneste" }); }
    return res.status(200).json({ ok: true, service: data });
  }
  if (req.method === "PATCH") {
    const { id, label, description, sortOrder, active, price_nok } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (description !== undefined) updates.description = description;
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
    const jobs = await Promise.all((data || []).map(async job => {
      let photos = [];
      if (job.photo_paths?.length) {
        const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(job.photo_paths, 3600);
        photos = (signed || [])
          .map((s, i) => ({ path: job.photo_paths[i], url: s.signedUrl }))
          .filter(p => p.url);
      }
      return { ...job, photos };
    }));

    const income = (data || []).reduce((sum, j) => sum + Number(j.price_paid || 0), 0);
    return res.status(200).json({ jobs, income });
  }

  if (req.method === "POST") {
    const { action } = req.body || {};

    if (action === "upload-photo") {
      const { jobId, imageBase64, mimeType } = req.body || {};
      if (!jobId || !imageBase64) return res.status(400).json({ error: "Missing jobId or imageBase64" });
      try {
        const buffer = Buffer.from(imageBase64, "base64");
        const ext = (mimeType || "image/jpeg").split("/")[1] || "jpg";
        const path = `${jobId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("job-photos").upload(path, buffer, {
          contentType: mimeType || "image/jpeg",
        });
        if (uploadErr) throw uploadErr;

        const { data: job, error: getErr } = await supabase.from("freshride_jobs").select("photo_paths").eq("id", jobId).single();
        if (getErr) throw getErr;
        const updatedPaths = [...(job.photo_paths || []), path];
        const { error: updateErr } = await supabase.from("freshride_jobs").update({ photo_paths: updatedPaths }).eq("id", jobId);
        if (updateErr) throw updateErr;

        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("upload-photo error:", err);
        return res.status(500).json({ error: "Klarte ikke å laste opp bilde" });
      }
    }

    if (action === "delete-photo") {
      const { jobId, path } = req.body || {};
      if (!jobId || !path) return res.status(400).json({ error: "Missing jobId or path" });
      try {
        await supabase.storage.from("job-photos").remove([path]);
        const { data: job, error: getErr } = await supabase.from("freshride_jobs").select("photo_paths").eq("id", jobId).single();
        if (getErr) throw getErr;
        const updatedPaths = (job.photo_paths || []).filter(p => p !== path);
        const { error: updateErr } = await supabase.from("freshride_jobs").update({ photo_paths: updatedPaths }).eq("id", jobId);
        if (updateErr) throw updateErr;
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error("delete-photo error:", err);
        return res.status(500).json({ error: "Klarte ikke å slette bilde" });
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
    return res.status(200).json({ ok: true, job: data });
  }

  if (req.method === "PATCH") {
    const { id, customer_name, customer_number, car_type, services, price_paid, notes, job_size, time_spent_minutes, job_date, campaign_price } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const updates = {};
    if (customer_name !== undefined) updates.customer_name = customer_name;
    if (customer_number !== undefined) updates.customer_number = customer_number;
    if (car_type !== undefined) updates.car_type = car_type;
    if (services !== undefined) updates.services = services;
    if (price_paid !== undefined) updates.price_paid = price_paid;
    if (notes !== undefined) updates.notes = notes;
    if (job_size !== undefined) updates.job_size = job_size;
    if (time_spent_minutes !== undefined) updates.time_spent_minutes = time_spent_minutes;
    if (job_date !== undefined) updates.job_date = job_date;
    if (campaign_price !== undefined) updates.campaign_price = campaign_price;
    const { error } = await supabase.from("freshride_jobs").update(updates).eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å oppdatere jobb" }); }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { data: job } = await supabase.from("freshride_jobs").select("photo_paths").eq("id", id).single();
    if (job?.photo_paths?.length) {
      await supabase.storage.from("job-photos").remove(job.photo_paths);
    }
    const { error } = await supabase.from("freshride_jobs").delete().eq("id", id);
    if (error) { console.error(error); return res.status(500).json({ error: "Klarte ikke å slette" }); }
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
    return res.status(500).json({ error: "Klarte ikke å hente besøksstatistikk" });
  }
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
  if (resource === "expenses") return handleExpenses(req, res, supabase);
  if (resource === "accounting") return handleAccounting(req, res, supabase);
  if (resource === "analytics") return handleAnalytics(req, res);

  return res.status(400).json({ error: "Missing or invalid 'resource'" });
}
