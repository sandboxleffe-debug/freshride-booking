// api/_lib/notifications.js
// Shared logging for every outbound customer/owner notification, so the
// admin's "Varsler" history is a complete record — not just the booking
// flow. (Before this, the completion "bilen er klar" SMS was never logged
// anywhere, so a delivery problem left zero trail to investigate later.)

import { getSupabaseAdmin } from "./supabase.js";

export async function logNotification({ channel, recipient, code, name, status, message }) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("freshride_notifications").insert({
      channel, recipient, booking_code: code, customer_name: name, status, message: message || null,
    });
  } catch (err) {
    console.error("logNotification error:", err);
  }
}
