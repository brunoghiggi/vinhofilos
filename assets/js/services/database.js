// Camada de dados. Interface única usada pelos módulos:
//
//   listParticipants()                       createParticipant({name, nickname})
//   updateParticipant(id, patch)             listTastings()
//   getTastingPublic(id)                     getTastingAdmin(id, token)
//   createTasting(data) → {id, token}        saveTasting(id, token, data)
//   deleteTasting(id, token)                 setTastingParticipants(id, token, ids)
//   startTasting(id, token)                  finishTasting(id, token)
//   saveGuess(id, token, guess)
//   ensureMonthlyTastings()                  claimTasting(id) → {id, token}
//   setTastingOrganizers(id, ids) → [{id, name, nickname}]
//
// Backend real: Supabase (tabelas + funções RPC em supabase/schema.sql).
// Sem configuração: backend de demonstração local (demo-backend.js).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { AppError, sleep } from '../utils/errors.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const P_COLS = 'id,name,nickname,active,created_at';
const T_COLS = 'id,name,tasting_date,description,status,score_min,score_max,created_at,started_at,finished_at,monthly_ref,organizer_ids,claimed';

let backend = null;
export const backendInfo = { demo: false };

export async function initDatabase() {
  const url = SUPABASE_URL.trim();
  const key = SUPABASE_ANON_KEY.trim();
  if (!url || !key) {
    const { createDemoBackend } = await import('./demo-backend.js');
    backend = createDemoBackend();
    backendInfo.demo = true;
    return;
  }
  assertPublicKey(key);
  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_ESM));
  } catch {
    throw new AppError('Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão e recarregue a página.', { network: true });
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  backend = createSupabaseBackend(client);
}

/** Impede o uso acidental de chave secreta no navegador. */
function assertPublicKey(key) {
  const msg = 'A chave configurada em config.js é SECRETA (service_role/secret). Remova-a imediatamente, gere uma nova no Supabase e use apenas a chave pública (anon/publishable).';
  if (key.startsWith('sb_secret_')) throw new AppError(msg);
  const parts = key.split('.');
  if (parts.length === 3) {
    let payload = null;
    try { payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* não é JWT legível */ }
    if (payload && payload.role === 'service_role') throw new AppError(msg);
  }
}

/** Fachada: api.metodo(...) delega ao backend ativo. */
export const api = new Proxy({}, {
  get(_, name) {
    return (...args) => {
      if (!backend) throw new AppError('Banco de dados não inicializado.');
      return backend[name](...args);
    };
  },
});

// ---------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------

function isNetworkError(error) {
  const msg = String(error?.message || error || '');
  return !error?.code && /fetch|network|load failed|timed? ?out|abort/i.test(msg);
}

function toAppError(error) {
  if (error instanceof AppError) return error;
  if (isNetworkError(error)) {
    return new AppError('Sem conexão com o servidor. Verifique a internet e tente novamente.', { network: true });
  }
  const known = {
    '23505': 'Registro duplicado.',
    '23503': 'Registro relacionado não encontrado.',
    '23514': 'Algum valor está fora do permitido.',
    '22P02': 'Algum valor tem formato inválido.',
    '22003': 'Algum número está fora do limite permitido.',
    '42501': 'Operação não permitida.',
  };
  return new AppError(known[error?.code] || error?.message || 'Erro inesperado.', { code: error?.code });
}

/** Executa uma consulta; leituras são repetidas em falhas de rede. */
async function run(build, attempts = 1) {
  for (let i = 0; ; i++) {
    try {
      const { data, error } = await build();
      if (error) throw error;
      return data;
    } catch (e) {
      const err = toAppError(e);
      if (!err.network || i >= attempts - 1) throw err;
      await sleep(600 * 2 ** i);
    }
  }
}

function createSupabaseBackend(sb) {
  const read = (build) => run(build, 3);
  const write = (build) => run(build, 1);
  const rpc = (fn, args, attempts = 1) => run(() => sb.rpc(fn, args), attempts);
  const tastingArgs = (d) => ({
    p_name: d.name,
    p_date: d.tasting_date || null,
    p_description: d.description || null,
    p_score_min: d.score_min,
    p_score_max: d.score_max,
    p_wines: d.wines,
  });

  return {
    listParticipants: () => read(() => sb.from('participants').select(P_COLS).order('name')),
    createParticipant: ({ name, nickname }) =>
      write(() => sb.from('participants').insert({ name, nickname: nickname || null }).select(P_COLS).single()),
    updateParticipant: (id, patch) =>
      write(() => sb.from('participants').update(patch).eq('id', id).select(P_COLS).single()),

    listTastings: () => read(() => sb.from('tastings').select(T_COLS).order('created_at', { ascending: false }).limit(500)),
    getTastingPublic: (id) => rpc('get_tasting_public', { p_tasting: id }, 3),
    getTastingAdmin: (id, token) => rpc('get_tasting_admin', { p_tasting: id, p_token: token }, 3),

    createTasting: (d) => rpc('create_tasting', tastingArgs(d)),
    saveTasting: (id, token, d) => rpc('save_tasting', { p_tasting: id, p_token: token, ...tastingArgs(d) }),
    deleteTasting: (id, token) => rpc('delete_tasting', { p_tasting: id, p_token: token }),
    setTastingParticipants: (id, token, ids) =>
      rpc('set_tasting_participants', { p_tasting: id, p_token: token, p_ids: ids }),
    startTasting: (id, token) => rpc('start_tasting', { p_tasting: id, p_token: token }),
    ensureMonthlyTastings: () => rpc('ensure_monthly_tastings', {}, 3),
    claimTasting: (id) => rpc('claim_tasting', { p_tasting: id }),
    setTastingOrganizers: (id, ids) => rpc('set_tasting_organizers', { p_tasting: id, p_ids: ids }),
    finishTasting: (id, token) => rpc('finish_tasting', { p_tasting: id, p_token: token }),
    // Upsert idempotente: o módulo de palpites cuida das novas tentativas.
    saveGuess: (id, token, g) => rpc('save_guess', {
      p_tasting: id,
      p_token: token,
      p_wine: g.wine_id,
      p_participant: g.participant_id,
      p_region: g.guessed_region,
      p_vintage: g.guessed_vintage,
      p_grape: g.guessed_grape,
      p_price: g.guessed_price,
      p_score: g.score,
      p_notes: g.notes,
    }),
  };
}
