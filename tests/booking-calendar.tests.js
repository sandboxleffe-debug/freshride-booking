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
