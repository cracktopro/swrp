import { appUrl } from './app-path.js';
import { getItemById, getCompendiumItems, getClassList } from './compendium-store.js';
import { swrpAlert, swrpConfirm } from './swrp-dialog.js';
import {
  INVENTORY_COLS,
  INVENTORY_MAX_SLOTS,
  normalizeInventory,
  computeInventoryWeight,
  computeUsedSlots,
  computeMoveRange,
  getClassMaxWeight,
  statLabel,
  saveCharacterInventory,
  removeItemFromInventory,
  applyConsumableToBoardToken,
  syncBoardTokenInventory
} from './inventory.js';

let modalEl = null;
let bsModal = null;
let state = null; // { characterId, partyId, classKey, level, name, credits, inventory, equippedItemId, statBonuses, currentHp, maxHp, canEdit, onChange, logUse, selectedItemId, activeTab, shopFilters }

const CREDITS_ICON = appUrl('icons/creditos.svg');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function classLabel(key) {
  if (!key || key === 'all') return 'Todas';
  return getClassList().find((c) => c.key === key)?.label || key;
}

function itemTypeBadge(type) {
  const cls = type === 'Equipo' ? 'swrp-item-badge--equipo'
    : type === 'Consumible' ? 'swrp-item-badge--consumible'
    : 'swrp-item-badge--inutil';
  return `<span class="swrp-item-badge ${cls}">${escapeHtml(type)}</span>`;
}

/** Comprueba si el personaje puede equipar el objeto (clase + nivel). */
function equipCheck(item) {
  if (!item || item.type !== 'Equipo') return { ok: false, reason: 'No es un objeto equipable.' };
  const reqClass = item.equipClass || 'all';
  if (reqClass !== 'all' && reqClass !== state.classKey) {
    return { ok: false, reason: `Solo lo equipa la clase ${classLabel(reqClass)}.` };
  }
  const reqLevel = Math.max(1, Number(item.equipLevel) || 1);
  if ((Number(state.level) || 1) < reqLevel) {
    return { ok: false, reason: `Requiere nivel ${reqLevel}.` };
  }
  return { ok: true };
}

function ensureModal() {
  if (modalEl) return;
  modalEl = document.createElement('div');
  modalEl.id = 'swrp-inventory-modal';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content swrp-modal-card swrp-inv">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title">Inventario · <span id="swrp-inv-name"></span></h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <ul class="nav nav-tabs swrp-board-tabs mb-3" role="tablist">
            <li class="nav-item" role="presentation">
              <button type="button" class="nav-link active" data-inv-tab="inv" role="tab">Inventario</button>
            </li>
            <li class="nav-item" role="presentation" id="swrp-inv-shop-tab-wrap">
              <button type="button" class="nav-link" data-inv-tab="shop" role="tab">Tienda</button>
            </li>
          </ul>

          <div data-inv-pane="inv">
            <div class="swrp-inv__topbar">
              <div class="swrp-inv__credits">
                <span id="swrp-inv-credits">0</span>
                <span class="swrp-inv__credits-icon" style="-webkit-mask-image:url('${CREDITS_ICON}');mask-image:url('${CREDITS_ICON}')" title="créditos"></span>
              </div>
              <div class="swrp-inv__weight">
                <div class="swrp-inv__weight-head">
                  <span>Peso</span>
                  <span id="swrp-inv-weight-val">0 / 0 KG</span>
                </div>
                <div class="swrp-inv__weight-bar"><div id="swrp-inv-weight-fill" class="swrp-inv__weight-fill"></div></div>
                <p id="swrp-inv-move" class="swrp-inv__move small mb-0"></p>
              </div>
            </div>
            <div class="swrp-inv__layout">
              <div class="swrp-inv__main">
                <div class="swrp-inv__equip" id="swrp-inv-equip"></div>
                <div class="swrp-inv__grid" id="swrp-inv-grid"></div>
              </div>
              <div class="swrp-inv__detail" id="swrp-inv-detail">
                <p class="text-muted small mb-0">Selecciona un objeto para ver sus detalles y acciones.</p>
              </div>
            </div>
          </div>

          <div data-inv-pane="shop" class="d-none">
            <div class="swrp-shop__filters">
              <input type="text" class="form-control form-control-sm" id="swrp-shop-name" placeholder="Buscar por nombre…">
              <select class="form-select form-select-sm" id="swrp-shop-type">
                <option value="">Todos los tipos</option>
                <option value="Equipo">Equipo</option>
                <option value="Consumible">Consumible</option>
                <option value="Sin utilidad">Sin utilidad</option>
              </select>
              <select class="form-select form-select-sm" id="swrp-shop-class"></select>
            </div>
            <div class="swrp-shop__list" id="swrp-shop-list"></div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true });

  modalEl.querySelectorAll('[data-inv-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.invTab));
  });
  modalEl.querySelector('#swrp-shop-name').addEventListener('input', (e) => {
    state.shopFilters.name = e.target.value;
    renderShop();
  });
  modalEl.querySelector('#swrp-shop-type').addEventListener('change', (e) => {
    state.shopFilters.type = e.target.value;
    renderShop();
  });
  modalEl.querySelector('#swrp-shop-class').addEventListener('change', (e) => {
    state.shopFilters.classKey = e.target.value;
    renderShop();
  });
}

