import { appUrl } from './app-path.js';
import { getItemById, getCompendiumItems } from './compendium-store.js';
import { swrpAlert, swrpConfirm } from './swrp-dialog.js';
import {
  INVENTORY_COLS,
  INVENTORY_ROWS,
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
  updateBoardTokenMoveRange
} from './inventory.js';

let modalEl = null;
let bsModal = null;
let state = null; // { characterId, partyId, classKey, name, credits, inventory, equippedItemId, statBonuses, currentHp, maxHp, canEdit, onChange, selectedItemId }

const CREDITS_ICON = appUrl('icons/creditos.svg');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true });
}

export function openInventoryModal(character, { partyId = null, canEdit = true, onChange = null, logUse = null } = {}) {
  ensureModal();
  const norm = normalizeInventory(character);
  state = {
    characterId: character.id,
    partyId,
    classKey: character.class || character.classKey,
    name: character.name || 'Personaje',
    credits: norm.credits,
    inventory: norm.inventory.map((e) => ({ ...e })),
    equippedItemId: norm.equippedItemId,
    statBonuses: { ...norm.statBonuses },
    currentHp: character.currentHp ?? character.hp ?? null,
    maxHp: character.maxHp ?? null,
    canEdit,
    onChange,
    logUse,
    selectedItemId: null
  };
  modalEl.querySelector('#swrp-inv-name').textContent = state.name;
  render();
  bsModal.show();
}

function render() {
  renderTopbar();
  renderEquip();
  renderGrid();
  renderDetail();
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

  const actions = [];
  if (state.canEdit) {
    if (item.type === 'Equipo') {
      actions.push(isEquipped
        ? '<button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost" data-act="unequip">Quitar equipo</button>'
        : '<button type="button" class="btn btn-sm btn-swrp btn-swrp-primary" data-act="equip">Equipar</button>');
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
        <span class="swrp-item-badge ${item.type === 'Equipo' ? 'swrp-item-badge--equipo' : item.type === 'Consumible' ? 'swrp-item-badge--consumible' : 'swrp-item-badge--inutil'}">${escapeHtml(item.type)}</span>
      </div>
    </div>
    <p class="small mb-1">${escapeHtml(item.description)}</p>
    ${effect}
    <p class="small text-muted mb-1">${item.weight} KG · Venta: ${item.price} créditos${isEquipped ? ' · Equipado' : ''}${ownedQty ? ` · Tienes: ${ownedQty}` : ''}</p>
    <div class="d-flex gap-2 flex-wrap mt-2">${actions.join('')}</div>`;

  detail.querySelector('[data-act="equip"]')?.addEventListener('click', () => equipItem(itemId));
  detail.querySelector('[data-act="unequip"]')?.addEventListener('click', () => unequipItem());
  detail.querySelector('[data-act="use"]')?.addEventListener('click', () => useConsumable(item));
  detail.querySelector('[data-act="sell"]')?.addEventListener('click', () => sellItem(item, ownedQty));
}

async function persist(patch) {
  try {
    await saveCharacterInventory(state.characterId, patch);
    if (state.partyId) {
      await updateBoardTokenMoveRange(state.partyId, {
        id: state.characterId,
        class: state.classKey,
        inventory: state.inventory,
        equippedItemId: state.equippedItemId
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
  // Un Equipo equipado ocupa la ranura especial (sale de la rejilla).
  state.inventory = removeItemFromInventory(state.inventory, itemId, 1);
  // Si ya había uno equipado, devuélvelo a la rejilla.
  if (state.equippedItemId && state.equippedItemId !== itemId) {
    state.inventory = addToGrid(state.inventory, state.equippedItemId);
  }
  state.equippedItemId = itemId;
  await persist({ inventory: state.inventory, equippedItemId: state.equippedItemId });
  render();
}

async function unequipItem() {
  const prev = state.equippedItemId;
  if (!prev) return;
  if (computeUsedSlots(state.inventory) >= INVENTORY_MAX_SLOTS) {
    await swrpAlert({ title: 'Inventario lleno', message: 'No hay espacio en la rejilla para guardar el equipo.' });
    return;
  }
  state.inventory = addToGrid(state.inventory, prev);
  state.equippedItemId = null;
  state.selectedItemId = prev;
  await persist({ inventory: state.inventory, equippedItemId: null });
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
