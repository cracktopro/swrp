import { getCompendiumItems } from './compendium-store.js';
import { grantCreditsToCharacter, grantItemToCharacter } from './inventory.js';
import { swrpAlert } from './swrp-dialog.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Panel del GM (tablero · Opciones) para otorgar créditos y objetos a los
 * personajes de jugador de la partida.
 */
export function initBoardGrantPanel({ roster = [], partyId = null } = {}) {
  const panel = document.getElementById('board-grant-panel');
  const charSel = document.getElementById('board-grant-character');
  if (!panel || !charSel) return;

  const creditsInput = document.getElementById('board-grant-credits');
  const creditsBtn = document.getElementById('board-grant-credits-btn');
  const itemSel = document.getElementById('board-grant-item');
  const itemQty = document.getElementById('board-grant-item-qty');
  const itemBtn = document.getElementById('board-grant-item-btn');
  const status = document.getElementById('board-grant-status');

  const players = roster.filter((c) => c && c.id && c.type !== 'NPC');
  charSel.innerHTML = players.length
    ? players.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">— Sin personajes de jugador —</option>';

  const items = getCompendiumItems().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  itemSel.innerHTML = items.length
    ? items.map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)} (${escapeHtml(it.type)})</option>`).join('')
    : '<option value="">— Sin objetos en el compendio —</option>';

  const hasPlayers = players.length > 0;
  const hasItems = items.length > 0;
  if (creditsBtn) creditsBtn.disabled = !hasPlayers;
  if (itemBtn) itemBtn.disabled = !hasPlayers || !hasItems;

  function setStatus(msg, ok = true) {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle('text-warning', !ok);
    status.classList.toggle('text-success', ok);
  }

  creditsBtn?.addEventListener('click', async () => {
    const charId = charSel.value;
    if (!charId) return;
    try {
      const total = await grantCreditsToCharacter(charId, creditsInput.value);
      const name = players.find((p) => p.id === charId)?.name || 'Personaje';
      setStatus(`${name} ahora tiene ${total} créditos.`);
      creditsInput.value = '0';
    } catch (err) {
      await swrpAlert({ title: 'No se pudo otorgar', message: err.message });
    }
  });

  itemBtn?.addEventListener('click', async () => {
    const charId = charSel.value;
    const itemId = itemSel.value;
    if (!charId || !itemId) return;
    try {
      await grantItemToCharacter(charId, itemId, itemQty.value, partyId);
      const name = players.find((p) => p.id === charId)?.name || 'Personaje';
      const itemName = items.find((i) => i.id === itemId)?.name || 'Objeto';
      setStatus(`«${itemName}» x${Math.max(1, Math.round(Number(itemQty.value) || 1))} otorgado a ${name}.`);
    } catch (err) {
      await swrpAlert({ title: 'No se pudo otorgar', message: err.message });
    }
  });
}