function syncShopTabVisibility() {
  const enabled = state?.shopEnabled !== false;
  const wrap = modalEl?.querySelector('#swrp-inv-shop-tab-wrap');
  wrap?.classList.toggle('d-none', !enabled);
  if (!enabled && state?.activeTab === 'shop') setTab('inv');
}

function setTab(tab) {
  if (tab === 'shop' && state?.shopEnabled === false) tab = 'inv';
  state.activeTab = tab;
  modalEl.querySelectorAll('[data-inv-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.invTab === tab);
  });
  modalEl.querySelectorAll('[data-inv-pane]').forEach((pane) => {
    pane.classList.toggle('d-none', pane.dataset.invPane !== tab);
  });
  if (tab === 'shop') renderShop();
}

export function openInventoryModal(character, {
  partyId = null,
  canEdit = true,
  shopEnabled = true,
  onChange = null,
  onClosed = null,
  logUse = null,
  saveInventory = null
} = {}) {
  ensureModal();
  const norm = normalizeInventory(character);
  state = {
    characterId: character.id,
    partyId,
    classKey: character.class || character.classKey,
    level: character.level ?? 1,
    name: character.name || 'Personaje',
    credits: norm.credits,
    inventory: norm.inventory.map((e) => ({ ...e })),
    equippedItemId: norm.equippedItemId,
    statBonuses: { ...norm.statBonuses },
    currentHp: character.currentHp ?? character.hp ?? null,
    maxHp: character.maxHp ?? null,
    canEdit,
    shopEnabled: shopEnabled !== false,
    onChange,
    onClosed,
    logUse,
    saveInventory,
    selectedItemId: null,
    activeTab: 'inv',
    shopFilters: { name: '', type: '', classKey: '' }
  };
  modalEl.querySelector('#swrp-inv-name').textContent = state.name;
  populateShopClassFilter();
  syncShopTabVisibility();
  setTab('inv');
  render();
  if (onClosed) {
    const handler = () => {
      modalEl.removeEventListener('hidden.bs.modal', handler);
      onClosed();
    };
    modalEl.addEventListener('hidden.bs.modal', handler);
  }
  bsModal.show();
}

function render() {
  renderTopbar();
  renderEquip();
  renderGrid();
  renderDetail();
  if (state.activeTab === 'shop') renderShop();
}

function renderTopbar() {
  modalEl.querySelector('#swrp-inv-credits').textContent = state.credits;
  const weight = computeInventoryWeight(state.inventory, state.equippedItemId);
  const maxWeight = getClassMaxWeight(state.classKey);
  const over = weight > maxWeight;
  modalEl.querySelector('#swrp-inv-weight-val').textContent = `${weight} / ${maxWeight} KG`;
  const fill = modalEl.querySelector('#swrp-inv-weight-fill');
  fill.style.width = `${Math.min(100, maxWeight ? (weight / maxWeight) * 100 : 0)}%`;
  fill.classList.toggle('swrp-inv__weight-fill--over', over);
  const move = computeMoveRange({ class: state.classKey, inventory: state.inventory, equippedItemId: state.equippedItemId });
  const moveEl = modalEl.querySelector('#swrp-inv-move');
  if (over) {
    const full = computeUsedSlots(state.inventory) >= INVENTORY_MAX_SLOTS;
    moveEl.textContent = `Sobrecargado: movimiento reducido a ${move} casillas${full ? ' (inventario lleno)' : ''}.`;
    moveEl.classList.add('text-warning');
  } else {
    moveEl.textContent = `Movimiento: ${move} casillas por acción.`;
    moveEl.classList.remove('text-warning');
  }
}

