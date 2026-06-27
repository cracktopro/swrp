import { getItemById, getCompendiumItems, getClassList } from './compendium-store.js';
import { lootProbPercent, LOOT_PROB_LEVELS } from './loot.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function classLabelFor(key) {
  if (!key || key === 'all') return 'Todas';
  return getClassList().find((c) => c.key === key)?.label || key;
}

export function renderLootList(listEl, draft, onRemove) {
  if (!listEl) return;
  const items = draft?.items || [];
  if (!items.length) {
    listEl.innerHTML = '<p class="small text-muted mb-0">Sin objetos en el botín.</p>';
    return;
  }
  listEl.innerHTML = items.map((entry, idx) => {
    const item = getItemById(entry.itemId);
    const name = escapeHtml(item?.name || 'Objeto desconocido');
    return `
      <div class="swrp-loot-row">
        ${item?.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" class="swrp-loot-row__img" loading="lazy">` : '<div class="swrp-loot-row__img swrp-loot-row__img--empty"></div>'}
        <span class="swrp-loot-row__name">${name}</span>
        <span class="swrp-loot-row__prob">${lootProbPercent(entry.prob)}%</span>
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger" data-loot-remove="${idx}">×</button>
      </div>`;
  }).join('');
  listEl.querySelectorAll('[data-loot-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      onRemove?.(Number(btn.dataset.lootRemove));
    });
  });
}

/**
 * Modal compartido para elegir un objeto del compendio y añadirlo al botín en edición.
 * @param {{ modalEl?: HTMLElement, getDraft: () => object|null, onItemsChanged?: () => void }} opts
 */
export function createLootItemPicker({ modalEl, getDraft, onItemsChanged }) {
  let lootSelection = null;
  let ready = false;
  const modal = modalEl ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;

  function renderPick() {
    const listEl = document.getElementById('loot-item-list');
    if (!listEl) return;
    const term = (document.getElementById('loot-item-filter-name')?.value || '').trim().toLowerCase();
    const type = document.getElementById('loot-item-filter-type')?.value || '';
    const classKey = document.getElementById('loot-item-filter-class')?.value || '';
    const items = getCompendiumItems()
      .filter((it) => !type || it.type === type)
      .filter((it) => !term || it.name.toLowerCase().includes(term))
      .filter((it) => {
        if (!classKey) return true;
        if (it.type !== 'Equipo') return false;
        const eq = it.equipClass || 'all';
        if (classKey === 'all') return eq === 'all';
        return eq === 'all' || eq === classKey;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    const addBtn = document.getElementById('btn-loot-item-add');
    if (!items.length) {
      listEl.innerHTML = '<p class="small text-muted mb-0">Ningún objeto con esos filtros.</p>';
      lootSelection = null;
      if (addBtn) addBtn.disabled = true;
      return;
    }
    if (!lootSelection || !items.some((i) => i.id === lootSelection.id)) {
      lootSelection = items[0];
    }
    listEl.innerHTML = items.map((it) => {
      const selected = lootSelection?.id === it.id;
      const extra = it.type === 'Equipo' ? ` · ${escapeHtml(classLabelFor(it.equipClass))}` : '';
      return `
        <button type="button" class="swrp-loot-pick${selected ? ' is-selected' : ''}" data-pick="${escapeHtml(it.id)}">
          ${it.imageUrl ? `<img src="${escapeHtml(it.imageUrl)}" alt="" class="swrp-loot-pick__img" loading="lazy">` : '<span class="swrp-loot-pick__img swrp-loot-pick__img--empty"></span>'}
          <span class="swrp-loot-pick__body">
            <strong>${escapeHtml(it.name)}</strong>
            <span class="small text-muted d-block">${escapeHtml(it.type)}${extra}</span>
          </span>
        </button>`;
    }).join('');
    listEl.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        lootSelection = items.find((i) => i.id === btn.dataset.pick) || null;
        renderPick();
      });
    });
    if (addBtn) addBtn.disabled = !lootSelection;
  }

  function setup() {
    if (ready) return;
    const classSel = document.getElementById('loot-item-filter-class');
    if (classSel) {
      classSel.innerHTML = [
        '<option value="">Todas las clases</option>',
        '<option value="all">Equipable por todas</option>',
        ...getClassList().map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
      ].join('');
    }
    const probSel = document.getElementById('loot-item-prob');
    if (probSel) {
      probSel.innerHTML = LOOT_PROB_LEVELS
        .map((lvl) => `<option value="${lvl}">${lvl} · ${lootProbPercent(lvl)}%</option>`)
        .join('');
    }
    document.getElementById('loot-item-filter-name')?.addEventListener('input', renderPick);
    document.getElementById('loot-item-filter-type')?.addEventListener('change', renderPick);
    classSel?.addEventListener('change', renderPick);
    document.getElementById('btn-loot-item-add')?.addEventListener('click', () => {
      const draft = getDraft();
      if (!lootSelection || !draft) return;
      const prob = Number(document.getElementById('loot-item-prob')?.value) || 1;
      draft.items.push({ itemId: lootSelection.id, prob });
      onItemsChanged?.();
      modal?.hide();
    });
    ready = true;
  }

  function open() {
    if (!getDraft()) return;
    setup();
    lootSelection = null;
    const nameEl = document.getElementById('loot-item-filter-name');
    const typeEl = document.getElementById('loot-item-filter-type');
    const classEl = document.getElementById('loot-item-filter-class');
    const probEl = document.getElementById('loot-item-prob');
    if (nameEl) nameEl.value = '';
    if (typeEl) typeEl.value = '';
    if (classEl) classEl.value = '';
    if (probEl) probEl.value = '5';
    renderPick();
    modal?.show();
  }

  return { open, setup, renderPick };
}
