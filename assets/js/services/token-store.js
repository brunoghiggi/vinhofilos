// Guarda as chaves de controle das degustações criadas neste navegador.
// A chave nunca vai para URLs; o banco armazena apenas o hash SHA-256.

const KEY = 'vinhofilos.tokens.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function write(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); return true; } catch { return false; }
}

export const tokenStore = {
  get(id) { return read()[id] || null; },
  /** Retorna false se o navegador não permitir salvar (ex.: modo privado). */
  set(id, token) { const m = read(); m[id] = token; return write(m); },
  remove(id) { const m = read(); delete m[id]; write(m); },
  ids() { return Object.keys(read()); },
};

/** Preferências de interface (apenas conveniência local). */
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`vinhofilos.pref.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`vinhofilos.pref.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};
