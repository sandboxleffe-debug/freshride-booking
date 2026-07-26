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
