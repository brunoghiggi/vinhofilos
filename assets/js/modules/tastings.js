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

/** Data de hoje no fuso da confraria, em ISO (AAAA-MM-DD). */
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** "Ana, Bia" a partir dos ids; names: Map id → nome. */
function organizerNames(ids, names) {
  return (ids || []).map((id) => names.get(id)).filter(Boolean).join(', ');
}

/**
 * Lista de degustações. Com `names` (Map id → nome), mostra os organizadores;
 * `nextId` destaca a próxima degustação mensal.
 */
function tastingList(items, mine = new Set(), { names = null, nextId = null } = {}) {
  return h('ul', { class: 'list' }, items.map((t) => {
    const orgs = names ? organizerNames(t.organizer_ids, names) : '';
    return h('li', {},
      h('a', { class: `tasting-card${t.id === nextId ? ' is-next' : ''}`, href: `#/degustacao/${t.id}` },
        h('div', { class: 'tc-main' },
          h('strong', {}, t.name),
          h('span', { class: 'muted small' }, formatDate(t.tasting_date)),
          names
            ? h('span', { class: 'small tc-orgs' }, orgs ? `Organizadores: ${orgs}` : 'Organizadores a definir')
            : null),
        h('div', { class: 'tc-meta' },
          t.id === nextId ? h('span', { class: 'badge badge-next' }, 'Próxima') : null,
          mine.has(t.id) ? h('span', { class: 'badge badge-mine' }, 'Você organiza') : null,
          statusBadge(t.status))));
  }));
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
  // Cria as degustações mensais que faltarem (idempotente no banco).
  try { await api.ensureMonthlyTastings(); } catch (err) { if (err.network) throw err; }
  const [tastings, people] = await Promise.all([api.listTastings(), api.listParticipants()]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const mine = new Set(tokenStore.ids());
  const today = todayIso();
  const year = today.slice(0, 4);

  // Mensais do ano corrente em diante, agrupadas por ano
  const monthly = tastings.filter((t) => t.monthly_ref && t.monthly_ref.slice(0, 4) >= year)
    .sort((a, b) => a.monthly_ref.localeCompare(b.monthly_ref));
  const next = monthly.find((t) => t.status !== 'finalizada' && (t.tasting_date || '') >= today);
  const years = [...new Set(monthly.map((t) => t.monthly_ref.slice(0, 4)))];

  const others = tastings.filter((t) => !t.monthly_ref);
  const myOpen = others.filter((t) => mine.has(t.id) && t.status !== 'finalizada');
  const open = others.filter((t) => t.status !== 'finalizada' && !mine.has(t.id)).slice(0, 8);
  const finished = tastings.filter((t) => t.status === 'finalizada' && !monthly.includes(t)).slice(0, 6);

  outlet.append(
    h('section', { class: 'hero' },
      h('h1', {}, 'Vinhófilos'),
      h('p', { class: 'lead' }, 'Degustações às cegas da confraria: prepare o encontro, registre os palpites de cada participante e revele tudo no final.'),
      h('div', { class: 'hero-actions' },
        h('a', { class: 'btn btn-primary btn-lg', href: '#/degustacao/nova' }, 'Criar degustação'),
        h('a', { class: 'btn btn-secondary btn-lg', href: '#/participantes' }, 'Participantes'),
        h('a', { class: 'btn btn-secondary btn-lg', href: '#/historico' }, 'Histórico'))),
    years.map((y) => section(`Degustações de ${y}`,
      h('p', { class: 'small muted' }, 'Uma por mês, sempre no último domingo.'),
      tastingList(monthly.filter((t) => t.monthly_ref.startsWith(y)), mine, { names, nextId: next?.id }))),
    myOpen.length ? section('Suas outras degustações em aberto', tastingList(myOpen, mine, { names })) : null,
    open.length ? section('Outras em preparação ou andamento', tastingList(open, mine, { names })) : null,
    finished.length
      ? section('Outras finalizadas recentemente',
        tastingList(finished, mine),
        h('p', { class: 'small' }, h('a', { href: '#/historico' }, 'Ver histórico completo →')))
      : null,
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

/** Organizadores: visíveis a todos; qualquer pessoa edita até finalizar. */
function organizersBlock(t, organizers) {
  const list = h('p', {}, organizers.length
    ? organizers.map((o) => participantName(o)).join(', ')
    : h('span', { class: 'muted' }, 'A definir'));
  const editBtn = t.status === 'finalizada' ? null
    : h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, 'Editar organizadores');
  editBtn?.addEventListener('click', () => editOrganizers(t, organizers, editBtn));
  return h('section', { class: 'card stack' },
    h('div', { class: 'row-between' }, h('h2', { style: 'margin:0' }, 'Organizadores'), editBtn),
    list);
}

async function editOrganizers(t, current, btn) {
  let people;
  try { people = await api.listParticipants(); } catch (err) { toast(err.message, 'error'); return; }
  const chosen = new Set(current.map((o) => o.id));
  // Ativos + os já escolhidos (mesmo que inativados depois)
  const options = people.filter((p) => p.active || chosen.has(p.id));
  if (!options.length) {
    toast('Cadastre participantes antes de escolher os organizadores.', 'error');
    return;
  }
  const boxes = options.map((p) => {
    const cb = h('input', { type: 'checkbox', value: p.id, checked: chosen.has(p.id) });
    return { p, cb, el: h('label', { class: 'checkbox' }, cb, participantName(p)) };
  });
  const ok = await confirmDialog({
    title: 'Organizadores',
    content: h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, 'Escolha quem organiza esta degustação (até 10).'),
      h('div', { class: 'org-options' }, boxes.map((b) => b.el))),
    confirmText: 'Salvar',
  });
  if (!ok) return;
  // Mantém a ordem anterior e acrescenta os novos no fim
  const picked = boxes.filter((b) => b.cb.checked).map((b) => b.p.id);
  const ids = [...current.map((o) => o.id).filter((id) => picked.includes(id)),
    ...picked.filter((id) => !chosen.has(id))];
  await busy(btn, async () => {
    try { await api.setTastingOrganizers(t.id, ids); toast('Organizadores atualizados.', 'success'); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

/** Degustação sem organizador com chave: o primeiro que assumir recebe a chave. */
function claimBlock(t) {
  const btn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Assumir organização');
  btn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Assumir a organização?',
      message: 'Este navegador recebe a chave de controle para cadastrar os vinhos, escolher os participantes e registrar os palpites. Só uma pessoa pode assumir; depois, outros aparelhos precisam da chave.',
      confirmText: 'Assumir',
    });
    if (!ok) return;
    await busy(btn, async () => {
      try {
        const { token } = await api.claimTasting(t.id);
        const saved = tokenStore.set(t.id, token);
        await showTokenDialog(token, { saved });
        refresh();
      } catch (err) { toast(err.message, 'error'); refresh(); }
    });
  });
  return h('section', { class: 'card stack' },
    h('h2', { style: 'margin:0' }, 'Sem organizador com chave'),
    h('p', {}, 'Ninguém assumiu esta degustação ainda. Quem for conduzir o encontro deve assumir para poder cadastrar vinhos e registrar os palpites.'),
    btn);
}

function renderPublic(outlet, pub) {
  const t = pub.tasting;
  outlet.append(
    headBlock(t),
    t.description ? h('p', {}, t.description) : null,
    organizersBlock(t, pub.organizers || []),
    !t.claimed && t.status !== 'finalizada' ? claimBlock(t) : null,
    pub.revealed
      ? h('div', { class: 'card stack' },
        h('p', {}, 'Degustação finalizada — vinhos e palpites foram revelados.'),
        h('a', { class: 'btn btn-primary btn-lg', href: `#/degustacao/${t.id}/relatorio` }, 'Ver relatório'))
      : h('div', { class: 'card stack' },
        h('p', {}, h('strong', {}, `${pub.wine_count} vinho(s)`), ' nesta degustação.'),
        h('p', { class: 'muted' }, 'Os dados reais dos vinhos, os participantes e os palpites ficam ocultos até a finalização.')),
    pub.revealed || !t.claimed ? null : importTokenBlock(t.id),
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
    organizersBlock(t, data.organizers || []),
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
  if (t.status === 'rascunho' && !t.monthly_ref) {
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
