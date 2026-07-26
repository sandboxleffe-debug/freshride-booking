// nav-rail.js — shared expandable icon nav rail (right edge), used on all customer-facing pages.
// Icons are Lucide (loaded via CDN on each page before this script) — kept as a name-lookup
// so [data-rail-icon="x"] markup didn't need to change, only the icon source underneath.
const RAIL_ICON_MAP = {
  menu: 'Menu', calendar: 'Calendar', home: 'Home', info: 'Info', dollarSign: 'DollarSign',
  star: 'Star', bag: 'ShoppingBag', lock: 'Lock', image: 'Image',
};
function railIcon(name) {
  const nodes = window.lucide?.icons?.[RAIL_ICON_MAP[name] || name];
  if (!nodes) return '';
  const inner = nodes.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}></${tag}>`;
  }).join('');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

document.querySelectorAll('[data-rail-icon]').forEach(el => {
  el.innerHTML = railIcon(el.dataset.railIcon);
});

function toggleNavRail() {
  document.getElementById('navRail').classList.toggle('fr-nav-rail-open');
}
document.addEventListener('click', (e) => {
  const rail = document.getElementById('navRail');
  // Ignore clicks anywhere inside the wrap (rail itself + the hamburger button
  // that toggles it) — otherwise the same click that opens the rail immediately
  // bubbles here and closes it again, since the button isn't a descendant of #navRail.
  if (rail.classList.contains('fr-nav-rail-open') && !e.target.closest('.fr-nav-rail-wrap')) {
    rail.classList.remove('fr-nav-rail-open');
  }
});
document.querySelectorAll('.fr-nav-rail-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.getAttribute('href')?.startsWith('#') || item.getAttribute('href')?.includes('#step-date')) {
      document.getElementById('navRail').classList.remove('fr-nav-rail-open');
    }
  });
});

// Soap-drip effect: a handful of soapy drips run down from the navbar the
// first time a visitor scrolls away from the very top of the page — resets
// once they scroll back to the top, so it can play again next time.
(function () {
  const layer = document.createElement('div');
  layer.className = 'fr-soap-drip-layer';
  document.body.appendChild(layer);

  function spawnSoapDrip() {
    const navbar = document.querySelector('.fr-navbar');
    const navBottom = navbar ? navbar.getBoundingClientRect().bottom : 0;
    const count = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const drip = document.createElement('div');
      drip.className = 'fr-soap-drip';
      const fallDistance = 220 + Math.random() * 260;
      const duration = 1.1 + Math.random() * 0.9;
      const delay = Math.random() * 0.25;
      const size = 0.75 + Math.random() * 0.55;
      drip.style.left = `${Math.random() * window.innerWidth}px`;
      drip.style.top = `${navBottom}px`;
      drip.style.width = `${size}rem`;
      drip.style.height = `${size * 3.2}rem`;
      drip.style.setProperty('--fr-soap-fall-distance', `${fallDistance}px`);
      drip.style.animationDuration = `${duration}s`;
      drip.style.animationDelay = `${delay}s`;
      layer.appendChild(drip);
      setTimeout(() => drip.remove(), (duration + delay) * 1000 + 100);
    }
  }

  let atTop = true;
  window.addEventListener('scroll', () => {
    if (window.scrollY <= 4) {
      atTop = true;
      return;
    }
    if (atTop) {
      atTop = false;
      spawnSoapDrip();
    }
  }, { passive: true });
})();
