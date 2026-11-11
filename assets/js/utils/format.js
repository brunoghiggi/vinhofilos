const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const STATUS_LABEL = {
  rascunho: 'Rascunho',
  em_andamento: 'Em andamento',
  finalizada: 'Finalizada',
};

/** Escala de pontuação da confraria: inteiros de 50 a 100 (ver CONTEXT.md §17). */
export const SCORE = Object.freeze({ min: 50, max: 100 });

export const isBlank =(v) => v === null || v === undefined || v === '';

export function formatMoney(v) {
  return isBlank(v) ? '—' : money.format(Number(v));
}

/** 'YYYY-MM-DD' → 'DD/MM/AAAA' sem conversão de fuso. */
export function formatDate(iso) {
  if (!iso) return 'Sem data';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const formatVintage = (v) => (isBlank(v) ? 'Não informada' : String(v));
export const formatText = (v) => (isBlank(v) ? '—' : String(v));

export function formatNumber(v, digits = 2) {
  return isBlank(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

/** Número para exibir em campo editável (vírgula decimal). */
export function toInputNumber(v) {
  return isBlank(v) ? '' : String(v).replace('.', ',');
}

/** Aceita "1.234,56", "1234.56", "R$ 89,90". Vazio → null; inválido → NaN. */
export function parseDecimal(input) {
  let s = String(input ?? '').replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Inteiro positivo; vazio → null; inválido → NaN. */
export function parseInteger(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

/** Normaliza texto para comparações (sem acento, minúsculo, espaços simples). */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function participantName(p) {
  return p.nickname ? `${p.name} (${p.nickname})` : p.name;
}

export function signed(n, formatter = (x) => formatNumber(x)) {
  if (n === 0) return 'igual';
  return `${n > 0 ? '+' : '−'}${formatter(Math.abs(n))}`;
}

/**
 * Título visível de uma degustação (11/11/2026). Mensais aparecem como
 * "Confraria do mês" até serem finalizadas; finalizadas mostram o tema
 * (public_theme só vem preenchido do banco depois da finalização).
 */
export function tastingTitle(t) {
  if (t.status === 'finalizada') return t.public_theme || t.name;
  return t.monthly_ref ? 'Confraria do mês' : t.name;
}
