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
