import { refreshCompendiumBoards } from './compendium-store.js';
import { swrpAlert } from './swrp-dialog.js';

export function syncBoardGridInputs({ cols, rows }, { colsInput, rowsInput } = {}) {
  if (colsInput && cols != null) colsInput.value = String(cols);
  if (rowsInput && rows != null) rowsInput.value = String(rows);
}

export async function populateCompendiumBoardSelect(selectEl) {
  if (!selectEl) return [];
  const boards = await refreshCompendiumBoards();
  selectEl.innerHTML = [
    '<option value="">— Tablero del compendio —</option>',
    ...boards.map((b) => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.name)}</option>`)
  ].join('');
  return boards;
}

export async function initBoardGridPanel({
  board,
  colsInput,
  rowsInput,
  applyBtn,
  compendiumSelect,
  compendiumLoadBtn,
  mapUrlInput
} = {}) {
  applyBtn?.addEventListener('click', async () => {
    try {
      await board.setGridSize(colsInput?.value, rowsInput?.value);
    } catch (err) {
      await swrpAlert({ title: 'Error de cuadrícula', message: err.message });
    }
  });

  await populateCompendiumBoardSelect(compendiumSelect);

  compendiumLoadBtn?.addEventListener('click', async () => {
    const id = compendiumSelect?.value;
    if (!id) {
      await swrpAlert({ title: 'Tablero', message: 'Selecciona un tablero del compendio.' });
      return;
    }
    const boards = await refreshCompendiumBoards();
    const def = boards.find((b) => b.id === id);
    if (!def) {
      await swrpAlert({ title: 'Tablero', message: 'No se encontró el tablero seleccionado.' });
      return;
    }
    try {
      await board.applyCompendiumLayout(def);
      if (mapUrlInput && def.mapUrl) mapUrlInput.value = def.mapUrl;
      syncBoardGridInputs({ cols: board.cols, rows: board.rows }, { colsInput, rowsInput });
    } catch (err) {
      await swrpAlert({ title: 'Error al cargar tablero', message: err.message });
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}
