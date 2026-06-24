import { renderNavbar } from './navbar.js';
import { requireAuth, isAdmin } from './auth.js';
import { appUrl } from './app-path.js';
import { TacticalBoard, cellLabel, getTokenHp, getTokenMaxHp, getTokenEffectiveDefense, isTokenInCover } from './board.js';
import { loadAllNpcs, npcToCardData, buildNpcEraFormOptions, DEFAULT_NPC_ERA } from './npcs.js';
import { loadCompendiumData } from './compendium-store.js';
import { renderCharacterCard, normalizeCharacter } from './character-card.js';
import { initBoardPage, MiniBoardPicker } from './board-page.js';
import { initBoardCombatUi } from './board-combat.js';
import { swrpConfirm, swrpAlert } from './swrp-dialog.js';
import { loadUserCharacters } from './characters.js';
import {
  loadUserEscaramuzaTemplates,
  loadEscaramuzaTemplate,
  saveEscaramuzaTemplate,
  deleteEscaramuzaTemplate,
  buildLayoutFromBoard,
  buildFreshBoardState
} from './escaramuza-templates.js';

let board = null;
let allySpawns = [];
let editingTemplateId = null;
let userCharacters = [];
let npcs = [];
let spawnMiniBoard = null;

export async function initMapEditorPage() {
  const { user, profile } = await requireAuth();
  renderNavbar('map-editor', user, { isAdmin: isAdmin(profile) });

  document.getElementById('editor-era').innerHTML = buildNpcEraFormOptions(DEFAULT_NPC_ERA);

  const params = new URLSearchParams(window.location.search);
  const templateParam = params.get('template');
  const isNew = params.get('new') === '1';

  document.getElementById('btn-new-template')?.addEventListener('click', () => {
    window.location.assign(appUrl('map-editor?new=1'));
  });

  document.getElementById('btn-back-list')?.addEventListener('click', () => {
    window.location.assign(appUrl('map-editor'));
  });

  if (templateParam || isNew) {
    await openEditorWorkspace(user, profile, templateParam);
    return;
  }

  await renderTemplateList(user);
}