function renderEquip() {
  const wrap = modalEl.querySelector('#swrp-inv-equip');
  const item = getItemById(state.equippedItemId);
  if (item) {
    wrap.innerHTML = `
      <div class="swrp-inv__equip-slot is-filled" data-equip="1" title="${escapeHtml(item.name)}">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : '<span class="swrp-inv__equip-tag">EQ</span>'}
      </div>
      <div class="swrp-inv__equip-label">
        <span class="swrp-inv__equip-title">Equipo</span>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="small text-info">${statLabel(item.stat)} +${item.statBonus}</span>
      </div>`;
    wrap.querySelector('[data-equip]')?.addEventListener('click', () => {
      state.selectedItemId = state.equippedItemId;
      renderDetail();
    });
  } else {
    wrap.innerHTML = `
      <div class="swrp-inv__equip-slot" title="Ranura de equipo">
        <span class="swrp-inv__equip-tag">EQ</span>
      </div>
      <div class="swrp-inv__equip-label">
        <span class="swrp-inv__equip-title">Equipo</span>
        <span class="small text-muted">Sin equipo</span>
      </div>`;
  }
}

function renderGrid() {
  const grid = modalEl.querySelector('#swrp-inv-grid');
  grid.style.setProperty('--inv-cols', INVENTORY_COLS);
  const cells = [];
  const entries = state.inventory.filter((e) => e.qty > 0);
  for (let i = 0; i < INVENTORY_MAX_SLOTS; i++) {
    const entry = entries[i];
    if (entry) {
      const item = getItemById(entry.itemId);
      const selected = state.selectedItemId === entry.itemId ? ' is-selected' : '';
      cells.push(`
        <button type="button" class="swrp-inv__cell is-filled${selected}" data-item-id="${escapeHtml(entry.itemId)}" title="${escapeHtml(item?.name || 'Objeto')}">
          ${item?.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : `<span class="swrp-inv__cell-name">${escapeHtml(item?.name || '¿?')}</span>`}
          ${entry.qty > 1 ? `<span class="swrp-inv__cell-qty">${entry.qty}</span>` : ''}
        </button>`);
    } else {
      cells.push('<div class="swrp-inv__cell"></div>');
    }
  }
  grid.innerHTML = cells.join('');
  grid.querySelectorAll('.swrp-inv__cell.is-filled').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedItemId = btn.dataset.itemId;
      render();
    });
  });
}

