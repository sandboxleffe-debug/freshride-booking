const { google } = require("googleapis");

exports.handler = async (event) => {
  const { eventId, name, phone } = JSON.parse(event.body);

  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar"]
  );

  const calendar = google.calendar({ version: "v3", auth });

  // 1. hent slot
  const slot = await calendar.events.get({
    calendarId: process.env.CALENDAR_ID,
    eventId
  });

  const data = slot.data;

  // 2. safety check (ANTI DOUBLE BOOKING)
  if (data.extendedProperties?.private?.status !== "available") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Slot not available" })
    };
  }

  // 3. oppdater til BOOKED
  const result = await calendar.events.patch({
    calendarId: process.env.CALENDAR_ID,
    eventId,
    requestBody: {
      summary: "BOOKED",
      description: `Name: ${name}, Phone: ${phone}`,
      extendedProperties: {
        private: {
          status: "booked",
          name,
          phone
        }
      }
    }
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, event: result.data })
  };
};
