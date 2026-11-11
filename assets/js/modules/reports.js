// Relatório da degustação: rankings, visão por vinho e por participante.
// Regras de acerto em scoring.js (CONTEXT.md §17).
import { api } from '../services/database.js';
import { tokenStore, prefs } from '../services/token-store.js';
import { h, statusBadge, emptyState, section, toast } from '../utils/dom.js';
import {
  formatDate, formatDateTime, formatMoney, formatNumber, formatText, formatVintage,
  isBlank, normalize, participantName, signed,
} from '../utils/format.js';
import { wineFacts } from './wines.js';
import {
  scoreGuess, participantRanking, wineRanking, RULES_TEXT,
} from './scoring.js';

const key = (w, p) => `${w}:${p}`;

// ----- comparações
const hit = (flag) => (flag ? h('span', { class: 'cmp match' }, '✓ acerto') : null);
function vintageDiff(guess, real) {
  if (isBlank(guess) || isBlank(real)) return null;
  const d = Number(guess) - Number(real);
  return d === 0 ? null : h('span', { class: 'cmp' }, `${signed(d, (x) => String(x))} ano(s)`);
}
const rankLabel = (r) => (r === null ? '—' : `${r}º`);
function priceCompare(guess, w) {
  if (isBlank(guess)) return null;
  const parts = [];
  const line = (label, real) => {
    if (isBlank(real)) return;
    const d = Number(guess) - Number(real);
    const p = Number(real) > 0 ? Math.round((d / Number(real)) * 100) : 0;
    const pct = p !== 0 ? ` (${signed(p, (x) => `${x}%`)})` : '';
    parts.push(h('span', { class: 'cmp' }, `vs. ${label}: ${d === 0 ? 'igual' : signed(d, formatMoney)}${d === 0 ? '' : pct}`));
  };
  line('cheio', w.price);
  line('desconto', w.discounted_price);
  return parts;
}

function stats(values) {
  const v = values.filter((x) => !isBlank(x)).map(Number);
  if (!v.length) return null;
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length };
}

function td(label, ...content) { return h('td', { 'data-label': label }, ...content); }

