(function () {
  var KNOWN_PAGE = /\/(board|party|dashboard|compendium|rules|admin|register|character-create|character-view|index)(?:\.html)?$/;
  var path = window.location.pathname;
  var publicIdx = path.indexOf('/public/');
  var base;

  if (publicIdx >= 0) {
    base = path.slice(0, publicIdx + 8);
  } else if (KNOWN_PAGE.test(path)) {
    base = path.replace(KNOWN_PAGE, '/');
  } else {
    var slash = path.lastIndexOf('/');
    base = slash >= 0 ? path.slice(0, slash + 1) : '/';
  }
  if (!/\/$/.test(base)) base += '/';

  var misroute = path.match(
    /^(\/[^/]+)\/(board|party|dashboard|compendium|rules|admin|register|character-create|character-view)(?:\.html)?$/
  );
  if (misroute && publicIdx < 0) {
    window.location.replace(misroute[1] + '/public/' + misroute[2] + window.location.search + window.location.hash);
    return;
  }

  var el = document.createElement('base');
  el.id = 'swrp-base';
  el.href = base;
  document.head.insertBefore(el, document.head.firstChild);
})();
