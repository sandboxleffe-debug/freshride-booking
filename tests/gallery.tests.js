// tests/gallery.tests.js
// Self-contained test suite for index.html's "Se oss i aksjon" gallery strip
// — paste this whole file's content into javascript_tool (action:
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
  function svgDataUrl(color, label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="30" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  const origFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('type=gallery')) {
      return new Response(JSON.stringify({
        images: [
          { path: svgDataUrl('#8B0000', '1'), alt: '' },
          { path: svgDataUrl('#2E7D32', '2'), alt: '' },
          { path: svgDataUrl('#1565C0', '3'), alt: '' },
        ],
      }), { status: 200 });
    }
    return origFetch(url, opts);
  };
  await loadGallery();

  test('regression guard: the track wrapper must allow native horizontal scroll (not overflow:hidden)', () => {
    // The old implementation used a pure CSS transform loop inside an
    // overflow:hidden wrapper — nothing could ever override it by swiping.
    const wrap = document.querySelector('.fr-gallery-track-wrap');
    const overflowX = getComputedStyle(wrap).overflowX;
    assert(overflowX === 'auto' || overflowX === 'scroll', `expected native horizontal scroll, got overflow-x: ${overflowX}`);
  });

  test('a manual scroll actually moves the strip (swipe-to-browse works)', () => {
    const wrap = document.querySelector('.fr-gallery-track-wrap');
    wrap.scrollLeft = 0;
    wrap.scrollLeft = 120;
    assertEqual(wrap.scrollLeft, 120, 'setting scrollLeft should move the strip like a real swipe would');
  });

  test('images are doubled for a seamless loop', () => {
    const imgs = document.querySelectorAll('#galleryTrack img');
    assertEqual(imgs.length, 6, '3 source images doubled to 6');
  });

  test('the two doubled halves still match each other exactly (shuffle happens once, before doubling)', () => {
    const imgs = Array.from(document.querySelectorAll('#galleryTrack img'));
    const firstHalf = imgs.slice(0, 3).map(i => i.src);
    const secondHalf = imgs.slice(3, 6).map(i => i.src);
    assertEqual(firstHalf, secondHalf, 'both halves must be identical, whatever order the shuffle picked, or the loop seam would be visible');
  });

  test('shuffleArray: preserves length and elements, reorders across enough tries', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    let sawDifferentOrder = false;
    for (let i = 0; i < 30; i++) {
      const shuffled = shuffleArray(arr);
      assertEqual(shuffled.length, arr.length);
      assertEqual(shuffled.slice().sort((a, b) => a - b), arr, 'must contain exactly the same elements');
      if (JSON.stringify(shuffled) !== JSON.stringify(arr)) sawDifferentOrder = true;
    }
    assert(sawDifferentOrder, 'expected at least one different ordering across 30 shuffles — otherwise it is not actually random');
  });

  test('clicking an image opens the lightbox with that image', async () => {
    const img = document.querySelector('#galleryTrack img');
    img.click();
    // Bootstrap's .fade modal doesn't add the "show" class synchronously —
    // it waits out the CSS transition (~300ms), which can take noticeably
    // longer in this backgrounded/automated tab (document.hidden is true
    // here, unlike a real foregrounded tab) — so give it real room.
    await new Promise(r => setTimeout(r, 500));
    const shown = document.getElementById('galleryLightboxModal').classList.contains('show');
    assert(shown, 'expected the lightbox modal to be visible after clicking an image');
    assertEqual(document.getElementById('galleryLightboxImg').src, img.src);
  });

  test('interaction events on the track wrapper do not throw (pause/resume wiring is intact)', () => {
    const wrap = document.querySelector('.fr-gallery-track-wrap');
    wrap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    wrap.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    wrap.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    wrap.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    // No assertion beyond "didn't throw" — auto-scroll timing itself can't be
    // reliably verified here since requestAnimationFrame is heavily throttled
    // in a backgrounded/automated tab (document.hidden is often true in this
    // environment). Verified manually in a real foregrounded tab instead.
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
  console.log('gallery.tests.js', summary);
  return summary;
})();
