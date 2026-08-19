// api/_lib/sms-templates.js
// Single source of truth for customer-facing SMS wording, shared between
// the real send paths (book-slot.js, admin-data.js) and admin's "Test SMS"
// panel. Keeping the wording in one place means a test send always shows
// exactly what a customer would actually receive — never a copy that's
// quietly drifted out of sync after a wording change.

const BUSINESS_ADDRESS = "Oftebroveien 29, Lyngdal";
const SITE_URL = "https://freshride.no";
const OWNER_PHONE = "921 33 900";
const FEEDBACK_URL = "https://freshride.no/feedback";

// Sent to the customer the moment they book — kept short (kode, tid,
// tjeneste(r), adresse, kalenderlenke, "kan ikke besvares"). William already
// knows he sent it, so it skips the name/mobil/date-header a plain
// confirmation doesn't need repeated back to the customer.
export function buildBookingTextCustomer({ services, date, time, endTime, code, phone }) {
  const calendarUrl = `${SITE_URL}/api/calendar-invite?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`;
  return (
    `Booking bekreftet ✅\n\n` +
    `Kode: ${code}\n` +
    `Tid: ${date}, kl. ${time} – ${endTime}\n` +
    `Tjeneste(r): ${services.join(", ")}\n` +
    `Adresse: ${BUSINESS_ADDRESS}\n\n` +
    `Legg til i kalender: ${calendarUrl}\n\n` +
    `Denne SMS-en kan ikke besvares.`
  );
}

// Sent to the customer the moment they submit a "Foreslå tid" request —
// same shape as buildBookingTextCustomer above (tid, tjeneste(r), adresse),
// but no kode/kalenderlenke yet since nothing's actually booked. The real
// confirmation SMS (buildBookingTextCustomer) follows once William confirms
// the time in admin.
export function buildTimeRequestTextCustomer({ services, date, time }) {
  return (
    `Forespurt booking mottatt ⏳\n\n` +
    `Tid: ${date}, kl. ${time} (ønsket tidspunkt)\n` +
    `Tjeneste(r): ${services.join(", ")}\n` +
    `Adresse: ${BUSINESS_ADDRESS}\n\n` +
    `⚠️ Du får en ny SMS når timen er bekreftet.\n\n` +
    `Denne SMS-en kan ikke besvares.`
  );
}

// Sent to William (owner SMS/email) — keeps the fuller detail since he
// needs to know who's coming, not just that someone booked. A "Foreslå tid"
// request never reaches this template (see buildTimeRequestTextOwner below)
// — by the time this one is sent, the booking is already real.
export function buildBookingTextOwner({ name, phone, services, date, time, endTime, code }) {
  const calendarUrl = `${SITE_URL}/api/calendar-invite?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`;
  return (
    `Ny booking mottatt\n\n` +
    `Kode: ${code}\n` +
    `Navn: ${name}\n` +
    `Mobil: ${phone}\n` +
    `Dato: ${date}\n` +
    `Tid: ${time} – ${endTime}\n` +
    `Tjeneste(r): ${services.join(", ")}\n` +
    `Adresse: ${BUSINESS_ADDRESS}\n\n` +
    `Legg til i kalender: ${calendarUrl}\n\n` +
    `Spørsmål? Ring William på ${OWNER_PHONE}. Denne SMS-en kan ikke besvares.`
  );
}

// Sent to William the moment a customer submits a "Foreslå tid" request —
// nothing is booked yet at this point (see book-slot.js), so unlike
// buildBookingTextOwner above there's no code/calendar link to include.
// William confirms (or adjusts the time first) from the admin panel, which
// is what actually creates the calendar event and notifies the customer.
export function buildTimeRequestTextOwner({ name, phone, services, date, time }) {
  return (
    `🕐 Ny tidsforespørsel\n\n` +
    `Navn: ${name}\n` +
    `Mobil: ${phone}\n` +
    `Ønsket dato: ${date}\n` +
    `Ønsket tid: ${time}\n` +
    `Tjeneste(r): ${services.join(", ")}\n\n` +
    `Bekreft eller juster tidspunktet i adminpanelet. Denne SMS-en kan ikke besvares.`
  );
}

// One line appended to both completion SMS variants below — `referral` is
// { code, percent } for the recipient's own permanent "tips en venn" code,
// or null if it couldn't be resolved (never blocks sending the SMS itself).
// Wording depends on whether they already have an earned discount waiting
// (percent > 0) or haven't referred anyone yet.
function referralNudgeLine(referral) {
  if (!referral?.code) return "";
  if (referral.percent > 0) {
    return `\n\nTips en venn! Del koden din ${referral.code} — du har allerede ${referral.percent}% rabatt klar til din neste vask.`;
  }
  return `\n\nTips en venn! Del koden din ${referral.code} — for hver nye kunde du sender vår vei låser du opp rabatt til deg selv (fra 10%).`;
}

// Sent manually by William (admin-data.js "send-completion-sms" action)
// once a job is done and the car is ready for pickup.
export function buildCompletionSmsText(name, referral) {
  const greeting = name ? `Hei ${name}!` : "Hei!";
  return (
    `${greeting}\n\n` +
    `Bilen din er klar hos FreshRide. Håper du ble fornøyd!\n\n` +
    `Legg gjerne igjen en tilbakemelding: ${FEEDBACK_URL}` +
    `${referralNudgeLine(referral)}\n\n` +
    `Mvh William\n\n` +
    `Denne SMS-en kan ikke besvares.`
  );
}

// Sent manually by William (admin-data.js "send-thanks-sms" action) when
// everything — including telling the customer the car is ready — was
// already handled outside SMS (in person, phone call, Messenger). Skips
// the "bilen er klar" line since that would be stale/redundant hours after
// the fact; just a thank-you + feedback nudge. Counts as the customer
// having been notified, same as the full completion SMS.
export function buildThanksSmsText(name, referral) {
  const greeting = name ? `Hei ${name}!` : "Hei!";
  return (
    `${greeting}\n\n` +
    `Tusen takk for oppdraget hos FreshRide!\n\n` +
    `Legg gjerne igjen en tilbakemelding: ${FEEDBACK_URL}` +
    `${referralNudgeLine(referral)}\n\n` +
    `Mvh William\n\n` +
    `Denne SMS-en kan ikke besvares.`
  );
}

// Same as buildThanksSmsText, but for a loyal/returning customer William
// wants to reward with one of the discount codes generated in Innstillinger
// — the code is still one-time-use, redeemed like any other at booking.
export function buildThanksSmsTextWithDiscount(name, code, percent) {
  const greeting = name ? `Hei ${name}!` : "Hei!";
  return (
    `${greeting}\n\n` +
    `Tusen takk for oppdraget hos FreshRide! Kom gjerne igjen.\n\n` +
    `Legger ved en rabattkode du kan bruke på neste booking: ${code} (-${percent}%)\n\n` +
    `Legg gjerne igjen en tilbakemelding: ${FEEDBACK_URL}\n\n` +
    `Mvh William\n\n` +
    `Denne SMS-en kan ikke besvares.`
  );
}
