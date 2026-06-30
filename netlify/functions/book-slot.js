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

    // 1. hent event (valgfritt men ok for logging)
    await calendar.events.get({
      calendarId: process.env.CALENDAR_ID,
      eventId
    });

    // 2. slett slot (den blir ikke tilgjengelig igjen)
    await calendar.events.delete({
      calendarId: process.env.CALENDAR_ID,
      eventId
    });

    // 3. lag faktisk booking event (ny event)
    const booked = await calendar.events.insert({
      calendarId: process.env.CALENDAR_ID,
      requestBody: {
        summary: `BOOKED - ${name} (${phone})`,
        start: {
          dateTime: event.start?.dateTime,
          timeZone: "Europe/Oslo"
        },
        end: {
          dateTime: event.end?.dateTime,
          timeZone: "Europe/Oslo"
        }
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, booked: booked.data })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
