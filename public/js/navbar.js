import { NAV_LOGO_SRC, EXPANDED_LOGO_SRC } from './assets.js';
import { appUrl } from './app-path.js';

export function renderNavbar(active = '', user = null, options = {}) {
  const nav = document.getElementById('swrp-nav');
  if (!nav) return;

  const { isAdmin = false } = options;

  const link = (key, href, label) => {
    const isActive = active === key ? ' is-active' : '';
    return `<li class="nav-item"><a class="nav-link swrp-nav-link${isActive}" href="${appUrl(href)}">${label}</a></li>`;
  };

  const homeHref = appUrl(user ? 'dashboard' : 'index');

  const links = user
    ? [
      link('dashboard', 'dashboard', 'Dashboard'),
      link('characters', 'character-create', 'Personajes'),
      link('map-editor', 'map-editor', 'Editor de mapas'),
      link('compendium', 'compendium', 'Compendio'),
      link('rules', 'rules', 'Reglas'),
      ...(isAdmin ? [link('admin', 'admin', 'Opciones')] : []),
      '<li class="nav-item"><a class="nav-link swrp-nav-link swrp-nav-link--logout" href="#" id="btn-logout">Salir</a></li>'
    ].join('')
    : [
      link('login', 'index', 'Login'),
      link('register', 'register', 'Registro')
    ].join('');

  const userLabel = user?.displayName || user?.email || '';

  nav.innerHTML = `
    <header class="swrp-nav-shell">
      <nav class="navbar navbar-expand-lg swrp-navbar">
        <div class="swrp-navbar__topline"></div>
        <div class="container-fluid swrp-navbar__inner">
          <a class="navbar-brand swrp-brand" href="${homeHref}">
            <img class="swrp-brand__logo" src="${NAV_LOGO_SRC}" alt="">
            <span class="swrp-brand__title">SW-RP</span>
          </a>

          <a class="swrp-nav-center" href="${homeHref}" aria-label="Star Wars Expanded RP">
            <img class="swrp-nav-center__logo" src="${EXPANDED_LOGO_SRC}" alt="Star Wars Expanded RP">
          </a>

          <button class="navbar-toggler swrp-navbar__toggler" type="button"
            data-bs-toggle="collapse" data-bs-target="#navMain"
            aria-controls="navMain" aria-expanded="false" aria-label="Menú">
            <span class="swrp-navbar__toggler-bar"></span>
            <span class="swrp-navbar__toggler-bar"></span>
            <span class="swrp-navbar__toggler-bar"></span>
          </button>

          <div class="collapse navbar-collapse swrp-navbar__menu" id="navMain">
            <ul class="navbar-nav swrp-nav-links ms-lg-auto">${links}</ul>
            ${user ? `
              <div class="swrp-nav-user ms-lg-3">
                <span class="swrp-nav-user__dot"></span>
                <span class="swrp-nav-user__name">${escapeHtml(userLabel)}</span>
              </div>` : ''}
          </div>
        </div>
        <div class="swrp-navbar__bottomline"></div>
      </nav>
    </header>`;

  document.getElementById('btn-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const { logout } = await import('./auth.js');
    await logout();
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
