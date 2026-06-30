const { google } = require("googleapis");

exports.handler = async (event) => {
  try {
    const { start, name, phone } = JSON.parse(event.body);

    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

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
        summary: `Vask - ${name} (${phone})`,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: "Europe/Oslo",
        },
        end: {
          dateTime: endDate.toISOString(),
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
