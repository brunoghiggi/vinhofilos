// Roteador por hash (#/caminho) — compatível com GitHub Pages sem configuração.
import { h, append } from './utils/dom.js';

const routes = [];
let outletEl = null;
let cleanup = null;
let navId = 0;
// Caminhos visitados nesta sessão do app, para o botão "Voltar"
const trail = [];

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ re, keys, handler });
}

export function navigate(path) {
  if (location.hash === `#${path}`) refresh();
  else location.hash = path;
}

/** Re-renderiza a rota atual. */
export function refresh() { return run(); }

export function startRouter(outlet) {
  outletEl = outlet;
  window.addEventListener('hashchange', run);
  run();
}

function updateNav(path) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function run() {
  const id = ++navId;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  updateNav(path);
  if (trail.length > 1 && trail[trail.length - 2] === raw) trail.pop();
  else if (trail[trail.length - 1] !== raw) trail.push(raw);

  let match = null;
  let params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      match = r;
      params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      break;
    }
  }

  const view = h('div', { class: 'view' });
  // Permite que as telas passem filhos condicionais (null/false) em outlet.append(...)
  view.append = (...nodes) => append(view, nodes);
  if (!match) {
    view.append(h('div', { class: 'card stack' }, h('h1', {}, 'Página não encontrada'), h('a', { href: '#/', class: 'btn btn-secondary' }, 'Voltar ao início')));
    show(view);
    return;
  }

  const loadingTimer = setTimeout(() => {
    if (id === navId) outletEl.replaceChildren(h('p', { class: 'loading' }, 'Carregando…'));
  }, 150);

  try {
    const result = await match.handler({ params, query: new URLSearchParams(qs || ''), outlet: view });
    clearTimeout(loadingTimer);
    if (id !== navId) { if (typeof result === 'function') result(); return; }
    cleanup = typeof result === 'function' ? result : null;
    show(view);
  } catch (err) {
    clearTimeout(loadingTimer);
    if (id !== navId) return;
    console.error(err);
    view.replaceChildren(h('div', { class: 'card stack error-card', role: 'alert' },
      h('h1', {}, err.network ? 'Sem conexão' : 'Algo deu errado'),
      h('p', {}, err.message || 'Erro inesperado.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => refresh() }, 'Tentar novamente'),
        h('a', { href: '#/', class: 'btn btn-ghost' }, 'Início'))));
    show(view);
  }
}

/** Volta à tela anterior do app; se entrou direto por um link, vai ao início. */
function goBack() {
  if (trail.length > 1) history.back();
  else location.hash = '#/';
}

function show(view) {
  const keepScroll = view.dataset.keepScroll;
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  if (path !== '/') {
    view.prepend(h('nav', { class: 'back-bar', 'aria-label': 'Navegação' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm back-btn', onclick: goBack }, '← Voltar'),
      h('a', { href: '#/', class: 'btn btn-ghost btn-sm' }, '⌂ Início')));
  }
  outletEl.replaceChildren(view);
  if (!keepScroll) window.scrollTo(0, 0);
  const heading = view.querySelector('h1');
  // Ignora o sobretítulo decorativo (.brand-small) dentro do h1
  const text = heading ? [...heading.childNodes].filter((n) => !n.classList?.contains('brand-small')).map((n) => n.textContent).join('').trim() : '';
  const home = heading?.classList.contains('hero-title');
  document.title = text && !home ? `${text} · Confraria Vinhófilos` : 'Confraria Vinhófilos';
  if (heading && !keepScroll) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}
