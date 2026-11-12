// Gráficos do relatório (12/11/2026). HTML + CSS puros, sem biblioteca:
// barras horizontais de uma cor só (a cor de destaque do tema), valores sempre
// escritos ao lado da barra e tabelas completas logo abaixo no relatório,
// então nenhuma informação depende só da cor. Dica ao passar o mouse/tocar.
import { h } from '../utils/dom.js';
import { formatNumber, participantName } from '../utils/format.js';
import { scoreGuess } from './scoring.js';

const pct = (v, lo, hi) => (hi > lo ? Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)) : 0);

function chartCard(title, subtitle, rows, note) {
  return h('figure', { class: 'chart' },
    h('figcaption', {}, h('strong', {}, title), subtitle ? h('span', { class: 'small muted' }, subtitle) : null),
    rows.length ? h('ul', { class: 'chart-rows' }, rows) : h('p', { class: 'small muted' }, 'Sem dados ainda.'),
    note ? h('p', { class: 'small muted chart-note' }, note) : null);
}

function barRow(label, value, widthPct, valueText, tip) {
  return h('li', { class: 'chart-row', title: tip, tabindex: '0', 'aria-label': tip },
    h('span', { class: 'chart-label' }, label),
    h('span', { class: 'chart-track' }, h('span', { class: 'chart-bar', style: `width:${widthPct.toFixed(1)}%` })),
    h('span', { class: 'chart-value' }, valueText));
}

/** Nota média de cada vinho, com a faixa da menor à maior nota. */
function wineScoresChart(wRank, t) {
  const lo = Number(t.score_min);
  const hi = Number(t.score_max);
  const rows = wRank.filter((r) => r.avg !== null).map((r) => {
    const tip = `${r.wine.name}: média ${formatNumber(r.avg)} (menor ${formatNumber(r.min)}, maior ${formatNumber(r.max)}, ${r.n} nota(s))`;
    return h('li', { class: 'chart-row', title: tip, tabindex: '0', 'aria-label': tip },
      h('span', { class: 'chart-label' }, `${r.wine.position}. ${r.wine.name}`),
      h('span', { class: 'chart-track chart-track-range' },
        h('span', { class: 'chart-range', style: `left:${pct(r.min, lo, hi).toFixed(1)}%;width:${(pct(r.max, lo, hi) - pct(r.min, lo, hi)).toFixed(1)}%` }),
        h('span', { class: 'chart-dot', style: `left:${pct(r.avg, lo, hi).toFixed(1)}%` })),
      h('span', { class: 'chart-value' }, formatNumber(r.avg)));
  });
  return chartCard('Nota média por vinho', `escala de ${formatNumber(lo)} a ${formatNumber(hi)}`, rows,
    rows.length ? 'Ponto = média · faixa = da menor à maior nota recebida.' : null);
}

/** Pontos de acerto de cada participante (do 1º ao último). */
function participantPointsChart(pRank) {
  const top = Math.max(1, ...pRank.map((r) => r.max));
  const rows = pRank.filter((r) => r.max > 0).map((r) => barRow(
    participantName(r.participant), r.points, pct(r.points, 0, top), `${r.points}/${r.max}`,
    `${participantName(r.participant)}: ${r.points} de ${r.max} pontos (${r.rank}º lugar)`));
  return chartCard('Pontos de acerto por participante', 'região, uva, safra e preço', rows);
}

/** Em que item o grupo mais acerta: % de acertos entre os palpites que contam. */
function hitRateChart(wines, participants, g) {
  const items = [['region', 'Região'], ['grape', 'Uva'], ['vintage', 'Safra'], ['price', 'Preço']];
  const tally = Object.fromEntries(items.map(([k]) => [k, { hit: 0, n: 0 }]));
  for (const w of wines) {
    for (const p of participants) {
      const s = scoreGuess(g(w, p), w);
      for (const [k] of items) {
        if (s.items[k] === null) continue;
        tally[k].n++;
        if (s.items[k]) tally[k].hit++;
      }
    }
  }
  const rows = items.filter(([k]) => tally[k].n > 0).map(([k, label]) => {
    const { hit, n } = tally[k];
    const rate = (hit / n) * 100;
    return barRow(label, rate, rate, `${Math.round(rate)}%`, `${label}: ${hit} acerto(s) em ${n} palpite(s) (${Math.round(rate)}%)`);
  });
  return chartCard('Taxa de acerto por item', 'todos os participantes e vinhos', rows);
}

export function reportCharts({ t, wines, participants, g, pRank, wRank }) {
  if (!wines.length || !participants.length) return null;
  return h('section', { class: 'card stack report-block' },
    h('h2', {}, 'Gráficos'),
    h('div', { class: 'chart-grid' },
      wineScoresChart(wRank, t),
      participantPointsChart(pRank),
      hitRateChart(wines, participants, g)));
}
