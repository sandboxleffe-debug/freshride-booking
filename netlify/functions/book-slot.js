const { google } = require("googleapis");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    const { start, end, title } = body;

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    const result = await calendar.events.insert({
      calendarId: process.env.CALENDAR_ID,
      requestBody: {
        summary: title || "Booking",
        start: {
          dateTime: start,
          timeZone: "Europe/Oslo",
        },
        end: {
          dateTime: end,
          timeZone: "Europe/Oslo",
        },
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, event: result.data }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
