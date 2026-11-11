// Início, histórico e detalhe da degustação (visão pública e do organizador).
import { api } from '../services/database.js';
import { tokenStore } from '../services/token-store.js';
import { navigate, refresh } from '../router.js';
import {
  h, append, toast, confirmDialog, statusBadge, emptyState, section, busy, copyText, field,
} from '../utils/dom.js';
import { formatDate, formatDateTime, normalize, participantName } from '../utils/format.js';
import { wineFacts } from './wines.js';
import { guessCompleteness } from './guesses.js';

// ---------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------

function tastingList(items, mine = new Set()) {
  return h('ul', { class: 'list' }, items.map((t) => h('li', {},
    h('a', { class: 'tasting-card', href: `#/degustacao/${t.id}` },
      h('div', { class: 'tc-main' },
        h('strong', {}, t.name),
        h('span', { class: 'muted small' }, formatDate(t.tasting_date))),
      h('div', { class: 'tc-meta' },
        mine.has(t.id) ? h('span', { class: 'badge badge-mine' }, 'Você organiza') : null,
        statusBadge(t.status))))));
}

/** Diálogo exibido logo após criar: explica e permite copiar a chave. */
export async function showTokenDialog(token, { saved = true } = {}) {
  const box = h('div', { class: 'token-box' }, token);
  const copyBtn = h('button', {
    type: 'button', class: 'btn btn-secondary btn-sm',
    onclick: async () => toast(await copyText(token) ? 'Chave copiada.' : 'Não foi possível copiar; selecione e copie manualmente.'),
  }, 'Copiar chave');
  await confirmDialog({
    title: 'Guarde a chave de controle',
    content: h('div', { class: 'stack' },
      h('p', {}, saved
        ? 'Este navegador já está autorizado a operar a degustação. Se você limpar os dados do navegador ou quiser operar em outro aparelho, vai precisar desta chave.'
        : 'ATENÇÃO: este navegador não permitiu salvar a chave (ex.: modo privado). Copie e guarde a chave agora; sem ela você perde o controle da degustação.'),
      box, copyBtn,
      h('p', { class: 'small muted' }, 'Não compartilhe: quem tiver a chave pode alterar a degustação e ver os vinhos antes da revelação.')),
    confirmText: 'Entendi',
    cancelText: null,
  });
}

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------

export async function renderHome({ outlet }) {
  const tastings = await api.listTastings();
  const mine = new Set(tokenStore.ids());
  const myOpen = tastings.filter((t) => mine.has(t.id) && t.status !== 'finalizada');
  const open = tastings.filter((t) => t.status !== 'finalizada' && !mine.has(t.id)).slice(0, 8);
  const finished = tastings.filter((t) => t.status === 'finalizada').slice(0, 6);

  outlet.append(
    h('section', { class: 'hero' },
      h('h1', {}, 'Vinhófilos'),
      h('p', { class: 'lead' }, 'Degustações às cegas da confraria: prepare o encontro, registre os palpites de cada participante e revele tudo no final.'),
      h('div', { class: 'hero-actions' },
        h('a', { class: 'btn btn-primary btn-lg', href: '#/degustacao/nova' }, 'Criar degustação'),
        h('a', { class: 'btn btn-secondary btn-lg', href: '#/participantes' }, 'Participantes'),
        h('a', { class: 'btn btn-secondary btn-lg', href: '#/historico' }, 'Histórico'))),
    myOpen.length ? section('Suas degustações em aberto', tastingList(myOpen, mine)) : null,
    section('Em preparação ou andamento', open.length ? tastingList(open, mine) : emptyState('Nenhuma outra degustação em aberto.')),
    section('Finalizadas recentemente',
      finished.length ? tastingList(finished, mine) : emptyState('Ainda não há degustações finalizadas.'),
      finished.length ? h('p', { class: 'small' }, h('a', { href: '#/historico' }, 'Ver histórico completo →')) : null),
  );
}

// ---------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------

export async function renderHistory({ outlet }) {
  const all = (await api.listTastings()).filter((t) => t.status === 'finalizada');
  const sortKey = (t) => t.tasting_date || (t.finished_at || '').slice(0, 10);
  all.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const mine = new Set(tokenStore.ids());

  const search = h('input', { type: 'search', placeholder: 'Nome da degustação', autocomplete: 'off' });
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  const results = h('div', { 'aria-live': 'polite' });

  function draw() {
    const q = normalize(search.value);
    const items = all.filter((t) => {
      const d = sortKey(t);
      return (!q || normalize(t.name).includes(q))
        && (!from.value || d >= from.value)
        && (!to.value || d <= to.value);
    });
    results.replaceChildren(
      h('p', { class: 'small muted' }, `${items.length} degustação(ões) finalizada(s)`),
      items.length ? tastingList(items, mine) : emptyState('Nenhuma degustação encontrada.'));
  }
  [search, from, to].forEach((el) => el.addEventListener('input', draw));

  outlet.append(
    h('h1', {}, 'Histórico'),
    h('div', { class: 'card grid-3' },
      field('Buscar', search), field('De', from), field('Até', to)),
    results);
  draw();
}

