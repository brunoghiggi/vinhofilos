import { STATUS_LABEL } from './format.js';

/**
 * Cria um elemento. Atributos: class, dataset, on<evento>, value/checked
 * (como propriedade), booleanos (true → atributo vazio). Filhos: nós ou texto.
 * Texto é sempre inserido como texto (nunca HTML), evitando XSS.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    Element.prototype.append.call(el, c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let uidCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++uidCounter}`;

/** Campo com rótulo e mensagem de erro associada. */
export function field(label, input, { hint, required } = {}) {
  if (!input.id) input.id = uid('f');
  const err = h('p', { class: 'field-error', id: `${input.id}-err`, hidden: true });
  const hintEl = hint ? h('p', { class: 'field-hint', id: `${input.id}-hint` }, hint) : null;
  input.setAttribute('aria-describedby', [hintEl && hintEl.id, err.id].filter(Boolean).join(' '));
  return h('div', { class: 'field' },
    h('label', { for: input.id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    input, hintEl, err);
}

export function setFieldError(input, message) {
  const err = document.getElementById(`${input.id}-err`);
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    if (err) { err.textContent = message; err.hidden = false; }
  } else {
    input.removeAttribute('aria-invalid');
    if (err) { err.textContent = ''; err.hidden = true; }
  }
}

export function toast(message, type = 'info', timeout = 3800) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  box.append(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 300); }, timeout);
}

/** Diálogo modal de confirmação. Resolve true se confirmado. */
export function confirmDialog({ title, message, content, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const titleId = uid('dlg');
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(result);
    };
    const form = h('form', {
      class: 'stack',
      onsubmit: (e) => { e.preventDefault(); finish(e.submitter?.value === 'ok'); },
    });
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': titleId, oncancel: (e) => { e.preventDefault(); finish(false); } },
      append(form, [
        h('h2', { id: titleId }, title),
        message ? h('p', {}, message) : null,
        content || null,
        h('div', { class: 'dialog-actions' },
          cancelText ? h('button', { value: 'cancel', class: 'btn btn-ghost' }, cancelText) : null,
          h('button', { value: 'ok', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, confirmText))]));
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function statusBadge(status) {
  return h('span', { class: `badge status-${status}` }, STATUS_LABEL[status] || status);
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action || null);
}

export function section(title, ...children) {
  return h('section', { class: 'section' }, title ? h('h2', {}, title) : null, ...children);
}

/** Desabilita o botão enquanto a promessa roda. */
export async function busy(button, fn, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (busyText) button.textContent = busyText;
  try { return await fn(); }
  finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (busyText) button.textContent = original;
  }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { class: 'sr-only' });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

/** Mensagem padrão quando o navegador não tem a chave de controle. */
export function noControl(id) {
  return h('div', { class: 'card stack' },
    h('h1', {}, 'Acesso restrito ao organizador'),
    h('p', {}, 'Esta área só pode ser usada no navegador que criou a degustação (ou onde a chave de controle foi importada).'),
    h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}` }, 'Ver degustação'));
}
