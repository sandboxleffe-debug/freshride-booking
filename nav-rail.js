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

// "Mobil visning" — a dev-only preview toggle next to the hamburger, so
// William can check mobile layout/styling while sitting at a PC without
// needing devtools. A narrow div alone wouldn't work: this site's
// @media (max-width: ...) rules respond to the real browser viewport, not
// a container's width, so shrinking a wrapper leaves every mobile style
// inactive. An <iframe> gets its own genuine narrow viewport, so the
// mobile CSS actually activates — same trick browser devtools use.
// Gated on a harmless localStorage flag (never the admin password) set by
// admin.html on login, so this only ever shows up for William, on any
// customer-facing page, in any tab — never for a real visitor. A named,
// idempotent function (rather than inline top-level code) so it can react
// if the flag changes without a full page reload, and so it's callable
// directly from tests.
function syncMobilePreviewToggle() {
  const railWrap = document.querySelector('.fr-nav-rail-wrap');
  if (!railWrap) return;
  const existing = railWrap.querySelector('.fr-mobile-preview-toggle');
  if (localStorage.getItem('fr_admin_seen') !== '1') {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fr-mobile-preview-toggle';
  toggle.title = 'Mobil visning (kun synlig for deg)';
  toggle.setAttribute('aria-label', 'Vis siden som på mobil');
  toggle.textContent = '📱';
  toggle.onclick = openMobilePreview;
  railWrap.insertBefore(toggle, railWrap.firstChild);
}
syncMobilePreviewToggle();

function openMobilePreview() {
  if (document.getElementById('frMobilePreviewOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'frMobilePreviewOverlay';
  overlay.className = 'fr-mobile-preview-overlay';
  overlay.innerHTML = `
    <button type="button" class="fr-mobile-preview-close">✕ Lukk mobilvisning</button>
    <div class="fr-mobile-preview-frame">
      <iframe src="${location.href}" title="Mobilvisning"></iframe>
    </div>
  `;
  overlay.querySelector('.fr-mobile-preview-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
