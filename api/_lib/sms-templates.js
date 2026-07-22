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

// Sent to the customer the moment they book (book-slot.js), and to William
// as an owner notification/email using the same wording.
export function buildBookingText({ name, phone, services, date, time, endTime, code }) {
  const calendarUrl = `${SITE_URL}/api/calendar-invite?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`;
  return (
    `Ny booking mottatt\n\n` +
    `Kode: ${code}\n` +
    `Navn: ${name}\n` +
    `Mobil: ${phone}\n` +
    `Dato: ${date}\n` +
    `Tid: ${time} – ${endTime}\n` +
    `Tjeneste(r): ${services.join(", ")}\n` +
    `Adresse: ${BUSINESS_ADDRESS}\n` +
    `Du får en SMS når bilen er ferdig og klar for henting (når det måtte passe).\n` +
    `Legg til i kalender: ${calendarUrl}\n\n` +
    `Spørsmål? Ring William på ${OWNER_PHONE}. Denne SMS-en kan ikke besvares.`
  );
}

// Sent manually by William (admin-data.js "send-completion-sms" action)
// once a job is done and the car is ready for pickup.
export function buildCompletionSmsText(name) {
  const greeting = name ? `Hei ${name}!` : "Hei!";
  return `${greeting} Bilen din er klar hos FreshRide. Håper du ble fornøyd! Legg gjerne igjen en tilbakemelding: ${FEEDBACK_URL} Mvh William\n\nSpørsmål? Ring William på ${OWNER_PHONE}. Denne SMS-en kan ikke besvares.`;
}
