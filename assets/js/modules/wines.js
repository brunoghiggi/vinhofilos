// Criação/edição da degustação e cadastro dos vinhos (dados reais).
import { api } from '../services/database.js';
import { tokenStore } from '../services/token-store.js';
import { navigate } from '../router.js';
import {
  h, toast, confirmDialog, field, setFieldError, busy, noControl, uid,
} from '../utils/dom.js';
import {
  formatMoney, formatVintage, formatText, parseDecimal, parseInteger, toInputNumber, isBlank, SCORE,
} from '../utils/format.js';
import { COUNTRIES, REGIONS, GRAPES, datalist } from '../utils/suggestions.js';
import { showTokenDialog } from './tastings.js';

const MAX_YEAR = new Date().getFullYear() + 1;

/** Lista de dados reais de um vinho (usada no detalhe e no relatório). */
export function wineFacts(w) {
  const item = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
  return h('dl', { class: 'wine-facts' },
    item('País', formatText(w.country)),
    item('Região', formatText(w.region)),
    item('Uva', formatText(w.grape)),
    item('Safra', formatVintage(w.vintage)),
    item('Preço original', h('span', {}, formatMoney(w.price), h('span', { class: 'price-tag full' }, 'cheio'))),
    item('Preço com desconto', h('span', {}, formatMoney(w.discounted_price), isBlank(w.discounted_price) ? null : h('span', { class: 'price-tag disc' }, 'desconto'))),
    w.notes ? h('div', { class: 'span-all' }, h('dt', {}, 'Observações'), h('dd', { style: 'font-weight:400' }, w.notes)) : null);
}

const blankWine = () => ({ _key: uid('w'), id: null, name: '', country: '', region: '', price: '', discounted_price: '', grape: '', vintage: '', notes: '' });

/** Valida e converte os campos digitados. Retorna { value, errors{campo: msg} }. */
export function validateWine(w) {
  const errors = {};
  const name = w.name.trim();
  if (!name) errors.name = 'Informe o nome do vinho.';
  else if (name.length > 200) errors.name = 'Máximo de 200 caracteres.';
  const price = parseDecimal(w.price);
  if (Number.isNaN(price) || price < 0) errors.price = 'Valor inválido (ex.: 129,90).';
  const disc = parseDecimal(w.discounted_price);
  if (Number.isNaN(disc) || disc < 0) errors.discounted_price = 'Valor inválido (ex.: 99,90).';
  const vintage = parseInteger(w.vintage);
  if (Number.isNaN(vintage) || (vintage !== null && (vintage < 1800 || vintage > MAX_YEAR))) errors.vintage = `Ano entre 1800 e ${MAX_YEAR}, ou vazio se não informada.`;
  return {
    errors,
    value: {
      id: w.id || null,
      name,
      country: w.country.trim(),
      region: w.region.trim(),
      grape: w.grape.trim(),
      price: Number.isNaN(price) ? null : price,
      discounted_price: Number.isNaN(disc) ? null : disc,
      vintage: Number.isNaN(vintage) ? null : vintage,
      notes: w.notes.trim(),
    },
  };
}

