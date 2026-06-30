const { google } = require("googleapis");

exports.handler = async (event) => {
  try {
    const { eventId, name, phone } = JSON.parse(event.body);

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    // Hent eksisterende event
    const existing = await calendar.events.get({
      calendarId: process.env.CALENDAR_ID,
      eventId
    });

    const ev = existing.data;

    // Oppdater event (marker som booket)
    const result = await calendar.events.patch({
      calendarId: process.env.CALENDAR_ID,
      eventId,
      requestBody: {
        summary: `BOOKED - ${name} (${phone})`,
        description: "Booked via FreshRide",
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, event: result.data })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
