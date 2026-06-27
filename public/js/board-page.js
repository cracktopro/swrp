import { tokenFromCharacter, tokenFromNpc } from './party-members.js';
import { cellLabel, getTokenHp, getTokenMaxHp, getTokenForce, tokenHasForceStat, updateHealthBarElement } from './board.js';
import {
  drawVisionConeOnCanvas,
  facingLabel,
  sideLabel,
  computeEnemyStatusIcons,
  getIconLabel
} from './board-vision.js';
import { getClassMeta } from './character-card.js';
import { getClassList } from './game-data.js';
import { swrpConfirm, swrpAlert } from './swrp-dialog.js';
import {
  buildNpcEraSelectOptions,
  filterNpcs,
  readNpcClassKey,
  readNpcEra
} from './npcs.js';
import {
  ensureTokenStatsEditor,
  loadTokenStatsEditor,
  readTokenStatsEditor
} from './token-stats-editor.js';
import { normalizeLoot } from './loot.js';
import { renderLootList, createLootItemPicker } from './loot-editor-ui.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nameInitials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function itemClassKey(item) {
  return item.class || item.classKey || '';
}

function itemPortraitUrl(item) {
  return item.portraitUrl || item.image || '';
}

function renderAddTokenThumb(item, theme) {
  const url = itemPortraitUrl(item);
  const themeClass = theme ? ` theme-${theme}` : '';
  if (url) {
    return `<span class="swrp-add-token-item__thumb${themeClass}"><img src="${escapeHtml(url)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="swrp-add-token-item__thumb swrp-add-token-item__thumb--empty${themeClass}">${escapeHtml(nameInitials(item.name))}</span>`;
}

class MiniBoardPicker {
  constructor(canvas, board, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = board;
    this.spawnCol = null;
    this.spawnRow = null;
    this.side = 'ally';
    this.facing = 'left';
    this.scale = 1;
    this.onCellPick = null;
    this.markerSpawns = options.markerSpawns || [];
    this.markerColor = options.markerColor || '#6dff6a';
    this.spawnMarkerMode = !!options.spawnMarkerMode;
    canvas.addEventListener('mousedown', (e) => this.onClick(e));
  }

  setMarkerSpawns(spawns) {
    this.markerSpawns = spawns || [];
    this.render();
  }

  setPreview({ side, facing }) {
    this.side = side;
    this.facing = facing;
    this.render();
  }

  setSpawn(col, row) {
    if (col == null || row == null) {
      this.spawnCol = null;
      this.spawnRow = null;
    } else {
      this.spawnCol = col;
      this.spawnRow = row;
    }
    this.render();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const maxW = wrap?.clientWidth || 480;
    const maxH = 280;
    const cw = this.board.cellWidth;
    const ch = this.board.cellHeight;
    const w = this.board.cols * cw;
    const h = this.board.rows * ch;
    this.scale = Math.min(maxW / w, maxH / h, 1);
    this.canvas.width = Math.floor(w * this.scale);
    this.canvas.height = Math.floor(h * this.scale);
    this.render();
  }

  cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    const cw = this.board.cellWidth;
    const ch = this.board.cellHeight;
    return {
      col: Math.floor(x / cw),
      row: Math.floor(y / ch)
    };
  }

  onClick(e) {
    const { col, row } = this.cellFromEvent(e);
    if (col < 0 || col >= this.board.cols || row < 0 || row >= this.board.rows) return;
    if (this.board.tokenAt(col, row)) return;
    if (this.board.chestAt?.(col, row)) return;
    if (this.markerSpawns.some((s) => s.col === col && s.row === row)) return;
    this.spawnCol = col;
    this.spawnRow = row;
    this.render();
    this.onCellPick?.(col, row);
  }

  drawSpawnMarkerCell(ctx, col, row, { preview = false } = {}) {
    const cw = this.board.cellWidth;
    const ch = this.board.cellHeight;
    const px = col * cw + 2;
    const py = row * ch + 2;
    const szW = cw - 4;
    const szH = ch - 4;
    ctx.fillStyle = preview ? 'rgba(57, 255, 20, 0.55)' : 'rgba(57, 255, 20, 0.42)';
    ctx.fillRect(px, py, szW, szH);
    ctx.strokeStyle = '#6dff6a';
    ctx.lineWidth = preview ? 2.5 : 2;
    ctx.strokeRect(px + 0.5, py + 0.5, szW - 1, szH - 1);
    const badgeH = 13;
    const badgeY = py + szH - badgeH - 2;
    ctx.fillStyle = 'rgba(10, 30, 10, 0.92)';
    ctx.fillRect(px + 3, badgeY, szW - 6, badgeH);
    ctx.fillStyle = '#9dff9a';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Spawn', px + szW / 2, badgeY + badgeH / 2);
  }

  render() {
    const ctx = this.ctx;
    const cols = this.board.cols;
    const rows = this.board.rows;
    const scale = this.scale;
    const cw = this.board.cellWidth;
    const ch = this.board.cellHeight;
    const gridW = cols * cw;
    const gridH = rows * ch;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, gridW, gridH);

    if (this.board.mapImage) {
      ctx.drawImage(this.board.mapImage, 0, 0, gridW, gridH);
    } else {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, gridW, gridH);
    }

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.18)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cw, 0);
      ctx.lineTo(c * cw, gridH);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ch);
      ctx.lineTo(gridW, r * ch);
      ctx.stroke();
    }

    this.board.tokens.forEach((token) => {
      const x = token.col * cw + 4;
      const y = token.row * ch + 4;
      const sizeW = cw - 8;
      const sizeH = ch - 8;
      ctx.fillStyle = token.side === 'enemy'
        ? 'rgba(255, 23, 68, 0.45)'
        : 'rgba(57, 255, 20, 0.35)';
      ctx.fillRect(x, y, sizeW, sizeH);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeRect(x + 0.5, y + 0.5, sizeW - 1, sizeH - 1);
    });

    (this.board.chests || []).forEach((chest) => {
      const x = chest.col * cw + 4;
      const y = chest.row * ch + 4;
      const sizeW = cw - 8;
      const sizeH = ch - 8;
      ctx.fillStyle = 'rgba(255, 199, 0, 0.35)';
      ctx.fillRect(x, y, sizeW, sizeH);
      ctx.strokeStyle = 'rgba(255, 199, 0, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, sizeW - 1, sizeH - 1);
    });

    this.markerSpawns.forEach(({ col, row }) => {
      this.drawSpawnMarkerCell(ctx, col, row);
    });

    if (this.spawnCol != null && this.spawnRow != null) {
      if (this.spawnMarkerMode && this.side === 'ally') {
        this.drawSpawnMarkerCell(ctx, this.spawnCol, this.spawnRow, { preview: true });
      } else if (this.side === 'enemy') {
        drawVisionConeOnCanvas(ctx, this.spawnCol, this.spawnRow, this.facing, Math.max(cw, ch), {
          preview: true,
          tint: '255, 80, 120'
        });
      }

      if (!(this.spawnMarkerMode && this.side === 'ally')) {
      const px = this.spawnCol * cw + 3;
      const py = this.spawnRow * ch + 3;
      const szW = cw - 6;
      const szH = ch - 6;
      ctx.strokeStyle = this.side === 'enemy' ? '#ff4569' : '#6dff6a';
      ctx.lineWidth = 2;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.strokeRect(px, py, szW, szH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = this.side === 'enemy' ? 'rgba(255,23,68,0.35)' : 'rgba(57,255,20,0.3)';
      ctx.fillRect(px + 1, py + 1, szW - 2, szH - 2);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

export { MiniBoardPicker };

export function initBoardPage(ctx) {
  const {
    board,
    roster,
    npcs,
    isGM,
    openCharacterCard,
    charModalBootstrap,
    editorMode = false,
    allUserCharacters = null
  } = ctx;

  const activeListEl = document.getElementById('active-tokens-list');
  const controlModalEl = document.getElementById('tokenControlModal');
  const addModalEl = document.getElementById('addTokenModal');
  const controlModal = controlModalEl ? bootstrap.Modal.getOrCreateInstance(controlModalEl) : null;
  const addModal = addModalEl ? bootstrap.Modal.getOrCreateInstance(addModalEl) : null;

  let controlTokenId = null;
  let addTab = 'characters';
  let addSelection = null;
  let miniBoard = null;
  let addFiltersReady = false;
  let ctrlHpInputReady = false;
  let statsEditorReady = false;
  let ctrlActiveTab = 'play';

  // ── Loot (botín de enemigos y cajas) ──
  let lootDraft = null;       // loot normalizado en edición
  let lootContext = null;     // { kind:'token'|'chest', listId, creditsId }
  let chestPlaceMini = null;
  let chestEditId = null;
  const chestPlaceModalEl = document.getElementById('chestPlaceModal');
  const chestEditModalEl = document.getElementById('chestEditModal');
  const lootItemModalEl = document.getElementById('lootItemModal');
  const chestPlaceModal = chestPlaceModalEl ? bootstrap.Modal.getOrCreateInstance(chestPlaceModalEl) : null;
  const chestEditModal = chestEditModalEl ? bootstrap.Modal.getOrCreateInstance(chestEditModalEl) : null;
  const lootItemPicker = createLootItemPicker({
    modalEl: lootItemModalEl,
    getDraft: () => lootDraft,
    onItemsChanged: () => renderActiveLootList()
  });

  function showCtrlTab(tabName) {
    ctrlActiveTab = tabName;
    document.getElementById('ctrl-tab-play')?.classList.toggle('d-none', tabName !== 'play');
    document.getElementById('ctrl-tab-stats')?.classList.toggle('d-none', tabName !== 'stats');
    document.getElementById('ctrl-tab-loot')?.classList.toggle('d-none', tabName !== 'loot');
    document.querySelectorAll('#ctrl-token-tabs [data-ctrl-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.ctrlTab === tabName);
    });
  }

  function renderActiveLootList() {
    if (!lootContext) return;
    renderLootList(document.getElementById(lootContext.listId), lootDraft, (idx) => {
      if (lootDraft?.items) {
        lootDraft.items.splice(idx, 1);
        renderActiveLootList();
      }
    });
  }

  function openLootItemModal() {
    if (!lootDraft) return;
    lootItemPicker.open();
  }

  async function ensureStatsEditor() {
    const root = document.getElementById('ctrl-stats-editor');
    if (!root || statsEditorReady) return;
    await ensureTokenStatsEditor(root);
    statsEditorReady = true;
  }

  document.getElementById('ctrl-token-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ctrl-tab]');
    if (!tab) return;
    showCtrlTab(tab.dataset.ctrlTab);
  });

  function setupCtrlHpPreview() {
    if (ctrlHpInputReady) return;
    const hpInput = document.getElementById('ctrl-token-hp');
    const maxHpEl = document.getElementById('ctrl-token-max-hp');
    if (!hpInput) return;
    hpInput.addEventListener('input', () => {
      const maxHp = parseInt(maxHpEl?.textContent, 10) || 1;
      let hp = parseInt(hpInput.value, 10);
      if (Number.isNaN(hp)) hp = 0;
      updateHealthBarElement(document.getElementById('ctrl-token-hp-bar'), hp, maxHp);
    });
    ctrlHpInputReady = true;
  }

  function updateCtrlHpBar(hp, maxHp) {
    updateHealthBarElement(document.getElementById('ctrl-token-hp-bar'), hp, maxHp);
  }

  function setupAddFilters() {
    if (addFiltersReady) return;
    const classSel = document.getElementById('add-filter-class');
    const eraSel = document.getElementById('add-filter-era');
    if (!classSel) return;

    classSel.innerHTML = [
      '<option value="">Todas las clases</option>',
      ...getClassList().map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
    ].join('');

    if (eraSel) {
      eraSel.innerHTML = buildNpcEraSelectOptions();
    }

    const rerender = () => renderAddList();
    document.getElementById('add-filter-name')?.addEventListener('input', rerender);
    classSel.addEventListener('change', rerender);
    eraSel?.addEventListener('change', rerender);
    addFiltersReady = true;
  }

  function renderActiveTokensList() {
    if (!activeListEl) return;
    const tokens = board.tokens;
    if (!tokens.length) {
      activeListEl.innerHTML = '<p class="small text-muted mb-0">No hay chapas en el tablero.</p>';
      return;
    }

    activeListEl.innerHTML = tokens.map((token) => {
      const side = token.side === 'enemy' ? 'enemy' : 'ally';
      const facing = token.side === 'enemy' ? ` · ${facingLabel(token.facing || 'left')}` : '';
      return `
        <button type="button" class="swrp-active-token theme-${token.theme || 'soldado'}" data-token-id="${escapeHtml(token.id)}">
          <span class="swrp-active-token__side swrp-active-token__side--${side}">${side === 'enemy' ? 'EN' : 'AL'}</span>
          <span class="swrp-active-token__info">
            <strong>${escapeHtml(token.name)}</strong>
            <span class="swrp-active-token__meta">${sideLabel(side)}${escapeHtml(facing)} · ${cellLabel(token.col, token.row)}</span>
          </span>
        </button>`;
    }).join('');

    activeListEl.querySelectorAll('[data-token-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const token = board.tokens.find((t) => t.id === btn.dataset.tokenId);
        if (token) openTokenControlModal(token);
      });
      btn.addEventListener('mouseenter', () => {
        board.setHighlightToken(btn.dataset.tokenId, 'list');
        btn.classList.add('is-list-hover');
      });
      btn.addEventListener('mouseleave', () => {
        board.clearHighlightToken('list');
        btn.classList.remove('is-list-hover');
      });
    });
  }

  function syncControlModalForm(token) {
    if (!token) return;
    document.getElementById('ctrl-token-name').textContent = token.name;
    const cellEl = document.getElementById('ctrl-token-cell');
    if (cellEl) {
      cellEl.className = 'board-cell-badge';
      cellEl.textContent = cellLabel(token.col, token.row);
    }
    document.getElementById('ctrl-side-ally').checked = token.side !== 'enemy';
    document.getElementById('ctrl-side-enemy').checked = token.side === 'enemy';

    const facingWrap = document.getElementById('ctrl-facing-wrap');
    const visionWrap = document.getElementById('ctrl-vision-wrap');
    const visionStatus = document.getElementById('ctrl-vision-status');
    const resetBtn = document.getElementById('btn-ctrl-reset-alert');
    const isEnemy = token.side === 'enemy';
    facingWrap?.classList.toggle('d-none', !isEnemy);
    visionWrap?.classList.toggle('d-none', !isEnemy);

    if (isEnemy) {
      const { icons } = computeEnemyStatusIcons(token, board.tokens, board.cols, board.rows);
      const hasVision = icons.includes('vision');
      visionStatus.textContent = hasVision
        ? getIconLabel('vision')
        : getIconLabel('no_vision');
      if (resetBtn) resetBtn.disabled = !token.alerted;
    }

    const facing = token.facing || 'left';
    facingWrap?.querySelectorAll('[data-facing]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.facing === facing);
    });

    const hpInput = document.getElementById('ctrl-token-hp');
    const maxHpEl = document.getElementById('ctrl-token-max-hp');
    if (hpInput && maxHpEl) {
      const maxHp = getTokenMaxHp(token);
      maxHpEl.textContent = String(maxHp);
      hpInput.max = String(maxHp);
      hpInput.value = String(getTokenHp(token));
      updateCtrlHpBar(getTokenHp(token), maxHp);
    }
    setupCtrlHpPreview();

    const forceWrap = document.getElementById('ctrl-force-wrap');
    const forceInput = document.getElementById('ctrl-token-force');
    const hasForce = tokenHasForceStat(token);
    forceWrap?.classList.toggle('d-none', !hasForce);
    if (hasForce && forceInput) {
      const currentForce = getTokenForce(token);
      forceInput.value = currentForce == null ? '0' : String(currentForce);
    }

    const coverInput = document.getElementById('ctrl-token-cover');
    if (coverInput) {
      coverInput.checked = token.inCover === true;
    }
  }

  function setupLootTabForToken(token) {
    const isEnemy = token.side === 'enemy';
    document.getElementById('ctrl-token-tab-loot')?.classList.toggle('d-none', !isEnemy);
    if (isEnemy) {
      lootContext = { kind: 'token', listId: 'ctrl-loot-list', creditsId: 'ctrl-loot-credits' };
      lootDraft = normalizeLoot(token.loot);
      const creditsInput = document.getElementById('ctrl-loot-credits');
      if (creditsInput) creditsInput.value = String(lootDraft.credits || 0);
      renderActiveLootList();
    } else {
      lootContext = null;
      lootDraft = null;
    }
  }

  async function openTokenControlModal(token) {
    controlTokenId = token.id;
    showCtrlTab('play');
    syncControlModalForm(token);
    setupLootTabForToken(token);
    await ensureStatsEditor();
    if (controlTokenId === token.id) {
      loadTokenStatsEditor(token);
    }
    controlModal?.show();
  }

  async function saveControlModal() {
    const token = board.tokens.find((t) => t.id === controlTokenId);
    if (!token) return;

    if (statsEditorReady) {
      const statsEntity = readTokenStatsEditor();
      if (!statsEntity.name) {
        await swrpAlert({ title: 'Nombre requerido', message: 'Indica un nombre en la pestaña Stats.' });
        showCtrlTab('stats');
        return;
      }
      try {
        await board.updateTokenFromStats(token.id, statsEntity);
      } catch (err) {
        await swrpAlert({ title: 'Error al guardar stats', message: err.message || 'No se pudieron guardar los cambios.' });
        showCtrlTab('stats');
        return;
      }
    }

    const updated = board.tokens.find((t) => t.id === controlTokenId) || token;
    const side = document.getElementById('ctrl-side-enemy').checked ? 'enemy' : 'ally';
    const facingBtn = document.querySelector('#ctrl-facing-wrap [data-facing].active');
    const facing = facingBtn?.dataset.facing || updated.facing || 'left';
    const inCover = document.getElementById('ctrl-token-cover')?.checked === true;
    await board.updateTokenProperties(updated.id, { side, facing, inCover });
    const hpVal = parseInt(document.getElementById('ctrl-token-hp')?.value, 10);
    if (!Number.isNaN(hpVal)) {
      await board.updateTokenHp(updated.id, hpVal);
    }
    const forceInput = document.getElementById('ctrl-token-force');
    if (tokenHasForceStat(updated) && forceInput) {
      const forceVal = parseInt(forceInput.value, 10);
      if (!Number.isNaN(forceVal)) {
        await board.updateTokenForce(updated.id, forceVal);
      }
    }
    if (side === 'enemy' && lootContext?.kind === 'token' && lootDraft) {
      lootDraft.credits = Math.max(0, parseInt(document.getElementById('ctrl-loot-credits')?.value, 10) || 0);
      lootDraft.resolved = null;
      await board.updateTokenLoot(updated.id, lootDraft);
    }
    controlModal?.hide();
    renderActiveTokensList();
  }

  function openChestPlaceModal() {
    if (!chestPlaceMini) {
      const canvas = document.getElementById('chest-place-canvas');
      chestPlaceMini = new MiniBoardPicker(canvas, board);
      chestPlaceMini.onCellPick = () => {
        const label = chestPlaceMini.spawnCol != null
          ? cellLabel(chestPlaceMini.spawnCol, chestPlaceMini.spawnRow)
          : 'Clic en el mapa…';
        document.getElementById('chest-place-label').textContent = label;
        document.getElementById('btn-confirm-chest').disabled = chestPlaceMini.spawnCol == null;
      };
    }
    document.getElementById('chest-place-image').value = '';
    chestPlaceMini.setSpawn(null, null);
    document.getElementById('chest-place-label').textContent = 'Clic en el mapa…';
    document.getElementById('btn-confirm-chest').disabled = true;
    chestPlaceModal?.show();
    requestAnimationFrame(() => chestPlaceMini.resize());
  }

  function openChestEditModal(chest) {
    if (!chest) return;
    chestEditId = chest.id;
    lootContext = { kind: 'chest', listId: 'chest-loot-list', creditsId: 'chest-loot-credits' };
    lootDraft = normalizeLoot(chest.loot);
    document.getElementById('chest-edit-cell').textContent = cellLabel(chest.col, chest.row);
    document.getElementById('chest-edit-image').value = chest.imageUrl || '';
    document.getElementById('chest-loot-credits').value = String(lootDraft.credits || 0);
    renderActiveLootList();
    chestEditModal?.show();
  }

  function getAddCandidates() {
    const list = addTab === 'characters'
      ? (allUserCharacters ?? roster)
      : npcs;
    const mapped = list.map((item) => {
      const template = addTab === 'characters'
        ? tokenFromCharacter(item)
        : tokenFromNpc(item);
      return { item, template };
    });

    if (addTab === 'npcs' || editorMode) return mapped;

    return mapped.filter(({ template }) => !board.tokenOnBoard(template.sourceId, template.kind));
  }

  function getFilteredAddCandidates() {
    const nameQ = document.getElementById('add-filter-name')?.value.trim().toLowerCase() || '';
    const classQ = document.getElementById('add-filter-class')?.value || '';
    const eraQ = document.getElementById('add-filter-era')?.value || '';
    const eraWrap = document.getElementById('add-filter-era-wrap');
    eraWrap?.classList.toggle('d-none', addTab !== 'npcs');

    const base = getAddCandidates();
    if (addTab !== 'npcs') {
      return base.filter(({ item }) => {
        if (nameQ && !(item.name || '').toLowerCase().includes(nameQ)) return false;
        if (classQ && itemClassKey(item) !== classQ) return false;
        return true;
      });
    }

    const npcItems = base.map((c) => c.item);
    const filteredItems = new Set(
      filterNpcs(npcItems, { nameQ, classQ, eraQ }).map((n) => n.id)
    );
    return base.filter(({ item }) => filteredItems.has(item.id));
  }

  function renderAddList() {
    const listEl = document.getElementById('add-token-list');
    const allCandidates = getAddCandidates();
    const candidates = getFilteredAddCandidates();

    if (!allCandidates.length) {
      const msg = addTab === 'npcs'
        ? 'No hay NPCs disponibles.'
        : 'Todos los personajes ya están en el tablero.';
      listEl.innerHTML = `<p class="small text-muted mb-0">${msg}</p>`;
      addSelection = null;
      document.getElementById('btn-confirm-add').disabled = true;
      miniBoard?.setSpawn(null, null);
      return;
    }

    if (!candidates.length) {
      listEl.innerHTML = '<p class="small text-muted mb-0">Ningún resultado con esos filtros.</p>';
      addSelection = null;
      document.getElementById('btn-confirm-add').disabled = true;
      return;
    }

    if (!addSelection || !candidates.some((c) => c.template.sourceId === addSelection.template.sourceId)) {
      addSelection = candidates[0];
    }

    listEl.innerHTML = candidates.map(({ item, template }) => {
      const selected = addSelection?.template.sourceId === template.sourceId;
      const classMeta = getClassMeta(itemClassKey(item));
      const defaultSide = addTab === 'npcs' ? 'enemy' : 'ally';
      const eraLine = addTab === 'npcs'
        ? ` · ${escapeHtml(readNpcEra(item))}`
        : '';
      return `
        <button type="button" class="swrp-add-token-item${selected ? ' is-selected' : ''}" data-source="${escapeHtml(template.sourceId)}" data-kind="${escapeHtml(template.kind)}">
          ${renderAddTokenThumb(item, classMeta.theme || item.theme || 'soldado')}
          <span class="swrp-add-token-item__body">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="small text-muted d-block">${escapeHtml(classMeta.label || itemClassKey(item) || '—')} · ${sideLabel(defaultSide)}${eraLine}</span>
          </span>
        </button>`;
    }).join('');

    listEl.querySelectorAll('.swrp-add-token-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        addSelection = candidates.find(
          (c) => c.template.sourceId === btn.dataset.source && c.template.kind === btn.dataset.kind
        );
        renderAddList();
        syncAddForm();
      });
    });

    syncAddForm();
  }

  function syncAddForm() {
    const sideEnemy = document.getElementById('add-side-enemy').checked;
    const facing = document.querySelector('#add-facing-wrap [data-facing].active')?.dataset.facing || 'left';
    document.getElementById('add-facing-wrap')?.classList.toggle('d-none', !sideEnemy);
    miniBoard?.setPreview({
      side: sideEnemy ? 'enemy' : 'ally',
      facing
    });
    document.getElementById('add-spawn-label').textContent = miniBoard?.spawnCol != null
      ? cellLabel(miniBoard.spawnCol, miniBoard.spawnRow)
      : 'Clic en el mapa…';
    document.getElementById('btn-confirm-add').disabled = !addSelection || miniBoard?.spawnCol == null;
  }

  function openAddTokenModal() {
    setupAddFilters();
    addTab = 'characters';
    document.getElementById('add-filter-name').value = '';
    document.getElementById('add-filter-class').value = '';
    const eraFilter = document.getElementById('add-filter-era');
    if (eraFilter) eraFilter.value = '';
    document.querySelectorAll('#add-token-tabs .nav-link').forEach((el, i) => {
      el.classList.toggle('active', i === 0);
    });
    document.getElementById('add-side-ally').checked = true;
    document.getElementById('add-side-enemy').checked = false;
    document.querySelectorAll('#add-facing-wrap [data-facing]').forEach((btn, i) => {
      btn.classList.toggle('active', btn.dataset.facing === 'left');
    });

    if (!miniBoard) {
      const canvas = document.getElementById('add-mini-canvas');
      miniBoard = new MiniBoardPicker(canvas, board);
      miniBoard.onCellPick = () => syncAddForm();
    }
    miniBoard.setSpawn(null, null);
    miniBoard.side = 'ally';
    miniBoard.facing = 'left';

    renderAddList();
    addModal?.show();
    requestAnimationFrame(() => {
      miniBoard.resize();
      syncAddForm();
    });
  }

  addModalEl?.addEventListener('shown.bs.modal', () => miniBoard?.resize());
  chestPlaceModalEl?.addEventListener('shown.bs.modal', () => chestPlaceMini?.resize());

  document.getElementById('btn-open-add')?.addEventListener('click', openAddTokenModal);
  document.getElementById('btn-open-add-chest')?.addEventListener('click', openChestPlaceModal);
  document.getElementById('ctrl-loot-add')?.addEventListener('click', openLootItemModal);
  document.getElementById('chest-loot-add')?.addEventListener('click', openLootItemModal);

  document.getElementById('btn-confirm-chest')?.addEventListener('click', async () => {
    if (chestPlaceMini?.spawnCol == null) return;
    try {
      await board.addChest({
        col: chestPlaceMini.spawnCol,
        row: chestPlaceMini.spawnRow,
        imageUrl: document.getElementById('chest-place-image').value.trim()
      });
      chestPlaceMini.setSpawn(null, null);
      chestPlaceModal?.hide();
    } catch (err) {
      await swrpAlert({ title: 'Error', message: err.message });
    }
  });

  document.getElementById('btn-chest-save')?.addEventListener('click', async () => {
    if (!chestEditId || !lootDraft) return;
    lootDraft.credits = Math.max(0, parseInt(document.getElementById('chest-loot-credits')?.value, 10) || 0);
    lootDraft.resolved = null;
    await board.updateChest(chestEditId, {
      imageUrl: document.getElementById('chest-edit-image').value.trim(),
      loot: lootDraft
    });
    chestEditModal?.hide();
  });

  document.getElementById('btn-chest-delete')?.addEventListener('click', async () => {
    if (!chestEditId) return;
    const ok = await swrpConfirm({
      title: 'Eliminar caja',
      message: '¿Eliminar esta caja del tablero?',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    await board.removeChest(chestEditId);
    chestEditModal?.hide();
  });

  document.getElementById('add-token-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-add-tab]');
    if (!tab) return;
    addTab = tab.dataset.addTab;
    document.querySelectorAll('#add-token-tabs .nav-link').forEach((el) => el.classList.remove('active'));
    tab.classList.add('active');
    if (addTab === 'npcs') {
      document.getElementById('add-side-enemy').checked = true;
    } else {
      document.getElementById('add-side-ally').checked = true;
    }
    renderAddList();
  });

  ['add-side-ally', 'add-side-enemy'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', syncAddForm);
  });

  document.getElementById('add-facing-wrap')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-facing]');
    if (!btn) return;
    document.querySelectorAll('#add-facing-wrap [data-facing]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    syncAddForm();
  });

  document.getElementById('btn-confirm-add')?.addEventListener('click', async () => {
    if (!addSelection || miniBoard?.spawnCol == null) return;
    const side = document.getElementById('add-side-enemy').checked ? 'enemy' : 'ally';
    const facing = document.querySelector('#add-facing-wrap [data-facing].active')?.dataset.facing || 'left';
    try {
      await board.placeTokenFromTemplate(addSelection.template, {
        col: miniBoard.spawnCol,
        row: miniBoard.spawnRow,
        side,
        facing
      });
      miniBoard.setSpawn(null, null);
      miniBoard.render();
      renderActiveTokensList();
      syncAddForm();
    } catch (err) {
      await swrpAlert({ title: 'Error', message: err.message });
    }
  });

  document.getElementById('ctrl-facing-wrap')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-facing]');
    if (!btn) return;
    document.querySelectorAll('#ctrl-facing-wrap [data-facing]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });

  ['ctrl-side-ally', 'ctrl-side-enemy'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      const token = board.tokens.find((t) => t.id === controlTokenId);
      if (!token) return;
      const isEnemy = document.getElementById('ctrl-side-enemy').checked;
      document.getElementById('ctrl-facing-wrap')?.classList.toggle('d-none', !isEnemy);
      document.getElementById('ctrl-vision-wrap')?.classList.toggle('d-none', !isEnemy);
    });
  });

  document.getElementById('btn-ctrl-save')?.addEventListener('click', saveControlModal);

  document.getElementById('btn-ctrl-remove')?.addEventListener('click', async () => {
    if (!controlTokenId) return;
    const token = board.tokens.find((t) => t.id === controlTokenId);
    const ok = await swrpConfirm({
      title: 'Eliminar chapa',
      message: token
        ? `¿Eliminar a «${token.name}» del tablero?`
        : '¿Eliminar esta chapa del tablero?',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    await board.removeToken(controlTokenId);
    controlModal?.hide();
    renderActiveTokensList();
  });

  document.getElementById('btn-ctrl-reset-alert')?.addEventListener('click', async () => {
    if (!controlTokenId) return;
    await board.resetTokenAlert(controlTokenId);
    const token = board.tokens.find((t) => t.id === controlTokenId);
    syncControlModalForm(token);
    renderActiveTokensList();
  });

  document.getElementById('btn-ctrl-view-card')?.addEventListener('click', () => {
    const token = board.tokens.find((t) => t.id === controlTokenId);
    if (token) openCharacterCard(token);
  });

  board.onTokensChange = () => renderActiveTokensList();
  board.onGMTokenControl = (token) => {
    if (isGM) openTokenControlModal(token);
  };

  renderActiveTokensList();

  return { renderActiveTokensList, openTokenControlModal, openChestEditModal };
}
