// api/_lib/analytics.js
// Reads visitor stats from the GA4 Data API using the same service account
// as Google Calendar. Requires the service account to be added as a
// "Viewer" under GA4 Property Access Management, plus this env var:
//   GA4_PROPERTY_ID   (numeric property id, not the G-XXXX measurement id)

import { google } from "googleapis";

async function getAccessToken() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const { access_token } = await auth.authorize();
  return access_token;
}

async function runReport(body) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error("GA4_PROPERTY_ID is not set");
  const token = await getAccessToken();
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 runReport failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Today's active users + page views, plus a same-metric comparison for
// yesterday so the admin card can show a simple up/down trend. The
// "dateRange" dimension + named ranges disambiguate which row is which.
export async function getVisitorSummary() {
  const data = await runReport({
    dateRanges: [
      { startDate: "today", endDate: "today", name: "today" },
      { startDate: "yesterday", endDate: "yesterday", name: "yesterday" },
    ],
    dimensions: [{ name: "dateRange" }],
    metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
  });

  const rowFor = (name) => (data.rows || []).find(r => r.dimensionValues?.[0]?.value === name);
  const today = rowFor("today");
  const yesterday = rowFor("yesterday");

  return {
    todayVisitors: Number(today?.metricValues?.[0]?.value || 0),
    todayPageViews: Number(today?.metricValues?.[1]?.value || 0),
    yesterdayVisitors: Number(yesterday?.metricValues?.[0]?.value || 0),
    yesterdayPageViews: Number(yesterday?.metricValues?.[1]?.value || 0),
  };
}
