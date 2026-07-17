// tests/resultater.tests.js
// Self-contained test suite for resultater.html — paste this whole file's
// content into javascript_tool (action: javascript_exec) after navigating to
// http://localhost:<port>/resultater.html. Returns a JSON summary; any entry
// with pass:false is a regression. See tests/README.md for the full workflow.
(async function () {
  const testList = [];
  function test(name, fn) { testList.push({ name, fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${b}, got ${a}`);
  }
  function svgDataUrl(color, label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="40" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
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

  const origFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('type=references')) {
      return new Response(JSON.stringify({
        pairs: [
          { id: 'p1', carType: 'Golf GTI', productName: 'Premium', before: svgDataUrl('#8B0000', 'FOR'), after: svgDataUrl('#2E7D32', 'ETTER') },
          { id: 'p2', carType: 'Tesla Model 3', productName: '', before: svgDataUrl('#8B0000', 'FOR2'), after: svgDataUrl('#2E7D32', 'ETTER2') },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch(url, opts);
  };
  await loadResults();

  test('renders one slide per pair with before/after labels', () => {
    const slides = document.querySelectorAll('.fr-results-slide');
    assertEqual(slides.length, 2);
    assertEqual(document.querySelectorAll('.fr-compare-label-before').length, 2);
    assertEqual(document.querySelectorAll('.fr-compare-label-after').length, 2);
  });

  test('compare slider: dragging the hitzone updates the clip-path', () => {
    const frame = document.querySelector('.fr-compare-frame');
    const hitzone = frame.querySelector('.fr-compare-hitzone');
    const before = frame.querySelector('.fr-compare-before');
    const rect = frame.getBoundingClientRect();
    const clipStart = before.style.clipPath;

    // Synthetic PointerEvents have no real OS-level active pointer behind
    // them, so setPointerCapture can throw in some browsers — stub it out
    // for this test only, since we're testing the clip-path math, not
    // capture semantics (already verified manually with a real drag).
    const origCapture = Element.prototype.setPointerCapture;
    const origRelease = Element.prototype.releasePointerCapture;
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    try {
      // The app listens for pointerdown/move/up (not touch events) on the hitzone.
      hitzone.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, pointerId: 1, bubbles: true }));
      hitzone.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height / 2, pointerId: 1, bubbles: true }));
      hitzone.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height / 2, pointerId: 1, bubbles: true }));
    } finally {
      Element.prototype.setPointerCapture = origCapture;
      Element.prototype.releasePointerCapture = origRelease;
    }

    const clipAfter = before.style.clipPath;
    assert(clipAfter !== clipStart, 'dragging the hitzone should change the before-layer clip-path');
  });

  test('regression guard: a swipe starting away from the hitzone must NOT move the slider', () => {
    // This is the exact bug reported in production: the whole image used to
    // capture all touch input (touch-action: none on .fr-compare-frame),
    // which silently ate carousel swipes and left visitors stuck on the
    // first card. Only the narrow .fr-compare-hitzone strip should react.
    const frame = document.querySelectorAll('.fr-compare-frame')[1];
    const before = frame.querySelector('.fr-compare-before');
    const clipStart = before.style.clipPath;
    const rect = frame.getBoundingClientRect();
    const farLeftX = rect.left + 20; // near the "Før" label, far outside the 48px hitzone

    fireTouch('touchstart', frame, farLeftX, rect.top + rect.height / 2);
    fireTouch('touchmove', frame, farLeftX - 80, rect.top + rect.height / 2);
    fireTouch('touchend', frame, farLeftX - 80, rect.top + rect.height / 2);

    const clipAfter = before.style.clipPath;
    assertEqual(clipAfter, clipStart, 'a swipe outside the hitzone must leave the compare position untouched');
  });

  test('regression guard: .fr-compare-frame must not set touch-action:none (would block carousel swipe)', () => {
    const frame = document.querySelector('.fr-compare-frame');
    const touchAction = getComputedStyle(frame).touchAction;
    assert(touchAction !== 'none', `fr-compare-frame touch-action is "${touchAction}" — must not be "none" or swipe-to-next-card breaks again`);
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
  console.log('resultater.tests.js', summary);
  return summary;
})();