// ---------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------

export async function renderTastingDetail({ params, outlet }) {
  const id = params.id;
  const token = tokenStore.get(id);
  if (token) {
    try {
      const data = await api.getTastingAdmin(id, token);
      renderAdmin(outlet, data, token);
      return;
    } catch (err) {
      if (err.network) throw err;
      tokenStore.remove(id);
      toast('A chave de controle salva neste navegador não vale para esta degustação e foi descartada.', 'error', 6000);
    }
  }
  const pub = await api.getTastingPublic(id);
  renderPublic(outlet, pub);
}

function headBlock(t, extra) {
  return h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, t.name),
      h('div', { class: 'meta' }, statusBadge(t.status), h('span', {}, formatDate(t.tasting_date)), extra || null)),
  );
}

function renderPublic(outlet, pub) {
  const t = pub.tasting;
  outlet.append(
    headBlock(t),
    t.description ? h('p', {}, t.description) : null,
    pub.revealed
      ? h('div', { class: 'card stack' },
        h('p', {}, 'Degustação finalizada — vinhos e palpites foram revelados.'),
        h('a', { class: 'btn btn-primary btn-lg', href: `#/degustacao/${t.id}/relatorio` }, 'Ver relatório'))
      : h('div', { class: 'card stack' },
        h('p', {}, h('strong', {}, `${pub.wine_count} vinho(s)`), ' nesta degustação.'),
        h('p', { class: 'muted' }, 'Os dados reais dos vinhos, os participantes e os palpites ficam ocultos até a finalização.')),
    pub.revealed ? null : importTokenBlock(t.id),
  );
}

function importTokenBlock(id) {
  const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const btn = h('button', { type: 'submit', class: 'btn btn-secondary' }, 'Usar chave');
  return h('details', { class: 'card' },
    h('summary', {}, 'Sou o organizador e tenho a chave de controle'),
    h('form', {
      class: 'stack', style: 'margin-top:12px',
      onsubmit: async (e) => {
        e.preventDefault();
        const token = input.value.trim();
        if (!token) return;
        await busy(btn, async () => {
          try {
            await api.getTastingAdmin(id, token);
            if (!tokenStore.set(id, token)) toast('O navegador não permitiu guardar a chave; ela valerá só até recarregar.', 'error');
            toast('Chave aceita. Este navegador agora controla a degustação.', 'success');
            refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    }, field('Chave de controle', input), btn));
}

function renderAdmin(outlet, data, token) {
  const { tasting: t, wines, participants, guesses } = data;
  const id = t.id;
  const canStart = wines.length > 0 && participants.length > 0;

  const actions = h('div', { class: 'card stack' });
  if (t.status === 'rascunho') {
    const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', disabled: !canStart }, 'Iniciar degustação');
    startBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Iniciar degustação?',
        message: `${participants.length} participante(s) e ${wines.length} vinho(s). Depois de iniciar, você poderá registrar os palpites. Vinhos e participantes ainda poderão ser ajustados.`,
        confirmText: 'Iniciar',
      });
      if (!ok) return;
      await busy(startBtn, async () => {
        try { await api.startTasting(id, token); toast('Degustação iniciada.', 'success'); navigate(`/degustacao/${id}/operar`); }
        catch (err) { toast(err.message, 'error'); }
      });
    });
    append(actions, [
      h('h2', {}, 'Preparação'),
      h('ul', { class: 'checklist' },
        h('li', { class: wines.length ? 'ok' : 'no' }, `Vinhos cadastrados: ${wines.length}`),
        h('li', { class: participants.length ? 'ok' : 'no' }, `Participantes do dia: ${participants.length}`)),
      h('div', { class: 'grid-2' },
        h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}/editar` }, 'Editar dados e vinhos'),
        h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}/participantes` }, 'Participantes do dia')),
      startBtn,
      canStart ? null : h('p', { class: 'small muted' }, 'Para iniciar é preciso ao menos 1 vinho e 1 participante.')]);
  } else if (t.status === 'em_andamento') {
    const { complete, total } = guessCompleteness(wines, participants, guesses);
    const finishBtn = h('button', { type: 'button', class: 'btn btn-danger-outline btn-block' }, 'Finalizar degustação');
    finishBtn.addEventListener('click', () => finishFlow(data, token, finishBtn));
    actions.append(
      h('h2', {}, 'Degustação em andamento'),
      h('p', {}, `Palpites completos: ${complete} de ${total}.`),
      h('a', { class: 'btn btn-primary btn-lg btn-block', href: `#/degustacao/${id}/operar` }, 'Registrar palpites'),
      h('div', { class: 'grid-2' },
        h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}/participantes` }, 'Participantes do dia'),
        h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}/editar` }, 'Editar vinhos')),
      h('a', { class: 'btn btn-ghost', href: `#/degustacao/${id}/relatorio` }, 'Prévia do relatório'),
      finishBtn);
  } else {
    actions.append(
      h('p', {}, `Finalizada em ${formatDateTime(t.finished_at)}. Os dados estão públicos.`),
      h('a', { class: 'btn btn-primary btn-lg btn-block', href: `#/degustacao/${id}/relatorio` }, 'Ver relatório'));
  }

  const hidden = t.status !== 'finalizada';
  outlet.append(
    headBlock(t, h('span', { class: 'badge badge-mine' }, 'Você organiza')),
    t.description ? h('p', {}, t.description) : null,
    actions,
    section(`Vinhos (${wines.length})`,
      hidden ? h('p', { class: 'notice notice-private small' }, 'Dados reais visíveis apenas para você até a finalização.') : null,
      wines.length
        ? h('div', { class: 'stack' }, wines.map((w) => h('div', { class: 'card' },
          h('h3', {}, `${w.position}. ${w.name}`), wineFacts(w))))
        : emptyState('Nenhum vinho cadastrado.', h('a', { href: `#/degustacao/${id}/editar` }, 'Adicionar vinhos'))),
    section(`Participantes do dia (${participants.length})`,
      participants.length
        ? h('ol', {}, participants.map((p) => h('li', {}, participantName(p))))
        : emptyState('Nenhum participante selecionado.', h('a', { href: `#/degustacao/${id}/participantes` }, 'Selecionar participantes'))),
    keyBlock(t, token),
  );
}