function renderDetail() {
  const detail = modalEl.querySelector('#swrp-inv-detail');
  const itemId = state.selectedItemId;
  const item = getItemById(itemId);
  if (!item) {
    detail.innerHTML = '<p class="text-muted small mb-0">Selecciona un objeto para ver sus detalles y acciones.</p>';
    return;
  }
  const isEquipped = state.equippedItemId === itemId;
  const entry = state.inventory.find((e) => e.itemId === itemId);
  const ownedQty = entry?.qty || 0;
  let effect = '';
  if (item.type === 'Consumible' && (!item.stat || item.stat === 'none')) {
    effect = '<p class="small text-muted mb-1">Sin efecto mecánico · uso narrativo</p>';
  } else if ((item.type === 'Equipo' || item.type === 'Consumible') && item.statBonus) {
    effect = `<p class="small text-info mb-1">${statLabel(item.stat)} +${item.statBonus}${item.type === 'Consumible' && item.temporary ? ' · temporal' : ''}</p>`;
  }

  let requirement = '';
  if (item.type === 'Equipo') {
    requirement = `<p class="small text-muted mb-1">Clase: ${escapeHtml(classLabel(item.equipClass))} · Nivel mín.: ${Math.max(1, Number(item.equipLevel) || 1)}</p>`;
  }

  const actions = [];
  if (state.canEdit) {
    if (item.type === 'Equipo') {
      if (isEquipped) {
        actions.push('<button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost" data-act="unequip">Quitar equipo</button>');
      } else if (ownedQty > 0) {
        const check = equipCheck(item);
        actions.push(check.ok
          ? '<button type="button" class="btn btn-sm btn-swrp btn-swrp-primary" data-act="equip">Equipar</button>'
          : `<button type="button" class="btn btn-sm btn-swrp btn-swrp-primary" disabled title="${escapeHtml(check.reason)}">Equipar</button><span class="small text-warning d-block mt-1">${escapeHtml(check.reason)}</span>`);
      }
    }
    if (item.type === 'Consumible' && ownedQty > 0) {
      actions.push('<button type="button" class="btn btn-sm btn-swrp btn-swrp-success" data-act="use">Usar</button>');
    }
    if (!isEquipped && ownedQty > 0) {
      actions.push('<button type="button" class="btn btn-sm btn-swrp btn-swrp-danger" data-act="sell">Vender</button>');
    }
  }

  detail.innerHTML = `
    <div class="swrp-inv__detail-head">
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" class="swrp-inv__detail-img">` : ''}
      <div>
        <strong class="text-gold">${escapeHtml(item.name)}</strong>
        ${itemTypeBadge(item.type)}
      </div>
    </div>
    <p class="small mb-1">${escapeHtml(item.description)}</p>
    ${effect}
    ${requirement}
    <p class="small text-muted mb-1">${item.weight} KG · Venta: ${item.price} créditos${isEquipped ? ' · Equipado' : ''}${ownedQty ? ` · Tienes: ${ownedQty}` : ''}</p>
    <div class="d-flex gap-2 flex-wrap mt-2">${actions.join('')}</div>`;

  detail.querySelector('[data-act="equip"]')?.addEventListener('click', () => equipItem(itemId));
  detail.querySelector('[data-act="unequip"]')?.addEventListener('click', () => unequipItem());
  detail.querySelector('[data-act="use"]')?.addEventListener('click', () => useConsumable(item));
  detail.querySelector('[data-act="sell"]')?.addEventListener('click', () => sellItem(item, ownedQty));
}

function populateShopClassFilter() {
  const sel = modalEl.querySelector('#swrp-shop-class');
  if (!sel) return;
  const opts = ['<option value="">Todas las clases</option>', '<option value="all">Equipable por todas</option>'];
  for (const c of getClassList()) {
    opts.push(`<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = state.shopFilters.classKey || '';
}

function renderShop() {
  const list = modalEl.querySelector('#swrp-shop-list');
  if (!list) return;
  const { name, type, classKey } = state.shopFilters;
  const term = name.trim().toLowerCase();
  const items = getCompendiumItems()
    .filter((it) => !type || it.type === type)
    .filter((it) => !term || it.name.toLowerCase().includes(term))
    .filter((it) => {
      if (!classKey) return true;
      // El filtro por clase solo aplica a objetos de tipo Equipo.
      if (it.type !== 'Equipo') return false;
      const eq = it.equipClass || 'all';
      if (classKey === 'all') return eq === 'all';
      return eq === 'all' || eq === classKey;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (!items.length) {
    list.innerHTML = '<p class="text-muted small mb-0">No hay objetos que coincidan con los filtros.</p>';
    return;
  }

  list.innerHTML = items.map((item) => {
    const entry = state.inventory.find((e) => e.itemId === item.id);
    const ownedQty = entry?.qty || 0;
    const isEquipped = state.equippedItemId === item.id;
    const totalOwned = ownedQty + (isEquipped ? 1 : 0);
    let meta = `${item.weight} KG · ${item.price} créditos`;
    if (item.type === 'Equipo') meta += ` · ${escapeHtml(classLabel(item.equipClass))} · Nv. ${Math.max(1, Number(item.equipLevel) || 1)}`;
    const canSell = state.canEdit && ownedQty > 0;
    return `
      <div class="swrp-shop__row">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" class="swrp-shop__img" loading="lazy">` : '<div class="swrp-shop__img swrp-shop__img--empty"></div>'}
        <div class="swrp-shop__info">
          <div class="swrp-shop__title">
            <strong class="text-gold">${escapeHtml(item.name)}</strong>
            ${itemTypeBadge(item.type)}
            ${totalOwned ? `<span class="swrp-shop__owned">Tienes: ${totalOwned}</span>` : ''}
          </div>
          <p class="small text-muted mb-0">${escapeHtml(item.description)}</p>
          <p class="small text-muted mb-0">${meta}</p>
        </div>
        <div class="swrp-shop__actions">
          ${canSell ? `<button type="button" class="btn btn-sm btn-swrp btn-swrp-danger" data-shop-sell="${escapeHtml(item.id)}">Vender</button>` : ''}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-shop-sell]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = getItemById(btn.dataset.shopSell);
      const entry = state.inventory.find((e) => e.itemId === btn.dataset.shopSell);
      if (item && entry) sellItem(item, entry.qty);
    });
  });
}

