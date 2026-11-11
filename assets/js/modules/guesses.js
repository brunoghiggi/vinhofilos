// Operação da degustação: registro dos palpites com salvamento automático.
import { api } from '../services/database.js';
import { tokenStore, prefs } from '../services/token-store.js';
import { h, toast, noControl, field, uid } from '../utils/dom.js';
import {
  isBlank, parseDecimal, parseInteger, toInputNumber, participantName, formatNumber,
} from '../utils/format.js';
import { REGIONS, GRAPES, datalist } from '../utils/suggestions.js';
import { sleep } from '../utils/errors.js';

const MAX_YEAR = new Date().getFullYear() + 1;
const key = (wineId, participantId) => `${wineId}:${participantId}`;
// Safra é opcional (decisão de 11/11/2026): não entra no critério de "completo".
const REQUIRED = ['guessed_region', 'guessed_grape', 'guessed_price', 'score'];

/** Completo = região, uva, preço e pontuação preenchidos (safra opcional). */
export function isGuessComplete(g) {
  return Boolean(g) && REQUIRED.every((f) => !isBlank(g[f]));
}
export function isGuessStarted(g) {
  return Boolean(g) && [...REQUIRED, 'guessed_vintage', 'notes'].some((f) => !isBlank(g[f]));
}

export function guessCompleteness(wines, participants, guesses) {
  const map = new Map(guesses.map((g) => [key(g.wine_id, g.participant_id), g]));
  let complete = 0;
  const missing = [];
  for (const p of participants) {
    const lacking = wines.filter((w) => !isGuessComplete(map.get(key(w.id, p.participant_id))));
    complete += wines.length - lacking.length;
    if (lacking.length) missing.push(`${participantName(p)}: vinho(s) ${lacking.map((w) => w.position).join(', ')}`);
  }
  return { complete, total: wines.length * participants.length, missing };
}

/**
 * Fila de salvamento por palpite: debounce, uma requisição por vez por
 * palpite, novas tentativas automáticas em falha de rede.
 */
class GuessSaver {
  constructor(tastingId, token, onState) {
    this.tastingId = tastingId;
    this.token = token;
    this.onState = onState;
    this.timers = new Map();
    this.inflight = new Map();
    this.queued = new Map();
    this.failed = new Map();
  }

  schedule(k, payload, delay = 900) {
    clearTimeout(this.timers.get(k));
    this.failed.delete(k);
    this.onState(k, 'dirty');
    this.timers.set(k, setTimeout(() => { this.timers.delete(k); this.flush(k, payload); }, delay));
  }

  cancel(k) { clearTimeout(this.timers.get(k)); this.timers.delete(k); }

  flush(k, payload) {
    if (this.inflight.has(k)) { this.queued.set(k, payload); return; }
    const p = this.save(k, payload).finally(() => {
      this.inflight.delete(k);
      if (this.queued.has(k)) { const next = this.queued.get(k); this.queued.delete(k); this.flush(k, next); }
    });
    this.inflight.set(k, p);
  }

