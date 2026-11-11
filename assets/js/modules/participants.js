// Cadastro de participantes e seleção dos presentes de uma degustação.
import { api } from '../services/database.js';
import { tokenStore } from '../services/token-store.js';
import { navigate } from '../router.js';
import {
  h, toast, confirmDialog, emptyState, field, setFieldError, busy, noControl,
} from '../utils/dom.js';
import { normalize, participantName, participantFullName } from '../utils/format.js';

const byName = (a, b) => participantName(a).localeCompare(participantName(b), 'pt-BR');

/** Cadastra com aviso de nome duplicado. Retorna o participante ou null. */
async function createWithDupCheck(list, name, nickname) {
  const dup = list.find((p) => normalize(p.name) === normalize(name));
  if (dup) {
    const ok = await confirmDialog({
      title: 'Nome já cadastrado',
      message: `Já existe "${participantFullName(dup)}"${dup.active ? '' : ' (inativo)'}. Deseja cadastrar outra pessoa com o mesmo nome?`,
      confirmText: 'Cadastrar mesmo assim',
    });
    if (!ok) return null;
  }
  return api.createParticipant({ name, nickname: nickname || null });
}

function quickAddForm(getList, onCreated, { compact = false } = {}) {
  const name = h('input', { type: 'text', maxlength: 80, autocomplete: 'off', autocapitalize: 'words', required: true });
  const nick = h('input', { type: 'text', maxlength: 40, autocomplete: 'off' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Cadastrar');
  const form = h('form', { class: compact ? 'stack' : 'card stack', novalidate: true },
    compact ? null : h('h2', {}, 'Novo participante'),
    h('div', { class: 'grid-2' },
      field('Nome', name, { required: true }),
      field('Apelido', nick, { hint: 'Opcional' })),
    btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) { setFieldError(name, 'Informe o nome.'); name.focus(); return; }
    setFieldError(name, null);
    await busy(btn, async () => {
      try {
        const p = await createWithDupCheck(getList(), n, nick.value.trim());
        if (!p) return;
        form.reset();
        toast(`${participantName(p)} cadastrado(a).`, 'success');
        onCreated(p);
        name.focus();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  return form;
}

// ---------------------------------------------------------------------
// Tela de participantes
// ---------------------------------------------------------------------

export async function renderParticipants({ outlet }) {
  let list = (await api.listParticipants()).sort(byName);
  const search = h('input', { type: 'search', placeholder: 'Buscar por nome ou apelido', autocomplete: 'off' });
  const showInactive = h('input', { type: 'checkbox' });
  const listEl = h('ul', { class: 'list', 'aria-live': 'polite' });
  const counter = h('p', { class: 'small muted' });

  function draw() {
    const q = normalize(search.value);
    const items = list.filter((p) => (showInactive.checked || p.active)
      && (!q || normalize(p.name).includes(q) || normalize(p.nickname).includes(q)));
    const inactive = list.filter((p) => !p.active).length;
    counter.textContent = `${list.length - inactive} ativo(s)${inactive ? `, ${inactive} inativo(s)` : ''}`;
    listEl.replaceChildren(...(items.length ? items.map(row) : [h('li', {}, emptyState(list.length ? 'Nenhum participante encontrado.' : 'Nenhum participante cadastrado ainda.'))]));
  }

  function replace(p) { list = list.map((x) => (x.id === p.id ? p : x)).sort(byName); draw(); }

  function row(p) {
    const toggle = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, p.active ? 'Inativar' : 'Reativar');
    toggle.addEventListener('click', () => busy(toggle, async () => {
      try { replace(await api.updateParticipant(p.id, { active: !p.active })); toast(p.active ? `${participantName(p)} inativado(a).` : `${participantName(p)} reativado(a).`); }
      catch (err) { toast(err.message, 'error'); }
    }));
    const edit = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Editar');
    const li = h('li', { class: `person-row${p.active ? '' : ' inactive'}` },
      h('div', {},
        h('span', { class: 'name' }, participantName(p)),
        p.nickname && p.nickname.trim() !== p.name ? h('span', { class: 'muted' }, ` · ${p.name}`) : null,
        p.active ? null : h('span', { class: 'badge badge-inactive', style: 'margin-left:8px' }, 'Inativo')),
      h('div', { class: 'row' }, edit, toggle));
    edit.addEventListener('click', () => li.replaceWith(editRow(p)));
    return li;
  }

  function editRow(p) {
    const name = h('input', { type: 'text', value: p.name, maxlength: 80 });
    const nick = h('input', { type: 'text', value: p.nickname || '', maxlength: 40 });
    const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Salvar');
    const form = h('form', { class: 'person-row stack', style: 'display:block' },
      h('div', { class: 'grid-2' }, field('Nome', name, { required: true }), field('Apelido', nick)),
      h('div', { class: 'row', style: 'margin-top:8px' }, save,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: draw }, 'Cancelar')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { setFieldError(name, 'Informe o nome.'); return; }
      busy(save, async () => {
        try { replace(await api.updateParticipant(p.id, { name: n, nickname: nick.value.trim() || null })); toast('Participante atualizado.', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      });
    });
    setTimeout(() => name.focus(), 0);
    return h('li', {}, form);
  }

  search.addEventListener('input', draw);
  showInactive.addEventListener('change', draw);

  outlet.append(
    h('h1', {}, 'Participantes'),
    quickAddForm(() => list, (p) => { list.push(p); list.sort(byName); draw(); }),
    h('section', { class: 'section' },
      h('div', { class: 'row-between' }, h('h2', {}, 'Cadastrados'), counter),
      h('div', { class: 'stack' },
        field('Buscar', search),
        h('label', { class: 'checkbox' }, showInactive, 'Mostrar inativos'),
        listEl)));
  draw();
}

// ---------------------------------------------------------------------
// Participantes do dia (seleção + ordem)
// ---------------------------------------------------------------------

export async function renderPresence({ params, outlet }) {
  const id = params.id;
  const token = tokenStore.get(id);
  if (!token) { outlet.append(noControl(id)); return; }

  const [data, all] = await Promise.all([api.getTastingAdmin(id, token), api.listParticipants()]);
  const t = data.tasting;
  if (t.status === 'finalizada') {
    outlet.append(h('div', { class: 'card stack' }, h('h1', {}, 'Degustação finalizada'),
      h('p', {}, 'Os participantes não podem mais ser alterados.'),
      h('a', { class: 'btn btn-secondary', href: `#/degustacao/${id}` }, 'Voltar')));
    return;
  }

  let people = all.sort(byName);
  const initial = data.participants.map((p) => p.participant_id);
  let selected = [...initial];
  const withGuesses = new Set(data.guesses.map((g) => g.participant_id));
  const byId = () => new Map(people.map((p) => [p.id, p]));
  let dirty = false;

  const search = h('input', { type: 'search', placeholder: 'Buscar', autocomplete: 'off' });
  const showInactive = h('input', { type: 'checkbox' });
  const orderEl = h('ol', { class: 'order-list', 'aria-label': 'Ordem da degustação' });
  const allEl = h('ul', { class: 'list' });
  const orderTitle = h('h2', {});
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Salvar participantes');
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  // Seleciona (ou desmarca) de uma vez todos os nomes visíveis na lista
  const allBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' });
  let visible = [];

  function setDirty() { dirty = true; }

  function toggle(pid) {
    const p = byId().get(pid);
    if (selected.includes(pid)) { selected = selected.filter((x) => x !== pid); live.textContent = `${participantName(p)} removido(a).`; }
    else { selected.push(pid); live.textContent = `${participantName(p)} adicionado(a) na posição ${selected.length}.`; }
    setDirty(); draw();
  }

  function move(index, delta) {
    const j = index + delta;
    if (j < 0 || j >= selected.length) return;
    [selected[index], selected[j]] = [selected[j], selected[index]];
    live.textContent = `${participantName(byId().get(selected[j]))} agora na posição ${j + 1}.`;
    setDirty(); draw();
    orderEl.querySelectorAll('.order-item')[j]?.querySelector(delta < 0 ? '[data-up]' : '[data-down]')?.focus();
  }

  let dragFrom = null;
  function drawOrder() {
    const map = byId();
    orderTitle.textContent = `Ordem da degustação (${selected.length})`;
    if (!selected.length) {
      orderEl.replaceChildren(h('li', {}, emptyState('Toque nos nomes abaixo, na ordem em que cada pessoa vai participar.')));
      return;
    }
    orderEl.replaceChildren(...selected.map((pid, i) => {
      const p = map.get(pid);
      const li = h('li', { class: 'order-item', draggable: 'true' },
        h('span', { class: 'drag-handle', 'aria-hidden': 'true', title: 'Arraste para reordenar' }, '⋮⋮'),
        h('span', { class: 'pos' }, `${i + 1}.`),
        h('span', { class: 'grow' }, p ? participantName(p) : '—'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'data-up': '', 'aria-label': `Subir ${participantName(p)}`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'data-down': '', 'aria-label': `Descer ${participantName(p)}`, disabled: i === selected.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': `Remover ${participantName(p)}`, onclick: () => toggle(pid) }, '✕'));
      li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragFrom = null; });
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-target'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
      li.addEventListener('drop', (e) => {
        e.preventDefault(); li.classList.remove('drop-target');
        if (dragFrom === null || dragFrom === i) return;
        const [item] = selected.splice(dragFrom, 1);
        selected.splice(i, 0, item);
        setDirty(); draw();
      });
      return li;
    }));
  }

  function drawAll() {
    const q = normalize(search.value);
    const items = people.filter((p) => (showInactive.checked || p.active || selected.includes(p.id))
      && (!q || normalize(p.name).includes(q) || normalize(p.nickname).includes(q)));
    visible = items.map((p) => p.id);
    const allIn = visible.length > 0 && visible.every((pid) => selected.includes(pid));
    allBtn.textContent = allIn ? 'Desmarcar todos' : 'Selecionar todos';
    allBtn.disabled = !visible.length;
    allEl.replaceChildren(...(items.length ? items.map((p) => {
      const pos = selected.indexOf(p.id);
      return h('li', {}, h('button', {
        type: 'button', class: 'select-btn', 'aria-pressed': String(pos >= 0), onclick: () => toggle(p.id),
      },
      h('span', { class: 'order-dot', 'aria-hidden': 'true' }, pos >= 0 ? String(pos + 1) : ''),
      h('span', {}, participantName(p), p.active ? null : h('span', { class: 'muted small' }, ' (inativo)'))));
    }) : [h('li', {}, emptyState(people.length ? 'Ninguém encontrado.' : 'Nenhum participante cadastrado. Cadastre abaixo.'))]));
  }

  function draw() { drawOrder(); drawAll(); }

  saveBtn.addEventListener('click', async () => {
    const removedWithGuesses = initial.filter((pid) => !selected.includes(pid) && withGuesses.has(pid));
    if (removedWithGuesses.length) {
      const names = removedWithGuesses.map((pid) => participantName(byId().get(pid))).join(', ');
      const ok = await confirmDialog({
        title: 'Remover participantes com palpites?',
        message: `Os palpites já registrados de ${names} serão apagados.`,
        confirmText: 'Remover e salvar', danger: true,
      });
      if (!ok) return;
    }
    if (t.status === 'em_andamento' && !selected.length) { toast('A degustação em andamento precisa de ao menos um participante.', 'error'); return; }
    await busy(saveBtn, async () => {
      try {
        await api.setTastingParticipants(id, token, selected);
        dirty = false;
        toast('Participantes salvos.', 'success');
        navigate(`/degustacao/${id}`);
      } catch (err) { toast(err.message, 'error'); }
    }, 'Salvando…');
  });

  allBtn.addEventListener('click', () => {
    if (visible.every((pid) => selected.includes(pid))) {
      selected = selected.filter((pid) => !visible.includes(pid));
      live.textContent = 'Seleção removida.';
    } else {
      // Mantém a ordem já escolhida e acrescenta os demais na ordem da lista
      selected.push(...visible.filter((pid) => !selected.includes(pid)));
      live.textContent = `${selected.length} participantes selecionados.`;
    }
    setDirty(); draw();
  });
  search.addEventListener('input', drawAll);
  showInactive.addEventListener('change', drawAll);

  const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);

  outlet.append(
    h('div', {},
      h('h1', {}, 'Participantes do dia'),
      h('p', { class: 'muted' }, t.name)),
    h('p', { class: 'small muted' }, 'A ordem em que você toca nos nomes define a ordem da degustação ("Selecionar todos" marca todos de uma vez, na ordem da lista). Ajuste com ↑ ↓ ou arrastando.'),
    h('section', { class: 'card stack' }, orderTitle, orderEl),
    h('section', { class: 'section stack' },
      h('div', { class: 'row-between' }, h('h2', { style: 'margin:0' }, 'Todos os participantes'), allBtn),
      field('Buscar', search),
      h('label', { class: 'checkbox' }, showInactive, 'Mostrar inativos'),
      allEl),
    h('details', { class: 'card' },
      h('summary', {}, 'Alguém não está na lista? Cadastrar agora'),
      h('div', { style: 'margin-top:12px' },
        quickAddForm(() => people, (p) => { people.push(p); people.sort(byName); selected.push(p.id); setDirty(); draw(); }, { compact: true }))),
    h('div', { class: 'bottom-bar' },
      h('a', { class: 'btn btn-ghost', href: `#/degustacao/${id}` }, 'Cancelar'),
      saveBtn),
    live);
  draw();

  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