async function persist(patch) {
  try {
    if (typeof state.saveInventory === 'function') {
      await state.saveInventory({
        ...patch,
        credits: state.credits,
        inventory: state.inventory,
        equippedItemId: state.equippedItemId,
        statBonuses: state.statBonuses,
        currentHp: state.currentHp
      });
    } else {
      await saveCharacterInventory(state.characterId, patch);
    }
    if (state.partyId && typeof state.saveInventory !== 'function') {
      await syncBoardTokenInventory(state.partyId, {
        id: state.characterId,
        class: state.classKey,
        classKey: state.classKey,
        level: state.level,
        type: 'Heroe',
        name: state.name,
        currentHp: state.currentHp,
        maxHp: state.maxHp,
        inventory: state.inventory,
        equippedItemId: state.equippedItemId,
        statBonuses: state.statBonuses
      });
    }
    if (typeof state.onChange === 'function') {
      state.onChange({
        credits: state.credits,
        inventory: state.inventory,
        equippedItemId: state.equippedItemId,
        statBonuses: state.statBonuses,
        currentHp: state.currentHp
      });
    }
  } catch (err) {
    await swrpAlert({ title: 'Error', message: err.message || 'No se pudo guardar el inventario.' });
  }
}

async function equipItem(itemId) {
  const item = getItemById(itemId);
  const check = equipCheck(item);
  if (!check.ok) {
    await swrpAlert({ title: 'No puedes equipar', message: check.reason });
    return;
  }
  // Un Equipo equipado ocupa la ranura especial (sale de la rejilla).
  state.inventory = removeItemFromInventory(state.inventory, itemId, 1);
  // Si ya había uno equipado, devuélvelo a la rejilla.
  if (state.equippedItemId && state.equippedItemId !== itemId) {
    const prevItem = getItemById(state.equippedItemId);
    if (prevItem?.stat === 'hp') {
      const bonus = Number(prevItem.statBonus) || 0;
      if (state.currentHp != null) state.currentHp = Math.max(0, state.currentHp - bonus);
      if (state.maxHp != null) state.maxHp = Math.max(1, state.maxHp - bonus);
      if (state.currentHp != null && state.maxHp != null && state.currentHp > state.maxHp) {
        state.currentHp = state.maxHp;
      }
    }
    state.inventory = addToGrid(state.inventory, state.equippedItemId);
  }
  state.equippedItemId = itemId;
  if (item?.stat === 'hp') {
    const bonus = Number(item.statBonus) || 0;
    if (state.currentHp != null) state.currentHp += bonus;
    if (state.maxHp != null) state.maxHp += bonus;
  }
  const persistPatch = { inventory: state.inventory, equippedItemId: state.equippedItemId };
  if (item?.stat === 'hp') persistPatch.currentHp = state.currentHp;
  await persist(persistPatch);
  render();
}