  async save(k, payload) {
    this.onState(k, 'saving');
    for (let attempt = 0; ; attempt++) {
      try {
        const g = await api.saveGuess(this.tastingId, this.token, payload);
        this.onState(k, 'saved', null, g, payload);
        return;
      } catch (err) {
        if (err.network && attempt < 4) {
          this.onState(k, 'retrying');
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        this.failed.set(k, payload);
        this.onState(k, 'error', err.message);
        return;
      }
    }
  }

  retry(k) { const p = this.failed.get(k); if (p) { this.failed.delete(k); this.flush(k, p); } }

  get busy() { return this.timers.size + this.inflight.size + this.failed.size > 0; }
}

const STATE_TEXT = {
  dirty: 'Não salvo…',
  saving: 'Salvando…',
  retrying: 'Sem conexão — tentando de novo…',
  saved: 'Salvo ✓',
  error: 'Erro ao salvar',
  invalid: 'Verifique os campos',
};

export async function renderOperation({ params, outlet }) {
  const id = params.id;
  const token = tokenStore.get(id);
  if (!token) { outlet.append(noControl(id)); return; }

  const data = await api.getTastingAdmin(id, token);
  const { tasting: t, wines, participants } = data;

  if (t.status !== 'em_andamento') {
    outlet.append(h('div', { class: 'card stack' },
      h('h1', {}, t.status === 'rascunho' ? 'Degustação ainda não iniciada' : 'Degustação finalizada'),
      h('p', {}, t.status === 'rascunho' ? 'Inicie a degustação para registrar palpites.' : 'Os palpites não podem mais ser alterados.'),
      h('a', { class: 'btn btn-primary', href: t.status === 'rascunho' ? `#/degustacao/${id}` : `#/degustacao/${id}/relatorio` },
        t.status === 'rascunho' ? 'Ir para a degustação' : 'Ver relatório')));
    return;
  }

  const saved = new Map(data.guesses.map((g) => [key(g.wine_id, g.participant_id), g]));
  const drafts = new Map(); // valores digitados ainda não salvos (strings)
  const states = new Map(); // k → { state, message }
  const pending = new Map(); // k → último payload agendado

  const state = {
    mode: prefs.get('opmode', 'participante'),
    reveal: false,
    ...(() => { try { return JSON.parse(sessionStorage.getItem(`vinhofilos.op.${id}`)) || {}; } catch { return {}; } })(),
  };
  state.pIndex = Math.min(state.pIndex || 0, participants.length - 1);
  state.wIndex = Math.min(state.wIndex || 0, wines.length - 1);
  // Modo por vinho: participante atual dentro do vinho (um por vez, pensado para o celular)
  state.wpIndex = Math.min(state.wpIndex || 0, participants.length - 1);
  const persist = () => {
    prefs.set('opmode', state.mode);
    try { sessionStorage.setItem(`vinhofilos.op.${id}`, JSON.stringify({ pIndex: state.pIndex, wIndex: state.wIndex, wpIndex: state.wpIndex, reveal: state.reveal })); } catch { /* ignore */ }
  };

  const view = outlet;
  const saver = new GuessSaver(id, token, onSaveState);

  // ----- elementos fixos
  const progressBar = h('span', { style: 'width:0%' });
  const progressLabel = h('div', { class: 'progress-label' });
  const modeBtns = {
    participante: h('button', { type: 'button', 'aria-pressed': 'false' }, 'Por participante'),
    vinho: h('button', { type: 'button', 'aria-pressed': 'false' }, 'Por vinho'),
  };
  const revealBox = h('input', { type: 'checkbox', checked: state.reveal });
  const chipsEl = h('div', { class: 'chips', role: 'list' });
  const reorderBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false' }, '↔ Reordenar');
  const reorderHint = h('p', { class: 'small notice', hidden: true },
    'Arraste os nomes para a esquerda ou direita (ou use as setas do teclado). A nova ordem é salva na hora.');
  const reorderRow = h('div', { class: 'row-between' }, h('span', { class: 'small muted' }, 'Ordem dos participantes'), reorderBtn);
  const currentEl = h('div', {});
  const cardsEl = h('div', { class: 'stack' });
  const prevBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, '← Anterior');
  const nextBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Próximo →');

  // ----- utilidades de estado
  function valuesFor(k) {
    if (drafts.has(k)) return drafts.get(k);
    const g = saved.get(k) || {};
    return {
      guessed_region: g.guessed_region || '',
      guessed_vintage: isBlank(g.guessed_vintage) ? '' : String(g.guessed_vintage),
      guessed_grape: g.guessed_grape || '',
      guessed_price: toInputNumber(g.guessed_price),
      score: toInputNumber(g.score),
      notes: g.notes || '',
    };
  }

  function counts(filterFn) {
    let done = 0; let total = 0;
    for (const w of wines) for (const p of participants) {
      if (!filterFn(w, p)) continue;
      total++;
      if (isGuessComplete(saved.get(key(w.id, p.participant_id)))) done++;
    }
    return { done, total };
  }

  function drawProgress() {
    const { done, total } = counts(() => true);
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressLabel.replaceChildren(h('span', {}, `Palpites completos: ${done} de ${total}`), h('span', {}, `${pct}%`));
  }

  function wineLabel(w) { return state.reveal ? `Vinho ${w.position} · ${w.name}` : `Vinho ${w.position}`; }

