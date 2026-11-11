import { h } from './dom.js';

// Sugestões para agilizar a digitação (o usuário pode digitar qualquer valor).
export const COUNTRIES = [
  'Brasil', 'Argentina', 'Chile', 'Uruguai', 'Portugal', 'França', 'Itália', 'Espanha',
  'Alemanha', 'Áustria', 'Estados Unidos', 'África do Sul', 'Austrália', 'Nova Zelândia', 'Grécia', 'Hungria',
];

export const REGIONS = [
  'Mendoza', 'Vale de Uco', 'Salta', 'Patagônia', 'Vale Central', 'Vale do Maipo', 'Vale do Colchagua',
  'Vale de Casablanca', 'Serra Gaúcha', 'Vale dos Vinhedos', 'Campanha Gaúcha', 'Serra Catarinense',
  'Vale do São Francisco', 'Canelones', 'Douro', 'Alentejo', 'Dão', 'Vinho Verde', 'Bordeaux', 'Borgonha',
  'Champagne', 'Vale do Rhône', 'Vale do Loire', 'Alsácia', 'Toscana', 'Piemonte', 'Vêneto', 'Puglia',
  'Sicília', 'Rioja', 'Ribera del Duero', 'Priorat', 'Mosel', 'Napa Valley', 'Sonoma', 'Barossa Valley',
  'Stellenbosch', 'Marlborough',
];

export const GRAPES = [
  'Cabernet Sauvignon', 'Merlot', 'Malbec', 'Pinot Noir', 'Syrah', 'Tannat', 'Carménère', 'Tempranillo',
  'Sangiovese', 'Nebbiolo', 'Touriga Nacional', 'Cabernet Franc', 'Grenache', 'Zinfandel', 'Pinotage',
  'Corte bordalês', 'Blend', 'Chardonnay', 'Sauvignon Blanc', 'Riesling', 'Pinot Grigio', 'Alvarinho',
  'Torrontés', 'Moscato', 'Viognier', 'Chenin Blanc', 'Gewürztraminer',
];

/** Cria um <datalist> com os valores (sem repetição, ordem preservada). */
export function datalist(id, ...lists) {
  const seen = new Set();
  const values = [];
  for (const v of lists.flat()) {
    const s = String(v ?? '').trim();
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); values.push(s); }
  }
  return h('datalist', { id }, values.map((v) => h('option', { value: v })));
}
