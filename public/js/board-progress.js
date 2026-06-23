import { swrpAlert, swrpConfirm } from './swrp-dialog.js';

function formatSaveDate(savedAt) {
  if (!savedAt) return '—';
  const date = typeof savedAt.toDate === 'function' ? savedAt.toDate() : new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initBoardProgressUi({ board }) {
  const nameInput = document.getElementById('board-save-name');
  const saveBtn = document.getElementById('board-save-progress');
  const loadSelect = document.getElementById('board-load-progress');
  const loadBtn = document.getElementById('board-load-progress-btn');
  if (!saveBtn || !loadSelect || !loadBtn) return;

  async function refreshSaveList({ selectId = null } = {}) {
    const saves = await board.listProgressSaves();
    if (!loadSelect) return saves;
    if (!saves.length) {
      loadSelect.innerHTML = '<option value="">— Sin guardados —</option>';
      loadSelect.disabled = true;
      loadBtn.disabled = true;
      return saves;
    }
    loadSelect.disabled = false;
    loadBtn.disabled = false;
    loadSelect.innerHTML = saves.map((save) => {
      const label = `${save.name} — ${formatSaveDate(save.savedAt)}`;
      const selected = save.id === selectId ? ' selected' : '';
      return `<option value="${escapeHtml(save.id)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
    return saves;
  }

  saveBtn.addEventListener('click', async () => {
    const name = nameInput?.value || '';
    const trimmedName = name.trim();
    saveBtn.disabled = true;
    try {
      const id = await board.saveProgress(name);
      if (nameInput) nameInput.value = '';
      await refreshSaveList({ selectId: id });
      await swrpAlert({
        title: 'Partida guardada',
        message: `Se ha guardado «${trimmedName}».`
      });
    } catch (err) {
      await swrpAlert({ title: 'Error al guardar', message: err.message });
    } finally {
      saveBtn.disabled = false;
    }
  });

  loadBtn.addEventListener('click', async () => {
    const saveId = loadSelect.value;
    if (!saveId) return;
    const label = loadSelect.options[loadSelect.selectedIndex]?.textContent || 'esta partida';
    const ok = await swrpConfirm({
      title: 'Cargar partida',
      message: `¿Restaurar el tablero desde «${label}»? Se sobrescribirá el estado actual del tablero para todos los jugadores.`,
      confirmText: 'Cargar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    loadBtn.disabled = true;
    try {
      await board.loadProgress(saveId);
      await swrpAlert({
        title: 'Partida cargada',
        message: 'El tablero se ha restaurado desde el guardado seleccionado.'
      });
    } catch (err) {
      await swrpAlert({ title: 'Error al cargar', message: err.message });
    } finally {
      loadBtn.disabled = !loadSelect.value;
    }
  });

  refreshSaveList().catch((err) => console.warn('board-progress:', err));
}
