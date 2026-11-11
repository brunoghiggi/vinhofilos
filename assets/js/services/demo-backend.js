// Backend de DEMONSTRAÇÃO: reproduz as regras de supabase/schema.sql
// usando o localStorage deste navegador. Serve apenas para testar a
// interface sem configurar o Supabase — os dados NÃO são compartilhados.

import { AppError, sleep } from '../utils/errors.js';

const KEY = 'vinhofilos.demo.v1';

// events: eventos especiais da agenda (no banco real, tabela agenda_events, editada pelo SQL Editor)
const empty = () => ({ participants: [], tastings: [], wines: [], presence: [], guesses: [], events: [] });

function load() {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return empty(); }
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { throw new AppError('Não foi possível salvar no armazenamento local do navegador.'); }
}

const fail = (msg) => { throw new AppError(msg); };
const now = () => new Date().toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const text = (v) => (blank(v) ? null : String(v).trim());

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function num(v, label, { int = false, min = 0, max = 1e9 } = {}) {
  if (blank(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || n < min || n > max) fail(`${label}: valor inválido.`);
  return n;
}

const publicTasting = (t) => {
  const c = clone(t);
  c.claimed = !!c.creator_token_hash;
  c.organizer_ids = c.organizer_ids || [];
  c.monthly_ref = c.monthly_ref || null;
  c.theme = c.theme || null;
  c.public_theme = c.status === 'finalizada' ? c.theme : null; // tema só depois de finalizar
  delete c.creator_token_hash;
  return c;
};
/** Visão pública: sem o tema secreto (só public_theme). */
const openTasting = (t) => { const c = publicTasting(t); delete c.theme; return c; };

function organizers(db, ids) {
  return (ids || []).map((id) => db.participants.find((p) => p.id === id)).filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, nickname: p.nickname }));
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Último domingo do mês (m: 0–11), em ISO. */
function lastSunday(y, m) {
  const d = new Date(Date.UTC(y, m + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((n) => n.toString(16).padStart(2, '0')).join('');

function details(db, id) {
  return clone({
    wines: db.wines.filter((w) => w.tasting_id === id).sort((a, b) => a.position - b.position),
    participants: db.presence.filter((p) => p.tasting_id === id).sort((a, b) => a.position - b.position)
      .map((tp) => {
        const p = db.participants.find((x) => x.id === tp.participant_id);
        return { participant_id: p.id, name: p.name, nickname: p.nickname, position: tp.position };
      }),
    guesses: db.guesses.filter((g) => g.tasting_id === id),
  });
}

async function assertCreator(db, id, token) {
  const t = db.tastings.find((x) => x.id === id);
  if (!t) fail('Degustação não encontrada.');
  if (!t.creator_token_hash) fail('Esta degustação ainda não tem organizador. Use "Assumir organização" na página dela.');
  if (!token || token.length < 32 || t.creator_token_hash !== await sha256(token)) {
    fail('Chave de controle inválida para esta degustação.');
  }
  return t;
}

function replaceWines(db, tastingId, wines) {
  wines = wines || [];
  if (!Array.isArray(wines)) fail('Lista de vinhos inválida.');
  if (wines.length > 50) fail('Máximo de 50 vinhos por degustação.');
  const keep = new Set();
  wines.forEach((w, i) => {
    const name = text(w.name);
    if (!name) fail(`Vinho ${i + 1}: o nome é obrigatório.`);
    const row = {
      position: i + 1,
      name,
      country: text(w.country),
      region: text(w.region),
      price: num(w.price, 'Preço'),
      discounted_price: num(w.discounted_price, 'Preço com desconto'),
      grape: text(w.grape),
      vintage: num(w.vintage, 'Safra', { int: true, min: 1800, max: 2100 }),
      notes: text(w.notes),
    };
    let existing = w.id && db.wines.find((x) => x.id === w.id && x.tasting_id === tastingId);
    if (existing) Object.assign(existing, row);
    else { existing = { id: uuid(), tasting_id: tastingId, ...row }; db.wines.push(existing); }
    keep.add(existing.id);
  });
  const removed = db.wines.filter((w) => w.tasting_id === tastingId && !keep.has(w.id)).map((w) => w.id);
  db.wines = db.wines.filter((w) => !removed.includes(w.id));
  db.guesses = db.guesses.filter((g) => !removed.includes(g.wine_id));
}

function adminView(db, t) {
  return { tasting: publicTasting(t), revealed: true, organizers: organizers(db, t.organizer_ids), ...details(db, t.id) };
}

export function createDemoBackend() {
  // Simula latência de rede para a interface se comportar como em produção.
  const tx = async (fn) => { await sleep(120); const db = load(); const r = await fn(db); save(db); return clone(r ?? null); };
  const q = async (fn) => { await sleep(80); return clone(await fn(load())); };

  return {
    listParticipants: () => q((db) => [...db.participants].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))),

    createParticipant: ({ name, nickname }) => tx((db) => {
      name = text(name);
      if (!name || name.length > 80) fail('Nome inválido.');
      if (nickname && nickname.length > 40) fail('Apelido muito longo.');
      const p = { id: uuid(), name, nickname: text(nickname), active: true, created_at: now() };
      db.participants.push(p);
      return p;
    }),

    updateParticipant: (id, patch) => tx((db) => {
      const p = db.participants.find((x) => x.id === id) || fail('Participante não encontrado.');
      if ('name' in patch) { const n = text(patch.name); if (!n || n.length > 80) fail('Nome inválido.'); p.name = n; }
      if ('nickname' in patch) p.nickname = text(patch.nickname);
      if ('active' in patch) p.active = !!patch.active;
      return p;
    }),

    listTastings: () => q((db) => db.tastings.map(openTasting).sort((a, b) => b.created_at.localeCompare(a.created_at))),

    getTastingPublic: (id) => q((db) => {
      const t = db.tastings.find((x) => x.id === id) || fail('Degustação não encontrada.');
      const out = { tasting: openTasting(t), organizers: organizers(db, t.organizer_ids), wine_count: db.wines.filter((w) => w.tasting_id === id).length, revealed: t.status === 'finalizada' };
      return out.revealed ? { ...out, ...details(db, id) } : out;
    }),

    getTastingAdmin: (id, token) => q(async (db) => adminView(db, await assertCreator(db, id, token))),

    createTasting: (d) => tx(async (db) => {
      if (!text(d.name)) fail('O nome da degustação é obrigatório.');
      const [min, max] = [50, 100]; // escala fixa da confraria
      const token = newToken();
      const t = {
        id: uuid(), name: text(d.name), tasting_date: d.tasting_date || null, description: text(d.description),
        status: 'rascunho', score_min: min, score_max: max, creator_token_hash: await sha256(token),
        created_at: now(), started_at: null, finished_at: null, monthly_ref: null, organizer_ids: [],
      };
      db.tastings.push(t);
      replaceWines(db, t.id, d.wines);
      return { id: t.id, token };
    }),

    saveTasting: (id, token, d) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status === 'finalizada') fail('Degustação finalizada não pode ser alterada.');
      if (!text(d.name)) fail('O nome da degustação é obrigatório.');
      if (t.status === 'em_andamento' && !(d.wines || []).length) fail('Uma degustação em andamento precisa de pelo menos um vinho.');
      const [min, max] = [50, 100]; // escala fixa da confraria
      if (db.guesses.some((g) => g.tasting_id === id && g.score !== null && (g.score < min || g.score > max))) {
        fail(`Há pontuações já registradas fora da nova escala (${min} a ${max}).`);
      }
      Object.assign(t, { name: text(d.name), tasting_date: d.tasting_date || null, description: text(d.description), score_min: min, score_max: max });
      replaceWines(db, id, d.wines);
      return adminView(db, t);
    }),

    deleteTasting: (id, token) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status !== 'rascunho') fail('Somente degustações em rascunho podem ser excluídas.');
      if (t.monthly_ref) fail('A degustação mensal não pode ser excluída (seria recriada automaticamente).');
      db.tastings = db.tastings.filter((x) => x.id !== id);
      db.wines = db.wines.filter((x) => x.tasting_id !== id);
      db.presence = db.presence.filter((x) => x.tasting_id !== id);
      db.guesses = db.guesses.filter((x) => x.tasting_id !== id);
    }),

    setTastingParticipants: (id, token, ids) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status === 'finalizada') fail('Degustação finalizada não pode ser alterada.');
      ids = ids || [];
      if (new Set(ids).size !== ids.length) fail('Um participante não pode aparecer duas vezes na mesma degustação.');
      if (ids.some((pid) => !db.participants.some((p) => p.id === pid))) fail('Participante não encontrado.');
      if (t.status === 'em_andamento' && ids.length === 0) fail('Uma degustação em andamento precisa de pelo menos um participante.');
      db.presence = db.presence.filter((x) => x.tasting_id !== id);
      ids.forEach((pid, i) => db.presence.push({ id: uuid(), tasting_id: id, participant_id: pid, position: i + 1 }));
      db.guesses = db.guesses.filter((g) => g.tasting_id !== id || ids.includes(g.participant_id));
      return adminView(db, t);
    }),

    startTasting: (id, token) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status !== 'rascunho') fail('A degustação já foi iniciada.');
      if (!db.wines.some((w) => w.tasting_id === id)) fail('Cadastre pelo menos um vinho antes de iniciar.');
      if (!db.presence.some((p) => p.tasting_id === id)) fail('Selecione pelo menos um participante antes de iniciar.');
      Object.assign(t, { status: 'em_andamento', started_at: now() });
      return adminView(db, t);
    }),

    saveGuess: (id, token, g) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status !== 'em_andamento') fail('Palpites só podem ser registrados com a degustação em andamento.');
      if (!db.wines.some((w) => w.id === g.wine_id && w.tasting_id === id)) fail('Este vinho não pertence à degustação.');
      if (!db.presence.some((p) => p.participant_id === g.participant_id && p.tasting_id === id)) fail('Este participante não está presente na degustação.');
      const score = num(g.score, 'Pontuação', { int: true, min: -1e5, max: 1e5 });
      if (score !== null && (score < t.score_min || score > t.score_max)) fail(`A pontuação deve estar entre ${t.score_min} e ${t.score_max}.`);
      const row = {
        guessed_region: text(g.guessed_region),
        guessed_vintage: num(g.guessed_vintage, 'Safra', { int: true, min: 1800, max: 2100 }),
        guessed_grape: text(g.guessed_grape),
        guessed_price: num(g.guessed_price, 'Preço'),
        score,
        notes: text(g.notes),
        updated_at: now(),
      };
      let existing = db.guesses.find((x) => x.wine_id === g.wine_id && x.participant_id === g.participant_id);
      if (existing) Object.assign(existing, row);
      else {
        existing = { id: uuid(), tasting_id: id, wine_id: g.wine_id, participant_id: g.participant_id, created_at: now(), ...row };
        db.guesses.push(existing);
      }
      return existing;
    }),

    ensureMonthlyTastings: () => tx((db) => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const [y, m] = today.split('-').map(Number);
      let created = 0;
      // Mês atual + 11 seguintes (nunca meses passados)
      for (let k = 0; k < 12; k++) {
        const yy = y + Math.floor((m - 1 + k) / 12);
        const mm = (m - 1 + k) % 12;
        const ref = `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
        if (db.tastings.some((t) => t.monthly_ref === ref)) continue;
        if (db.events.some((e) => e.replaces_month === ref)) continue; // mês ocupado por evento especial
        db.tastings.push({
          id: uuid(), name: `Confraria de ${MONTHS[mm]} de ${yy}`, tasting_date: lastSunday(yy, mm), description: null,
          status: 'rascunho', score_min: 50, score_max: 100, creator_token_hash: null,
          created_at: now(), started_at: null, finished_at: null, monthly_ref: ref, organizer_ids: [], theme: null,
        });
        created++;
      }
      return created;
    }),

    setTastingTheme: (id, token, theme) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status === 'finalizada') fail('Degustação finalizada não pode ser alterada.');
      const v = text(theme);
      if (v && v.length > 150) fail('O tema pode ter no máximo 150 caracteres.');
      t.theme = v;
    }),

    listAgendaEvents: () => q((db) => [...db.events].sort((a, b) => a.event_date.localeCompare(b.event_date))),

    claimTasting: (id) => tx(async (db) => {
      const t = db.tastings.find((x) => x.id === id) || fail('Degustação não encontrada.');
      if (t.creator_token_hash || t.status === 'finalizada') fail('Esta degustação já tem um organizador com a chave de controle.');
      const token = newToken();
      t.creator_token_hash = await sha256(token);
      return { id, token };
    }),

    setTastingOrganizers: (id, ids) => tx((db) => {
      const t = db.tastings.find((x) => x.id === id) || fail('Degustação não encontrada.');
      if (t.status === 'finalizada') fail('Degustação finalizada não pode ser alterada.');
      ids = ids || [];
      if (ids.length > 10) fail('No máximo 10 organizadores.');
      if (new Set(ids).size !== ids.length) fail('Um organizador não pode aparecer duas vezes.');
      if (ids.some((pid) => !db.participants.some((p) => p.id === pid))) fail('Participante não encontrado.');
      t.organizer_ids = [...ids];
      return organizers(db, ids);
    }),

    finishTasting: (id, token) => tx(async (db) => {
      const t = await assertCreator(db, id, token);
      if (t.status !== 'em_andamento') fail('Somente degustações em andamento podem ser finalizadas.');
      Object.assign(t, { status: 'finalizada', finished_at: now() });
      return adminView(db, t);
    }),
  };
}
