// Tema claro/escuro (11/11/2026). Script clássico carregado no <head>, antes
// do CSS ser aplicado, para não "piscar" o tema errado ao abrir.
// Preferência por aparelho: 'auto' (segue o sistema), 'light' ou 'dark'.
(function () {
  var KEY = 'vinhofilos.theme';
  var ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: 'Automático', light: 'Claro', dark: 'Escuro' };
  var ICON = { auto: '◐', light: '☀', dark: '☾' };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read() {
    try { var v = localStorage.getItem(KEY); return ORDER.indexOf(v) >= 0 ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  function resolved(pref) {
    return pref === 'auto' ? (media && media.matches ? 'dark' : 'light') : pref;
  }
  function apply() {
    var pref = read();
    var mode = resolved(pref);
    document.documentElement.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#262428' : '#ffffff');
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = ICON[pref];
      var text = 'Tema: ' + LABEL[pref] + (pref === 'auto' ? ' (segue o aparelho)' : '') + '. Toque para trocar.';
      btn.setAttribute('aria-label', text);
      btn.title = text;
    }
  }
  function next() {
    var pref = ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length];
    try { localStorage.setItem(KEY, pref); } catch (e) { /* sem armazenamento: vale até recarregar */ }
    apply();
    return pref;
  }

  apply();
  if (media) {
    var onChange = function () { if (read() === 'auto') apply(); };
    if (media.addEventListener) media.addEventListener('change', onChange); else if (media.addListener) media.addListener(onChange);
  }
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    apply();
    btn.addEventListener('click', function () {
      var pref = next();
      var box = document.getElementById('toasts');
      if (box) {
        var t = document.createElement('div');
        t.className = 'toast toast-info';
        t.setAttribute('role', 'status');
        t.textContent = 'Tema: ' + LABEL[pref] + (pref === 'auto' ? ' (segue o aparelho)' : '');
        box.appendChild(t);
        setTimeout(function () { t.remove(); }, 2000);
      }
    });
  });
})();
