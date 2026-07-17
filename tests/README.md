# Tests

There's no Node.js available in the sandbox these are usually run from (and
none confirmed on William's machine either), so this isn't a Playwright/Vitest
setup — it's a small, dependency-free harness that runs real assertions
directly inside a real browser, using the same tools already used all session
to manually verify changes:

- `serve.ps1` — a static file server (no Node required), so the site can be
  loaded over `http://localhost`. Fetches to `/api/*` aren't real (no backend
  runs locally) — every test suite mocks `window.fetch` for the endpoints it
  needs before exercising the page.
- `*.tests.js` — self-contained test files. Each one is meant to be pasted
  wholesale into a `javascript_exec` call against the already-loaded page.
  Running the file returns a JSON summary (`{ total, passed, failed, details }`)
  — any `details[].pass === false` entry is a regression, with the specific
  assertion message and `error`.

Tests share mutable global state and run in registration order on purpose —
they exercise the page the way a person actually would (open it, click
through it), not as isolated units. Don't reorder tests within a file without
checking what later tests assume is already true.

## Running a suite

1. Start the server (pick any free port):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File tests/serve.ps1 -Port 8890
   ```
2. Navigate the Claude Browser pane to the matching page, e.g.
   `http://localhost:8890/admin.html`.
3. `Read` the relevant `tests/*.tests.js` file and pass its full contents as
   the `text` argument to `javascript_tool` (`action: javascript_exec`)
   targeting that tab.
4. Read the returned summary. `failed: 0` means the suite passed. Any failure
   includes the test name and assertion message — go straight to that
   behavior in the source.
5. Stop the server when done (find the PID on the port and kill it, or just
   close the terminal task) — don't leave it running between sessions.

## What's covered

- `admin.tests.js` — car auto-suggest from kunderegister (fill / switch /
  clear on "+ Ny kunde" / never overwrite a manual edit), photo-pair
  rendering + upload/delete payload shape, the "Vis under referanser"
  checkbox reading `photoPairs` (not the old flat columns — this exact bug
  shipped once), tab-switch slide direction, the swipe gesture (forward,
  backward, ignores vertical drags, ignores drags starting on a gauge),
  the Oversikt month calendar (today marked but not struck through, past
  days struck through, month navigation), and the gallery grid (no
  description input, move/delete controls present).
- `resultater.tests.js` — pairs render as before/after slides, dragging the
  compare-slider hitzone works, and the specific regression where the whole
  image used to swallow every touch gesture (leaving visitors stuck on the
  first card) can't come back — asserts both the behavior (a swipe outside
  the hitzone doesn't move the slider) and the CSS property that caused it
  (`touch-action` must not be `none` on `.fr-compare-frame`).
- `booking-calendar.tests.js` — the public booking calendar's month
  navigation, and the guard against ever browsing into a month before the
  current one (the past can't be booked).

## What's NOT covered (be extra careful here, or extend the suite first)

- Anything touching the real Supabase/Google Calendar/Talkdesk backends —
  these tests never hit real APIs, only mocked `fetch`. A change to an actual
  `/api/*.js` handler's behavior needs either a real Vercel deploy to a
  preview environment, or careful manual reasoning against the code.
- Visual/CSS regressions that don't change DOM structure or class names
  (e.g. a color or spacing change that doesn't break functionality) — this
  harness asserts behavior, not pixels.
