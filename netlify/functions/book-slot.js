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

    await calendar.events.patch({
      calendarId: process.env.CALENDAR_ID,
      eventId,
      requestBody: {
        summary: `BOOKED - ${name}`,
        description: phone,
        colorId: "11" // grønn/rød visuell markering
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
