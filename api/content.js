// api/content.js — public
// GET /api/content?type=about      -> { heading, body }
// GET /api/content?type=services   -> { services: [{ id, label, description, price_nok }] }
// GET /api/content?type=promotion  -> { active: bool, title?, discount_label?, description? }
// GET /api/content?type=customer-cars&phone=91234567 -> { cars: string[] } (rate-limited)
//
// Merged endpoint to stay within Vercel's function count limit (Hobby: 12).

import { getSupabaseAdmin } from "./_lib/supabase.js";
import { getCarsByPhone } from "./_lib/customers.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";

function isPromoActive(promo, todayStr) {
  if (promo.status === "forced_on") return true;
  if (promo.status === "forced_off") return false;
  return promo.start_date <= todayStr && todayStr <= promo.end_date;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type } = req.query;
  const supabase = getSupabaseAdmin();

  if (type === "about") {
    try {
      const { data, error } = await supabase.from("freshride_about").select("heading, body").eq("id", 1).single();
      if (error) throw error;
      return res.status(200).json(data);
    } catch (err) {
      console.error("content about error:", err);
      return res.status(500).json({ error: "Klarte ikke å hente innhold" });
    }
  }

  if (type === "hero") {
    try {
      const { data, error } = await supabase.from("freshride_about").select("use_hero_video").eq("id", 1).single();
      if (error) throw error;
      return res.status(200).json({ useVideo: !!data.use_hero_video });
    } catch (err) {
      console.error("content hero error:", err);
      return res.status(200).json({ useVideo: false });
    }
  }

  if (type === "services") {
    try {
      const { data: services, error } = await supabase
        .from("freshride_services")
        .select("id, label, description")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;

      const ids = (services || []).map(s => s.id);
      let priceById = {};
      let updatedAt = null;
      if (ids.length) {
        const { data: prices } = await supabase
          .from("freshride_prices")
          .select("service_id, price_nok, updated_at")
          .in("service_id", ids);
        (prices || []).forEach(p => {
          priceById[p.service_id] = p.price_nok;
          if (p.updated_at && (!updatedAt || p.updated_at > updatedAt)) updatedAt = p.updated_at;
        });
      }

      const withPrices = (services || []).map(s => ({ ...s, price_nok: priceById[s.id] ?? null }));
      return res.status(200).json({ services: withPrices, updatedAt });
    } catch (err) {
      console.error("content services error:", err);
      return res.status(500).json({ error: "Klarte ikke å hente tjenester" });
    }
  }

  if (type === "promotion") {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: promos, error } = await supabase
        .from("freshride_promotions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const activePromo = (promos || []).find(p => isPromoActive(p, todayStr));
      if (!activePromo) return res.status(200).json({ active: false });

      return res.status(200).json({
        active: true,
        title: activePromo.title,
        discount_label: activePromo.discount_label,
        description: activePromo.description,
      });
    } catch (err) {
      console.error("content promotion error:", err);
      return res.status(200).json({ active: false });
    }
  }

  if (type === "references") {
    try {
      const { data: jobs, error } = await supabase
        .from("freshride_jobs")
        .select("id, car_type, reference_product_name, services, photo_paths_before, photo_paths_after, job_date")
        .eq("show_as_reference", true)
        .order("job_date", { ascending: false });
      if (error) throw error;

      const signAll = async paths => {
        if (!paths?.length) return [];
        const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(paths, 3600);
        return (signed || []).map(s => s.signedUrl).filter(Boolean);
      };

      const references = [];
      for (const j of jobs || []) {
        const beforePaths = j.photo_paths_before || [];
        const afterPaths = j.photo_paths_after || [];
        if (!beforePaths.length || !afterPaths.length) continue;
        const [before, after] = await Promise.all([signAll(beforePaths), signAll(afterPaths)]);
        if (!before.length || !after.length) continue;
        references.push({
          id: j.id,
          carType: j.car_type || "",
          productName: j.reference_product_name || j.services || "",
          before, // array — may hold multiple angles, not paired 1:1 with `after`
          after,
        });
      }
      return res.status(200).json({ references });
    } catch (err) {
      console.error("content references error:", err);
      return res.status(500).json({ error: "Klarte ikke å hente referanser" });
    }
  }

  if (type === "customer-cars") {
    // Used by the booking form to suggest a returning customer's saved
    // car(s) once they've typed their phone number — rate-limited since
    // it's an unauthenticated lookup keyed by arbitrary phone input.
    const { phone } = req.query;
    if (!phone) return res.status(200).json({ cars: [] });
    try {
      const ip = getClientIp(req);
      const allowed = await checkRateLimit({ key: `customer-cars:${ip}`, maxRequests: 20, windowSeconds: 600 });
      if (!allowed) return res.status(200).json({ cars: [] });
      const cars = await getCarsByPhone(supabase, phone);
      return res.status(200).json({ cars });
    } catch (err) {
      console.error("content customer-cars error:", err);
      return res.status(200).json({ cars: [] });
    }
  }

  return res.status(400).json({ error: "Missing or invalid 'type'" });
}
