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

  test('icons: Lucide loaded and frIcon() renders real SVG content for every mapped name', () => {
    assert(typeof window.lucide === 'object', 'Lucide failed to load from CDN');
    const missing = Object.keys(FR_ICON_MAP).filter(name => !frIcon(name).includes('<svg'));
    assertEqual(missing, [], `frIcon() returned empty output for: ${missing.join(', ')}`);
  });

  test('login screen: shows the FreshRide logo', () => {
    const img = document.querySelector('#loginView .fr-login-logo');
    assert(!!img, 'expected an .fr-login-logo image on the login screen');
    assert(img.getAttribute('src').includes('freshride-logo'), `unexpected logo src: ${img.getAttribute('src')}`);
  });

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

  // =========================================================================
  // Login: loading bar shows while verifying, hides after (success or fail)
  // =========================================================================
  test('login: shows the loading bar while pending and hides it afterward', async () => {
    document.getElementById('loginView').classList.remove('d-none');
    document.getElementById('adminView').classList.add('d-none');
    document.getElementById('pw').value = 'whatever';
    const origFetch = window.fetch;
    let resolveFetch;
    window.fetch = () => new Promise(r => { resolveFetch = r; });
    const loginPromise = login();
    await new Promise(r => setTimeout(r, 0)); // let login() reach its await
    const bar = document.getElementById('loginLoadingBar');
    const btn = document.getElementById('loginBtn');
    assert(!bar.classList.contains('d-none'), 'loading bar should be visible while the fetch is pending');
    assert(btn.disabled, 'login button should be disabled while pending');
    resolveFetch(new Response(JSON.stringify({}), { status: 401 }));
    await loginPromise;
    assert(bar.classList.contains('d-none'), 'loading bar should hide once the request settles');
    assertEqual(btn.disabled, false, 'button should re-enable once the request settles');
    window.fetch = origFetch;
    document.getElementById('loginView').classList.add('d-none');
    document.getElementById('adminView').classList.remove('d-none');
  });

  // =========================================================================
  // Oversikt: completed-projects section between Bookinger and Ledige tider
  // =========================================================================
  test('oversikt: "Ledige tider" shows only 3 before "vis flere"', () => {
    window._frJobs = [];
    const el = document.getElementById('list');
    el.innerHTML = `<div id="listBookedSection"></div><div id="listCompletedSection"></div><div id="listOpenSection"></div>`;
    const openItems = Array.from({ length: 7 }, (_, i) => ({ start: `2026-07-${10 + i}T10:00:00Z` }));
    listOpenShown = LIST_OPEN_PAGE_SIZE;
    window._frListOpen = openItems;
    renderListSection('listOpenSection', openItems, 'open');
    const rows = document.querySelectorAll('#listOpenSection .fr-list-row');
    assertEqual(rows.length, 3, 'should show exactly 3 open slots before expanding');
    assert(!!document.querySelector('#listOpenSection .fr-list-more-btn'), 'expected a "vis flere" button');
  });

  test('oversikt: renderCompletedSection() shows recent completed jobs, sorted newest first', () => {
    const el = document.getElementById('list');
    el.innerHTML = `<div id="listBookedSection"></div><div id="listCompletedSection"></div><div id="listOpenSection"></div>`;
    window._frJobs = [
      { id: 'd1', status: 'draft', job_date: '2026-07-20', customer_name: 'Kladd' },
      { id: 'j1', status: 'completed', job_date: '2026-07-10', customer_name: 'Eldst', price_paid: 100 },
      { id: 'j2', status: 'completed', job_date: '2026-07-15', customer_name: 'Nyest', price_paid: 200 },
    ];
    renderCompletedSection();
    const names = Array.from(document.querySelectorAll('#listCompletedSection .fr-list-row-name')).map(el => el.textContent.trim());
    assert(names[0].includes('Nyest') && names[1].includes('Eldst'), `draft jobs excluded, newest completed job first, got ${JSON.stringify(names)}`);
  });

  test('renderCompletedSection: shows the total income of the visible rows', () => {
    const el = document.getElementById('list');
    el.innerHTML = `<div id="listBookedSection"></div><div id="listCompletedSection"></div><div id="listOpenSection"></div>`;
    window._frJobs = [
      { id: 't1', status: 'completed', job_date: '2026-07-10', customer_name: 'A', price_paid: 100 },
      { id: 't2', status: 'completed', job_date: '2026-07-11', customer_name: 'B', price_paid: 250 },
    ];
    renderCompletedSection();
    const total = document.querySelector('#listCompletedSection .fr-list-section-total');
    assert(!!total, 'expected a total sum element');
    assert(total.textContent.includes('350'), `expected the sum of visible rows (350), got "${total.textContent}"`);
  });

  test('renderCompletedSection: groups jobs into the same week under one divider, separate weeks get their own', () => {
    const el = document.getElementById('list');
    el.innerHTML = `<div id="listBookedSection"></div><div id="listCompletedSection"></div><div id="listOpenSection"></div>`;
    window._frJobs = [
      { id: 'w1', status: 'completed', job_date: '2026-07-24', customer_name: 'Fredag', price_paid: 100 }, // week Mon20-Sun26 jul
      { id: 'w2', status: 'completed', job_date: '2026-07-22', customer_name: 'Onsdag', price_paid: 100 }, // same week
      { id: 'w3', status: 'completed', job_date: '2026-07-15', customer_name: 'ForrigeUke', price_paid: 100 }, // week Mon13-Sun19 jul
    ];
    renderCompletedSection();
    const dividers = document.querySelectorAll('#listCompletedSection .fr-week-divider');
    assertEqual(dividers.length, 2, 'expected exactly 2 week dividers for jobs spanning 2 distinct weeks');
    // Both same-week jobs must sit inside the first divider's group, i.e. before the second divider in DOM order.
    const container = document.getElementById('listCompletedSection');
    const children = Array.from(container.children);
    const firstDividerIdx = children.indexOf(dividers[0]);
    const secondDividerIdx = children.indexOf(dividers[1]);
    assert(secondDividerIdx - firstDividerIdx === 3, 'expected exactly the 2 same-week rows between the two dividers (divider + 2 rows before the next divider)');
  });

  test('oversikt: completed rows show a green checkmark + green border, and the total of the visible ones', () => {
    const el = document.getElementById('list');
    el.innerHTML = `<div id="listBookedSection"></div><div id="listCompletedSection"></div><div id="listOpenSection"></div>`;
    window._frJobs = [
      { id: 'j3', status: 'completed', job_date: '2026-07-10', customer_name: 'Eldst', price_paid: 100 },
      { id: 'j4', status: 'completed', job_date: '2026-07-15', customer_name: 'Nyest', price_paid: 200 },
    ];
    renderCompletedSection();
    const rows = document.querySelectorAll('#listCompletedSection .fr-list-row-completed');
    assertEqual(rows.length, 2, 'expected both completed rows to carry the green-border class');
    assert(!!rows[0].querySelector('.fr-completed-check svg'), 'expected a checkmark icon on each completed row');
    const label = document.querySelector('#listCompletedSection .fr-list-section-label');
    assert(label.innerHTML.includes('kr 300'), `expected the total of the visible completed jobs (100+200), got "${label.innerHTML}"`);
  });

  test('bookedRowHtml: shows the service with a matching icon, and an orange upcoming-border class', () => {
    const html = bookedRowHtml({ start: '2026-07-24T10:00:00Z', name: 'Ola Testesen', phone: '90000001', car: 'VW Golf', services: 'FreshRide Complete', code: 'T01' });
    assert(html.includes('fr-list-row-upcoming'), 'expected the orange booked-not-completed border class');
    assert(html.includes('fr-booked-service'), 'expected the service to be shown in its own highlighted element');
    assert(html.includes('<svg'), 'expected a service icon rendered alongside the service name');
  });

  // =========================================================================
  // Admin calendar: collapse fully-past weeks (matches public calendar)
  // =========================================================================
  test('calendar: a fully-past week collapses into a single bar', async () => {
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ days: {} }), { status: 200 }));
    const now = new Date();
    // View a month that's fully in the past relative to "today" if we're not
    // in January, otherwise skip (no fully-past month available to force this).
    if (now.getMonth() > 0) {
      calendarViewYear = now.getFullYear();
      calendarViewMonth = now.getMonth(); // previous month, guaranteed fully past
      await loadMonthCalendar();
      const bars = document.querySelectorAll('.fr-admin-cal-week-collapsed');
      assert(bars.length > 0, 'expected at least one collapsed week bar in a fully-past month');
    }
    calendarViewYear = undefined; calendarViewMonth = undefined;
    await loadMonthCalendar();
  });

  // =========================================================================
  // Besøkende i dag: gridlines, total, click-for-value, GA link
  // =========================================================================
  test('visitor chart: renders gridlines, total, and updates value on bar click', () => {
    const days = [
      { date: '20260710', visitors: 5 },
      { date: '20260711', visitors: 10 },
      { date: '20260712', visitors: 3 },
      { date: '20260713', visitors: 8 },
      { date: '20260714', visitors: 20 },
      { date: '20260715', visitors: 1 },
      { date: '20260716', visitors: 12 },
    ];
    renderGaWeekChart(days);
    const wrap = document.getElementById('gaWeekChart');
    assertEqual(wrap.querySelectorAll('.fr-ga-gridline').length, 2, 'expected two gridlines (max + half-max)');
    assertEqual(wrap.querySelectorAll('.fr-ga-bar-col').length, 7);
    assertEqual(document.getElementById('gaWeekTotal').textContent, `${5+10+3+8+20+1+12} siste 7 dager`);

    const firstBar = wrap.querySelector('.fr-ga-bar-col');
    firstBar.click();
    assert(firstBar.classList.contains('fr-ga-bar-active'), 'clicked bar should be marked active');
    assert(document.getElementById('gaChartSelectedValue').textContent.includes('5 besøkende'), 'expected the clicked day\'s visitor count to be shown');
  });

  test('visitor chart: GA icon link updates from propertyId', async () => {
    const origFetch = window.fetch;
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({
      todayVisitors: 3, todayPageViews: 9, yesterdayVisitors: 2, yesterdayPageViews: 5,
      last7Days: [{ date: '20260716', visitors: 3 }], propertyId: '123456789',
    }), { status: 200 }));
    await loadAnalyticsSummary();
    window.fetch = origFetch;
    assert(document.getElementById('gaLink').href.includes('123456789'), 'GA link should deep-link using the returned propertyId');
  });

  // =========================================================================
  // Phone fields: digits-only, max 8 characters
  // =========================================================================
  test('phone fields: strip non-digits and cap at 8 characters on input', () => {
    const ids = ['editPhone', 'editJobCustomerPhone', 'custEditPhone', 'testSmsPhoneInput'];
    for (const id of ids) {
      const el = document.getElementById(id);
      assert(!!el, `expected #${id} to exist`);
      el.value = '92-13 39 001abc';
      el.dispatchEvent(new Event('input'));
      assertEqual(el.value, '92133900', `#${id} should strip non-digits and cap at 8 chars`);
    }
  });

  // =========================================================================
  // Bookinger list: shows car info when the overview API supplies it
  // (calendar events themselves never store car — see admin-overview.js)
  // =========================================================================
  test('bookedRowHtml: includes the car when present, omits it when absent', () => {
    const withCar = bookedRowHtml({ start: '2026-07-24T10:00:00Z', name: 'Ola Testesen', phone: '90000001', car: 'VW Golf', services: 'FreshRide Interior', code: 'T01' });
    assert(withCar.includes('VW Golf'), 'expected the car to appear in the row when present');
    const withoutCar = bookedRowHtml({ start: '2026-07-24T10:00:00Z', name: 'Kari Testesen', phone: '', car: null, services: 'FreshRide Complete', code: null });
    assert(!withoutCar.includes('null'), 'a missing car must not leak the literal "null" into the row');
  });

  // =========================================================================
  // Kunderegister: multi-line detail rows instead of one long meta line
  // =========================================================================
  test('kunderegister: phone/car/job count render as separate detail lines', () => {
    window._frJobs = [
      { id: 'j1', customer_number: '9', customer_name: 'Multi Linje', customer_phone: '92133900', status: 'completed', job_date: '2026-07-01' },
    ];
    _frCustomerCarsMap = { '9': ['Volvo V60'] };
    renderCustomersAdmin();
    const row = Array.from(document.querySelectorAll('.fr-customer-row')).find(r => r.textContent.includes('Multi Linje'));
    assert(!!row, 'expected a customer row for Multi Linje');
    const details = row.querySelectorAll('.fr-customer-row-detail');
    assertEqual(details.length, 3, 'expected phone, car, and job-count as separate lines');
    assert(details[0].textContent.includes('92133900'));
    assert(details[1].textContent.includes('Volvo V60'));
    assert(details[2].textContent.includes('jobb'));
  });

  // =========================================================================
  // Kunderegister: per-customer avatar picker (choose between two portraits
  // or fall back to the colored-initials circle)
  // =========================================================================
  test('customerAvatarHtml: renders chosen portrait, falls back to initials when unset', () => {
    window._frJobs = [
      { id: 'a1', customer_number: '20', customer_name: 'Avatar Testesen', customer_phone: '90000020', status: 'completed', job_date: '2026-07-01' },
      { id: 'a2', customer_number: '21', customer_name: 'Uten Bilde', customer_phone: '90000021', status: 'completed', job_date: '2026-07-01' },
    ];
    _frCustomerCarsMap = {};
    _frCustomerAvatarMap = { '20': 'avatar-2' };
    renderCustomersAdmin();
    const rowWith = Array.from(document.querySelectorAll('.fr-customer-row')).find(r => r.textContent.includes('Avatar Testesen'));
    const rowWithout = Array.from(document.querySelectorAll('.fr-customer-row')).find(r => r.textContent.includes('Uten Bilde'));
    assert(!!rowWith && !!rowWithout, 'expected both customer rows to render');
    const img = rowWith.querySelector('.fr-customer-avatar-img img');
    assert(!!img && img.getAttribute('src') === 'assets/avatar-2.png', 'expected customer 20 to render the chosen avatar-2 image');
    assert(!rowWithout.querySelector('.fr-customer-avatar-img'), 'expected customer 21 (no avatar set) to fall back to the initials circle');
  });

  test('avatar picker: 3 options in edit modal, click selects it and save PATCHes it', async () => {
    window._frJobs = [
      { id: 'a3', customer_number: '22', customer_name: 'Picker Testesen', customer_phone: '90000022', status: 'completed', job_date: '2026-07-01' },
    ];
    _frCustomerCarsMap = { '22': ['Skoda Octavia'] };
    _frCustomerAvatarMap = {};
    openCustomerEdit('22');
    const picker = document.getElementById('custEditAvatarPicker');
    const opts = picker.querySelectorAll('.fr-avatar-option');
    assertEqual(opts.length, 3, 'expected initials + avatar-1 + avatar-2 as the 3 picker options');
    assert(opts[0].classList.contains('selected'), 'the initials/"none" option should show as selected when no avatar is chosen yet');

    opts[1].click();
    assert(picker.querySelectorAll('.fr-avatar-option')[1].classList.contains('selected'), 'clicking avatar-1 should mark it selected');

    const origFetch = window.fetch;
    let sentBody = null;
    window.fetch = (url, opts) => {
      if (String(url).includes('customer-cars') && opts && opts.method === 'PATCH') sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    try {
      await saveCustomerEditModal();
    } finally {
      window.fetch = origFetch;
    }
    assert(!!sentBody, 'expected the customer-cars PATCH to fire on save');
    assertEqual(sentBody.avatar, 'avatar-1', 'expected the selected avatar key to be sent in the PATCH body');
  });

  // =========================================================================
  // Kunderegister is the master source for car spelling — correcting a car
  // there must cascade to every job of that customer carrying the old spelling
  // =========================================================================
  test('saveCustomerEditModal: detects a corrected car spelling and sends it as a carRenames entry', async () => {
    window._frJobs = [
      { id: 'r1', customer_number: '30', customer_name: 'Rename Testesen', customer_phone: '90000030', status: 'completed', job_date: '2026-07-01' },
    ];
    _frCustomerCarsMap = { '30': ['VW golf, kvit'] };
    _frCustomerAvatarMap = {};
    openCustomerEdit('30');
    const carInput = document.querySelector('#custEditCarsList .fr-cust-car-input');
    carInput.value = 'VW Golf, hvit';

    const origFetch = window.fetch;
    let sentBody = null;
    window.fetch = (url, opts) => {
      if (String(url).includes('customer-cars') && opts && opts.method === 'PATCH') sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    try {
      await saveCustomerEditModal();
    } finally {
      window.fetch = origFetch;
    }
    assert(!!sentBody, 'expected the customer-cars PATCH to fire on save');
    assertEqual(sentBody.carRenames, [{ from: 'VW golf, kvit', to: 'VW Golf, hvit' }], 'expected the position-aligned text change to be reported as a rename');
  });

  test('saveCustomerEditModal: adding a new car (no prior entry at that index) is not treated as a rename', async () => {
    window._frJobs = [
      { id: 'r2', customer_number: '31', customer_name: 'Ny Bil Testesen', customer_phone: '90000031', status: 'completed', job_date: '2026-07-01' },
    ];
    _frCustomerCarsMap = { '31': ['Skoda Octavia'] };
    _frCustomerAvatarMap = {};
    openCustomerEdit('31');
    addCustomerCarRow();
    const inputs = document.querySelectorAll('#custEditCarsList .fr-cust-car-input');
    inputs[1].value = 'Tesla Model Y';

    const origFetch = window.fetch;
    let sentBody = null;
    window.fetch = (url, opts) => {
      if (String(url).includes('customer-cars') && opts && opts.method === 'PATCH') sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    try {
      await saveCustomerEditModal();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody.carRenames, [], 'a brand-new second car must not be reported as a rename of the first');
    assertEqual(sentBody.cars, ['Skoda Octavia', 'Tesla Model Y']);
  });

  // =========================================================================
  // Rabattkoder: generate/list in Innstillinger, badges on discounted jobs
  // =========================================================================
  test('loadDiscountCodesAdmin: renders unused and used codes with distinct status text', async () => {
    const origFetch = window.fetch;
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({
      codes: [
        { code: 'A7K3M', percent: 15, used: false, used_at: null, used_by_customer_number: null },
        { code: 'ZZ111', percent: 20, used: true, used_at: '2026-07-01', used_by_customer_number: '9' },
      ],
    }), { status: 200 }));
    try {
      await loadDiscountCodesAdmin();
    } finally {
      window.fetch = origFetch;
    }
    const rows = document.querySelectorAll('#discountCodeList .fr-service-row');
    assertEqual(rows.length, 2);
    assert(rows[0].textContent.includes('Ikke brukt'), 'unused code should say "Ikke brukt"');
    assert(!!rows[0].querySelector('button'), 'an unused code should offer a delete button');
    assert(rows[1].textContent.includes('Brukt'), 'used code should say "Brukt"');
    assert(!rows[1].querySelector('button'), 'a used code must not be deletable');
  });

  test('generateDiscountCode: sends the gauge percent and shows the returned code', async () => {
    setGaugeValue('discount', 'discountPct', 25);
    const origFetch = window.fetch;
    let sentBody = null;
    window.fetch = (url, opts) => {
      if (String(url).includes('discount-codes') && opts && opts.method === 'POST') {
        sentBody = JSON.parse(opts.body);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, code: 'Q9F2X', percent: 25 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ codes: [] }), { status: 200 }));
    };
    try {
      await generateDiscountCode();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody, { percent: 25 });
    const msg = document.getElementById('discountCodeMsg');
    assert(msg.textContent.includes('Q9F2X'), `expected the generated code in the message, got "${msg.textContent}"`);
  });

  // =========================================================================
  // Test SMS til kunder — lets William preview the exact current wording of
  // every customer-facing SMS from his own phone, whenever it changes.
  // =========================================================================
  test('sendTestBookingSms: sends the send-test-booking-sms action with the typed phone', async () => {
    document.getElementById('testSmsPhoneInput').value = '92133900';
    let sentBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, message: 'x' }), { status: 200 }));
    };
    try {
      await sendTestBookingSms();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody, { action: 'send-test-booking-sms', phone: '92133900' });
    assert(document.getElementById('testSmsMsg').textContent.includes('sendt'), 'expected a success message');
  });

  test('sendTestCompletionSms: sends the send-test-completion-sms action with the typed phone', async () => {
    document.getElementById('testSmsPhoneInput').value = '92133900';
    let sentBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, message: 'x' }), { status: 200 }));
    };
    try {
      await sendTestCompletionSms();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody, { action: 'send-test-completion-sms', phone: '92133900' });
  });

  test('sendTestBookingSms: a blank phone shows an error without ever calling the network', async () => {
    document.getElementById('testSmsPhoneInput').value = '';
    window.fetch = () => { throw new Error('must not call the network with a blank phone'); };
    await sendTestBookingSms();
    assert(document.getElementById('testSmsMsg').classList.contains('err'), 'expected an error message for a blank phone');
  });

  test('sendTestThanksSms: sends the send-test-thanks-sms action with the typed phone', async () => {
    document.getElementById('testSmsPhoneInput').value = '92133900';
    let sentBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, message: 'x' }), { status: 200 }));
    };
    try {
      await sendTestThanksSms();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody, { action: 'send-test-thanks-sms', phone: '92133900' });
  });

  // =========================================================================
  // "Send takk" — for jobs William already closed out with the customer
  // outside SMS. Same completion_sms_sent_at bookkeeping as the full
  // "jobben er ferdig" SMS, so the VIKTIG MELDING reminder still clears.
  // =========================================================================
  test('sendThanksSms: sends send-thanks-sms and records completion_sms_sent_at like the full completion SMS', async () => {
    window._frJobs = [{ id: 'jThanks1', customer_name: 'Takk Testesen', customer_phone: '90000010', booking_code: 'X10', completion_sms_sent_at: null, completion_notice_dismissed: false }];
    editingJobId = 'jThanks1';
    renderJobSmsStatus(window._frJobs[0]);
    assert(!document.getElementById('editJobThanksBtn').disabled, 'thanks button should be enabled when the customer has a phone');

    window.confirm = () => true;
    let sentBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, sentAt: '2026-07-24T12:00:00Z' }), { status: 200 }));
    };
    try {
      await sendThanksSms();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody, { action: 'send-thanks-sms', jobId: 'jThanks1' });
    assertEqual(window._frJobs[0].completion_sms_sent_at, '2026-07-24T12:00:00Z', 'expected the same field the full completion SMS uses, so the reminder system stays consistent');
    assert(document.getElementById('editJobSmsStatus').textContent.includes('Varslet'), 'expected the shared notified status to update');
  });

  test('sendThanksSms/sendCompletionSms: both buttons disable when the customer has no phone', () => {
    renderJobSmsStatus({ customer_phone: null, completion_sms_sent_at: null });
    assert(document.getElementById('editJobSmsBtn').disabled, 'ferdig-SMS button must disable with no phone');
    assert(document.getElementById('editJobThanksBtn').disabled, 'takk-SMS button must disable with no phone');
  });

  test('openJobEdit: shows the discount badge with code and percent when the job has one', () => {
    window._frJobs = [
      { id: 'disc1', customer_name: 'Rabatt Testesen', job_date: '2026-07-01', status: 'draft', discount_code: 'A7K3M', discount_percent: 15 },
      { id: 'disc2', customer_name: 'Ingen Rabatt', job_date: '2026-07-01', status: 'draft' },
    ];
    openJobEdit('disc1');
    const badge = document.getElementById('editJobDiscountBadge');
    assert(!badge.classList.contains('d-none'), 'expected the discount badge to be visible');
    assert(badge.textContent.includes('A7K3M') && badge.textContent.includes('15%'), `expected code+percent in badge, got "${badge.textContent}"`);

    openJobEdit('disc2');
    assert(document.getElementById('editJobDiscountBadge').classList.contains('d-none'), 'a job with no discount must hide the badge');
  });

  test('buildJobRow: shows a discount flag on the compact row when the job has a discount', () => {
    const withDiscount = buildJobRow({ id: 'd1', customer_name: 'Rabatt Testesen', job_date: '2026-07-01', price_paid: 500, discount_code: 'A7K3M', discount_percent: 15 }, false);
    assert(!!withDiscount.querySelector('.fr-campaign-badge[title*="A7K3M"]'), 'expected a discount flag mentioning the code');

    const withoutDiscount = buildJobRow({ id: 'd2', customer_name: 'Ingen Rabatt', job_date: '2026-07-01', price_paid: 500 }, false);
    assert(!withoutDiscount.querySelector('.fr-campaign-badge[title*="A7K3M"]'), 'a job without a discount must not show the flag');
  });

  // =========================================================================
  // Discount code auto-adjusts the suggested price, like an active campaign
  // (only for a still-priceless draft — never overwrites an already-priced job)
  // =========================================================================
  test('openJobEdit: suggests the discounted amount for a priceless draft with a discount code', () => {
    jobServicesCache = [
      { label: 'FreshRide Interior', price_nok: 500 },
      { label: 'FreshRide Exterior', price_nok: 300 },
    ];
    window._frJobs = [
      { id: 'auto1', customer_name: 'Auto Rabatt', job_date: '2026-07-01', status: 'draft', price_paid: 0, services: 'FreshRide Interior, FreshRide Exterior', discount_code: 'A7K3M', discount_percent: 20 },
    ];
    openJobEdit('auto1');
    // (500+300) * (1 - 0.20) = 640
    assertEqual(document.getElementById('editJobAmount').value, '640', 'expected the service sum reduced by the discount percent');
    assertEqual(document.getElementById('editJobTotalDisplay').textContent, 'kr 640', 'total should equal the amount when no tip is set');
  });

  test('openJobEdit: suggests the plain service sum for a priceless draft with no discount code', () => {
    jobServicesCache = [
      { label: 'FreshRide Interior', price_nok: 500 },
      { label: 'FreshRide Exterior', price_nok: 300 },
    ];
    window._frJobs = [
      { id: 'auto3', customer_name: 'Ingen Rabatt Auto', job_date: '2026-07-01', status: 'draft', price_paid: 0, services: 'FreshRide Interior, FreshRide Exterior' },
    ];
    openJobEdit('auto3');
    assertEqual(document.getElementById('editJobAmount').value, '800', 'expected the plain service sum with no discount to apply');
  });

  test('openJobEdit: never overwrites an amount the job already has, even with a discount code', () => {
    jobServicesCache = [{ label: 'FreshRide Interior', price_nok: 500 }];
    window._frJobs = [
      { id: 'auto2', customer_name: 'Allerede Priset', job_date: '2026-07-01', status: 'completed', price_paid: 999, tip_amount: 0, services: 'FreshRide Interior', discount_code: 'A7K3M', discount_percent: 20 },
    ];
    openJobEdit('auto2');
    assertEqual(document.getElementById('editJobAmount').value, '999', 'a completed/already-priced job must keep its saved amount, not get recomputed');
  });

  test('openJobEdit: splits a saved price_paid back into amount + tip', () => {
    jobServicesCache = [];
    window._frJobs = [
      { id: 'auto4', customer_name: 'Med Tips', job_date: '2026-07-01', status: 'completed', price_paid: 700, tip_amount: 100, services: '' },
    ];
    openJobEdit('auto4');
    assertEqual(document.getElementById('editJobAmount').value, '600', 'amount should be price_paid minus the stored tip');
    assertEqual(document.getElementById('editJobTip').value, '100');
  });

  test('updateJobEditTotal: sums amount + tip, and turns red when the total is 0', () => {
    document.getElementById('editJobAmount').value = '500';
    document.getElementById('editJobTip').value = '50';
    updateJobEditTotal();
    assertEqual(document.getElementById('editJobTotalDisplay').textContent, 'kr 550');
    assert(!document.getElementById('editJobTotalDisplay').classList.contains('fr-job-total-zero'));

    document.getElementById('editJobAmount').value = '';
    document.getElementById('editJobTip').value = '';
    updateJobEditTotal();
    assertEqual(document.getElementById('editJobTotalDisplay').textContent, 'kr 0');
    assert(document.getElementById('editJobTotalDisplay').classList.contains('fr-job-total-zero'), 'a zero total must be flagged in red');
  });

  test('saveJobEdit: sends price_paid as amount+tip, and tip_amount separately', async () => {
    window._frJobs = [{ id: 'saveTip1', booking_code: 'S01', customer_phone: null, completion_sms_sent_at: '2026-01-01T00:00:00Z', completion_notice_dismissed: false }];
    editingJobId = 'saveTip1';
    document.getElementById('editJobCustomerPhone').value = '';
    document.getElementById('editJobAmount').value = '500';
    document.getElementById('editJobTip').value = '100';
    document.getElementById('editJobServices').value = 'FreshRide Interior';
    document.getElementById('editJobCustomer').value = 'Med Tips';
    document.getElementById('editJobCustomerNumber').value = '';
    document.getElementById('editJobDate').value = '2026-07-01';

    let sentBody = null;
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (opts && opts.method === 'PATCH') sentBody = JSON.parse(opts.body);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    try {
      await saveJobEdit();
    } finally {
      window.fetch = origFetch;
    }
    assertEqual(sentBody.price_paid, 600, 'expected price_paid to be amount + tip');
    assertEqual(sentBody.tip_amount, 100);
  });

  test('computeServicesBasePrice: returns null (not 0) when no service label matches', () => {
    jobServicesCache = [{ label: 'FreshRide Interior', price_nok: 500 }];
    assertEqual(computeServicesBasePrice('Et gammelt tjenestenavn'), null);
    assertEqual(computeServicesBasePrice(''), null);
  });

  // =========================================================================
  // Completion-SMS reminder (VIKTIG MELDING) — sending "bilen er klar" is a
  // manual step; these guard both the Oversikt banner and the save-time nag.
  // =========================================================================
  test('renderCompletionAlerts: shows the VIKTIG MELDING banner with customer, code, and a dismiss button', () => {
    renderCompletionAlerts([{ jobId: 'a1', customerName: 'Rabatt Testesen', code: 'A12', endTime: '2026-07-20T10:00:00Z' }]);
    const box = document.getElementById('completionAlertsBox');
    assert(!box.classList.contains('d-none'), 'expected the banner to be visible with 1+ alerts');
    assert(box.textContent.includes('VIKTIG MELDING'), 'expected the heading');
    assert(box.textContent.includes('Rabatt Testesen') && box.textContent.includes('A12'), 'expected customer name and booking code');
    assert(!!box.querySelector('.fr-completion-alert-dismiss'), 'expected a dismiss button per alert');
  });

  test('renderCompletionAlerts: hides the banner entirely when there are zero alerts', () => {
    renderCompletionAlerts([]);
    assert(document.getElementById('completionAlertsBox').classList.contains('d-none'), 'no alerts — banner must be hidden, not an empty box');
  });

  test('saveJobEdit: warns via confirm() when completing a job with no completion SMS sent, and Cancel aborts the save', async () => {
    window._frJobs = [{ id: 'jSms1', booking_code: 'B99', customer_phone: '90000002', completion_sms_sent_at: null, completion_notice_dismissed: false }];
    editingJobId = 'jSms1';
    document.getElementById('editJobCustomerPhone').value = '90000002';

    let confirmMessage = null;
    window.confirm = (msg) => { confirmMessage = msg; return false; };
    window.fetch = () => { throw new Error('must not PATCH when the user cancels the warning'); };

    await saveJobEdit();
    assert(confirmMessage && confirmMessage.includes('SMS'), `expected a confirm() prompt mentioning SMS, got "${confirmMessage}"`);
  });

  test('saveJobEdit: confirming the warning proceeds with the save', async () => {
    window._frJobs = [{ id: 'jSms2', booking_code: 'B98', customer_phone: '90000003', completion_sms_sent_at: null, completion_notice_dismissed: false }];
    editingJobId = 'jSms2';
    document.getElementById('editJobCustomerPhone').value = '90000003';

    window.confirm = () => true;
    let patchCalled = false;
    window.fetch = (url, opts) => {
      if (opts && opts.method === 'PATCH') patchCalled = true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    await saveJobEdit();
    assert(patchCalled, 'expected the save to proceed once the admin confirms anyway');
  });

  test('saveJobEdit: no warning at all once the notice has already been dismissed', async () => {
    window._frJobs = [{ id: 'jSms3', booking_code: 'B97', customer_phone: '90000004', completion_sms_sent_at: null, completion_notice_dismissed: true }];
    editingJobId = 'jSms3';
    document.getElementById('editJobCustomerPhone').value = '90000004';

    let confirmCalled = false;
    window.confirm = () => { confirmCalled = true; return true; };
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await saveJobEdit();
    assert(!confirmCalled, 'a dismissed notice must not re-prompt on save');
  });

  test('saveJobEdit: no warning when the completion SMS was already sent', async () => {
    window._frJobs = [{ id: 'jSms4', booking_code: 'B96', customer_phone: '90000005', completion_sms_sent_at: '2026-07-01T10:00:00Z', completion_notice_dismissed: false }];
    editingJobId = 'jSms4';
    document.getElementById('editJobCustomerPhone').value = '90000005';

    let confirmCalled = false;
    window.confirm = () => { confirmCalled = true; return true; };
    window.fetch = () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await saveJobEdit();
    assert(!confirmCalled, 'SMS already sent — must not prompt');
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
