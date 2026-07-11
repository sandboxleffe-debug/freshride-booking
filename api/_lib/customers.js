// api/_lib/customers.js
// Shared customer-matching helpers. There's no dedicated customers table —
// the registry (customer_number, name, phone) lives denormalized on
// freshride_jobs, same as the admin's Kunderegister tab already builds
// client-side by grouping job rows.

export function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\D/g, "").slice(-8);
}

export function formatCustomerId(number) {
  return number ? `FR${number}` : "";
}

// Looks up an existing customer by phone (the reliable match key — names get
// mistyped/renamed, phone numbers don't). Returns null if no match.
export async function findCustomerByPhone(supabase, phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  const { data, error } = await supabase
    .from("freshride_jobs")
    .select("customer_number, customer_name, customer_phone")
    .not("customer_phone", "is", null)
    .not("customer_number", "is", null);
  if (error || !data) return null;
  for (const row of data) {
    if (normalizePhone(row.customer_phone) === target) {
      return { customer_number: row.customer_number, customer_name: row.customer_name };
    }
  }
  return null;
}

// Bulk version of findCustomerByPhone for callers that need to match many
// bookings at once (e.g. the admin overview list) — one query instead of N.
export async function buildPhoneCustomerMap(supabase) {
  const map = new Map();
  const { data, error } = await supabase
    .from("freshride_jobs")
    .select("customer_number, customer_phone")
    .not("customer_phone", "is", null)
    .not("customer_number", "is", null);
  if (error || !data) return map;
  for (const row of data) {
    const key = normalizePhone(row.customer_phone);
    if (key && !map.has(key)) map.set(key, row.customer_number);
  }
  return map;
}

export function lookupCustomerNumber(map, phone) {
  return map.get(normalizePhone(phone)) || null;
}

export async function getNextCustomerNumber(supabase) {
  const { data } = await supabase.from("freshride_jobs").select("customer_number").not("customer_number", "is", null);
  const nums = (data || []).map(r => Number(r.customer_number)).filter(n => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// Pre-fills a "draft" job log entry for a booking, so completing it later
// isn't starting from a blank form. Used both automatically (book-slot.js,
// the moment a customer books) and manually (admin-bookings.js, for
// bookings made before this existed, or one the admin wants to log ahead
// of time). Skips if a job for this booking_code already exists.
export async function createDraftJobLog(supabase, { name, phone, services, jobDate, code }) {
  if (code) {
    const { data: existing } = await supabase.from("freshride_jobs").select("id").eq("booking_code", code).limit(1);
    if (existing && existing.length) return { ok: false, reason: "exists" };
  }
  const match = await findCustomerByPhone(supabase, phone);
  const customer_number = match ? match.customer_number : String(await getNextCustomerNumber(supabase));

  const { error } = await supabase.from("freshride_jobs").insert({
    job_date: jobDate,
    customer_name: name,
    customer_phone: phone,
    customer_number,
    services: Array.isArray(services) ? services.join(", ") : (services || ""),
    price_paid: 0,
    status: "draft",
    booking_code: code || null,
  });
  if (error) return { ok: false, reason: "error" };
  return { ok: true };
}
