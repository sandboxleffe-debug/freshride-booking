const { google } = require("googleapis");

function generateSlots(date, startHour, endHour, slotMinutes, events) {
  const slots = [];

  const dayStart = new Date(date);
  dayStart.setHours(startHour, 0, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setHours(endHour, 0, 0, 0);

  for (
    let t = new Date(dayStart);
    t < dayEnd;
    t = new Date(t.getTime() + slotMinutes * 60000)
  ) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t.getTime() + slotMinutes * 60000);

    const overlapping = events.some(e => {
      const eStart = new Date(e.start.dateTime || e.start.date);
      const eEnd = new Date(e.end.dateTime || e.end.date);

      return slotStart < eEnd && slotEnd > eStart;
    });

    if (!overlapping) {
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: true
      });
    }
  }

  return slots;
}

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

    const slots = generateSlots(
      date,
      9,
      17,
      60,
      events
    );

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
