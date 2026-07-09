// api/feedback.js — public
// GET  -> { reviews: [{ id, name, rating, comment, created_at }, ...] }  (approved only)
// POST { name?, rating, comment } -> { ok: true }  (goes in as unapproved, pending admin review)

import { getSupabaseAdmin } from "./_lib/supabase.js";
import { sendOwnerEmail } from "./_lib/email.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin();

  if (req.method === "POST") {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit({ key: `feedback:${ip}`, maxRequests: 5, windowSeconds: 600 });
    if (!allowed) {
      return res.status(429).json({ error: "For mange forsøk. Prøv igjen om litt." });
    }
  }

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("freshride_reviews")
        .select("id, name, rating, comment, created_at")
        .eq("approved", true)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return res.status(200).json({ reviews: data });
    } catch (err) {
      console.error("feedback GET error:", err);
      return res.status(500).json({ error: "Klarte ikke å hente tilbakemeldinger" });
    }
  }

  if (req.method === "POST") {
    const { name, rating, comment } = req.body || {};
    const ratingNum = Number(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "Ugyldig vurdering" });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Skriv gjerne litt om opplevelsen din" });
    }
    if (comment.length > 1000) {
      return res.status(400).json({ error: "Kommentaren er for lang" });
    }
    try {
      const cleanName = (name || "").trim().slice(0, 80) || null;
      const cleanComment = comment.trim().slice(0, 1000);
      const { error } = await supabase.from("freshride_reviews").insert({
        name: cleanName,
        rating: ratingNum,
        comment: cleanComment,
        approved: false,
      });
      if (error) throw error;

      try {
        await sendOwnerEmail({
          subject: `Ny tilbakemelding venter på godkjenning (${ratingNum}★)`,
          text:
            `Ny tilbakemelding mottatt — må godkjennes i admin før den vises på siden.\n\n` +
            `Vurdering: ${ratingNum}/5\n` +
            `Navn: ${cleanName || "Anonym"}\n` +
            `Kommentar: ${cleanComment}\n`,
        });
      } catch (emailErr) {
        console.error("feedback notification email error:", emailErr);
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("feedback POST error:", err);
      return res.status(500).json({ error: "Klarte ikke å sende tilbakemelding" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
