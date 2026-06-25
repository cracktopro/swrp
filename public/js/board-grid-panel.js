import { getCompendiumBoards, loadCompendiumData } from './compendium-store.js';
import { MAX_CELL_WIDTH, MAX_CELL_HEIGHT } from './board.js';
import { swrpAlert } from './swrp-dialog.js';

function clampCellInput(input, max) {
  if (!input) return;
  input.max = String(max);
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (n > max) input.value = String(max);
    if (n < 12 && input.value !== '') input.value = '12';
  });
}

export function syncBoardGridInputs(board, {
  colsInput,
  rowsInput,
  cellWidthInput,
  cellHeightInput
} = {}) {
  if (colsInput) colsInput.value = String(board.cols);
  if (rowsInput) rowsInput.value = String(board.rows);
  if (cellWidthInput) cellWidthInput.value = String(board.cellWidth);
  if (cellHeightInput) cellHeightInput.value = String(board.cellHeight);
}

export async function initBoardGridPanel({
  board,
  colsInput,
  rowsInput,
  cellWidthInput,
  cellHeightInput,
  applyBtn,
  compendiumSelect,
  compendiumLoadBtn,
  mapUrlInput
} = {}) {
  clampCellInput(cellWidthInput, MAX_CELL_WIDTH);
  clampCellInput(cellHeightInput, MAX_CELL_HEIGHT);

  applyBtn?.addEventListener('click', async () => {
    try {
      await board.setGridSize(
        colsInput?.value,
        rowsInput?.value,
        cellWidthInput?.value,
        cellHeightInput?.value
      );
    } catch (err) {
      await swrpAlert({ title: 'Error de cuadrícula', message: err.message });
    }
  });

  if (compendiumSelect) {
    await loadCompendiumData();
    const boards = getCompendiumBoards();
    compendiumSelect.innerHTML = [
      '<option value="">— Tablero del compendio —</option>',
      ...boards.map((b) => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.name)}</option>`)
    ].join('');
  }

  compendiumLoadBtn?.addEventListener('click', async () => {
    const id = compendiumSelect?.value;
    if (!id) {
      await swrpAlert({ title: 'Tablero', message: 'Selecciona un tablero del compendio.' });
      return;
    }
    const def = getCompendiumBoards().find((b) => b.id === id);
    if (!def) return;
    try {
      await board.applyCompendiumLayout(def);
      if (mapUrlInput && def.mapUrl) mapUrlInput.value = def.mapUrl;
      syncBoardGridInputs(board, { colsInput, rowsInput, cellWidthInput, cellHeightInput });
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
