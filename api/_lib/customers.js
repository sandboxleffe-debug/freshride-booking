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

// Bulk lookup so the admin overview's "Bookinger" list can show each
// booking's car — the calendar event itself never stores it (see
// book-slot.js's requestBody), so this cross-references freshride_jobs by
// booking_code first (exact, set at booking time) and falls back to phone
// (for older bookings without a code, or if the code lookup misses).
export async function buildCarLookupMaps(supabase) {
  const byCode = new Map();
  const byPhone = new Map();
  const { data, error } = await supabase
    .from("freshride_jobs")
    .select("booking_code, customer_phone, car_type")
    .not("car_type", "is", null);
  if (error || !data) return { byCode, byPhone };
  for (const row of data) {
    if (row.booking_code && !byCode.has(row.booking_code)) byCode.set(row.booking_code, row.car_type);
    const phoneKey = normalizePhone(row.customer_phone);
    if (phoneKey && !byPhone.has(phoneKey)) byPhone.set(phoneKey, row.car_type);
  }
  return { byCode, byPhone };
}

export function lookupCar(maps, code, phone) {
  if (code && maps.byCode.has(code)) return maps.byCode.get(code);
  const phoneKey = normalizePhone(phone);
  if (phoneKey && maps.byPhone.has(phoneKey)) return maps.byPhone.get(phoneKey);
  return null;
}

// Cars are stored separately (freshride_customers) since they're a
// per-customer attribute, not tied to any one job.
export async function getCarsByPhone(supabase, phone) {
  const match = await findCustomerByPhone(supabase, phone);
  if (!match) return [];
  const { data } = await supabase
    .from("freshride_customers")
    .select("cars")
    .eq("customer_number", String(match.customer_number))
    .maybeSingle();
  return data?.cars || [];
}

export async function upsertCustomerCars(supabase, customerNumber, cars) {
  const cleaned = (cars || []).map(c => String(c).trim()).filter(Boolean);
  const { error } = await supabase
    .from("freshride_customers")
    .upsert({ customer_number: String(customerNumber), cars: cleaned, updated_at: new Date().toISOString() });
  return !error;
}

// Avatar is saved separately from cars (its own upsert call, omitting the
// `cars` column) so picking a picture never clobbers the customer's saved
// car list, and vice versa — PostgREST upsert only touches columns present
// in the payload.
export async function upsertCustomerAvatar(supabase, customerNumber, avatar) {
  const { error } = await supabase
    .from("freshride_customers")
    .upsert({ customer_number: String(customerNumber), avatar: avatar || null, updated_at: new Date().toISOString() });
  return !error;
}

// Appends a car to a customer's saved list if it isn't already there
// (case-insensitive match) — keeps Kunderegister in sync whenever a job's
// car_type is set, instead of that only happening when someone manually
// edits the customer's car list. Best-effort: never throws, since this is
// always a secondary side effect of some other write that already succeeded.
export async function syncCarToCustomer(supabase, customerNumber, car) {
  const trimmed = (car || "").toString().trim();
  if (!customerNumber || !trimmed) return;
  try {
    const { data } = await supabase
      .from("freshride_customers")
      .select("cars")
      .eq("customer_number", String(customerNumber))
      .maybeSingle();
    const existing = data?.cars || [];
    const alreadyHas = existing.some(c => String(c).trim().toLowerCase() === trimmed.toLowerCase());
    if (alreadyHas) return;
    await supabase
      .from("freshride_customers")
      .upsert({ customer_number: String(customerNumber), cars: [...existing, trimmed], updated_at: new Date().toISOString() });
  } catch (err) {
    console.error("syncCarToCustomer error:", err);
  }
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
export async function createDraftJobLog(supabase, { name, phone, services, jobDate, code, car }) {
  if (code) {
    const { data: existing } = await supabase.from("freshride_jobs").select("id").eq("booking_code", code).limit(1);
    if (existing && existing.length) return { ok: false, reason: "exists" };
  }
  const match = await findCustomerByPhone(supabase, phone);
  const customer_number = match ? match.customer_number : String(await getNextCustomerNumber(supabase));

  // A returning customer isn't guaranteed to pick/type a car at booking time
  // (they may skip the suggestion chips) — fall back to whatever's already
  // on their Kunderegister card so the draft still shows up with a car.
  let car_type = (car || "").toString().trim();
  if (!car_type && match) {
    const { data: existingCustomer } = await supabase
      .from("freshride_customers")
      .select("cars")
      .eq("customer_number", String(customer_number))
      .maybeSingle();
    car_type = (existingCustomer?.cars || [])[0] || "";
  }

  const { error } = await supabase.from("freshride_jobs").insert({
    job_date: jobDate,
    customer_name: name,
    customer_phone: phone,
    customer_number,
    car_type: car_type || null,
    services: Array.isArray(services) ? services.join(", ") : (services || ""),
    price_paid: 0,
    status: "draft",
    booking_code: code || null,
  });
  if (error) return { ok: false, reason: "error" };

  // A car typed at booking time that isn't on file yet gets added, so
  // Kunderegister stays current going forward instead of only reflecting
  // whatever was last entered manually.
  if (car_type) await syncCarToCustomer(supabase, customer_number, car_type);

  return { ok: true };
}