export async function renderTastingForm({ params, outlet }) {
  const editing = Boolean(params.id);
  let data = null;
  let token = null;

  if (editing) {
    token = tokenStore.get(params.id);
    if (!token) { outlet.append(noControl(params.id)); return; }
    data = await api.getTastingAdmin(params.id, token);
    if (data.tasting.status === 'finalizada') {
      outlet.append(h('div', { class: 'card stack' }, h('h1', {}, 'Degustação finalizada'),
        h('p', {}, 'Os dados não podem mais ser alterados.'),
        h('a', { class: 'btn btn-secondary', href: `#/degustacao/${params.id}` }, 'Voltar')));
      return;
    }
  }

  const t = data?.tasting || { status: 'rascunho' };
  const guessedWineIds = new Set((data?.guesses || []).map((g) => g.wine_id));
  let wines = (data?.wines || []).map((w) => ({
    _key: uid('w'),
    id: w.id,
    name: w.name || '',
    country: w.country || '',
    region: w.region || '',
    price: toInputNumber(w.price),
    discounted_price: toInputNumber(w.discounted_price),
    grape: w.grape || '',
    vintage: isBlank(w.vintage) ? '' : String(w.vintage),
    notes: w.notes || '',
  }));
  if (!wines.length) wines.push(blankWine());

  // ----- dados gerais
  const nameIn = h('input', { type: 'text', maxlength: 120, value: t.name || '', autocomplete: 'off', required: true });
  const dateIn = h('input', { type: 'date', value: t.tasting_date || '' });
  const descIn = h('textarea', { maxlength: 2000, rows: 2, value: t.description || '' });

  const winesEl = h('div', { class: 'stack' });
  const inputsByKey = new Map(); // _key → { campo: input }

  function wineCard(w, i) {
    const inputs = {
      name: h('input', { type: 'text', maxlength: 200, value: w.name, autocomplete: 'off' }),
      country: h('input', { type: 'text', maxlength: 100, value: w.country, list: 'dl-countries', autocomplete: 'off' }),
      region: h('input', { type: 'text', maxlength: 150, value: w.region, list: 'dl-regions', autocomplete: 'off' }),
      grape: h('input', { type: 'text', maxlength: 200, value: w.grape, list: 'dl-grapes', autocomplete: 'off' }),
      vintage: h('input', { type: 'text', inputmode: 'numeric', maxlength: 4, value: w.vintage, placeholder: 'ex.: 2019', autocomplete: 'off' }),
      price: h('input', { type: 'text', inputmode: 'decimal', value: w.price, placeholder: '0,00', autocomplete: 'off' }),
      discounted_price: h('input', { type: 'text', inputmode: 'decimal', value: w.discounted_price, placeholder: '0,00', autocomplete: 'off' }),
      notes: h('textarea', { maxlength: 2000, rows: 2, value: w.notes }),
    };
    for (const [k, input] of Object.entries(inputs)) {
      input.addEventListener('input', () => { w[k] = input.value; setFieldError(input, null); });
    }
    inputsByKey.set(w._key, inputs);
    const moneyField = (label, input, hint) => {
      const f = field(label, input, { hint });
      const wrap = h('div', { class: 'input-prefix' }, h('span', { 'aria-hidden': 'true' }, 'R$'));
      input.replaceWith(wrap);
      wrap.append(input);
      return f;
    };

    return h('fieldset', { class: 'card wine-editor' },
      h('div', { class: 'wine-editor-head' },
        h('legend', {}, h('h3', { style: 'margin:0' }, `Vinho ${i + 1}`)),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': `Mover vinho ${i + 1} para cima`, disabled: i === 0, onclick: () => moveWine(i, -1) }, '↑'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': `Mover vinho ${i + 1} para baixo`, disabled: i === wines.length - 1, onclick: () => moveWine(i, 1) }, '↓'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Remover vinho ${i + 1}`, onclick: () => removeWine(i) }, 'Remover'))),
      h('div', { class: 'grid-2' },
        h('div', { class: 'span-all' }, field('Nome / identificação', inputs.name, { required: true })),
        field('País', inputs.country),
        field('Região', inputs.region),
        field('Uva(s)', inputs.grape, { hint: 'Variedade ou composição' }),
        field('Safra', inputs.vintage, { hint: 'Deixe vazio se não informada' }),
        moneyField('Preço original', inputs.price, 'Sem desconto'),
        moneyField('Preço com desconto', inputs.discounted_price, 'Opcional'),
        h('div', { class: 'span-all' }, field('Observações', inputs.notes))));
  }

  function drawWines() {
    inputsByKey.clear();
    winesEl.replaceChildren(...wines.map(wineCard));
  }

  function moveWine(i, d) {
    const j = i + d;
    if (j < 0 || j >= wines.length) return;
    [wines[i], wines[j]] = [wines[j], wines[i]];
    drawWines();
  }

  async function removeWine(i) {
    const w = wines[i];
    if (w.id && guessedWineIds.has(w.id)) {
      const ok = await confirmDialog({ title: 'Remover vinho com palpites?', message: 'Os palpites já registrados para este vinho serão apagados quando você salvar.', confirmText: 'Remover', danger: true });
      if (!ok) return;
    }
    wines.splice(i, 1);
    drawWines();
  }

  const addBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, '+ Adicionar vinho');
  addBtn.addEventListener('click', () => {
    wines.push(blankWine());
    drawWines();
    inputsByKey.get(wines.at(-1)._key).name.focus();
  });

  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, editing ? 'Salvar alterações' : 'Criar degustação');

  const form = h('form', { class: 'stack', novalidate: true },
    datalist('dl-countries', COUNTRIES, wines.map((w) => w.country)),
    datalist('dl-regions', REGIONS, wines.map((w) => w.region)),
    datalist('dl-grapes', GRAPES, wines.map((w) => w.grape)),
    h('section', { class: 'card stack' },
      h('h2', {}, 'Dados gerais'),
      field('Nome do encontro', nameIn, { required: true }),
      h('div', { class: 'grid-2' },
        field('Data', dateIn, { hint: 'Opcional; pode ser definida depois' }),
        h('div', { class: 'field' },
          h('span', { style: 'font-weight:600;font-size:.92rem' }, 'Escala de pontuação'),
          h('p', { style: 'margin:0' }, `${SCORE.min} a ${SCORE.max}, somente números inteiros`),
          h('p', { class: 'field-hint' }, 'Escala padrão da confraria.'))),
      field('Descrição', descIn, { hint: 'Opcional' })),
    h('section', { class: 'section stack' },
      h('h2', {}, 'Vinhos'),
      h('p', { class: 'notice notice-private small' }, 'Estes são os dados REAIS. Ficam ocultos para os demais até a finalização.'),
      winesEl,
      addBtn),
    h('div', { class: 'bottom-bar' },
      h('a', { class: 'btn btn-ghost', href: editing ? `#/degustacao/${params.id}` : '#/' }, 'Cancelar'),
      saveBtn));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let firstInvalid = null;
    const mark = (input, msg) => { setFieldError(input, msg); if (msg && !firstInvalid) firstInvalid = input; };

    const name = nameIn.value.trim();
    mark(nameIn, name ? null : 'Informe o nome do encontro.');

    const payloadWines = wines.map((w) => {
      const { value, errors } = validateWine(w);
      const inputs = inputsByKey.get(w._key);
      for (const k of Object.keys(inputs)) mark(inputs[k], errors[k] || null);
      return value;
    });

    if (t.status === 'em_andamento' && payloadWines.length === 0) {
      toast('Uma degustação em andamento precisa de ao menos um vinho.', 'error');
      return;
    }
    if (firstInvalid) {
      toast('Corrija os campos destacados.', 'error');
      firstInvalid.focus();
      return;
    }

    const payload = {
      name,
      tasting_date: dateIn.value || null,
      description: descIn.value.trim(),
      score_min: SCORE.min,
      score_max: SCORE.max,
      wines: payloadWines,
    };

    await busy(saveBtn, async () => {
      try {
        if (editing) {
          await api.saveTasting(params.id, token, payload);
          toast('Alterações salvas.', 'success');
          navigate(`/degustacao/${params.id}`);
        } else {
          const { id, token: newToken } = await api.createTasting(payload);
          const saved = tokenStore.set(id, newToken);
          await showTokenDialog(newToken, { saved });
          toast('Degustação criada.', 'success');
          navigate(`/degustacao/${id}`);
        }
      } catch (err) { toast(err.message, 'error', 6000); }
    }, 'Salvando…');
  });

  outlet.append(
    h('div', {},
      h('h1', {}, editing ? 'Editar degustação' : 'Nova degustação'),
      editing ? h('p', { class: 'muted' }, t.name) : h('p', { class: 'muted' }, 'Quem cria a degustação fica com o controle dela neste navegador — sem login.')),
    form);
  drawWines();
  if (!editing) setTimeout(() => nameIn.focus(), 0);
}