async function unequipItem() {
  const prev = state.equippedItemId;
  if (!prev) return;
  const prevItem = getItemById(prev);
  if (computeUsedSlots(state.inventory) >= INVENTORY_MAX_SLOTS) {
    await swrpAlert({ title: 'Inventario lleno', message: 'No hay espacio en la rejilla para guardar el equipo.' });
    return;
  }
  if (prevItem?.stat === 'hp') {
    const bonus = Number(prevItem.statBonus) || 0;
    if (state.currentHp != null) state.currentHp = Math.max(0, state.currentHp - bonus);
    if (state.maxHp != null) state.maxHp = Math.max(1, state.maxHp - bonus);
    if (state.currentHp != null && state.maxHp != null && state.currentHp > state.maxHp) {
      state.currentHp = state.maxHp;
    }
  }
  state.inventory = addToGrid(state.inventory, prev);
  state.equippedItemId = null;
  state.selectedItemId = prev;
  const persistPatch = { inventory: state.inventory, equippedItemId: null };
  if (prevItem?.stat === 'hp') persistPatch.currentHp = state.currentHp;
  await persist(persistPatch);
  render();
}

function addToGrid(inventory, itemId, qty = 1) {
  const list = inventory.map((e) => ({ ...e }));
  const existing = list.find((e) => e.itemId === itemId);
  if (existing) existing.qty += qty;
  else list.push({ itemId, qty });
  return list;
}

async function sellItem(item, ownedQty) {
  let qty = 1;
  if (ownedQty > 1) {
    const input = window.prompt(`¿Cuántas unidades de «${item.name}» quieres vender? (1-${ownedQty})`, String(ownedQty));
    if (input === null) return;
    qty = Math.max(1, Math.min(ownedQty, Math.round(Number(input) || 0)));
  } else {
    const ok = await swrpConfirm({
      title: 'Vender objeto',
      message: `¿Vender «${item.name}» por ${item.price} créditos?`,
      confirmText: 'Vender',
      danger: true
    });
    if (!ok) return;
  }
  const gain = (Number(item.price) || 0) * qty;
  state.inventory = removeItemFromInventory(state.inventory, item.id, qty);
  state.credits += gain;
  if (state.selectedItemId === item.id && !state.inventory.some((e) => e.itemId === item.id)) {
    state.selectedItemId = null;
  }
  await persist({ inventory: state.inventory, credits: state.credits });
  render();
}

async function useConsumable(item) {
  const noEffect = !item.stat || item.stat === 'none';
  const isTemporaryNonHp = !noEffect && item.temporary === true && item.stat !== 'hp';

  // Un consumible temporal (no-HP) requiere chapa en combate; si no, no se gasta.
  if (noEffect) {
    // Consumible narrativo (sin efecto mecánico): usable siempre.
  } else if (isTemporaryNonHp) {
    if (!state.partyId) {
      await swrpAlert({
        title: 'Solo en combate',
        message: 'Los consumibles temporales solo pueden usarse durante el combate en el tablero.'
      });
      return;
    }
    const res = await applyConsumableToBoardToken(state.partyId, state.characterId, item);
    if (!res.applied) {
      await swrpAlert({
        title: 'Solo en combate',
        message: 'Este consumible temporal solo se aplica con tu chapa en el tablero durante un combate activo.'
      });
      return;
    }
  } else {
    // HP y permanentes: aplica al personaje y refleja en el token si existe.
    if (item.stat === 'hp') {
      const max = Number(state.maxHp) || null;
      if (state.currentHp != null && max != null) {
        state.currentHp = Math.min(max, state.currentHp + (Number(item.statBonus) || 0));
      }
    } else if (item.stat) {
      state.statBonuses = { ...state.statBonuses };
      state.statBonuses[item.stat] = (Number(state.statBonuses[item.stat]) || 0) + (Number(item.statBonus) || 0);
    }
    if (state.partyId) {
      await applyConsumableToBoardToken(state.partyId, state.characterId, item);
    }
  }

  state.inventory = removeItemFromInventory(state.inventory, item.id, 1);
  if (!state.inventory.some((e) => e.itemId === item.id)) state.selectedItemId = null;
  await persist({
    inventory: state.inventory,
    statBonuses: state.statBonuses,
    ...(item.stat === 'hp' && state.currentHp != null ? { currentHp: state.currentHp } : {})
  });
  // En contexto de tablero, registra el uso del objeto en el log.
  if (typeof state.logUse === 'function') {
    try { await state.logUse(item); } catch { /* el log no debe bloquear el uso */ }
  }
  render();
  await swrpAlert({
    title: 'Consumible usado',
    message: `Has usado «${item.name}».`
  });
}

export function hasCompendiumItems() {
  return getCompendiumItems().length > 0;
}
