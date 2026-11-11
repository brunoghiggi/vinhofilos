// Regras de acerto e rankings (CONTEXT.md §17).
// Para mudar a regra, altere apenas RULES abaixo.
import { isBlank, normalize } from '../utils/format.js';

export const RULES = Object.freeze({
  pointsPerItem: 1,      // região, uva, safra e preço valem 1 ponto cada
  priceTolerance: 0.15,  // preço acerta se ficar a até 15% do preço CHEIO
  minTextLength: 3,      // evita que palpites curtos ("a") "contenham" o real
});

export const RULES_TEXT = 'Acertos: 1 ponto por item — região e uva acertam quando um texto contém o outro '
  + '(sem diferenciar acentos e maiúsculas); safra precisa ser exata; preço acerta se ficar a até 15% do preço cheio. '
  + 'Itens sem dado real não contam para ninguém.';

/** Região/uva: acerta se um texto normalizado contém o outro. */
export function textMatches(guess, real) {
  if (isBlank(guess) || isBlank(real)) return false;
  const g = normalize(guess);
  const r = normalize(real);
  if (g.length < RULES.minTextLength && g !== r) return false;
  return g.includes(r) || r.includes(g);
}

/**
 * Avalia um palpite contra o vinho real.
 * Cada item: true (acerto), false (erro/sem palpite) ou null (sem dado real — não pontua).
 */
export function scoreGuess(guess = {}, wine) {
  const items = {
    region: isBlank(wine.region) ? null : textMatches(guess.guessed_region, wine.region),
    grape: isBlank(wine.grape) ? null : textMatches(guess.guessed_grape, wine.grape),
    vintage: isBlank(wine.vintage) ? null : (!isBlank(guess.guessed_vintage) && Number(guess.guessed_vintage) === Number(wine.vintage)),
    price: isBlank(wine.price) || Number(wine.price) <= 0 ? null
      : (!isBlank(guess.guessed_price)
        && Math.abs(Number(guess.guessed_price) - Number(wine.price)) <= Number(wine.price) * RULES.priceTolerance + 1e-9),
  };
  const scorable = Object.values(items).filter((v) => v !== null);
  return {
    items,
    points: scorable.filter(Boolean).length * RULES.pointsPerItem,
    max: scorable.length * RULES.pointsPerItem,
  };
}

/** Posição com empates compartilhados (1, 1, 3…). */
function withRanks(list, valueOf) {
  let prev = null;
  return list.map((item, i) => {
    const v = valueOf(item);
    const rank = prev && prev.v === v ? prev.rank : i + 1;
    prev = { v, rank };
    return { ...item, rank };
  });
}

/** Ranking dos participantes pelo total de pontos de acerto. */
export function participantRanking(wines, participants, getGuess) {
  const rows = participants.map((p) => {
    const hits = { region: 0, grape: 0, vintage: 0, price: 0 };
    let points = 0;
    let max = 0;
    for (const w of wines) {
      const s = scoreGuess(getGuess(w, p), w);
      points += s.points;
      max += s.max;
      for (const k of Object.keys(hits)) if (s.items[k]) hits[k]++;
    }
    return { participant: p, points, max, hits };
  });
  rows.sort((a, b) => b.points - a.points || a.participant.position - b.participant.position);
  return withRanks(rows, (r) => r.points);
}

/** Ranking dos vinhos pela nota média; vinhos sem nota ficam no fim, sem posição. */
export function wineRanking(wines, participants, getGuess) {
  const rows = wines.map((w) => {
    const scores = participants.map((p) => getGuess(w, p).score).filter((s) => !isBlank(s)).map(Number);
    return {
      wine: w,
      n: scores.length,
      avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
    };
  });
  const rated = rows.filter((r) => r.avg !== null)
    .sort((a, b) => b.avg - a.avg || a.wine.position - b.wine.position);
  const unrated = rows.filter((r) => r.avg === null).map((r) => ({ ...r, rank: null }));
  // Empate na média arredondada a 2 casas, que é o que aparece na tela
  return [...withRanks(rated, (r) => Math.round(r.avg * 100)), ...unrated];
}
