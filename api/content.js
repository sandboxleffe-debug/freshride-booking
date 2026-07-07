// api/content.js — public
// GET /api/content?type=about      -> { heading, body }
// GET /api/content?type=services   -> { services: [{ id, label, description, price_nok }] }
// GET /api/content?type=promotion  -> { active: bool, title?, discount_label?, description? }
//
// Merged endpoint to stay within Vercel's function count limit (Hobby: 12).

import { getSupabaseAdmin } from "./_lib/supabase.js";

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
      if (ids.length) {
        const { data: prices } = await supabase
          .from("freshride_prices")
          .select("service_id, price_nok")
          .in("service_id", ids);
        (prices || []).forEach(p => { priceById[p.service_id] = p.price_nok; });
      }

      const withPrices = (services || []).map(s => ({ ...s, price_nok: priceById[s.id] ?? null }));
      return res.status(200).json({ services: withPrices });
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

  return res.status(400).json({ error: "Missing or invalid 'type'" });
}
