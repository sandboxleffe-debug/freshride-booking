// tests/booking-calendar.tests.js
// Self-contained test suite for index.html's booking calendar (Step 1: Velg
// dato) — paste this whole file's content into javascript_tool (action:
// javascript_exec) after navigating to http://localhost:<port>/index.html.
// Returns a JSON summary; any entry with pass:false is a regression.
// See tests/README.md for the full workflow.
(async function () {
  const testList = [];
  function test(name, fn) { testList.push({ name, fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${b}, got ${a}`);
  }

  const origFetch = window.fetch;
  window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));

  // =========================================================================
  // Results promo: resultater.html only lived in the nav rail before, which
  // nobody noticed — this clickable card on the homepage is the fix.
  // =========================================================================
  test('results promo: a small link to resultater.html sits below the calendar section', () => {
    const el = document.querySelector('.fr-results-promo');
    assert(!!el, 'expected a .fr-results-promo element on the homepage');
    assertEqual(el.getAttribute('href'), 'resultater.html');
    assert(el.textContent.includes('resultater'), 'expected a clear call-to-action label');
    const main = document.querySelector('main');
    const children = Array.from(main.children);
    assert(children.indexOf(el) > children.indexOf(document.getElementById('step-date')), 'expected the promo link to come after the calendar section, not compete with it above');
  });

  test('calendar: today is marked but not struck through', async () => {
    calendarViewYear = undefined; calendarViewMonth = undefined; // reset to "today"
    await loadMonthCalendar();
    const now = new Date();
    const todayCell = [...document.querySelectorAll('.fr-calendar-day')].find(c => c.classList.contains('fr-day-today'));
    assert(!!todayCell, 'today cell should exist (unless this week collapsed, which would be a different bug)');
    assert(!todayCell.classList.contains('fr-day-past'), 'today must not be struck through');
  });

  // A collapsed past week used to be a plain gray bar with zero color info
  // — a week full of red (fully-booked) days looked identical to an empty
  // one. Now each collapsed bar carries a status dot per day, and a past
  // day still in a non-collapsed (current) week keeps its full status
  // color too — it used to be washed out to 25% opacity + grayscale.
  test('calendar: a collapsed past week still shows a status dot per day, including red ones', async () => {
    calendarViewYear = undefined; calendarViewMonth = undefined; // current month — earlier weeks in it are already past
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (toDateKey(firstOfMonth) < toDateKey(now)) {
      const key = toDateKey(firstOfMonth);
      window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: { [key]: 'red' } }), { status: 200 }));
      await loadMonthCalendar();
      const bar = document.querySelector('.fr-calendar-week-collapsed');
      assert(!!bar, 'expected at least one collapsed week bar this far into the month');
      assert(!!bar.querySelector('.fr-calendar-week-dots'), 'expected a row of status dots inside the collapsed bar');
      assert(bar.querySelectorAll('.fr-calendar-week-dot').length > 0, 'expected one dot per day in the week');
      assert(bar.classList.contains('fr-calendar-week-had-red'), 'a week that had a red day must get the had-red highlight, not read as empty');
      assert(!!bar.querySelector('.fr-calendar-week-dot-red'), 'expected an actual red-colored dot for that day');
    }
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));
    calendarViewYear = undefined; calendarViewMonth = undefined;
    await loadMonthCalendar();
  });

  test('calendar: a past day still in a non-collapsed (current) week keeps its full status color, not grayed out', async () => {
    calendarViewYear = undefined; calendarViewMonth = undefined;
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (toDateKey(yesterday).slice(0, 7) !== toDateKey(now).slice(0, 7)) return; // skip right at a month boundary
    const key = toDateKey(yesterday);
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: { [key]: 'red' } }), { status: 200 }));
    await loadMonthCalendar();
    const cell = [...document.querySelectorAll('.fr-calendar-day')].find(c => c.textContent.trim() === String(yesterday.getDate()) && c.classList.contains('fr-day-past'));
    if (cell) {
      assert(cell.classList.contains('fr-status-red'), 'expected the red status class to still be applied to a past day');
      assertEqual(getComputedStyle(cell).opacity, '1', 'the cell itself must not be faded — only the day number gets struck through');
    }
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));
    calendarViewYear = undefined; calendarViewMonth = undefined;
    await loadMonthCalendar();
  });

  test('calendar: next month button is enabled and advances the label', async () => {
    const before = document.getElementById('calendarMonthLabel').textContent;
    await changeCalendarMonth(1);
    const after = document.getElementById('calendarMonthLabel').textContent;
    assert(after !== before, `label should change from "${before}"`);
  });

  test('calendar: prev button is enabled once viewing a future month', () => {
    assertEqual(document.getElementById('calendarPrevBtn').disabled, false);
  });

  test('calendar: prev button is disabled again back at the current month', async () => {
    localStorage.removeItem('fr_admin_seen'); // a regular visitor, not William
    await changeCalendarMonth(-1);
    assertEqual(document.getElementById('calendarPrevBtn').disabled, true);
  });

  test('regression guard: navigating before the current month is a no-op for a regular visitor (can\'t book the past)', async () => {
    localStorage.removeItem('fr_admin_seen');
    const before = document.getElementById('calendarMonthLabel').textContent;
    await changeCalendarMonth(-1); // already at the floor — must not go further back
    const after = document.getElementById('calendarMonthLabel').textContent;
    assertEqual(after, before, 'the public calendar must never navigate before the current month for a regular visitor');
  });

  // William uses the same public booking page himself — the same
  // localStorage flag admin.html sets on login (fr_admin_seen) also unlocks
  // paging back past the current month here, purely so he can look at how a
  // past month went. Nothing else about the page (booking a past day is
  // still impossible — those cells have no click handler either way).
  test('logged in (fr_admin_seen): can page back before the current month, just to look', async () => {
    localStorage.setItem('fr_admin_seen', '1');
    try {
      const before = document.getElementById('calendarMonthLabel').textContent;
      await changeCalendarMonth(-1);
      const after = document.getElementById('calendarMonthLabel').textContent;
      assert(after !== before, 'expected navigation to actually move back one month when logged in');
      assertEqual(document.getElementById('calendarPrevBtn').disabled, false, 'prev must stay enabled even at/before the current month when logged in');
      await changeCalendarMonth(1); // back to where the other tests expect to be
    } finally {
      localStorage.removeItem('fr_admin_seen');
    }
  });

  test('legend: orange dot is labeled "Delvis ledig", not "Delvis booket"', () => {
    const text = document.querySelector('.fr-calendar-legend').textContent;
    assert(text.includes('Delvis ledig'), 'expected "Delvis ledig" in the legend');
    assert(!text.includes('Delvis booket'), 'the old "Delvis booket" wording should be gone');
  });

  test('nav rail: "Om FreshRide" label (not "Om meg")', () => {
    const link = document.querySelector('a[href="about.html"]');
    assert(!!link, 'expected an about.html nav link');
    assertEqual(link.getAttribute('title'), 'Om FreshRide');
    assert(link.textContent.includes('Om FreshRide'));
  });

  // =========================================================================
  // "Mobil visning" dev toggle — only ever shown to William (fr_admin_seen,
  // set by admin.html on login), never a real visitor. Uses a real <iframe>
  // (not just a narrower div) so the site's actual @media rules activate —
  // a container's width alone doesn't affect what media queries evaluate.
  // =========================================================================
  test('syncMobilePreviewToggle: hidden by default, appears once logged in, disappears again on logout', () => {
    localStorage.removeItem('fr_admin_seen');
    syncMobilePreviewToggle();
    assert(!document.querySelector('.fr-mobile-preview-toggle'), 'a regular visitor must never see this');

    localStorage.setItem('fr_admin_seen', '1');
    syncMobilePreviewToggle();
    const btn = document.querySelector('.fr-mobile-preview-toggle');
    assert(!!btn, 'expected the toggle once logged in');

    syncMobilePreviewToggle(); // calling again must not duplicate it
    assertEqual(document.querySelectorAll('.fr-mobile-preview-toggle').length, 1);

    localStorage.removeItem('fr_admin_seen');
    syncMobilePreviewToggle();
    assert(!document.querySelector('.fr-mobile-preview-toggle'), 'must disappear again once logged out');
  });

  test('openMobilePreview: shows a phone-sized iframe of the current page, closable', () => {
    document.getElementById('frMobilePreviewOverlay')?.remove();
    openMobilePreview();
    const overlay = document.getElementById('frMobilePreviewOverlay');
    assert(!!overlay, 'expected the preview overlay to appear');
    const iframe = overlay.querySelector('iframe');
    assert(!!iframe, 'expected an iframe — a narrower div would not actually trigger the site\'s mobile CSS');
    assertEqual(iframe.src, location.href);

    overlay.querySelector('.fr-mobile-preview-close').click();
    assert(!document.getElementById('frMobilePreviewOverlay'), 'expected the close button to remove the overlay');
  });

  test('success toast: mentions the completion SMS the customer will get later', () => {
    const text = document.getElementById('successToast').textContent;
    assert(text.includes('SMS') && text.includes('ferdig') && text.includes('henting'), `expected pickup-SMS notice in the toast, got "${text}"`);
  });

  // =========================================================================
  // Reviews: an average-rating summary above the ticker, also folded into
  // the page's existing LocalBusiness JSON-LD as aggregateRating so search
  // results can show the star rating too.
  // =========================================================================
  test('loadReviews: shows the average rating and review count above the ticker, and updates the JSON-LD', async () => {
    const origFetch = window.fetch;
    window.fetch = (url) => {
      if (String(url).includes('/api/feedback')) {
        return Promise.resolve(new Response(JSON.stringify({
          reviews: [
            { id: 'r1', name: 'Ola', rating: 5, comment: 'Kjempebra!' },
            { id: 'r2', name: 'Kari', rating: 5, comment: 'Strålende jobb.' },
            { id: 'r3', name: 'Per', rating: 4, comment: 'Veldig bra.' },
          ],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));
    };
    try {
      await loadReviews();
    } finally {
      window.fetch = origFetch;
    }
    const avgText = document.getElementById('reviewsAvg').textContent;
    assert(avgText.includes('4,7'), `expected the average (14/3 = 4.7) in the summary, got "${avgText}"`);
    assert(avgText.includes('3 anmeldelser'), `expected the review count, got "${avgText}"`);

    const ld = JSON.parse(document.getElementById('frLocalBusinessLd').textContent);
    assertEqual(ld.aggregateRating.reviewCount, 3);
    assertEqual(ld.aggregateRating.ratingValue, '4.7');
    assertEqual(ld["@type"], "AutoWash", 'must not have clobbered the rest of the existing structured data');
  });

  test('loadReviews: singular "1 anmeldelse", not "1 anmeldelser"', async () => {
    const origFetch = window.fetch;
    window.fetch = (url) => {
      if (String(url).includes('/api/feedback')) {
        return Promise.resolve(new Response(JSON.stringify({ reviews: [{ id: 'r1', name: 'Ola', rating: 5, comment: 'Bra!' }] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));
    };
    try {
      await loadReviews();
    } finally {
      window.fetch = origFetch;
    }
    assert(document.getElementById('reviewsAvg').textContent.includes('1 anmeldelse') && !document.getElementById('reviewsAvg').textContent.includes('1 anmeldelser'));
  });

  // =========================================================================
  // Weather (Yr / MET Norway) — a single "emoji + degrees" line at the top
  // of the opened day's slot list (not on the calendar itself — a symbol on
  // every cell turned out to be more visual noise than help).
  // =========================================================================
  test('weatherEmoji: maps common MET symbol codes to a sensible emoji', () => {
    assertEqual(weatherEmoji('clearsky_day'), '☀️');
    assertEqual(weatherEmoji('partlycloudy_night'), '⛅');
    assertEqual(weatherEmoji('cloudy'), '☁️');
    assertEqual(weatherEmoji('rainshowers_day'), '🌧️');
    assertEqual(weatherEmoji('rainshowersandthunder_day'), '⛈️', 'thunder must take priority over the rain part of the code');
    assertEqual(weatherEmoji('lightsnowshowers_day'), '❄️');
    assertEqual(weatherEmoji('sleet'), '🌨️');
    assertEqual(weatherEmoji('fog'), '🌫️');
    assertEqual(weatherEmoji(null), '', 'no code (forecast out of range) must render nothing, not a broken icon');
    assertEqual(weatherEmoji('some_unknown_code'), '', 'an unmapped code must render nothing rather than guess');
  });

  test('calendar: day cells never carry a weather badge anymore', async () => {
    calendarViewYear = undefined; calendarViewMonth = undefined;
    await loadMonthCalendar();
    assertEqual(document.querySelectorAll('.fr-day-weather').length, 0, 'weather moved to the opened-day panel — the calendar grid itself must stay clean');
  });

  test('loadSlotsForDate: shows "emoji + degrees" plus Yr credit when forecast data exists for that day', async () => {
    weatherByDate = { '2026-07-24': { symbol: 'partlycloudy_day', temp: 18 } };
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [{ id: 'e1', start: '2026-07-24T10:00:00Z', end: '2026-07-24T11:00:00Z' }] }), { status: 200 }));
    await loadSlotsForDate('2026-07-24');
    const line = document.getElementById('slotsWeatherLine');
    assert(!line.classList.contains('d-none'), 'expected the weather line to show when data exists for the date');
    assert(line.textContent.includes('⛅'), `expected the emoji in the line, got "${line.textContent}"`);
    assert(line.textContent.includes('18°'), `expected the temperature in the line, got "${line.textContent}"`);
    assert(!!line.querySelector('a[href="https://www.yr.no"]'), 'MET Norway terms require crediting Yr wherever the data is shown');
  });

  test('loadSlotsForDate: hides the weather line when there is no forecast for that day', async () => {
    weatherByDate = {};
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    await loadSlotsForDate('2026-08-15'); // well beyond MET's ~9-day range
    const line = document.getElementById('slotsWeatherLine');
    assert(line.classList.contains('d-none'), 'a date with no forecast data must not show a stale/blank weather line');
  });

  test('loadSlotsForDate: the Yr credit sits on its own line, separate from the emoji + degrees', async () => {
    weatherByDate = { '2026-07-24': { symbol: 'partlycloudy_day', temp: 18 } };
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [{ id: 'e1', start: '2026-07-24T10:00:00Z', end: '2026-07-24T11:00:00Z' }] }), { status: 200 }));
    await loadSlotsForDate('2026-07-24');
    const line = document.getElementById('slotsWeatherLine');
    assert(line.innerHTML.includes('<br>'), 'expected a line break before the Yr credit');
    assert(!!line.querySelector('a[href="https://www.yr.no"]'), 'expected the Yr credit link');
  });

  test('render(): each open slot also shows emoji + degrees for the opened day', async () => {
    weatherByDate = { '2026-07-24': { symbol: 'rainshowers_day', temp: 14 } };
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [{ id: 'e1', start: '2026-07-24T10:00:00Z', end: '2026-07-24T11:00:00Z' }] }), { status: 200 }));
    await loadSlotsForDate('2026-07-24');
    const weatherSpan = document.querySelector('.fr-slot-weather');
    assert(!!weatherSpan, 'expected a per-slot weather span');
    assert(weatherSpan.textContent.includes('🌧️'), `expected the emoji on the slot, got "${weatherSpan.textContent}"`);
    assert(weatherSpan.textContent.includes('14°'), `expected the temperature on the slot, got "${weatherSpan.textContent}"`);
  });

  test('render(): no per-slot weather span when there is no forecast for the opened day', async () => {
    weatherByDate = {};
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [{ id: 'e1', start: '2026-07-24T10:00:00Z', end: '2026-07-24T11:00:00Z' }] }), { status: 200 }));
    await loadSlotsForDate('2026-07-24');
    assert(!document.querySelector('.fr-slot-weather'), 'no forecast data — must not render a blank weather span on the slot');
  });

  test('renderMiniWeatherStrip: shows 3 days (today + 2) with data, hides entirely with none', () => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    weatherByDate = { [key(now)]: { symbol: 'clearsky_day', temp: 20 } };
    renderMiniWeatherStrip();
    const box = document.getElementById('miniWeatherStrip');
    assert(!box.classList.contains('d-none'), 'expected the strip to show when at least one of the 3 days has data');
    assertEqual(box.querySelectorAll('.fr-mini-weather-day').length, 3, 'expected exactly 3 day columns');
    assert(box.textContent.includes('Lyngdal'), 'expected the location label');
    assert(box.textContent.includes('I dag'), 'expected "I dag" for the first column, not a weekday name');

    weatherByDate = {};
    renderMiniWeatherStrip();
    assert(box.classList.contains('d-none'), 'strip must hide entirely when none of the 3 days have data');
  });

  test('service icons: every known label pattern renders a real icon, not empty output', () => {
    const labels = ['FreshRide Complete', 'FreshRide Exterior', 'FreshRide Interior', 'FreshRide Interior+', 'FreshRide Premium', 'Something Unmapped'];
    const missing = labels.filter(l => !iconForServiceLabel(l).includes('<svg'));
    assertEqual(missing, [], `expected every label (including an unmapped fallback) to render an icon, missing for: ${missing.join(', ')}`);
  });

  test('loadServices: FreshRide Complete gets a subtle "Kundefavoritt" badge, others do not', async () => {
    window.fetch = (url) => {
      if (String(url).includes('type=services')) {
        return Promise.resolve(new Response(JSON.stringify({ services: [
          { id: '1', label: 'FreshRide Complete', price_nok: 1200 },
          { id: '2', label: 'FreshRide Exterior', price_nok: 500 },
        ] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    };
    await loadServices();
    const options = Array.from(document.querySelectorAll('.fr-service-name'));
    const complete = options.find(o => o.textContent.includes('Complete'));
    const exterior = options.find(o => o.textContent.includes('Exterior'));
    assert(!!complete.querySelector('.fr-service-favorite'), 'expected FreshRide Complete to show the Kundefavoritt badge');
    assert(!exterior.querySelector('.fr-service-favorite'), 'expected other services to not show the badge');
  });

  test('build version: fetches the latest commit SHA from GitHub and shows it in the footer', async () => {
    window.fetch = (url) => {
      assert(String(url).includes('api.github.com/repos/sandboxleffe-debug/freshride-booking/commits/main'), 'expected the public GitHub commits API to be called');
      return Promise.resolve(new Response(JSON.stringify({ sha: '0920a3f1234567890' }), { status: 200 }));
    };
    await loadBuildVersion();
    assertEqual(document.getElementById('buildVersion').textContent, 'build 0920a3f');
  });

  test('build version: keeps the static fallback text if the GitHub call fails', async () => {
    document.getElementById('buildVersion').textContent = 'v1.1.0';
    window.fetch = () => Promise.resolve(new Response('', { status: 500 }));
    await loadBuildVersion();
    assertEqual(document.getElementById('buildVersion').textContent, 'v1.1.0', 'a failed lookup must not blank out or break the footer text');
  });

  test('loadSlotsForDate: a day with zero open slots that was never configured says so, not "Fullbooket"', async () => {
    weatherByDate = {};
    dayStatuses = {}; // date absent entirely — no "Ledig" or booked events were ever set up
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    await loadSlotsForDate('2026-07-25');
    const noSlots = document.getElementById('noSlots');
    assert(!noSlots.classList.contains('d-none'), 'expected the empty state to show for a day with zero events');
    assert(!noSlots.textContent.includes('Fullbooket'), `"Fullbooket" wording is wrong when nothing was ever set up, got "${noSlots.textContent}"`);
    assert(noSlots.textContent.includes('Ingen faste ledige tider'), `expected the "never configured" wording, got "${noSlots.textContent}"`);
  });

  test('loadSlotsForDate: a day marked fully booked in the month view keeps the "Fullbooket dag" wording', async () => {
    weatherByDate = {};
    dayStatuses = { '2026-07-26': 'red' }; // month view: slots existed and all got taken
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    await loadSlotsForDate('2026-07-26');
    const noSlots = document.getElementById('noSlots');
    assert(!noSlots.classList.contains('d-none'), 'expected the empty state to show');
    assert(noSlots.textContent.includes('Fullbooket dag'), `expected "Fullbooket dag" wording for a genuinely fully-booked day, got "${noSlots.textContent}"`);
  });

  test('loadSlotsForDate: a zero-slot day still offers a prominent "Foreslå tid" CTA either way', async () => {
    weatherByDate = {};
    dayStatuses = {};
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    await loadSlotsForDate('2026-07-27');
    const card = document.querySelector('#noSlotsRequestWrap .fr-request-time-cta');
    assert(!!card, 'expected a "Foreslå tid" CTA even on a day with no real slots at all');
    assert(!!card.querySelector('.fr-request-time-cta-btn'), 'expected a clickable button inside the CTA card');
  });

  // On an empty day the "Foreslå tid" option is the ONLY thing to do — it
  // used to reuse the same low-key dashed pill shown alongside real slots,
  // which read as nearly invisible sitting under the faint "ingen tid"
  // message. It must now stand out as its own clear, high-contrast card,
  // not blend into the muted empty-state text around it.
  test('the empty-day "Foreslå tid" CTA is visually distinct from the low-key inline variant', () => {
    events = [];
    currentSlotsDate = '2026-07-27';
    renderNoSlots();
    const card = document.querySelector('#noSlotsRequestWrap .fr-request-time-cta');
    assert(!card.classList.contains('fr-slot-request'), 'must not reuse the subtle dashed-pill class used alongside real slots');
    assert(card.textContent.includes('Foreslå ditt eget tidspunkt'), 'expected a clear headline, not just a small tag');
    const btn = card.querySelector('.fr-request-time-cta-btn');
    assert(btn.classList.contains('fr-btn-primary'), 'expected the same strong solid-gold styling as the main booking button, not an outline/dashed look');
  });

  // A time request never attaches to any particular calendar event anymore
  // — it used to grab events[0] (the day's first real slot) as a "base" to
  // patch, but that had nothing to do with the requested time and could
  // silently move the wrong slot, leaving a stale duplicate "Ledig" time
  // behind. Nothing gets booked at request time at all now — William
  // confirms it from admin (see api/book-slot.js).
  test('confirmTimeRequest: with no real slot that day, selected carries only the requested date/time', () => {
    events = [];
    currentSlotsDate = '2026-07-27';
    renderNoSlots();
    document.querySelector('#noSlotsRequestWrap .fr-request-time-cta-btn').click();
    document.getElementById('timeRequestInput').value = '08:30';
    document.getElementById('timeRequestConfirmBtn').click();
    assertEqual(selected.isTimeRequest, true);
    assertEqual(selected.requestedDate, '2026-07-27');
    assertEqual(selected.requestedTime, '08:30');
    assertEqual(selected.id, undefined, 'no calendar event is ever attached to a time request');
  });

  test('confirmTimeRequest: even with a real slot that day, selected still only carries the requested date/time — not the unrelated slot\'s id', () => {
    events = [{ id: 'evtReal', start: '2026-07-28T09:00:00+02:00', end: '2026-07-28T11:30:00+02:00' }];
    currentSlotsDate = '2026-07-28';
    render();
    document.querySelector('#list .fr-slot-request').click();
    document.getElementById('timeRequestInput').value = '13:00';
    document.getElementById('timeRequestConfirmBtn').click();
    assertEqual(selected.requestedTime, '13:00');
    assertEqual(selected.id, undefined, 'the day\'s real slot has nothing to do with a different requested time — must not be borrowed');
  });

  test('phone field: strips non-digits and caps at 8', () => {
    const el = document.getElementById('phone');
    el.value = '92-13 39 001abc';
    el.dispatchEvent(new Event('input'));
    assertEqual(el.value, '92133900');
  });

  // =========================================================================
  // Discount code field on the booking form — never validated live as the
  // customer types (would let anyone brute-force guess codes for free).
  // There's an explicit "Sjekk kode" button for an on-demand check, and
  // book() itself re-checks once at submission if that button was skipped —
  // either way, exactly one check per complete code, never per keystroke.
  // =========================================================================
  test('discount code input: uppercases and strips non-alphanumeric characters, no network call', () => {
    window.fetch = () => { throw new Error('typing in the field must never call the network'); };
    onDiscountCodeInput('a7-k3 m!');
    assertEqual(document.getElementById('discountCodeInput').value, 'A7K3M');
  });

  test('checkDiscountCode(): "Sjekk kode" button makes exactly one call and shows the result', async () => {
    onDiscountCodeInput('a7k3m');
    let calls = 0;
    window.fetch = (url) => {
      calls++;
      assert(String(url).includes('code=A7K3M'), 'expected the typed code in the validate request');
      return Promise.resolve(new Response(JSON.stringify({ valid: true, percent: 15 }), { status: 200 }));
    };
    await checkDiscountCode();
    assertEqual(calls, 1, 'one click must mean exactly one network call');
    const hint = document.getElementById('discountCodeHint');
    assert(hint.textContent.includes('15%'), `expected the percent in the hint, got "${hint.textContent}"`);
    assert(hint.classList.contains('fr-hint-ok'));
    assertEqual(discountCodeState, { code: 'A7K3M', valid: true, percent: 15 });
  });

  test('checkDiscountCode(): shows an error hint for an invalid/used code, without throwing', async () => {
    onDiscountCodeInput('zzzzz');
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ valid: false }), { status: 200 }));
    await checkDiscountCode();
    assert(document.getElementById('discountCodeHint').classList.contains('fr-hint-error'));
    assertEqual(discountCodeState.valid, false);
  });

  test('checkDiscountCode(): an incomplete code shows a hint without ever calling the network', async () => {
    onDiscountCodeInput('ab');
    window.fetch = () => { throw new Error('an incomplete code must not be sent to the server'); };
    await checkDiscountCode();
    assert(document.getElementById('discountCodeHint').classList.contains('fr-hint-error'));
  });

  test('editing the code after a successful check invalidates the cached result', () => {
    onDiscountCodeInput('a7k3m');
    discountCodeState = { code: 'A7K3M', valid: true, percent: 15 }; // simulate a prior successful check
    onDiscountCodeInput('a7k3x'); // customer changes a character
    assertEqual(discountCodeState, { code: '', valid: null, percent: null }, 'stale validation must not silently carry over to a different code');
  });

  // =========================================================================
  // Live totalpris - rabatt = totalt breakdown, so the customer sees the
  // discount actually apply to the price, not just a "✓ 15% rabatt" hint.
  // =========================================================================
  function setUpTwoPricedServices() {
    document.getElementById('serviceGrid').innerHTML = `
      <label><input type="checkbox" class="fr-service-checkbox" value="FreshRide Interior" data-price="500"></label>
      <label><input type="checkbox" class="fr-service-checkbox" value="FreshRide Exterior" data-price="300"></label>
    `;
    discountCodeState = { code: '', valid: null, percent: null };
  }

  test('price summary: hidden when no priced service is selected', () => {
    setUpTwoPricedServices();
    updateBookingPriceSummary();
    assert(document.getElementById('bookingPriceSummary').classList.contains('d-none'), 'expected the summary to stay hidden with nothing selected');
  });

  test('price summary: shows the plain total with no discount applied', () => {
    setUpTwoPricedServices();
    document.querySelector('.fr-service-checkbox[value="FreshRide Interior"]').checked = true;
    updateBookingPriceSummary();
    assert(!document.getElementById('bookingPriceSummary').classList.contains('d-none'));
    assertEqual(document.getElementById('bookingPriceTotal').textContent, 'kr 500');
    assertEqual(document.getElementById('bookingPriceFinal').textContent, 'kr 500');
    assert(document.getElementById('bookingPriceDiscountRow').classList.contains('d-none'), 'no discount row without a validated code');
  });

  test('price summary: lists each selected service with its own price above the total', () => {
    setUpTwoPricedServices();
    document.querySelector('.fr-service-checkbox[value="FreshRide Interior"]').checked = true;
    document.querySelector('.fr-service-checkbox[value="FreshRide Exterior"]').checked = true;
    updateBookingPriceSummary();
    const itemsText = document.getElementById('bookingPriceItems').textContent;
    assert(itemsText.includes('FreshRide Interior') && itemsText.includes('kr 500'), `expected Interior + its price in the breakdown, got "${itemsText}"`);
    assert(itemsText.includes('FreshRide Exterior') && itemsText.includes('kr 300'), `expected Exterior + its price in the breakdown, got "${itemsText}"`);
  });

  test('price summary: applies a validated discount as totalpris - rabatt = totalt', async () => {
    setUpTwoPricedServices();
    document.querySelector('.fr-service-checkbox[value="FreshRide Interior"]').checked = true;
    document.querySelector('.fr-service-checkbox[value="FreshRide Exterior"]').checked = true;
    onDiscountCodeInput('a7k3m');
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ valid: true, percent: 15 }), { status: 200 }));
    await checkDiscountCode();
    assertEqual(document.getElementById('bookingPriceTotal').textContent, 'kr 800', '500 + 300');
    assert(!document.getElementById('bookingPriceDiscountRow').classList.contains('d-none'));
    assertEqual(document.getElementById('bookingPriceDiscountValue').textContent, '-kr 120', '15% of 800, rounded');
    assertEqual(document.getElementById('bookingPriceFinal').textContent, 'kr 680', '800 - 120');
  });

  test('price summary: editing the code after a check reverts to the plain total', async () => {
    setUpTwoPricedServices();
    document.querySelector('.fr-service-checkbox[value="FreshRide Interior"]').checked = true;
    onDiscountCodeInput('a7k3m');
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ valid: true, percent: 15 }), { status: 200 }));
    await checkDiscountCode();
    assert(!document.getElementById('bookingPriceDiscountRow').classList.contains('d-none'), 'sanity: discount row visible after a valid check');

    onDiscountCodeInput('a7k3x'); // customer changes the code afterward
    assert(document.getElementById('bookingPriceDiscountRow').classList.contains('d-none'), 'discount row must hide once the validated code no longer matches what is typed');
    assertEqual(document.getElementById('bookingPriceFinal').textContent, 'kr 500', 'must fall back to the plain total, not keep the stale discounted one');
  });

  function setUpValidBookingForm() {
    document.getElementById('serviceGrid').innerHTML = '<label><input type="checkbox" class="fr-service-checkbox" value="FreshRide Interior" checked></label>';
    document.getElementById('name').value = 'Ola Testesen';
    document.getElementById('phone').value = '90000001';
    selected = { id: 'ev1', start: '2026-07-24T10:00:00Z', end: '2026-07-24T11:00:00Z' };
    discountCodeState = { code: '', valid: null, percent: null };
  }

  test('book(): a normal (non-time-request) booking shows the confirmed-booking toast with its code, not the pending wording', async () => {
    setUpValidBookingForm();
    document.getElementById('discountCodeInput').value = '';
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ ok: true, code: 'X1' }), { status: 200 }));
    await book();
    assert(document.getElementById('toastTitle').textContent.includes('booking'), 'expected the normal booking-confirmed title');
    assertEqual(document.getElementById('toastCode').textContent, 'Din bookingkode: X1');
    assert(document.getElementById('toastConfirmedBody').style.display === '', 'the full confirmed-booking details must show for a real booking');
  });

  test('book(): a blank discount code never triggers a validate call', async () => {
    setUpValidBookingForm();
    document.getElementById('discountCodeInput').value = '';
    let discountCheckCalled = false;
    window.fetch = (url) => {
      if (String(url).includes('discount-code')) discountCheckCalled = true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true, code: 'X1' }), { status: 200 }));
    };
    await book();
    assert(!discountCheckCalled, 'no discount code typed — must not call the validate endpoint at all');
  });

  test('book(): a code never checked via the button gets validated once here, then sent to book-slot', async () => {
    setUpValidBookingForm();
    document.getElementById('discountCodeInput').value = 'A7K3M'; // set directly — button never clicked
    let discountCheckCount = 0;
    let bookSlotBody = null;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes('discount-code')) {
        discountCheckCount++;
        assert(u.includes('code=A7K3M'), 'expected the typed code in the validate request');
        return Promise.resolve(new Response(JSON.stringify({ valid: true, percent: 15 }), { status: 200 }));
      }
      bookSlotBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, code: 'X1' }), { status: 200 }));
    };
    await book();
    assertEqual(discountCheckCount, 1, 'expected exactly one validate call for a complete code, not a live stream of them');
    assertEqual(bookSlotBody.discountCode, 'A7K3M', 'expected the validated code to be forwarded to book-slot.js');
  });

  test('book(): a code already confirmed via "Sjekk kode" is reused, no second network call', async () => {
    setUpValidBookingForm();
    document.getElementById('discountCodeInput').value = 'A7K3M';
    discountCodeState = { code: 'A7K3M', valid: true, percent: 15 }; // as if the button was already clicked
    let discountCheckCalled = false;
    let bookSlotBody = null;
    window.fetch = (url, opts) => {
      if (String(url).includes('discount-code')) { discountCheckCalled = true; return Promise.resolve(new Response(JSON.stringify({ valid: true, percent: 15 }), { status: 200 })); }
      bookSlotBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, code: 'X1' }), { status: 200 }));
    };
    await book();
    assert(!discountCheckCalled, 'already-verified code must not trigger a second validate call at submission');
    assertEqual(bookSlotBody.discountCode, 'A7K3M');
  });

  test('book(): an invalid/used code blocks the booking with an error, never reaches book-slot', async () => {
    setUpValidBookingForm();
    document.getElementById('discountCodeInput').value = 'ZZZZZ';
    let bookSlotCalled = false;
    window.fetch = (url) => {
      if (String(url).includes('discount-code')) return Promise.resolve(new Response(JSON.stringify({ valid: false }), { status: 200 }));
      bookSlotCalled = true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    await book();
    assert(!bookSlotCalled, 'an invalid code must stop the booking before it ever reaches book-slot.js');
    const hint = document.getElementById('discountCodeHint');
    assert(hint.classList.contains('fr-hint-error'), 'expected an error hint for an invalid/used code');
  });

  test('book(): a time request sends requestedDate/requestedTime with no eventId/start/end, and shows the pending-toast wording', async () => {
    document.getElementById('serviceGrid').innerHTML = '<label><input type="checkbox" class="fr-service-checkbox" value="FreshRide Interior" checked></label>';
    document.getElementById('name').value = 'Ola Testesen';
    document.getElementById('phone').value = '90000001';
    document.getElementById('discountCodeInput').value = '';
    selected = { isTimeRequest: true, requestedDate: '2026-07-27', requestedTime: '13:00' };
    discountCodeState = { code: '', valid: null, percent: null };
    let bookSlotBody = null;
    window.fetch = (url, opts) => {
      bookSlotBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, pending: true }), { status: 200 }));
    };
    await book();
    assertEqual(bookSlotBody.isTimeRequest, true);
    assertEqual(bookSlotBody.requestedDate, '2026-07-27');
    assertEqual(bookSlotBody.requestedTime, '13:00');
    assert(bookSlotBody.eventId === undefined, 'a time request has no calendar event to attach to');
    assert(bookSlotBody.start === undefined && bookSlotBody.end === undefined, 'the server computes the actual time — the client must not also send a guessed start/end');
    assert(document.getElementById('toastTitle').textContent.includes('sendt'), 'expected pending-request wording, not the normal booking-confirmed toast');
    assert(document.getElementById('toastConfirmedBody').style.display === 'none', 'the confirmed-booking-only details (address, Vipps, etc.) must not show for a still-pending request');
  });

  // =========================================================================
  // Services: Complete/Premium each cover Exterior+Interior and exclude each
  // other; Exterior and Interior can combine with each other but each is
  // exclusive within its own category (e.g. Interior vs Interior+); addons
  // are never touched.
  // =========================================================================
  function setupServiceGrid() {
    const grid = document.getElementById('serviceGrid');
    const services = [
      { label: 'FreshRide Complete', category: 'complete' },
      { label: 'FreshRide Premium', category: 'premium' },
      { label: 'FreshRide Exterior', category: 'exterior' },
      { label: 'FreshRide Interior', category: 'interior' },
      { label: 'FreshRide Interior+', category: 'interior' },
      { label: 'FreshRide Clay', category: 'addon' },
    ];
    grid.innerHTML = services.map(s => `
      <label class="fr-service-option">
        <input type="checkbox" class="fr-service-checkbox" value="${s.label}" data-price="0" data-category="${s.category}">
        <span class="fr-service-option-body"><span class="fr-service-option-top"><span class="fr-service-name">${s.label}</span></span></span>
      </label>
    `).join('');
    grid.querySelectorAll('.fr-service-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.fr-service-option').classList.toggle('fr-service-checked', cb.checked);
        updateServiceAvailability();
      });
    });
    updateServiceAvailability();
  }
  function checkSvc(label, val) {
    const cb = Array.from(document.querySelectorAll('.fr-service-checkbox')).find(c => c.value === label);
    cb.checked = val;
    cb.dispatchEvent(new Event('change'));
  }
  function svcDisabled(label) {
    return Array.from(document.querySelectorAll('.fr-service-checkbox')).find(c => c.value === label).disabled;
  }

  test('updateServiceAvailability: Complete blocks Premium/Exterior/Interior/Interior+, leaves addons free', () => {
    setupServiceGrid();
    checkSvc('FreshRide Complete', true);
    assertEqual(svcDisabled('FreshRide Premium'), true);
    assertEqual(svcDisabled('FreshRide Exterior'), true);
    assertEqual(svcDisabled('FreshRide Interior'), true);
    assertEqual(svcDisabled('FreshRide Interior+'), true);
    assertEqual(svcDisabled('FreshRide Clay'), false, 'addons must stay selectable regardless of what main category is chosen');
    assertEqual(svcDisabled('FreshRide Complete'), false, 'a checked box must never disable itself — needs to stay clickable to uncheck');
  });

  test('updateServiceAvailability: Premium blocks Complete/Exterior/Interior/Interior+ the same way', () => {
    setupServiceGrid();
    checkSvc('FreshRide Premium', true);
    assertEqual(svcDisabled('FreshRide Complete'), true);
    assertEqual(svcDisabled('FreshRide Exterior'), true);
    assertEqual(svcDisabled('FreshRide Interior'), true);
    assertEqual(svcDisabled('FreshRide Interior+'), true);
  });

  test('updateServiceAvailability: Exterior blocks Complete/Premium only — Interior stays combinable', () => {
    setupServiceGrid();
    checkSvc('FreshRide Exterior', true);
    assertEqual(svcDisabled('FreshRide Complete'), true);
    assertEqual(svcDisabled('FreshRide Premium'), true);
    assertEqual(svcDisabled('FreshRide Interior'), false, 'Exterior + Interior together is a valid combo');
    assertEqual(svcDisabled('FreshRide Interior+'), false);
  });

  test('updateServiceAvailability: Exterior + Interior together still blocks Complete/Premium, and Interior excludes Interior+', () => {
    setupServiceGrid();
    checkSvc('FreshRide Exterior', true);
    checkSvc('FreshRide Interior', true);
    assertEqual(svcDisabled('FreshRide Complete'), true);
    assertEqual(svcDisabled('FreshRide Premium'), true);
    assertEqual(svcDisabled('FreshRide Interior+'), true, 'Interior and Interior+ are alternative tiers of the same category — not stackable');
    assertEqual(svcDisabled('FreshRide Exterior'), false, 'still checked, must stay clickable to uncheck');
  });

  test('updateServiceAvailability: unchecking everything clears all disabled states', () => {
    setupServiceGrid();
    checkSvc('FreshRide Complete', true);
    checkSvc('FreshRide Complete', false);
    ['FreshRide Premium', 'FreshRide Exterior', 'FreshRide Interior', 'FreshRide Interior+', 'FreshRide Clay'].forEach(label => {
      assertEqual(svcDisabled(label), false, `${label} should be selectable again once nothing is checked`);
    });
  });

  window.fetch = origFetch;

  const results = [];
  for (const { name, fn } of testList) {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e.message });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter(r => r.pass).length,
    failed: results.filter(r => !r.pass).length,
    details: results,
  };
  console.log('booking-calendar.tests.js', summary);
  return summary;
})();