  function drawChips() {
    const items = state.mode === 'participante' ? participants : wines;
    chipsEl.replaceChildren(...items.map((item, i) => {
      const c = state.mode === 'participante'
        ? counts((w, p) => p.participant_id === item.participant_id)
        : counts((w) => w.id === item.id);
      const current = i === (state.mode === 'participante' ? state.pIndex : state.wIndex);
      const title = state.mode === 'participante' ? `${item.position}. ${item.name}` : wineLabel(item);
      const reordering = reorderOn();
      return h('button', {
        type: 'button', role: 'listitem',
        class: `chip${c.done === c.total ? ' complete' : ''}`,
        dataset: { index: String(i) },
        'aria-current': current ? 'true' : null,
        'aria-label': reordering
          ? `${title}: posição ${i + 1} de ${items.length}. Setas esquerda e direita movem.`
          : `${title}: ${c.done} de ${c.total} completos`,
        onclick: () => { if (!reorderOn()) go(i); },
        onkeydown: (e) => {
          if (!reordering || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          moveParticipant(i, i + (e.key === 'ArrowLeft' ? -1 : 1), true);
        },
      }, h('span', { class: 'chip-title' }, title), h('span', { class: 'chip-sub' }, `${c.done}/${c.total}`));
    }));
    chipsEl.classList.toggle('reorder', reorderOn());
    reorderRow.hidden = state.mode !== 'participante';
    reorderHint.hidden = !reorderOn();
    reorderBtn.setAttribute('aria-pressed', String(reorderOn()));
    reorderBtn.textContent = reorderOn() ? 'Concluir ordem' : '↔ Reordenar';
    chipsEl.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ----- ordem dos participantes durante a degustação (11/11/2026)
  // Arrastar a ficha para os lados (mouse ou toque) ou setas do teclado.
  let reorder = false;
  let orderSave = Promise.resolve();
  const reorderOn = () => reorder && state.mode === 'participante';

  function moveParticipant(from, to, refocus = false) {
    if (to < 0 || to >= participants.length || to === from) return;
    const before = participants.slice();
    const current = participants[state.pIndex];
    const [p] = participants.splice(from, 1);
    participants.splice(to, 0, p);
    participants.forEach((x, i) => { x.position = i + 1; });
    state.pIndex = participants.indexOf(current);
    persist(); drawChips(); drawPanel();
    if (refocus) chipsEl.querySelector(`[data-index="${to}"]`)?.focus();
    const ids = participants.map((x) => x.participant_id);
    orderSave = orderSave.then(async () => {
      try {
        await api.setTastingParticipants(id, token, ids);
        toast('Ordem salva.', 'success', 1500);
      } catch (err) {
        toast(`Não foi possível salvar a ordem: ${err.message}`, 'error', 6000);
        participants.splice(0, participants.length, ...before);
        participants.forEach((x, i) => { x.position = i + 1; });
        state.pIndex = Math.max(0, participants.indexOf(current));
        persist(); drawChips(); drawPanel();
      }
    });
  }

  let drag = null;
  const chipAt = (el) => el?.closest?.('.chip');
  function dropIndex(x) {
    // Quantas outras fichas ficam à esquerda do ponteiro = nova posição
    return [...chipsEl.children].filter((c, i) => {
      if (i === drag.from) return false;
      const r = c.getBoundingClientRect();
      return r.left + r.width / 2 < x;
    }).length;
  }
  chipsEl.addEventListener('pointerdown', (e) => {
    const chip = chipAt(e.target);
    if (!reorderOn() || !chip || e.button > 0) return;
    e.preventDefault();
    chip.setPointerCapture(e.pointerId);
    drag = { chip, from: Number(chip.dataset.index), x0: e.clientX, to: Number(chip.dataset.index) };
    chip.classList.add('dragging');
  });
  chipsEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.chip.style.transform = `translateX(${e.clientX - drag.x0}px)`;
    drag.to = dropIndex(e.clientX);
    // Rola a faixa quando o dedo chega perto das bordas
    const r = chipsEl.getBoundingClientRect();
    if (e.clientX < r.left + 30) chipsEl.scrollLeft -= 12;
    else if (e.clientX > r.right - 30) chipsEl.scrollLeft += 12;
    [...chipsEl.children].forEach((c, i) => {
      const others = i > drag.from ? i - 1 : i; // índice entre as demais fichas
      c.classList.toggle('drop-before', i !== drag.from && others === drag.to);
      c.classList.toggle('drop-after', i !== drag.from && drag.to === participants.length - 1 && others === participants.length - 2);
    });
  });
  const endDrag = () => {
    if (!drag) return;
    const { chip, from, to } = drag;
    drag = null;
    chip.classList.remove('dragging');
    chip.style.transform = '';
    [...chipsEl.children].forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    moveParticipant(from, to);
  };
  chipsEl.addEventListener('pointerup', endDrag);
  chipsEl.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag.to = drag.from;
    endDrag();
  });
  reorderBtn.addEventListener('click', () => { reorder = !reorder; drawChips(); });

  function guessCard(w, p, title, subtitle) {
    const k = key(w.id, p.participant_id);
    const v = valuesFor(k);
    const base = uid('g');
    const inputs = {
      guessed_region: h('input', { id: `${base}-r`, type: 'text', list: 'dl-op-regions', maxlength: 150, autocomplete: 'off', enterkeyhint: 'next', value: v.guessed_region }),
      guessed_grape: h('input', { id: `${base}-g`, type: 'text', list: 'dl-op-grapes', maxlength: 200, autocomplete: 'off', enterkeyhint: 'next', value: v.guessed_grape }),
      guessed_vintage: h('input', { id: `${base}-v`, type: 'text', inputmode: 'numeric', maxlength: 4, placeholder: 'ano', autocomplete: 'off', enterkeyhint: 'next', value: v.guessed_vintage }),
      guessed_price: h('input', { id: `${base}-p`, type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', enterkeyhint: 'next', value: v.guessed_price }),
      score: h('input', { id: `${base}-s`, type: 'text', inputmode: 'numeric', maxlength: 3, placeholder: `${formatNumber(t.score_min)}–${formatNumber(t.score_max)}`, autocomplete: 'off', enterkeyhint: 'next', value: v.score }),
    };
    // Observações saíram do formulário (11/11/2026); as já gravadas são preservadas.
    const keptNotes = saved.get(k)?.notes ?? null;
    const status = h('span', { class: 'save-state', role: 'status' });
    const card = h('div', { class: 'card guess-card', dataset: { key: k } },
      h('div', { class: 'guess-head' },
        h('div', {}, h('h3', {}, title), subtitle ? h('span', { class: 'small muted' }, subtitle) : null),
        status),
      h('div', { class: 'guess-grid' },
        field('Região', inputs.guessed_region),
        field('Uva', inputs.guessed_grape),
        field('Safra (opcional)', inputs.guessed_vintage),
        field('Preço (R$)', inputs.guessed_price),
        field(`Pontuação (${formatNumber(t.score_min)}–${formatNumber(t.score_max)})`, inputs.score)));

    const readValues = () => Object.fromEntries(Object.entries(inputs).map(([f, el]) => [f, el.value]));

    const onEdit = (delay) => {
      const raw = readValues();
      drafts.set(k, raw);
      const parsed = parseGuess(raw, inputs, keptNotes);
      if (!parsed) { saver.cancel(k); pending.delete(k); onSaveState(k, 'invalid'); return; }
      const payload = { wine_id: w.id, participant_id: p.participant_id, ...parsed, _raw: raw };
      pending.set(k, payload);
      saver.schedule(k, payload, delay);
    };
    for (const el of Object.values(inputs)) {
      el.addEventListener('input', () => onEdit(900));
      el.addEventListener('change', () => onEdit(0));
      if (el.tagName === 'INPUT') {
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const all = [...view.querySelectorAll('.guess-card input')];
          const next = all[all.indexOf(el) + 1];
          // Por vinho: "Enter"/"Ir" no último campo avança para o próximo participante
          if (next) next.focus(); else if (state.mode === 'vinho') nextBtn.click();
        });
      }
    }

    paintCard(card, k);
    return card;
  }

  function parseGuess(raw, inputs, notes) {
    let ok = true;
    const err = (el, msg) => {
      const e = document.getElementById(`${el.id}-err`);
      if (msg) { ok = false; el.setAttribute('aria-invalid', 'true'); if (e) { e.textContent = msg; e.hidden = false; } }
      else { el.removeAttribute('aria-invalid'); if (e) { e.hidden = true; e.textContent = ''; } }
    };
    const vintage = parseInteger(raw.guessed_vintage);
    err(inputs.guessed_vintage, Number.isNaN(vintage) || (vintage !== null && (vintage < 1800 || vintage > MAX_YEAR)) ? 'Ano inválido' : null);
    const price = parseDecimal(raw.guessed_price);
    err(inputs.guessed_price, Number.isNaN(price) || price < 0 ? 'Valor inválido' : null);
    const score = parseInteger(raw.score); // só inteiros (escala da confraria)
    err(inputs.score, Number.isNaN(score) || (score !== null && (score < Number(t.score_min) || score > Number(t.score_max)))
      ? `Inteiro entre ${formatNumber(t.score_min)} e ${formatNumber(t.score_max)}` : null);
    if (!ok) return null;
    return {
      guessed_region: raw.guessed_region.trim() || null,
      guessed_vintage: vintage,
      guessed_grape: raw.guessed_grape.trim() || null,
      guessed_price: price,
      score,
      notes,
    };
  }

  function paintCard(card, k) {
    const s = states.get(k);
    const statusEl = card.querySelector('.save-state');
    const g = saved.get(k);
    card.classList.toggle('is-complete', isGuessComplete(g) && !drafts.has(k));
    card.classList.toggle('is-partial', !isGuessComplete(g) && isGuessStarted(g));
    if (!s) { statusEl.className = 'save-state'; statusEl.replaceChildren(isGuessComplete(g) ? 'Completo' : ''); return; }
    statusEl.className = `save-state ${s.state}`;
    statusEl.replaceChildren(STATE_TEXT[s.state] || '');
    if (s.state === 'error') {
      if (s.message) statusEl.append(h('span', {}, `: ${s.message}`));
      statusEl.append(h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: () => saver.retry(k) }, 'Tentar de novo'));
    }
  }

  function onSaveState(k, st, message, g, payload) {
    states.set(k, { state: st, message });
    if (st === 'saved') {
      saved.set(k, g);
      // Só descarta o rascunho se nada mudou depois deste envio
      if (payload && drafts.get(k) === payload._raw) drafts.delete(k);
      if (pending.get(k) === payload) pending.delete(k);
      drawProgress();
      drawChips();
      if (state.mode === 'vinho') {
        const w = wines[state.wIndex];
        currentEl.querySelectorAll('.chips-sm .chip').forEach((c, i) => {
          c.classList.toggle('complete', isGuessComplete(saved.get(key(w.id, participants[i].participant_id))));
        });
      }
    }
    if (st === 'error') toast(`Falha ao salvar um palpite: ${message}`, 'error', 6000);
    const card = view.querySelector(`.guess-card[data-key="${CSS.escape(k)}"]`);
    if (card) paintCard(card, k);
  }

  // ----- painel atual
  function drawPanel() {
    if (state.mode === 'participante') {
      const p = participants[state.pIndex];
      currentEl.replaceChildren(h('div', { class: 'current-banner' },
        h('span', { class: 'muted' }, `Participante ${state.pIndex + 1} de ${participants.length}`),
        h('span', { class: 'big' }, participantName(p))));
      cardsEl.replaceChildren(...wines.map((w) => guessCard(w, p, wineLabel(w), null)));
      prevBtn.disabled = state.pIndex === 0;
      nextBtn.textContent = state.pIndex === participants.length - 1 ? 'Concluir' : 'Próximo participante →';
      prevBtn.textContent = '← Anterior';
    } else {
      // Por vinho (11/11/2026): um participante por vez; "Próximo vinho" só depois do último participante.
      const w = wines[state.wIndex];
      const p = participants[state.wpIndex];
      const lastP = state.wpIndex === participants.length - 1;
      const lastW = state.wIndex === wines.length - 1;
      currentEl.replaceChildren(h('div', { class: 'current-banner' },
        h('span', { class: 'muted' }, `${wineLabel(w)} (${state.wIndex + 1} de ${wines.length}) · participante ${state.wpIndex + 1} de ${participants.length}`),
        h('span', { class: 'big' }, `${p.position}. ${participantName(p)}`)),
      h('div', { class: 'chips chips-sm', role: 'list', 'aria-label': 'Participantes deste vinho' },
        participants.map((x, i) => {
          const done = isGuessComplete(saved.get(key(w.id, x.participant_id)));
          return h('button', {
            type: 'button', role: 'listitem',
            class: `chip${done ? ' complete' : ''}`,
            'aria-current': i === state.wpIndex ? 'true' : null,
            'aria-label': `${x.position}. ${x.name}${done ? ' (completo)' : ''}`,
            onclick: () => goParticipantInWine(i),
          }, h('span', { class: 'chip-title' }, `${x.position}. ${x.name}`));
        })));
      cardsEl.replaceChildren(guessCard(w, p, wineLabel(w), null));
      prevBtn.disabled = state.wIndex === 0 && state.wpIndex === 0;
      prevBtn.textContent = state.wpIndex === 0 ? '← Vinho anterior' : '← Participante anterior';
      nextBtn.textContent = !lastP ? 'Próximo participante →' : (lastW ? 'Concluir' : 'Próximo vinho →');
      currentEl.querySelector('.chips-sm [aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    for (const [m, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', String(state.mode === m));
  }

  function show() {
    persist(); drawChips(); drawPanel();
    currentEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    cardsEl.querySelector('input')?.focus({ preventScroll: true });
  }

  /** Ficha do topo: participante (modo participante) ou vinho (modo vinho, recomeça do 1º participante). */
  function go(i) {
    if (state.mode === 'participante') state.pIndex = i;
    else { state.wIndex = i; state.wpIndex = 0; }
    show();
  }

  function goParticipantInWine(i) { state.wpIndex = i; show(); }

  prevBtn.addEventListener('click', () => {
    if (state.mode === 'participante') { go(state.pIndex - 1); return; }
    if (state.wpIndex > 0) state.wpIndex--;
    else if (state.wIndex > 0) { state.wIndex--; state.wpIndex = participants.length - 1; }
    show();
  });
  nextBtn.addEventListener('click', () => {
    if (state.mode === 'participante') {
      if (state.pIndex < participants.length - 1) go(state.pIndex + 1);
      else location.hash = `/degustacao/${id}`;
      return;
    }
    if (state.wpIndex < participants.length - 1) state.wpIndex++;
    else if (state.wIndex < wines.length - 1) { state.wIndex++; state.wpIndex = 0; }
    else { location.hash = `/degustacao/${id}`; return; }
    show();
  });
  for (const [m, b] of Object.entries(modeBtns)) {
    b.addEventListener('click', () => { state.mode = m; persist(); drawChips(); drawPanel(); });
  }
  revealBox.addEventListener('change', () => { state.reveal = revealBox.checked; persist(); drawChips(); drawPanel(); });

  const onBeforeUnload = (e) => { if (saver.busy) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);

  const usedRegions = data.guesses.map((g) => g.guessed_region);
  const usedGrapes = data.guesses.map((g) => g.guessed_grape);

  view.append(
    datalist('dl-op-regions', usedRegions, REGIONS),
    datalist('dl-op-grapes', usedGrapes, GRAPES),
    h('div', { class: 'row-between' },
      h('div', {}, h('h1', { style: 'margin:0' }, 'Registro de palpites'), h('p', { class: 'muted', style: 'margin:0' }, t.name)),
      h('a', { class: 'btn btn-ghost btn-sm', href: `#/degustacao/${id}` }, 'Painel da degustação')),
    h('div', {}, progressLabel, h('div', { class: 'progress', role: 'presentation' }, progressBar)),
    h('div', { class: 'row-between' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Modo de preenchimento' }, modeBtns.participante, modeBtns.vinho),
      h('label', { class: 'checkbox small' }, revealBox, 'Mostrar nomes reais dos vinhos')),
    reorderRow,
    reorderHint,
    chipsEl,
    currentEl,
    cardsEl,
    h('p', { class: 'small muted' }, 'Os palpites são salvos automaticamente enquanto você digita.'),
    h('div', { class: 'bottom-bar' }, prevBtn, nextBtn));

  drawProgress();
  drawChips();
  drawPanel();

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    // Envia o que estiver aguardando o debounce antes de sair da tela
    for (const k of [...saver.timers.keys()]) {
      saver.cancel(k);
      const payload = pending.get(k);
      if (payload) saver.flush(k, payload);
    }
  };
}
