const { google } = require("googleapis");

exports.handler = async (event) => {
  try {
    const dateParam = event.queryStringParameters?.date;
    const date = dateParam ? new Date(dateParam) : new Date();

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    const timeMin = new Date(date);
    timeMin.setHours(0, 0, 0, 0);

    const timeMax = new Date(date);
    timeMax.setHours(23, 59, 59, 999);

    const res = await calendar.events.list({
      calendarId: process.env.CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items || [];

    const slots = events.map(e => ({
      id: e.id,
      title: e.summary,
      start: e.start.dateTime,
      end: e.end.dateTime
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ slots }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
