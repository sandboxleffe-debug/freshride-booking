# FreshRide Booking — Vercel deployment

## What changed from the Netlify version
- Redesigned frontend on **Bootstrap 5** (CDN, no build step) — hero, stepper
  panels, a slot grid instead of a bare list, a booking modal instead of an
  inline form, and a toast for the success message.
- `netlify/functions/*` → `api/*`. Vercel auto-detects any file in `/api` as
  a serverless function, so no extra config is needed for that.
- Frontend calls `/api/get-slots` and `/api/book-slot` (was
  `/.netlify/functions/...`).
- `api/get-slots.js` and `api/book-slot.js` are **placeholders** that match
  the original request/response shape exactly. I couldn't retrieve your two
  real Netlify function files from GitHub (the folder view was blocked), so
  paste their source here and I'll port the real logic (Google Calendar,
  DB, etc.) 1:1 into these two files.

## File structure
```
freshride/
├── index.html          # Bootstrap 5 frontend
├── style.css           # design tokens + custom styling
├── package.json
├── vercel.json
└── api/
    ├── get-slots.js     # GET  /api/get-slots?date=YYYY-MM-DD
    └── book-slot.js     # POST /api/book-slot { eventId, name, phone }
```

## Deploy to Vercel

**Option A — via GitHub (recommended)**
1. Push this folder's contents to your `freshride-booking` repo (replacing
   the old files), or a new repo.
2. Go to vercel.com → **Add New… → Project** → import the repo.
3. Framework Preset: **Other**. Build command: leave empty. Output
   directory: leave empty (root). Vercel will pick up `api/` automatically.
4. Click **Deploy**.
5. If your real booking logic needs secrets (Google Calendar service
   account, DB URL, etc.), add them under **Project → Settings →
   Environment Variables** before deploying.

**Option B — via CLI**
```bash
npm i -g vercel
cd freshride
vercel        # first deploy / link project
vercel --prod # promote to production
```

## Next step
Send me the contents of `netlify/functions/get-slots.js` and
`netlify/functions/book-slot.js` and I'll wire the real logic into
`api/get-slots.js` / `api/book-slot.js` so booking actually works end to
end (right now it returns example slots and logs bookings without
persisting them).
