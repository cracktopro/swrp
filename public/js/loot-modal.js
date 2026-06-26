import { getItemById } from './compendium-store.js';
import { grantItemToCharacter } from './inventory.js';
import { normalizeLoot, resolveLoot } from './loot.js';
import { swrpAlert } from './swrp-dialog.js';

let modalEl = null;
let bsModal = null;
let state = null; // { board, target:{kind,id}, sourceName, looter:{id,name,class}, partyId }

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
  modalEl.id = 'swrp-loot-modal';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content swrp-modal-card">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title text-gold">Saqueo · <span id="swrp-loot-source"></span></h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <p id="swrp-loot-credits" class="small mb-2"></p>
          <div id="swrp-loot-list" class="swrp-loot-take-list"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true });
}

/** Devuelve el objeto loot vivo del objetivo (token enemigo o cofre). */
function readTargetLoot() {
  if (!state) return null;
  if (state.target.kind === 'chest') {
    return state.board.getChestById(state.target.id)?.loot ?? null;
  }
  const token = state.board.tokens.find((t) => t.id === state.target.id);
  return token?.loot ?? null;
}

async function persistTargetLoot(loot) {
  if (state.target.kind === 'chest') {
    await state.board.updateChest(state.target.id, { loot });
  } else {
    await state.board.updateTokenLoot(state.target.id, loot);
  }
}

export async function openLootModal({ board, target, sourceName = 'Botín', looter, partyId = null }) {
  ensureModal();
  state = { board, target, sourceName, looter, partyId };
  modalEl.querySelector('#swrp-loot-source').textContent = sourceName;

  if (target.kind === 'chest') {
    await board.markChestOpened(target.id);
  }

  // Resolver el botín la primera vez y repartir créditos.
  const loot = resolveLoot(readTargetLoot());
  let creditsMsg = '';
  if (!loot.creditsClaimed && loot.credits > 0) {
    const split = await board.distributeLootCredits(loot.credits);
    await board.logLootCredits(sourceName, split);
    loot.creditsClaimed = true;
    creditsMsg = `Se repartieron ${split.total} créditos entre ${split.count} jugador(es).`;
  }
  await persistTargetLoot(loot);

  state.creditsMsg = creditsMsg;
  render();
  bsModal.show();
}

function render() {
  const loot = normalizeLoot(readTargetLoot());
  const creditsEl = modalEl.querySelector('#swrp-loot-credits');
  creditsEl.textContent = state.creditsMsg || (loot.credits > 0 ? 'Créditos ya repartidos.' : 'Sin créditos.');

  const listEl = modalEl.querySelector('#swrp-loot-list');
  const items = loot.resolved || [];
  if (!items.length) {
    listEl.innerHTML = '<p class="text-muted small mb-0">No queda ningún objeto por recoger.</p>';
    return;
  }
  listEl.innerHTML = items.map((entry) => {
    const item = getItemById(entry.itemId);
    const name = escapeHtml(item?.name || 'Objeto');
    const type = item ? escapeHtml(item.type) : '';
    return `
      <div class="swrp-loot-take-row">
        ${item?.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" class="swrp-loot-take-img" loading="lazy">` : '<div class="swrp-loot-take-img swrp-loot-take-img--empty"></div>'}
        <div class="swrp-loot-take-info">
          <strong class="text-gold">${name}</strong>
          <span class="small text-muted d-block">${type}${entry.qty > 1 ? ` · x${entry.qty}` : ''}</span>
        </div>
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-primary" data-take="${escapeHtml(entry.itemId)}">Coger</button>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-take]').forEach((btn) => {
    btn.addEventListener('click', () => takeItem(btn.dataset.take));
  });
}

async function takeItem(itemId) {
  const item = getItemById(itemId);
  try {
    await grantItemToCharacter(state.looter.id, itemId, 1, state.partyId);
  } catch (err) {
    await swrpAlert({ title: 'No se pudo coger', message: err.message || 'Tu inventario no admite el objeto.' });
    return;
  }
  // Quita una unidad del botín resuelto y persiste.
  const loot = normalizeLoot(readTargetLoot());
  const entry = (loot.resolved || []).find((e) => e.itemId === itemId);
  if (entry) {
    entry.qty -= 1;
    loot.resolved = loot.resolved.filter((e) => e.qty > 0);
  }
  await persistTargetLoot(loot);
  try { await state.board.logLootItem(state.looter, item?.name || 'objeto', state.sourceName); } catch { /* log no bloquea */ }
  state.creditsMsg = '';
  render();
}
