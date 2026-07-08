// nav-rail.js — shared expandable icon nav rail (right edge), used on all customer-facing pages.
const RAIL_ICONS = {
  menu: '<rect x="4" y="6" width="16" height="2" rx="1"/><rect x="4" y="11" width="16" height="2" rx="1"/><rect x="4" y="16" width="16" height="2" rx="1"/>',
  calendar: '<path fill-rule="evenodd" d="M7 1a1 1 0 0 1 1 1v1h8V2a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h1V2a1 1 0 0 1 1-1ZM4 10v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10H4Z" clip-rule="evenodd"/>',
  home: '<path d="M12 2.3 2 10.8h3V21h6v-6h2v6h6V10.8h3Z"/>',
  info: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 6.8a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0ZM11 12a1 1 0 1 1 2 0v5a1 1 0 1 1-2 0v-5Z" clip-rule="evenodd"/>',
  dollarSign: '<path d="M13 1h-2v2.05C8.7 3.4 7 5.1 7 7.4c0 2.5 1.8 3.6 3.9 4.3l.1.03V16c-1-.2-1.7-1-1.9-1.9H7c.2 2.2 1.9 3.9 4 4.3V21h2v-2.6c2.5-.3 4.3-2 4.3-4.4 0-2.6-1.9-3.6-4.3-4.4V5.2c.9.2 1.5.9 1.7 1.7h2.2c-.2-2-1.8-3.6-3.9-3.9V1Zm-2 4.2v3.6c-1-.4-1.6-.9-1.6-1.8s.6-1.5 1.6-1.8Zm2 8.4c1.1.4 1.8.9 1.8 1.9s-.7 1.6-1.8 1.9v-3.8Z"/>',
  star: '<path d="M11.05 2.6a1 1 0 0 1 1.9 0l2.1 4.6 5 .6a1 1 0 0 1 .57 1.73l-3.73 3.4.98 4.94a1 1 0 0 1-1.47 1.07L12 16.7l-4.4 2.24a1 1 0 0 1-1.47-1.07l.98-4.95-3.73-3.4A1 1 0 0 1 3.95 7.8l5-.6 2.1-4.6Z"/>',
  bag: '<path fill-rule="evenodd" d="M8 6a4 4 0 1 1 8 0v1h2.4a1 1 0 0 1 1 .9l1.1 12a2 2 0 0 1-2 2.1H5.5a2 2 0 0 1-2-2.1l1.1-12a1 1 0 0 1 1-.9H8V6Zm2 1h4V6a2 2 0 1 0-4 0v1Z" clip-rule="evenodd"/>',
  lock: '<path fill-rule="evenodd" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 8V6a3 3 0 0 1 6 0v3H9Zm3 4a1.5 1.5 0 0 1 1.5 1.5c0 .6-.3 1.1-.8 1.4l.3 2.1h-2l.3-2.1c-.5-.3-.8-.8-.8-1.4A1.5 1.5 0 0 1 12 13Z" clip-rule="evenodd"/>',
};

document.querySelectorAll('[data-rail-icon]').forEach(el => {
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${RAIL_ICONS[el.dataset.railIcon] || ''}</svg>`;
});

function toggleNavRail() {
  document.getElementById('navRail').classList.toggle('fr-nav-rail-open');
}
document.addEventListener('click', (e) => {
  const rail = document.getElementById('navRail');
  if (rail.classList.contains('fr-nav-rail-open') && !rail.contains(e.target)) {
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