function keyBlock(t, token) {
  const box = h('div', { class: 'token-box', hidden: true }, token);
  const toggle = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Mostrar chave');
  toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.textContent = box.hidden ? 'Mostrar chave' : 'Ocultar chave'; });
  const items = [
    h('h2', {}, 'Chave de controle'),
    h('p', { class: 'small muted' }, 'Guardada apenas neste navegador. Use-a para operar a degustação em outro aparelho (página da degustação → "Sou o organizador"). Não compartilhe.'),
    h('div', { class: 'row' },
      toggle,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => toast(await copyText(token) ? 'Chave copiada.' : 'Não foi possível copiar.') }, 'Copiar chave'),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: async () => {
          if (await confirmDialog({ title: 'Remover a chave deste navegador?', message: 'Sem a chave você não poderá mais operar esta degustação aqui. Copie-a antes se quiser manter o controle.', confirmText: 'Remover', danger: true })) {
            tokenStore.remove(t.id); refresh();
          }
        },
      }, 'Remover deste navegador')),
    box,
  ];
  if (t.status === 'rascunho') {
    const del = h('button', { type: 'button', class: 'btn btn-danger-outline btn-sm' }, 'Excluir degustação');
    del.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Excluir degustação?', message: `"${t.name}" e seus vinhos serão apagados definitivamente. Esta ação não pode ser desfeita.`, confirmText: 'Excluir', danger: true })) return;
      await busy(del, async () => {
        try { await api.deleteTasting(t.id, token); tokenStore.remove(t.id); toast('Degustação excluída.', 'success'); navigate('/'); }
        catch (err) { toast(err.message, 'error'); }
      });
    });
    items.push(h('hr', { style: 'border:0;border-top:1px solid var(--border)' }), del);
  }
  return h('section', { class: 'card stack no-print' }, items);
}

async function finishFlow(data, token, btn) {
  const { tasting: t, wines, participants, guesses } = data;
  // Recarrega para considerar palpites salvos em outra aba/aparelho
  let fresh = data;
  try { fresh = await api.getTastingAdmin(t.id, token); } catch { /* usa os dados atuais */ }
  const stats = guessCompleteness(fresh.wines || wines, fresh.participants || participants, fresh.guesses || guesses);
  const content = h('div', { class: 'stack' },
    h('p', {}, `Palpites completos: ${stats.complete} de ${stats.total}.`),
    stats.missing.length
      ? h('div', { class: 'notice notice-warn small' },
        h('strong', {}, 'Pendências:'),
        h('ul', {}, stats.missing.slice(0, 8).map((m) => h('li', {}, m))),
        stats.missing.length > 8 ? h('p', {}, `… e mais ${stats.missing.length - 8}.`) : null)
      : h('p', { class: 'notice notice-ok small' }, 'Todos os palpites estão completos.'),
    h('p', {}, h('strong', {}, 'Esta ação é irreversível: '), 'os dados reais dos vinhos e todos os palpites ficarão públicos e não poderão mais ser editados.'));
  const ok = await confirmDialog({ title: 'Finalizar e revelar?', content, confirmText: 'Finalizar e revelar', danger: true });
  if (!ok) return;
  await busy(btn, async () => {
    try {
      await api.finishTasting(t.id, token);
      toast('Degustação finalizada! Relatório disponível.', 'success');
      navigate(`/degustacao/${t.id}/relatorio`);
    } catch (err) { toast(err.message, 'error'); }
  });
}
