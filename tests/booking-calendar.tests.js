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

  test('calendar: today is marked but not struck through', async () => {
    calendarViewYear = undefined; calendarViewMonth = undefined; // reset to "today"
    await loadMonthCalendar();
    const now = new Date();
    const todayCell = [...document.querySelectorAll('.fr-calendar-day')].find(c => c.classList.contains('fr-day-today'));
    assert(!!todayCell, 'today cell should exist (unless this week collapsed, which would be a different bug)');
    assert(!todayCell.classList.contains('fr-day-past'), 'today must not be struck through');
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
    await changeCalendarMonth(-1);
    assertEqual(document.getElementById('calendarPrevBtn').disabled, true);
  });

  test('regression guard: navigating before the current month is a no-op (can\'t book the past)', async () => {
    const before = document.getElementById('calendarMonthLabel').textContent;
    await changeCalendarMonth(-1); // already at the floor — must not go further back
    const after = document.getElementById('calendarMonthLabel').textContent;
    assertEqual(after, before, 'the public calendar must never navigate before the current month');
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

  test('success toast: mentions the completion SMS the customer will get later', () => {
    const text = document.getElementById('successToast').textContent;
    assert(text.includes('SMS') && text.includes('ferdig') && text.includes('henting'), `expected pickup-SMS notice in the toast, got "${text}"`);
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

  test('loadSlotsForDate: a day with zero open slots says "Fullbooket dag", not a generic empty message', async () => {
    weatherByDate = {};
    window.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    await loadSlotsForDate('2026-07-25');
    const noSlots = document.getElementById('noSlots');
    assert(!noSlots.classList.contains('d-none'), 'expected the empty state to show for a day with zero events');
    assert(noSlots.textContent.includes('Fullbooket dag'), `expected "Fullbooket dag" wording, got "${noSlots.textContent}"`);
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