export async function renderReport({ params, outlet }) {
  const id = params.id;
  const token = tokenStore.get(id);
  let data = null;
  if (token) {
    try { data = await api.getTastingAdmin(id, token); } catch (err) { if (err.network) throw err; }
  }
  if (!data) {
    data = await api.getTastingPublic(id);
    if (!data.revealed) {
      outlet.append(h('div', { class: 'card stack' },
        h('h1', {}, data.tasting.name),
        h('p', {}, 'O relatório fica disponível depois que a degustação for finalizada.'),
        h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}` }, 'Voltar')));
      return;
    }
  }

  const { tasting: t, wines, participants, guesses } = data;
  const preview = t.status !== 'finalizada';
  const gmap = new Map(guesses.map((g) => [key(g.wine_id, g.participant_id), g]));
  const g = (w, p) => gmap.get(key(w.id, p.participant_id)) || {};

  // ----- rankings
  const pRank = participantRanking(wines, participants, g);
  const wRank = wineRanking(wines, participants, g);
  const pointsById = new Map(pRank.map((r) => [r.participant.participant_id, r]));

  const participantRankRows = pRank.map((r) => h('tr', {},
    td('Posição', h('strong', {}, rankLabel(r.rank))),
    td('Participante', h('strong', {}, participantName(r.participant))),
    td('Pontos', h('strong', {}, `${r.points} de ${r.max}`)),
    td('Região', String(r.hits.region)),
    td('Uva', String(r.hits.grape)),
    td('Safra', String(r.hits.vintage)),
    td('Preço', String(r.hits.price))));

  const wineRankRows = wRank.map((r) => h('tr', {},
    td('Posição', h('strong', {}, rankLabel(r.rank))),
    td('Vinho', h('strong', {}, `${r.wine.position}. ${r.wine.name}`), h('span', { class: 'cmp' }, [r.wine.country, r.wine.region].filter(Boolean).join(' · '))),
    td('Média', h('strong', {}, r.avg === null ? '—' : formatNumber(r.avg))),
    td('Menor / maior', r.avg === null ? '—' : `${formatNumber(r.min)} / ${formatNumber(r.max)}`),
    td('Notas', String(r.n)),
    td('Preço cheio', h('span', { class: 'nowrap' }, formatMoney(r.wine.price)))));

  const table = (cols, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'rtable' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, rows)));

  const overview = h('section', { class: 'card stack report-block' },
    h('h2', {}, 'Visão geral'),
    h('div', { class: 'grid-3' },
      h('div', {}, h('div', { class: 'small muted' }, 'Vinhos'), h('strong', {}, String(wines.length))),
      h('div', {}, h('div', { class: 'small muted' }, 'Participantes'), h('strong', {}, String(participants.length))),
      h('div', {}, h('div', { class: 'small muted' }, 'Escala de pontuação'), h('strong', {}, `${formatNumber(t.score_min)} a ${formatNumber(t.score_max)}`))),
    participants.length ? h('div', {}, h('h3', {}, 'Participantes (ordem)'),
      h('ol', {}, participants.map((p) => h('li', {}, participantName(p))))) : null,
    h('h3', {}, 'Ranking dos participantes (acertos)'),
    table(['Posição', 'Participante', 'Pontos', 'Região', 'Uva', 'Safra', 'Preço'], participantRankRows),
    h('p', { class: 'small muted' }, RULES_TEXT),
    h('h3', {}, 'Ranking dos vinhos (nota média)'),
    table(['Posição', 'Vinho', 'Média', 'Menor / maior', 'Notas', 'Preço cheio'], wineRankRows),
    h('p', { class: 'small muted' }, 'Empates dividem a mesma posição.'));

  // ----- por vinho
  const byWine = h('div', { class: 'stack' }, wines.map((w) => h('section', { class: 'card stack report-block' },
    h('h3', {}, `Vinho ${w.position} · ${w.name}`),
    wineFacts(w),
    h('div', { class: 'table-wrap' }, h('table', { class: 'rtable' },
      h('thead', {}, h('tr', {}, ['Participante', 'Região', 'Safra', 'Uva', 'Preço', 'Acertos', 'Nota', 'Observações'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {},
        h('tr', { class: 'real-row' },
          td('Participante', 'Dados reais'),
          td('Região', formatText(w.region)),
          td('Safra', formatVintage(w.vintage)),
          td('Uva', formatText(w.grape)),
          td('Preço', h('span', { class: 'nowrap' }, formatMoney(w.price)), isBlank(w.discounted_price) ? null : h('span', { class: 'cmp' }, `desc.: ${formatMoney(w.discounted_price)}`)),
          td('Acertos', '—'),
          td('Nota', '—'),
          td('Observações', '')),
        participants.map((p) => {
          const x = g(w, p);
          const s = scoreGuess(x, w);
          return h('tr', {},
            td('Participante', h('strong', {}, `${p.position}. ${participantName(p)}`)),
            td('Região', formatText(x.guessed_region), hit(s.items.region)),
            td('Safra', formatText(x.guessed_vintage), vintageDiff(x.guessed_vintage, w.vintage), hit(s.items.vintage)),
            td('Uva', formatText(x.guessed_grape), hit(s.items.grape)),
            td('Preço', h('span', { class: 'nowrap' }, formatMoney(x.guessed_price)), priceCompare(x.guessed_price, w), hit(s.items.price)),
            td('Acertos', h('strong', {}, `${s.points}/${s.max}`)),
            td('Nota', h('strong', {}, formatNumber(x.score))),
            td('Observações', formatText(x.notes)));
        })))))));

  // ----- por participante
  const byParticipant = h('div', { class: 'stack' }, participants.map((p) => {
    const s = stats(wines.map((w) => g(w, p).score));
    const r = pointsById.get(p.participant_id);
    return h('section', { class: 'card stack report-block' },
      h('div', { class: 'row-between' },
        h('h3', { style: 'margin:0' }, `${p.position}. ${participantName(p)}`),
        h('span', { class: 'small' },
          h('strong', {}, `${rankLabel(r.rank)} lugar · ${r.points} de ${r.max} pontos`),
          h('span', { class: 'muted' }, s ? ` · média das notas dadas: ${formatNumber(s.avg)}` : ' · sem notas'))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'rtable' },
        h('thead', {}, h('tr', {}, ['Vinho', 'Região', 'Safra', 'Uva', 'Preço', 'Acertos', 'Nota', 'Observações'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, wines.map((w) => {
          const x = g(w, p);
          const sc = scoreGuess(x, w);
          return h('tr', {},
            td('Vinho', h('strong', {}, `${w.position}. ${w.name}`)),
            td('Região', formatText(x.guessed_region), h('span', { class: 'cmp' }, `real: ${formatText(w.region)}`), hit(sc.items.region)),
            td('Safra', formatText(x.guessed_vintage), h('span', { class: 'cmp' }, `real: ${formatVintage(w.vintage)}`), vintageDiff(x.guessed_vintage, w.vintage), hit(sc.items.vintage)),
            td('Uva', formatText(x.guessed_grape), h('span', { class: 'cmp' }, `real: ${formatText(w.grape)}`), hit(sc.items.grape)),
            td('Preço', h('span', { class: 'nowrap' }, formatMoney(x.guessed_price)), h('span', { class: 'cmp' }, `real: ${formatMoney(w.price)}`), priceCompare(x.guessed_price, w), hit(sc.items.price)),
            td('Acertos', h('strong', {}, `${sc.points}/${sc.max}`)),
            td('Nota', h('strong', {}, formatNumber(x.score))),
            td('Observações', formatText(x.notes)));
        })))));
  }));

  // ----- abas (na impressão, ambas aparecem)
  const tabs = [
    { id: 'vinho', label: 'Por vinho', panel: byWine },
    { id: 'participante', label: 'Por participante', panel: byParticipant },
  ];
  let active = prefs.get('reportTab', 'vinho');
  const tabBtns = tabs.map((tab) => h('button', {
    type: 'button', role: 'tab', id: `tab-${tab.id}`, 'aria-controls': `panel-${tab.id}`,
  }, tab.label));
  const panels = tabs.map((tab) => h('div', { role: 'tabpanel', id: `panel-${tab.id}`, 'aria-labelledby': `tab-${tab.id}`, class: 'stack' },
    h('h2', { class: 'print-only' }, tab.label), tab.panel));
  function select(tabId, focus) {
    active = tabId; prefs.set('reportTab', tabId);
    tabs.forEach((tab, i) => {
      const on = tab.id === tabId;
      tabBtns[i].setAttribute('aria-selected', String(on));
      tabBtns[i].tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
      if (on && focus) tabBtns[i].focus();
    });
  }
  tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => select(tabs[i].id));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[n].id, true);
    });
  });

  outlet.append(
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, `Relatório · ${t.name}`),
        h('div', { class: 'meta' }, statusBadge(t.status), h('span', {}, formatDate(t.tasting_date)),
          t.finished_at ? h('span', { class: 'small' }, `finalizada em ${formatDateTime(t.finished_at)}`) : null)),
      h('div', { class: 'row no-print' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, 'Imprimir / Salvar em PDF'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => exportCsv(t, wines, participants, g) }, 'Exportar CSV'))),
    preview ? h('p', { class: 'notice notice-private' }, h('strong', {}, 'Prévia do organizador. '), 'Estes dados só ficarão públicos quando a degustação for finalizada.') : null,
    t.description ? h('p', {}, t.description) : null,
    overview,
    wines.length && participants.length
      ? section(null,
        h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Organização do relatório' }, tabBtns),
        h('div', { style: 'margin-top:16px' }, panels))
      : emptyState('Sem vinhos ou participantes para detalhar.'),
    h('p', { class: 'no-print' }, h('a', { href: `#/degustacao/${id}` }, '← Voltar à degustação')));
  select(active);
}

function exportCsv(t, wines, participants, g) {
  const header = ['degustacao', 'data', 'ordem_vinho', 'vinho', 'pais', 'regiao_real', 'uva_real', 'safra_real',
    'preco_cheio', 'preco_desconto', 'ordem_participante', 'participante', 'regiao_palpite', 'safra_palpite',
    'uva_palpite', 'preco_palpite', 'pontuacao', 'observacoes', 'pontos_acerto', 'pontos_possiveis'];
  const num = (v) => (isBlank(v) ? '' : String(v).replace('.', ','));
  const rows = [];
  for (const w of wines) {
    for (const p of participants) {
      const x = g(w, p);
      const s = scoreGuess(x, w);
      rows.push([t.name, t.tasting_date || '', w.position, w.name, w.country, w.region, w.grape, w.vintage,
        num(w.price), num(w.discounted_price), p.position, participantName(p), x.guessed_region, x.guessed_vintage,
        x.guessed_grape, num(x.guessed_price), num(x.score), x.notes, s.points, s.max]);
    }
  }
  const esc = (v) => {
    const s = isBlank(v) ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `﻿${[header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const slug = normalize(t.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'degustacao';
  const a = h('a', { href: url, download: `vinhofilos-${slug}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV gerado.');
}
