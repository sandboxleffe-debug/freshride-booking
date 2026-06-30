const { google } = require("googleapis");

exports.handler = async (event) => {
  const date = event.queryStringParameters?.date;

  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar.readonly"]
  );

  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.list({
    calendarId: process.env.CALENDAR_ID,
    timeMin: new Date(date).toISOString(),
    timeMax: new Date(new Date(date).setHours(23,59,59)).toISOString(),
    singleEvents: true
  });

  const events = (res.data.items || [])
    .map(e => ({
      id: e.id,
      start: e.start.dateTime,
      end: e.end.dateTime,
      status: e.extendedProperties?.private?.status || "unknown",
      summary: e.summary
    }))
    .filter(e => e.status === "available");

  return {
    statusCode: 200,
    body: JSON.stringify({ events })
  };
};
