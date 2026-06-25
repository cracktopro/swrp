import { cellLabel } from './board.js';
import { MiniBoardPicker } from './board-page.js';
import { swrpAlert } from './swrp-dialog.js';
import { savePartyEscaramuzaSlots } from './escaramuza-templates.js';

export function renderSpawnMarkersOnLayer(layerEl, board, spawns) {
  if (!layerEl || !board) return;
  layerEl.innerHTML = '';
  layerEl.style.width = `${board.cols * board.cellWidth}px`;
  layerEl.style.height = `${board.rows * board.cellHeight}px`;
  (spawns || []).forEach((s) => {
    const el = document.createElement('div');
    el.className = 'board-spawn-marker';
    el.style.left = `${s.col * board.cellWidth}px`;
    el.style.top = `${s.row * board.cellHeight}px`;
    el.innerHTML = '<span class="board-spawn-marker__badge">Spawn</span>';
    layerEl.appendChild(el);
  });
}

export function renderSpawnListUi(listEl, spawns, onRemove) {
  if (!listEl) return;
  if (!spawns?.length) {
    listEl.innerHTML = '<li class="text-muted">Sin spawns definidos.</li>';
    return;
  }
  listEl.innerHTML = spawns.map((s, i) => `
    <li class="d-flex justify-content-between align-items-center gap-2 mb-1">
      <span>Spawn ${i + 1}: ${cellLabel(s.col, s.row)}</span>
      <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-remove-spawn" data-index="${i}">×</button>
    </li>`).join('');
  listEl.querySelectorAll('.btn-remove-spawn').forEach((btn) => {
    btn.addEventListener('click', () => onRemove(Number(btn.dataset.index)));
  });
}

export function createAllySpawnsEditor({
  board,
  spawnLayerEl,
  spawnListEl,
  btnAddEl,
  modalEl,
  labelEl,
  confirmBtnEl,
  canvasEl,
  getSpawns,
  setSpawns
}) {
  let spawnMiniBoard = null;

  function renderMarkers() {
    renderSpawnMarkersOnLayer(spawnLayerEl, board, getSpawns());
  }

  function renderList() {
    renderSpawnListUi(spawnListEl, getSpawns(), (index) => {
      const next = [...getSpawns()];
      next.splice(index, 1);
      setSpawns(next);
      renderList();
    });
  }

  function refresh() {
    renderList();
    renderMarkers();
    spawnMiniBoard?.setMarkerSpawns(getSpawns());
  }

  const modal = modalEl ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;

  btnAddEl?.addEventListener('click', () => {
    if (!board) return;
    if (!spawnMiniBoard && canvasEl) {
      spawnMiniBoard = new MiniBoardPicker(canvasEl, board, {
        markerSpawns: getSpawns(),
        spawnMarkerMode: true
      });
      spawnMiniBoard.side = 'ally';
      spawnMiniBoard.onCellPick = () => {
        const hasCell = spawnMiniBoard.spawnCol != null;
        if (labelEl) {
          labelEl.textContent = hasCell
            ? cellLabel(spawnMiniBoard.spawnCol, spawnMiniBoard.spawnRow)
            : '—';
        }
        if (confirmBtnEl) confirmBtnEl.disabled = !hasCell;
      };
    } else {
      spawnMiniBoard?.setMarkerSpawns(getSpawns());
    }
    spawnMiniBoard?.setSpawn(null, null);
    if (labelEl) labelEl.textContent = '—';
    if (confirmBtnEl) confirmBtnEl.disabled = true;
    modal?.show();
    requestAnimationFrame(() => spawnMiniBoard?.resize());
  });

  modalEl?.addEventListener('shown.bs.modal', () => spawnMiniBoard?.resize());

  confirmBtnEl?.addEventListener('click', () => {
    const col = spawnMiniBoard?.spawnCol;
    const row = spawnMiniBoard?.spawnRow;
    if (col == null || row == null) return;
    if (board.tokenAt(col, row)) {
      swrpAlert({ title: 'Celda ocupada', message: 'Elige una celda libre.' });
      return;
    }
    if (getSpawns().some((s) => s.col === col && s.row === row)) {
      swrpAlert({ title: 'Spawn duplicado', message: 'Ya hay un spawn en esa celda.' });
      return;
    }
    setSpawns([...getSpawns(), { col, row }]);
    refresh();
    spawnMiniBoard?.setSpawn(null, null);
    if (labelEl) labelEl.textContent = '—';
    if (confirmBtnEl) confirmBtnEl.disabled = true;
    spawnMiniBoard?.render();
  });

  return { refresh, renderMarkers };
}

export function initPartyEscaramuzaSlotsPanel({ board, party, partyId, isGM, onSaved }) {
  const panel = document.getElementById('board-escaramuza-slots-panel');
  if (!panel) return null;

  const isCustomEscaramuza = party?.type === 'Escaramuza' && !party?.templateId;
  if (!isGM || !isCustomEscaramuza) {
    panel.classList.add('d-none');
    return null;
  }

  panel.classList.remove('d-none');

  let allySpawns = [...(party.allySpawns || [])];
  const minInput = document.getElementById('board-min-players');
  const maxInput = document.getElementById('board-max-slots');
  const saveBtn = document.getElementById('btn-save-escaramuza-slots');
  const statusEl = document.getElementById('board-escaramuza-slots-status');

  if (minInput) minInput.value = String(party.minPlayers ?? 1);
  if (maxInput) maxInput.value = String(party.maxSlots ?? 4);

  const editor = createAllySpawnsEditor({
    board,
    spawnLayerEl: document.getElementById('board-spawn-layer'),
    spawnListEl: document.getElementById('board-spawn-list'),
    btnAddEl: document.getElementById('btn-board-add-ally-spawn'),
    modalEl: document.getElementById('allySpawnModal'),
    labelEl: document.getElementById('ally-spawn-label'),
    confirmBtnEl: document.getElementById('btn-confirm-ally-spawn'),
    canvasEl: document.getElementById('ally-spawn-canvas'),
    getSpawns: () => allySpawns,
    setSpawns: (next) => { allySpawns = next; }
  });

  editor.refresh();

  saveBtn?.addEventListener('click', async () => {
    saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = '';
    try {
      const payload = await savePartyEscaramuzaSlots(partyId, {
        minPlayers: minInput?.value,
        maxSlots: maxInput?.value,
        allySpawns
      });
      Object.assign(party, payload);
      if (statusEl) statusEl.textContent = 'Configuración guardada.';
      onSaved?.(payload);
    } catch (err) {
      if (statusEl) statusEl.textContent = '';
      await swrpAlert({ title: 'No se pudo guardar', message: err.message });
    } finally {
      saveBtn.disabled = false;
    }
  });

  return editor;
}
