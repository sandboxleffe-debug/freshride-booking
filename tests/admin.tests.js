// tests/admin.tests.js
// Self-contained test suite for admin.html — paste this whole file's content
// into javascript_tool (action: javascript_exec) after navigating to
// http://localhost:<port>/admin.html. Returns a JSON summary; any entry with
// pass:false is a regression. Tests run strictly in registration order and
// share mutable state on purpose (mirrors how the page itself is used) —
// see tests/README.md for the full workflow.
(async function () {
  const testList = [];
  function test(name, fn) { testList.push({ name, fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${b}, got ${a}`);
  }

  // ---- Global stubs so dialogs/network calls never block the test run ----
  window.confirm = () => true;
  window.alert = (m) => { window.__lastAlert = m; };
  function svgDataUrl(color, label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="20" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }
  async function fakeJpegFile(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    canvas.getContext('2d').fillRect(0, 0, 100, 100);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
    return new File([blob], name, { type: 'image/jpeg' });
  }
  function fireTouch(type, el, x, y) {
    const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const ev = new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch],
      targetTouches: type === 'touchend' ? [] : [touch],
      bubbles: true, cancelable: true,
    });
    el.dispatchEvent(ev);
  }

  document.getElementById('loginView').classList.add('d-none');
  document.getElementById('adminView').classList.remove('d-none');

  // =========================================================================
  // Car auto-suggest from kunderegister (Jobblogg → Logg ny jobb)
  // =========================================================================
  test('car auto-suggest: fills car for an existing customer', () => {
    window._frJobs = [
      { id: 'j1', customer_number: '1', customer_name: 'Ola Nordmann', status: 'completed', job_date: '2026-06-01' },
      { id: 'j2', customer_number: '2', customer_name: 'Kari Nordmann', status: 'completed', job_date: '2026-06-01' },
    ];
    _frCustomerCarsMap = { '1': ['VW Golf, hvit', 'Tesla Model 3'], '2': ['Skoda Octavia'] };
    populateCustomerDropdown();
    const select = document.getElementById('jobCustomerSelect');
    const carType = document.getElementById('jobCarType');

    select.value = '1'; onCustomerSelectChange();
    assertEqual(carType.value, 'VW Golf, hvit', 'suggests first registered car');
  });

  test('car auto-suggest: updates suggestion when switching between existing customers', () => {
    const select = document.getElementById('jobCustomerSelect');
    const carType = document.getElementById('jobCarType');
    select.value = '2'; onCustomerSelectChange();
    assertEqual(carType.value, 'Skoda Octavia');
  });

  test('car auto-suggest: "+ Ny kunde" clears a previous suggestion', () => {
    const select = document.getElementById('jobCustomerSelect');
    const carType = document.getElementById('jobCarType');
    select.value = '__new__'; onCustomerSelectChange();
    assertEqual(carType.value, '', 'new customer has no registered car — field must clear');
  });

  test('car auto-suggest: never overwrites a manually typed value', () => {
    const select = document.getElementById('jobCustomerSelect');
    const carType = document.getElementById('jobCarType');
    select.value = '1'; onCustomerSelectChange();
    carType.value = 'Manuelt endret av William';
    select.value = '2'; onCustomerSelectChange();
    assertEqual(carType.value, 'Manuelt endret av William', 'manual edit must survive a customer switch');
    select.value = '__new__'; onCustomerSelectChange();
    assertEqual(carType.value, 'Manuelt endret av William', 'manual edit must survive switching to new customer too');
  });

  // =========================================================================
  // Photo pairs (job edit modal)
  // =========================================================================
  test('photo pairs: renders filled and empty slots correctly', () => {
    const job = {
      id: 'jobX',
      photoPairs: [
        { before: { path: 'a', url: svgDataUrl('#8B0000', 'FOR') }, after: { path: 'b', url: svgDataUrl('#2E7D32', 'ETTER') } },
        { before: { path: 'c', url: svgDataUrl('#8B0000', 'FOR2') }, after: null },
      ],
    };
    renderPhotoPairs(job);
    const box = document.getElementById('editJobPhotoPairs');
    const filled = box.querySelectorAll('.fr-photo-pair-filled');
    const empty = box.querySelectorAll('.fr-photo-pair-empty');
    assertEqual(filled.length, 3, 'pair 1 has 2 filled slots, pair 2 has 1');
    assertEqual(empty.length, 1, 'pair 2 has 1 empty (after) slot');
  });

  test('photo pairs: addEmptyPhotoPair guards against a duplicate trailing empty pair', () => {
    window._frJobs = [{ id: 'jobX', photoPairs: [{ before: null, after: null }] }];
    editingJobId = 'jobX';
    const job = window._frJobs[0];
    addEmptyPhotoPair();
    assertEqual(job.photoPairs.length, 1, 'must not add a second empty pair while one is already waiting');
  });

  test('photo pairs: upload sends the correct action/pairIndex/side payload', async () => {
    window._frJobs = [{ id: 'jobY', photoPairs: [] }];
    editingJobId = 'jobY';
    const file = await fakeJpegFile('photo.jpg');

    let capturedBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (String(url).includes('resource=jobs') && opts && opts.body) {
        const body = JSON.parse(opts.body);
        if (body.action === 'upload-pair-photo') capturedBody = body;
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, pairs: [] }), { status: 200 }));
    };
    try {
      await uploadPairPhoto(-1, 'before', { files: [file] });
    } finally {
      window.fetch = origFetch;
    }

    assert(!!capturedBody, 'expected an upload-pair-photo request to have been sent');
    assertEqual(capturedBody.action, 'upload-pair-photo');
    assertEqual(capturedBody.side, 'before');
    assertEqual(capturedBody.jobId, 'jobY');
    assertEqual(capturedBody.pairIndex, -1);
    assert(typeof capturedBody.imageBase64 === 'string' && capturedBody.imageBase64.length > 0, 'expected non-empty base64 payload');
  });

  test('photo pairs: delete-whole-pair sends clearWholePair:true', async () => {
    editingJobId = 'jobZ';
    let capturedBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (opts && opts.body) capturedBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, pairs: [] }), { status: 200 }));
    };
    try {
      await deletePhotoPair(0);
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(capturedBody.action, 'delete-pair-photo');
    assertEqual(capturedBody.pairIndex, 0);
    assertEqual(capturedBody.clearWholePair, true);
  });

  // =========================================================================
  // "Vis under referanser" checkbox — must read photoPairs, not the old flat columns
  // =========================================================================
  test('reference checkbox: enabled when a complete pair exists', () => {
    updateJobReferenceCheckboxState({ photoPairs: [{ before: { path: 'a' }, after: { path: 'b' } }] });
    assertEqual(document.getElementById('editJobShowReference').disabled, false);
  });

  test('reference checkbox: disabled when no pair is complete', () => {
    updateJobReferenceCheckboxState({ photoPairs: [{ before: { path: 'a' }, after: null }] });
    assertEqual(document.getElementById('editJobShowReference').disabled, true);
    assertEqual(document.getElementById('editJobShowReference').checked, false);
  });

  test('reference checkbox: disabled when photoPairs is empty/missing', () => {
    updateJobReferenceCheckboxState({});
    assertEqual(document.getElementById('editJobShowReference').disabled, true);
  });

  // =========================================================================
  // Tab switching — slide direction + swipe gesture
  // =========================================================================
  test('showTab: applies fr-tab-slide-right when moving forward in FR_TAB_ORDER', () => {
    showTab('overview');
    showTab('services'); // overview(0) -> services(2): forward
    const panel = document.getElementById('tab-services');
    assert(panel.classList.contains('fr-tab-slide-right'), 'expected forward slide class');
  });

  test('showTab: applies fr-tab-slide-left when moving backward in FR_TAB_ORDER', () => {
    showTab('services');
    showTab('overview'); // services(2) -> overview(0): backward
    const panel = document.getElementById('tab-overview');
    assert(panel.classList.contains('fr-tab-slide-left'), 'expected backward slide class');
  });

  test('swipe gesture: swiping left on the wrap moves to the next tab', () => {
    showTab('accounting');
    const wrap = document.querySelector('.fr-admin-wrap');
    fireTouch('touchstart', wrap, 600, 400);
    fireTouch('touchmove', wrap, 500, 400);
    fireTouch('touchmove', wrap, 400, 400);
    fireTouch('touchend', wrap, 400, 400);
    assertEqual(document.querySelector('.fr-tab-btn.active').dataset.tab, 'customers');
  });

  test('swipe gesture: swiping right on the wrap moves to the previous tab', () => {
    const wrap = document.querySelector('.fr-admin-wrap');
    fireTouch('touchstart', wrap, 300, 400);
    fireTouch('touchmove', wrap, 400, 400);
    fireTouch('touchmove', wrap, 500, 400);
    fireTouch('touchend', wrap, 500, 400);
    assertEqual(document.querySelector('.fr-tab-btn.active').dataset.tab, 'accounting');
  });

  test('swipe gesture: a vertical drag does not change tabs', () => {
    const wrap = document.querySelector('.fr-admin-wrap');
    const before = document.querySelector('.fr-tab-btn.active').dataset.tab;
    fireTouch('touchstart', wrap, 300, 300);
    fireTouch('touchmove', wrap, 305, 400);
    fireTouch('touchmove', wrap, 310, 500);
    fireTouch('touchend', wrap, 310, 500);
    assertEqual(document.querySelector('.fr-tab-btn.active').dataset.tab, before);
  });

  test('swipe gesture: a drag starting on the job-size gauge does not change tabs', () => {
    const before = document.querySelector('.fr-tab-btn.active').dataset.tab;
    const gaugeTrack = document.getElementById('jobSizeGaugeTrack');
    fireTouch('touchstart', gaugeTrack, 200, 800);
    fireTouch('touchmove', gaugeTrack, 400, 800);
    fireTouch('touchend', gaugeTrack, 500, 800);
    assertEqual(document.querySelector('.fr-tab-btn.active').dataset.tab, before);
  });

  // =========================================================================
  // Oversikt month calendar — navigation + past-day strikethrough
  // =========================================================================
  test('calendar: today is marked but not struck through; earlier days in the week are', async () => {
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));
    calendarViewYear = undefined; calendarViewMonth = undefined; // reset to "today" on next load
    await loadMonthCalendar();
    const now = new Date();
    const cells = [...document.querySelectorAll('.fr-admin-cal-day')];
    const todayCell = cells.find(c => c.classList.contains('fr-admin-cal-day-today'));
    assert(!!todayCell, 'today cell should exist');
    assert(!todayCell.classList.contains('fr-admin-cal-day-past'), 'today must not be struck through');
    if (now.getDate() > 1) {
      const yesterday = cells.find(c => c.textContent.trim() === String(now.getDate() - 1) && !c.classList.contains('fr-admin-cal-day-empty'));
      if (yesterday) assert(yesterday.classList.contains('fr-admin-cal-day-past'), 'yesterday must be marked past');
    }
  });

  test('calendar: changeCalendarMonth(1) advances the label to next month', async () => {
    const before = document.getElementById('calendarMonthLabel').textContent;
    await changeCalendarMonth(1);
    const after = document.getElementById('calendarMonthLabel').textContent;
    assert(after !== before, `label should change from "${before}"`);
    await changeCalendarMonth(-1); // reset for any later manual poking
  });

  // =========================================================================
  // Gallery grid — no description field, ordering controls present
  // =========================================================================
  test('gallery: renders a thumb + move/delete controls per image, no alt input', () => {
    window._frGalleryImages = [
      { id: 'g1', path: svgDataUrl('#8B0000', 'A'), alt: '' },
      { id: 'g2', path: svgDataUrl('#2E7D32', 'B'), alt: '' },
    ];
    renderGalleryList();
    const rows = document.querySelectorAll('#galleryList .fr-gallery-admin-row');
    assertEqual(rows.length, 2);
    assertEqual(document.querySelectorAll('#galleryList .fr-gallery-admin-alt').length, 0, 'description input must be gone');
    assertEqual(document.querySelectorAll('#galleryList img.fr-gallery-admin-thumb').length, 2);
  });

  // ---- Run sequentially, in order, and collect results ----
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
  console.log('admin.tests.js', summary);
  return summary;
})();