async function renderTemplateList(user) {
  document.getElementById('map-editor-list-view')?.classList.remove('d-none');
  document.getElementById('map-editor-workspace')?.classList.add('d-none');

  const listEl = document.getElementById('template-list');
  listEl.innerHTML = '<p class="text-muted">Cargando…</p>';

  try {
    const templates = await loadUserEscaramuzaTemplates(user.uid);
    if (!templates.length) {
      listEl.innerHTML = '<p class="text-muted mb-0">Aún no has creado escaramuzas. Pulsa «+ Nueva escaramuza» para empezar.</p>';
      return;
    }

    listEl.innerHTML = '';
    templates.forEach((tpl) => {
      const card = document.createElement('article');
      card.className = 'swrp-party-card mb-3';
      const media = tpl.imageUrl
        ? `<img class="swrp-party-card__img" src="${escapeAttr(tpl.imageUrl)}" alt="" loading="lazy">`
        : '<div class="swrp-party-card__placeholder"><span>Escaramuza</span></div>';
      card.innerHTML = `
        <div class="swrp-party-card__media">${media}</div>
        <div class="swrp-party-card__body">
          <h3 class="swrp-party-card__title">${escapeHtml(tpl.name)}</h3>
          <p class="swrp-party-card__meta">${tpl.minPlayers || 1}–${tpl.maxSlots || 1} jugadores · ${tpl.allySpawns?.length || 0} spawns</p>
          <p class="swrp-party-card__desc">${escapeHtml(tpl.description || 'Sin descripción.')}</p>
          <div class="swrp-party-card__actions">
            <a href="${appUrl(`map-editor?template=${encodeURIComponent(tpl.id)}`)}" class="btn btn-sm btn-swrp btn-swrp-primary">Editar</a>
            <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-delete-template">Eliminar</button>
          </div>
        </div>`;
      card.querySelector('.btn-delete-template')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la plantilla «${tpl.name}»? Las partidas activas no se verán afectadas.`)) return;
        try {
          await deleteEscaramuzaTemplate(user.uid, tpl.id);
          await renderTemplateList(user);
        } catch (err) {
          await swrpAlert({ title: 'Error', message: err.message });
        }
      });
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = `<p class="text-danger mb-0">Error al cargar: ${escapeHtml(err.message)}</p>`;
  }
}

async function openEditorWorkspace(user, profile, templateId) {
  document.getElementById('map-editor-list-view')?.classList.add('d-none');
  document.getElementById('map-editor-workspace')?.classList.remove('d-none');

  editingTemplateId = templateId || null;
  allySpawns = [];
  userCharacters = await loadUserCharacters(user.uid);
  await loadCompendiumData();
  npcs = (await loadAllNpcs()).map(npcToCardData);

  if (templateId) {
    const tpl = await loadEscaramuzaTemplate(templateId);
    if (!tpl || tpl.creatorId !== user.uid) {
      await swrpAlert({ title: 'No encontrada', message: 'No puedes editar esta plantilla.' });
      window.location.assign(appUrl('map-editor'));
      return;
    }
    fillMetaForm(tpl);
    allySpawns = [...(tpl.allySpawns || [])];
    await initBoardEditor(user, profile, buildFreshBoardState(tpl.boardLayout));
  } else {
    fillMetaForm({});
    await initBoardEditor(user, profile, null);
  }

  renderSpawnList();
  wireSpawnModal();
  wireSaveButton(user, profile);
}

function fillMetaForm(tpl) {
  document.getElementById('editor-name').value = tpl.name || '';
  document.getElementById('editor-era').value = tpl.era || DEFAULT_NPC_ERA;
  document.getElementById('editor-image-url').value = tpl.imageUrl || '';
  document.getElementById('editor-description').value = tpl.description || '';
  document.getElementById('editor-min-players').value = String(tpl.minPlayers ?? 1);
  document.getElementById('editor-max-slots').value = String(tpl.maxSlots ?? 4);
  document.getElementById('editor-title').textContent = tpl.name
    ? `Editar: ${tpl.name}`
    : 'Nueva escaramuza';
}

function renderSpawnList() {
  const listEl = document.getElementById('editor-spawn-list');
  if (!listEl) return;
  if (!allySpawns.length) {
    listEl.innerHTML = '<li class="text-muted">Sin spawns definidos.</li>';
    return;
  }
  listEl.innerHTML = allySpawns.map((s, i) => `
    <li class="d-flex justify-content-between align-items-center gap-2 mb-1">
      <span>Spawn ${i + 1}: ${cellLabel(s.col, s.row)}</span>
      <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-remove-spawn" data-index="${i}">×</button>
    </li>`).join('');
  listEl.querySelectorAll('.btn-remove-spawn').forEach((btn) => {
    btn.addEventListener('click', () => {
      allySpawns.splice(Number(btn.dataset.index), 1);
      renderSpawnList();
      spawnMiniBoard?.setMarkerSpawns(allySpawns);
    });
  });
}

function wireSpawnModal() {
  const modalEl = document.getElementById('allySpawnModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const labelEl = document.getElementById('ally-spawn-label');
  const confirmBtn = document.getElementById('btn-confirm-ally-spawn');

  document.getElementById('btn-add-ally-spawn')?.addEventListener('click', () => {
    if (!board) return;
    if (!spawnMiniBoard) {
      const canvas = document.getElementById('ally-spawn-canvas');
      spawnMiniBoard = new MiniBoardPicker(canvas, board, { markerSpawns: allySpawns });
      spawnMiniBoard.side = 'ally';
      spawnMiniBoard.onCellPick = () => {
        const hasCell = spawnMiniBoard.spawnCol != null;
        labelEl.textContent = hasCell
          ? cellLabel(spawnMiniBoard.spawnCol, spawnMiniBoard.spawnRow)
          : '—';
        confirmBtn.disabled = !hasCell;
      };
    } else {
      spawnMiniBoard.setMarkerSpawns(allySpawns);
    }
    spawnMiniBoard.setSpawn(null, null);
    labelEl.textContent = '—';
    confirmBtn.disabled = true;
    modal.show();
    requestAnimationFrame(() => spawnMiniBoard.resize());
  });

  modalEl?.addEventListener('shown.bs.modal', () => spawnMiniBoard?.resize());

  confirmBtn?.addEventListener('click', () => {
    const col = spawnMiniBoard?.spawnCol;
    const row = spawnMiniBoard?.spawnRow;
    if (col == null || row == null) return;
    if (board.tokenAt(col, row)) {
      swrpAlert({ title: 'Celda ocupada', message: 'Elige una celda libre.' });
      return;
    }
    if (allySpawns.some((s) => s.col === col && s.row === row)) {
      swrpAlert({ title: 'Spawn duplicado', message: 'Ya hay un spawn en esa celda.' });
      return;
    }
    allySpawns.push({ col, row });
    renderSpawnList();
    spawnMiniBoard?.setMarkerSpawns(allySpawns);
    modal.hide();
  });
}

function wireSaveButton(user, profile) {
  document.getElementById('btn-save-template')?.addEventListener('click', async () => {
    if (!board) return;
    const btn = document.getElementById('btn-save-template');
    btn.disabled = true;
    try {
      const boardLayout = buildLayoutFromBoard(board, { enemyOnly: true });
      const data = {
        name: document.getElementById('editor-name').value,
        era: document.getElementById('editor-era').value,
        imageUrl: document.getElementById('editor-image-url').value,
        description: document.getElementById('editor-description').value,
        minPlayers: document.getElementById('editor-min-players').value,
        maxSlots: document.getElementById('editor-max-slots').value,
        allySpawns,
        boardLayout
      };
      const id = await saveEscaramuzaTemplate(
        user.uid,
        profile?.username || user.displayName || user.email,
        data,
        editingTemplateId
      );
      editingTemplateId = id;
      await swrpAlert({ title: 'Guardado', message: 'Plantilla de escaramuza guardada correctamente.' });
      window.history.replaceState({}, '', appUrl(`map-editor?template=${encodeURIComponent(id)}`));
      document.getElementById('editor-title').textContent = `Editar: ${data.name.trim()}`;
    } catch (err) {
      await swrpAlert({ title: 'No se pudo guardar', message: err.message });
    } finally {
      btn.disabled = false;
    }
  });
}

async function initBoardEditor(user, profile, initialState) {
  const charModal = new bootstrap.Modal(document.getElementById('charModal'));
  const mentionModal = new bootstrap.Modal(document.getElementById('boardMentionModal'));
  const charModalBody = document.getElementById('char-modal-body');
  const roster = userCharacters;
  const isGM = true;

  const mapUrlInput = document.getElementById('map-url');
  const mapApplyBtn = document.getElementById('map-url-apply');
  const mapClearBtn = document.getElementById('map-url-clear');
  const gridColsInput = document.getElementById('grid-cols');
  const gridRowsInput = document.getElementById('grid-rows');

  const boardSidebar = initBoardSidebar(isGM);

  const boardHint = document.getElementById('board-board-hint');
  if (boardHint) {
    boardHint.textContent = 'Modo editor: coloca enemigos, prueba combate con tus personajes y guarda la plantilla.';
  }

  board = new TacticalBoard(
    document.getElementById('board-canvas'),
    document.getElementById('board-token-layer'),
    document.getElementById('combat-log'),
    {
      localPersist: true,
      isGM: true,
      userId: user.uid,
      roster,
      colLabelsEl: document.getElementById('board-col-labels'),
      rowLabelsEl: document.getElementById('board-row-labels'),
      tooltipEl: document.getElementById('board-token-tooltip'),
      initiativeLogEl: document.getElementById('board-initiative-log'),
      initiativeOrderEl: document.getElementById('board-initiative-order'),
      onTokenClick: (token) => openTokenCard(token, { roster, npcs, charModal, charModalBody }),
      onMapUrlChange: (url) => { mapUrlInput.value = url || ''; },
      onCombatStateChange: (started) => {
        syncCombatUi(started, isGM);
        boardSidebar.syncGmSidebar(board);
      },
      onInitiativeStateChange: () => boardSidebar.syncGmSidebar(board),
      onGridSizeChange: (cols, rows) => {
        gridColsInput.value = cols;
        gridRowsInput.value = rows;
      }
    }
  );

  if (initialState) {
    await board.loadLocalState(initialState);
  } else {
    await board.loadState();
  }

  syncCombatUi(board.combatStarted, isGM);
  boardSidebar.syncGmSidebar(board);

  initBoardPage({
    board,
    roster,
    npcs,
    isGM,
    editorMode: true,
    allUserCharacters: userCharacters,
    openCharacterCard: (token) => openTokenCard(token, { roster, npcs, charModal, charModalBody })
  });

  const fakeMember = {
    userId: user.uid,
    playMode: 'gm',
    characterSnapshot: userCharacters[0] ? normalizeCharacter(userCharacters[0], userCharacters[0].id) : null,
    characterId: userCharacters[0]?.id || null
  };
  const fakeMembers = [fakeMember];

  initBoardCombatUi({
    board,
    user,
    members: fakeMembers,
    member: fakeMember,
    roster: userCharacters,
    isGM: true,
    userCharacterSourceId: userCharacters[0]?.id || null,
    userPlayTokenKind: 'character',
    mentionUi: { modal: mentionModal },
    onOpenMention: (id) => {
      const token = board.tokens.find((t) => t.id === id);
      if (token) {
        openTokenCard(token, { roster, npcs, charModal, charModalBody });
        return;
      }
      const char = userCharacters.find((c) => c.id === id);
      if (!char) return;
      charModalBody.innerHTML = '';
      charModalBody.appendChild(renderCharacterCard(normalizeCharacter(char, char.id)));
      document.getElementById('charModalLabel').textContent = char.name;
      charModal.show();
    }
  });

  document.getElementById('start-combat')?.addEventListener('click', () => board.startCombat());
  document.getElementById('clear-log')?.addEventListener('click', () => board.clearLog());

  mapApplyBtn?.addEventListener('click', async () => {
    try {
      await board.setMapUrl(mapUrlInput.value);
    } catch (err) {
      await swrpAlert({ title: 'Error al cargar mapa', message: err.message });
    }
  });

  mapClearBtn?.addEventListener('click', async () => {
    const ok = await swrpConfirm({
      title: 'Quitar mapa',
      message: '¿Quitar el mapa de fondo del tablero?',
      confirmText: 'Quitar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    try {
      await board.clearMapUrl();
    } catch (err) {
      await swrpAlert({ title: 'Error', message: err.message });
    }
  });

  document.getElementById('grid-apply')?.addEventListener('click', async () => {
    try {
      await board.setGridSize(gridColsInput.value, gridRowsInput.value);
    } catch (err) {
      await swrpAlert({ title: 'Error de cuadrícula', message: err.message });
    }
  });
}

function openTokenCard(token, { roster, npcs, charModal, charModalBody }) {
  const cardOpts = {
    copyMentionId: token.id,
    boardContext: {
      hp: getTokenHp(token),
      maxHp: getTokenMaxHp(token),
      defense: getTokenEffectiveDefense(token),
      defenseInCover: isTokenInCover(token),
      hpDamaged: getTokenHp(token) < getTokenMaxHp(token)
    }
  };

  if (token.kind === 'npc') {
    const npc = npcs.find((n) => n.id === token.sourceId) || token.characterSnapshot;
    if (!npc) return;
    charModalBody.innerHTML = '';
    charModalBody.appendChild(renderCharacterCard(
      normalizeCharacter({ ...npc, portraitUrl: npc.portraitUrl || npc.image || '' }, npc.id),
      { isNpc: true, ...cardOpts }
    ));
    document.getElementById('charModalLabel').textContent = npc.name;
    charModal.show();
    return;
  }

  let snap = token.characterSnapshot || roster.find((c) => c.id === token.sourceId);
  if (!snap) return;
  charModalBody.innerHTML = '';
  charModalBody.appendChild(renderCharacterCard(normalizeCharacter(snap, snap.id || token.sourceId), cardOpts));
  document.getElementById('charModalLabel').textContent = snap.name;
  charModal.show();
}

function syncCombatUi(started, isGM) {
  document.getElementById('combat-idle-msg')?.classList.toggle('d-none', started);
  document.getElementById('start-combat')?.classList.toggle('d-none', started || !isGM);
  document.getElementById('clear-log')?.classList.toggle('d-none', !isGM);
}

function initBoardSidebar(isGM) {
  const tabsEl = document.getElementById('board-sidebar-tabs');
  const combateEl = document.getElementById('board-sidebar-combate');
  const logEl = document.getElementById('board-sidebar-log');
  const opcionesEl = document.getElementById('board-sidebar-opciones');
  const gotoSetupBtn = document.getElementById('board-goto-setup');
  let activeTab = 'opciones';
  let sidebarBootstrapped = false;

  function showTab(tabName) {
    activeTab = tabName;
    combateEl?.classList.toggle('d-none', tabName !== 'combate');
    logEl?.classList.toggle('d-none', tabName !== 'log');
    opcionesEl?.classList.toggle('d-none', tabName !== 'opciones');
    tabsEl?.querySelectorAll('[data-board-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.boardTab === tabName);
    });
  }

  tabsEl?.classList.remove('d-none');

  function syncGmSidebar(b) {
    if (!b) return;
    const preCombat = !b.combatStarted;
    const betweenRounds = b.combatStarted && b.initiativeOpen;
    gotoSetupBtn?.classList.toggle('d-none', !preCombat && !betweenRounds);
    if (!sidebarBootstrapped) {
      sidebarBootstrapped = true;
      activeTab = 'opciones';
    }
    showTab(activeTab);
  }

  tabsEl?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-board-tab]');
    if (!tab) return;
    showTab(tab.dataset.boardTab);
  });

  gotoSetupBtn?.addEventListener('click', () => showTab('opciones'));
  showTab('opciones');

  return { showTab, syncGmSidebar };
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
