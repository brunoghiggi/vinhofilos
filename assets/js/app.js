import { initDatabase, backendInfo } from './services/database.js';
import { route, startRouter } from './router.js';
import { h } from './utils/dom.js';
import { renderHome, renderHistory, renderTastingDetail } from './modules/tastings.js';
import { renderParticipants, renderPresence } from './modules/participants.js';
import { renderTastingForm } from './modules/wines.js';
import { renderOperation } from './modules/guesses.js';
import { renderReport } from './modules/reports.js';

async function main() {
  const outlet = document.getElementById('main');
  try {
    await initDatabase();
  } catch (err) {
    outlet.replaceChildren(h('div', { class: 'card stack error-card', role: 'alert' },
      h('h1', {}, 'Não foi possível iniciar'), h('p', {}, err.message)));
    return;
  }

  if (backendInfo.demo) {
    document.getElementById('banner').append(h('div', { class: 'demo-banner', role: 'note' },
      h('strong', {}, 'Modo demonstração. '),
      'O Supabase ainda não foi configurado: os dados ficam só neste navegador. Veja o README para configurar.'));
  }

  route('/', renderHome);
  route('/participantes', renderParticipants);
  route('/historico', renderHistory);
  route('/degustacao/nova', renderTastingForm);
  route('/degustacao/:id', renderTastingDetail);
  route('/degustacao/:id/editar', renderTastingForm);
  route('/degustacao/:id/participantes', renderPresence);
  route('/degustacao/:id/operar', renderOperation);
  route('/degustacao/:id/relatorio', renderReport);

  startRouter(outlet);
}

main();
