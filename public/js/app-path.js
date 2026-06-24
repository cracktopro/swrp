const APP_PAGES = new Set([
  'board',
  'party',
  'dashboard',
  'compendium',
  'rules',
  'admin',
  'register',
  'character-create',
  'character-view',
  'index'
]);

let cachedBasePath = null;

/** Directorio raíz de la app (termina en /), inferido desde este módulo. */
export function getAppBasePath() {
  if (cachedBasePath) return cachedBasePath;
  const scriptPath = new URL(import.meta.url).pathname;
  cachedBasePath = scriptPath.replace(/\/js\/[^/]+$/, '/');
  return cachedBasePath;
}

/** URL absoluta de ruta (misma origen) dentro de la app. */
export function appUrl(relativePath) {
  const raw = String(relativePath || '');
  const hashIdx = raw.indexOf('#');
  const queryIdx = raw.indexOf('?');
  const cut = [hashIdx, queryIdx].filter((i) => i >= 0);
  const pathEnd = cut.length ? Math.min(...cut) : raw.length;
  const pathPart = raw.slice(0, pathEnd).replace(/^\//, '');
  const suffix = raw.slice(pathEnd);
  const base = getAppBasePath();
  return `${base}${pathPart}${suffix}`.replace(/([^:]\/)\/+/g, '$1');
}

export function navigateTo(relativePath) {
  window.location.assign(appUrl(relativePath));
}

function currentPageName(pathname) {
  const match = pathname.match(/\/([^/]+?)(?:\.html)?$/);
  return match?.[1] || '';
}

/** Corrige rutas sin /public/ en GitHub Pages (p. ej. /swrp/board → /swrp/public/board). */
export function fixMisroutedPath() {
  const { pathname, search, hash } = window.location;
  if (pathname.includes('/public/')) return;

  const misroute = pathname.match(
    /^(\/[^/]+)\/(board|party|dashboard|compendium|rules|admin|register|character-create|character-view)(?:\.html)?$/
  );
  if (!misroute) return;

  const target = `${misroute[1]}/public/${misroute[2]}${search}${hash}`;
  if (pathname + search + hash !== target) {
    window.location.replace(target);
  }
}

export { APP_PAGES };
