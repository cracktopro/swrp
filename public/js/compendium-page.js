import { appUrl } from './app-path.js';
import {
  loadCompendiumData,
  getStats,
  getClassList,
  getCompendiumProgression,
  getCompendiumSkills,
  getSkillsClassList,
  CUSTOM_SKILLS_CLASS,
  normalizeCustomSkill,
  getSpeciesList,
  saveClassProgression,
  saveClassSkills,
  saveSpeciesList,
  syncCompendiumSeed,
  resetCompendiumToDefaults,
  isCompendiumSeedStale,
  skillTypeBadgeClass,
  getCompendiumBoards,
  saveCompendiumBoards,
  normalizeCompendiumBoard,
  getCompendiumItems,
  saveCompendiumItems,
  normalizeCompendiumItem,
  ITEM_TYPES,
  ITEM_STAT_DEFS
} from './compendium-store.js';
import { renderCharacterCard } from './character-card.js';
import { loadAllNpcs, deleteNpc, npcToCardData, filterNpcs, buildNpcEraSelectOptions } from './npcs.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let cachedNpcs = [];
let npcFiltersReady = false;

function setupNpcFilters() {
  if (npcFiltersReady) return;
  const classSel = document.getElementById('npc-filter-class');
  const eraSel = document.getElementById('npc-filter-era');
  if (!classSel) return;

  classSel.innerHTML = [
    '<option value="">Todas las clases</option>',
    ...getClassList().map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
  ].join('');

  if (eraSel) {
    eraSel.innerHTML = buildNpcEraSelectOptions();
  }

  const rerender = () => renderNpcsFromCache(document.body.dataset.compAdmin === '1');
  document.getElementById('npc-filter-name')?.addEventListener('input', rerender);
  classSel.addEventListener('change', rerender);
  eraSel?.addEventListener('change', rerender);
  npcFiltersReady = true;
}

function filterNpcsFromUi(npcs) {
  return filterNpcs(npcs, {
    nameQ: document.getElementById('npc-filter-name')?.value || '',
    classQ: document.getElementById('npc-filter-class')?.value || '',
    eraQ: document.getElementById('npc-filter-era')?.value || ''
  });
}

export async function initCompendiumPage({ isAdmin }) {
  await loadCompendiumData();
  document.body.dataset.compAdmin = isAdmin ? '1' : '0';

  const readonlyBanner = document.getElementById('comp-readonly-banner');
  if (readonlyBanner) {
    readonlyBanner.classList.toggle('d-none', isAdmin);
  }

  const classSelects = ['stats-class', 'skills-class'];
  classSelects.forEach((id) => {
    const sel = document.getElementById(id);
    const list = id === 'skills-class' ? getSkillsClassList() : getClassList();
    sel.innerHTML = list
      .map((c) => `<option value="${c.key}">${c.label}</option>`)
      .join('');
  });

  document.getElementById('stats-class').addEventListener('change', (e) => {
    renderStatsTable(e.target.value, isAdmin);
  });
  document.getElementById('skills-class').addEventListener('change', (e) => {
    renderSkillsList(e.target.value, isAdmin);
  });

  if (isAdmin) {
    document.getElementById('admin-stats-actions')?.classList.remove('d-none');
    document.getElementById('admin-skills-actions')?.classList.remove('d-none');
    document.getElementById('admin-species-actions')?.classList.remove('d-none');
    document.getElementById('admin-npcs-actions')?.classList.remove('d-none');
    setupSeedSyncBanner(isAdmin);
    document.getElementById('btn-save-stats')?.addEventListener('click', saveStatsFromTable);
    document.getElementById('btn-add-skill')?.addEventListener('click', () => openSkillModal(null));
    document.getElementById('btn-save-skill')?.addEventListener('click', saveSkillFromModal);
    document.getElementById('btn-add-species')?.addEventListener('click', () => openSpeciesModal(null));
    document.getElementById('btn-save-species')?.addEventListener('click', saveSpeciesFromModal);
    document.getElementById('btn-new-npc')?.addEventListener('click', () => {
      window.location.href = appUrl('character-create?mode=npc');
    });
    document.getElementById('admin-boards-actions')?.classList.remove('d-none');
    document.getElementById('btn-add-board')?.addEventListener('click', () => openBoardModal(null));
    document.getElementById('btn-save-board')?.addEventListener('click', saveBoardFromModal);
    document.getElementById('admin-items-actions')?.classList.remove('d-none');
    document.getElementById('btn-add-item')?.addEventListener('click', () => openItemModal(null));
    document.getElementById('btn-save-item')?.addEventListener('click', saveItemFromModal);
    document.getElementById('item-edit-type')?.addEventListener('change', syncItemModalFields);
    document.getElementById('item-edit-stat')?.addEventListener('change', syncItemModalFields);
    document.getElementById('item-edit-image')?.addEventListener('input', updateItemImagePreview);
  }

  const firstClass = getClassList()[0]?.key;
  renderStatsTable(firstClass, isAdmin);
  renderSkillsList(getSkillsClassList()[0]?.key || firstClass, isAdmin);
  renderSpeciesList(isAdmin);
  renderBoardsList(isAdmin);
  renderItemsList(isAdmin);
  await renderNpcs(isAdmin);
}

function setupSeedSyncBanner(isAdmin) {
  const banner = document.getElementById('comp-seed-banner');
  if (!banner || !isAdmin) return;

  const refresh = () => {
    const stale = isCompendiumSeedStale();
    banner.classList.toggle('d-none', !stale);
    if (!stale) return;
    document.getElementById('comp-seed-banner-text').textContent =
      'Hay una versión nueva de la semilla del juego (Guerrero Sith, Inquisidor Sith, Cazarrecompensas). '
      + 'Ya la ves en local; pulsa «Aplicar semilla a Firestore» para que todos la reciban.';
  };

  refresh();

  document.getElementById('btn-sync-seed')?.addEventListener('click', async () => {
    if (!confirm('¿Actualizar Firestore con las habilidades y progresión de las clases derivadas desde game-data.js?')) return;
    try {
      await syncCompendiumSeed();
      refresh();
      const classKey = document.getElementById('skills-class')?.value;
      renderSkillsList(classKey, true);
      renderStatsTable(classKey, true);
      alert('Semilla aplicada. Todos los usuarios verán las habilidades nuevas.');
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-reset-compendium')?.addEventListener('click', async () => {
    if (!confirm('¿Restaurar TODO el compendio (progresión, habilidades y especies) desde la semilla local? Se perderán los cambios guardados en Firestore.')) return;
    try {
      await resetCompendiumToDefaults();
      refresh();
      const classKey = document.getElementById('skills-class')?.value;
      renderSkillsList(classKey, true);
      renderStatsTable(classKey, true);
      renderSpeciesList(true);
      alert('Compendio restaurado desde la semilla.');
    } catch (err) {
      alert(err.message);
    }
  });
}

function renderStatsTable(classKey, isAdmin) {
  const table = document.getElementById('stats-table');
  const rows = [];
  for (let lv = 1; lv <= 20; lv++) {
    const s = getStats(classKey, lv);
    if (isAdmin) {
      rows.push(`<tr data-level="${lv}">
        <td>${lv}</td>
        <td><input type="number" class="form-control form-control-sm stat-inp" data-field="hp" value="${s.hp}"></td>
        <td><input type="number" class="form-control form-control-sm stat-inp" data-field="defense" value="${s.defense}"></td>
        <td><input type="number" class="form-control form-control-sm stat-inp" data-field="attack" value="${s.attack}"></td>
        <td><input type="number" class="form-control form-control-sm stat-inp" data-field="damage" value="${s.damage}"></td>
        <td><input type="number" class="form-control form-control-sm stat-inp" data-field="force" value="${s.force ?? ''}" placeholder="—"></td>
      </tr>`);
    } else {
      rows.push(`<tr>
        <td>${lv}</td><td>${s.hp}</td><td>${s.defense}</td><td>+${s.attack}</td><td>${s.damage}</td><td>${s.force ?? '—'}</td>
      </tr>`);
    }
  }
  table.dataset.classKey = classKey;
  table.innerHTML = `
    <thead><tr>
      <th>Nivel</th><th>P.Golpe</th><th>Defensa</th><th>Ataque</th><th>Daño</th><th>Fuerza</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>`;
}

async function saveStatsFromTable() {
  const table = document.getElementById('stats-table');
  const classKey = table.dataset.classKey;
  const levelStats = {};
  table.querySelectorAll('tbody tr').forEach((row) => {
    const lv = parseInt(row.dataset.level, 10);
    const read = (field) => {
      const inp = row.querySelector(`[data-field="${field}"]`);
      const val = inp.value.trim();
      return val === '' ? null : parseInt(val, 10);
    };
    levelStats[lv] = {
      hp: read('hp') ?? 0,
      defense: read('defense') ?? 0,
      attack: read('attack') ?? 0,
      damage: read('damage') ?? 0,
      force: read('force')
    };
  });
  try {
    await saveClassProgression(classKey, levelStats);
    alert('Progresión guardada.');
  } catch (err) {
    alert(err.message);
  }
}

function renderSkillsList(classKey, isAdmin) {
  const container = document.getElementById('skills-list');
  container.dataset.classKey = classKey;
  const isOtros = classKey === CUSTOM_SKILLS_CLASS;
  const skills = getCompendiumSkills()[classKey] || [];
  container.innerHTML = skills.map((s, idx) => `
    <div class="swrp-comp-skill-row mb-3 pb-2 border-bottom border-secondary" data-skill-idx="${idx}">
      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
        <div>
          <strong class="text-gold">${escapeHtml(s.name)}</strong>
          <span class="swrp-skill-badge ${skillTypeBadgeClass(s.type)} ms-2">${escapeHtml(s.type)}</span>
          <span class="text-muted small ms-2">${isOtros ? 'Personalizada (NPC)' : `Nv. ${s.unlockLevel}`}</span>
        </div>
        ${isAdmin ? `<div class="d-flex gap-1">
          <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-edit-skill" data-idx="${idx}">Editar</button>
          <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-del-skill" data-idx="${idx}">Borrar</button>
        </div>` : ''}
      </div>
      <p class="mb-0 small mt-1">${escapeHtml(s.description)}</p>
    </div>`).join('') || `<p class="text-muted">${isOtros ? 'Sin habilidades personalizadas. Se añaden al crear o editar NPCs.' : 'Sin habilidades para esta clase.'}</p>`;

  if (isAdmin) {
    container.querySelectorAll('.btn-edit-skill').forEach((btn) => {
      btn.addEventListener('click', () => openSkillModal(parseInt(btn.dataset.idx, 10)));
    });
    container.querySelectorAll('.btn-del-skill').forEach((btn) => {
      btn.addEventListener('click', () => deleteSkill(parseInt(btn.dataset.idx, 10)));
    });
  }
}

function openSkillModal(skillIdx) {
  const classKey = document.getElementById('skills-list').dataset.classKey;
  const isOtros = classKey === CUSTOM_SKILLS_CLASS;
  const skills = getCompendiumSkills()[classKey] || [];
  const skill = skillIdx != null ? skills[skillIdx] : {
    id: isOtros ? `otros-nueva-habilidad-${Date.now().toString(36)}` : `${classKey}-nueva-habilidad`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: '',
    unlockLevel: isOtros ? 1 : 1,
    type: 'Activa',
    description: '',
    class: classKey,
    forceCost: 0,
    custom: isOtros
  };

  document.getElementById('skill-edit-idx').value = skillIdx ?? '';
  document.getElementById('skill-edit-class').value = classKey;
  document.getElementById('skill-edit-id').value = skill.id;
  document.getElementById('skill-edit-name').value = skill.name;
  document.getElementById('skill-edit-unlock').value = skill.unlockLevel === 'always' ? 'always' : skill.unlockLevel;
  document.getElementById('skill-edit-type').value = skill.type;
  document.getElementById('skill-edit-desc').value = skill.description;

  document.getElementById('skill-edit-unlock-wrap')?.classList.toggle('d-none', isOtros);
  document.getElementById('skill-edit-id-wrap')?.classList.toggle('d-none', isOtros);
  const typeSel = document.getElementById('skill-edit-type');
  typeSel.querySelector('option[value="Rol"]')?.toggleAttribute('hidden', isOtros);
  if (isOtros && skill.type === 'Rol') typeSel.value = 'Activa';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('skillModal')).show();
}

async function saveSkillFromModal() {
  const classKey = document.getElementById('skill-edit-class').value;
  const isOtros = classKey === CUSTOM_SKILLS_CLASS;
  const idxRaw = document.getElementById('skill-edit-idx').value;
  const skill = isOtros
    ? normalizeCustomSkill({
      id: document.getElementById('skill-edit-id').value.trim(),
      name: document.getElementById('skill-edit-name').value.trim(),
      type: document.getElementById('skill-edit-type').value,
      description: document.getElementById('skill-edit-desc').value.trim()
    })
    : {
      id: document.getElementById('skill-edit-id').value.trim(),
      name: document.getElementById('skill-edit-name').value.trim(),
      unlockLevel: document.getElementById('skill-edit-unlock').value === 'always'
        ? 'always'
        : parseInt(document.getElementById('skill-edit-unlock').value, 10),
      type: document.getElementById('skill-edit-type').value,
      description: document.getElementById('skill-edit-desc').value.trim(),
      class: classKey,
      forceCost: 0
    };

  if (!skill.name) {
    alert('Indica un nombre.');
    return;
  }

  const skills = [...(getCompendiumSkills()[classKey] || [])];
  const idx = idxRaw === '' ? -1 : parseInt(idxRaw, 10);
  if (idx >= 0) skills[idx] = skill;
  else skills.push(skill);

  try {
    await saveClassSkills(classKey, skills);
    bootstrap.Modal.getInstance(document.getElementById('skillModal')).hide();
    renderSkillsList(classKey, true);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSkill(skillIdx) {
  const classKey = document.getElementById('skills-list').dataset.classKey;
  const skills = [...(getCompendiumSkills()[classKey] || [])];
  const skill = skills[skillIdx];
  if (!skill || !confirm(`¿Eliminar «${skill.name}»?`)) return;
  skills.splice(skillIdx, 1);
  try {
    await saveClassSkills(classKey, skills);
    renderSkillsList(classKey, true);
  } catch (err) {
    alert(err.message);
  }
}

function renderSpeciesList(isAdmin) {
  const container = document.getElementById('species-list');
  const list = getSpeciesList();
  container.innerHTML = list.map((name, idx) => `
    <div class="swrp-comp-species-row d-flex justify-content-between align-items-center gap-2 mb-2 pb-2 border-bottom border-secondary">
      <span>${escapeHtml(name)}</span>
      ${isAdmin ? `<div class="d-flex gap-1 flex-shrink-0">
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-edit-species" data-idx="${idx}">Editar</button>
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-del-species" data-idx="${idx}">Borrar</button>
      </div>` : ''}
    </div>`).join('') || '<p class="text-muted mb-0">No hay especies definidas.</p>';

  if (isAdmin) {
    container.querySelectorAll('.btn-edit-species').forEach((btn) => {
      btn.addEventListener('click', () => openSpeciesModal(parseInt(btn.dataset.idx, 10)));
    });
    container.querySelectorAll('.btn-del-species').forEach((btn) => {
      btn.addEventListener('click', () => deleteSpecies(parseInt(btn.dataset.idx, 10)));
    });
  }
}

function openSpeciesModal(speciesIdx) {
  const list = getSpeciesList();
  const name = speciesIdx != null ? list[speciesIdx] : '';
  document.getElementById('species-edit-idx').value = speciesIdx ?? '';
  document.getElementById('species-edit-name').value = name;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('speciesModal')).show();
}

async function saveSpeciesFromModal() {
  const idxRaw = document.getElementById('species-edit-idx').value;
  const name = document.getElementById('species-edit-name').value.trim();
  if (!name) {
    alert('Indica un nombre de especie.');
    return;
  }

  const list = [...getSpeciesList()];
  const idx = idxRaw === '' ? -1 : parseInt(idxRaw, 10);

  if (idx >= 0) {
    if (list.some((s, i) => i !== idx && s.toLowerCase() === name.toLowerCase())) {
      alert('Ya existe una especie con ese nombre.');
      return;
    }
    list[idx] = name;
  } else {
    if (list.some((s) => s.toLowerCase() === name.toLowerCase())) {
      alert('Ya existe una especie con ese nombre.');
      return;
    }
    list.push(name);
    list.sort((a, b) => a.localeCompare(b, 'es'));
  }

  try {
    await saveSpeciesList(list);
    bootstrap.Modal.getInstance(document.getElementById('speciesModal')).hide();
    renderSpeciesList(true);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSpecies(speciesIdx) {
  const list = [...getSpeciesList()];
  const name = list[speciesIdx];
  if (!name || !confirm(`¿Eliminar la especie «${name}»?`)) return;
  if (list.length <= 1) {
    alert('Debe quedar al menos una especie.');
    return;
  }
  list.splice(speciesIdx, 1);
  try {
    await saveSpeciesList(list);
    renderSpeciesList(true);
  } catch (err) {
    alert(err.message);
  }
}

async function renderNpcs(isAdmin) {
  const container = document.getElementById('npcs-list');
  container.innerHTML = '<p class="text-muted">Cargando NPCs…</p>';
  cachedNpcs = await loadAllNpcs();
  setupNpcFilters();
  renderNpcsFromCache(isAdmin);
}

function renderNpcsFromCache(isAdmin) {
  const container = document.getElementById('npcs-list');
  const npcs = filterNpcsFromUi(cachedNpcs);
  container.innerHTML = '';

  if (!cachedNpcs.length) {
    container.innerHTML = '<p class="text-muted">No hay NPCs. Los admins pueden crearlos desde Personajes → pestaña NPCs.</p>';
    return;
  }
  if (!npcs.length) {
    container.innerHTML = '<p class="text-muted">Ningún NPC coincide con los filtros.</p>';
    return;
  }

  npcs.forEach((npc) => {
    const wrap = document.createElement('div');
    wrap.className = 'npcs-grid__item';
    wrap.appendChild(renderCharacterCard(npcToCardData(npc), { isNpc: true }));
    if (isAdmin) {
      const actions = document.createElement('div');
      actions.className = 'd-flex gap-2 justify-content-center mt-2 flex-wrap';
      actions.innerHTML = `
        <a href="${appUrl(`character-create?npc=${encodeURIComponent(npc.id)}`)}" class="btn btn-sm btn-swrp btn-swrp-ghost">Editar</a>
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-del-npc">Eliminar</button>`;
      actions.querySelector('.btn-del-npc').addEventListener('click', async () => {
        if (!confirm(`¿Eliminar NPC «${npc.name}»?`)) return;
        try {
          await deleteNpc(npc.id);
          await renderNpcs(isAdmin);
        } catch (err) {
          alert(err.message);
        }
      });
      wrap.appendChild(actions);
    }
    container.appendChild(wrap);
  });
}

function renderBoardsList(isAdmin) {
  const container = document.getElementById('boards-list');
  if (!container) return;
  const boards = getCompendiumBoards();
  if (!boards.length) {
    container.innerHTML = '<p class="text-muted mb-0">No hay tableros definidos en el compendio.</p>';
    return;
  }
  container.innerHTML = boards.map((board) => `
    <div class="border border-secondary border-opacity-25 rounded p-3 mb-3" data-board-id="${escapeHtml(board.id)}">
      <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div>
          <h3 class="h6 text-gold mb-1">${escapeHtml(board.name)}</h3>
          <p class="small text-muted mb-1">${board.cols}×${board.rows} · celda 48 px</p>
          <p class="small mb-0 text-break">${escapeHtml(board.mapUrl)}</p>
        </div>
        ${board.mapUrl ? `<img src="${escapeHtml(board.mapUrl)}" alt="" class="swrp-board-compendium-thumb" loading="lazy">` : ''}
      </div>
      ${isAdmin ? `<div class="d-flex gap-2 mt-3">
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-edit-board">Editar</button>
        <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-del-board">Eliminar</button>
      </div>` : ''}
    </div>`).join('');

  if (!isAdmin) return;
  container.querySelectorAll('.btn-edit-board').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-board-id]')?.dataset.boardId;
      const board = boards.find((b) => b.id === id);
      if (board) openBoardModal(board);
    });
  });
  container.querySelectorAll('.btn-del-board').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-board-id]')?.dataset.boardId;
      const board = boards.find((b) => b.id === id);
      if (!board || !confirm(`¿Eliminar tablero «${board.name}»?`)) return;
      try {
        await saveCompendiumBoards(boards.filter((b) => b.id !== id));
        renderBoardsList(true);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function openBoardModal(board) {
  document.getElementById('board-edit-id').value = board?.id || '';
  document.getElementById('board-edit-name').value = board?.name || '';
  document.getElementById('board-edit-url').value = board?.mapUrl || '';
  document.getElementById('board-edit-cols').value = String(board?.cols ?? 24);
  document.getElementById('board-edit-rows').value = String(board?.rows ?? 16);
  updateBoardModalPreview();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('boardModal')).show();
}

function updateBoardModalPreview() {
  const preview = document.getElementById('board-edit-preview');
  const url = document.getElementById('board-edit-url')?.value.trim();
  if (!preview) return;
  if (!url) {
    preview.innerHTML = 'Introduce una URL de imagen para ver la vista previa.';
    return;
  }
  preview.innerHTML = `<img src="${escapeHtml(url)}" alt="" class="swrp-board-compendium-thumb" loading="lazy">`;
}

async function saveBoardFromModal() {
  const id = document.getElementById('board-edit-id').value.trim();
  const normalized = normalizeCompendiumBoard({
    id: id || undefined,
    name: document.getElementById('board-edit-name').value,
    mapUrl: document.getElementById('board-edit-url').value,
    cols: document.getElementById('board-edit-cols').value,
    rows: document.getElementById('board-edit-rows').value
  });
  if (!normalized) {
    alert('Nombre y URL del mapa son obligatorios.');
    return;
  }
  const boards = getCompendiumBoards();
  const idx = boards.findIndex((b) => b.id === normalized.id);
  if (idx >= 0) boards[idx] = normalized;
  else boards.push(normalized);
  boards.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  try {
    await saveCompendiumBoards(boards);
    bootstrap.Modal.getInstance(document.getElementById('boardModal')).hide();
    renderBoardsList(true);
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById('board-edit-url')?.addEventListener('input', updateBoardModalPreview);

// ── Objetos ──────────────────────────────────────────────────────────

function itemTypeBadgeClass(type) {
  if (type === 'Equipo') return 'swrp-item-badge--equipo';
  if (type === 'Consumible') return 'swrp-item-badge--consumible';
  return 'swrp-item-badge--inutil';
}

function renderItemsList(isAdmin) {
  const container = document.getElementById('items-list');
  if (!container) return;
  const items = getCompendiumItems();
  if (!items.length) {
    container.innerHTML = '<p class="text-muted mb-0">No hay objetos definidos en el compendio.</p>';
    return;
  }
  const statLabelOf = (key) => ITEM_STAT_DEFS.find((s) => s.key === key)?.label || key;
  container.innerHTML = items
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((item) => {
      let effect = '';
      if (item.type === 'Consumible' && item.stat === 'none') {
        effect = '<p class="small mb-1 text-muted">Sin efecto mecánico (uso narrativo)</p>';
      } else if ((item.type === 'Equipo' || item.type === 'Consumible') && item.statBonus) {
        effect = `<p class="small mb-1 text-info">${statLabelOf(item.stat)} ${item.statBonus >= 0 ? '+' : ''}${item.statBonus}${item.type === 'Consumible' && item.temporary ? ' · temporal' : ''}</p>`;
      }
      return `
      <div class="swrp-item-card" data-item-id="${escapeHtml(item.id)}">
        <div class="swrp-item-card__head">
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" class="swrp-item-card__img" loading="lazy">` : '<div class="swrp-item-card__img swrp-item-card__img--empty"></div>'}
          <div class="swrp-item-card__title">
            <strong class="text-gold">${escapeHtml(item.name)}</strong>
            <span class="swrp-item-badge ${itemTypeBadgeClass(item.type)}">${escapeHtml(item.type)}</span>
          </div>
        </div>
        <p class="small mb-1">${escapeHtml(item.description)}</p>
        ${effect}
        <p class="small text-muted mb-0">${item.weight} KG · ${item.price} créditos</p>
        ${isAdmin ? `<div class="d-flex gap-1 mt-2">
          <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-edit-item">Editar</button>
          <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-del-item">Eliminar</button>
        </div>` : ''}
      </div>`;
    })
    .join('');

  if (!isAdmin) return;
  container.querySelectorAll('.btn-edit-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-item-id]')?.dataset.itemId;
      const item = getCompendiumItems().find((i) => i.id === id);
      if (item) openItemModal(item);
    });
  });
  container.querySelectorAll('.btn-del-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-item-id]')?.dataset.itemId;
      const item = getCompendiumItems().find((i) => i.id === id);
      if (!item || !confirm(`¿Eliminar objeto «${item.name}»?`)) return;
      try {
        await saveCompendiumItems(getCompendiumItems().filter((i) => i.id !== id));
        renderItemsList(true);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function populateItemStatSelect(type) {
  const sel = document.getElementById('item-edit-stat');
  if (!sel) return;
  const prev = sel.value;
  const opts = type === 'Consumible'
    ? [{ key: 'none', label: 'Ninguna' }, ...ITEM_STAT_DEFS]
    : ITEM_STAT_DEFS;
  sel.innerHTML = opts.map((s) => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join('');
  if (opts.some((o) => o.key === prev)) sel.value = prev;
}

function syncItemModalFields() {
  const type = document.getElementById('item-edit-type').value;
  const effectWrap = document.getElementById('item-edit-effect');
  const tempWrap = document.getElementById('item-edit-temp-wrap');
  const bonusWrap = document.getElementById('item-edit-bonus')?.closest('.col-6');
  const title = document.getElementById('item-edit-effect-title');
  const hasEffect = type === 'Equipo' || type === 'Consumible';
  populateItemStatSelect(type);
  effectWrap.classList.toggle('d-none', !hasEffect);
  const stat = document.getElementById('item-edit-stat').value;
  const noEffect = type === 'Consumible' && stat === 'none';
  bonusWrap?.classList.toggle('d-none', noEffect);
  tempWrap.classList.toggle('d-none', type !== 'Consumible' || noEffect);
  if (title) title.textContent = type === 'Equipo' ? 'Bonificación al equipar' : 'Efecto del consumible';
}

function updateItemImagePreview() {
  const url = document.getElementById('item-edit-image')?.value.trim();
  const wrap = document.getElementById('item-edit-image-preview');
  if (!wrap) return;
  const img = wrap.querySelector('img');
  if (url) {
    img.src = url;
    wrap.classList.remove('d-none');
  } else {
    wrap.classList.add('d-none');
  }
}

function openItemModal(item) {
  document.getElementById('item-edit-id').value = item?.id || '';
  document.getElementById('item-edit-name').value = item?.name || '';
  document.getElementById('item-edit-desc').value = item?.description || '';
  document.getElementById('item-edit-image').value = item?.imageUrl || '';
  const type = ITEM_TYPES.includes(item?.type) ? item.type : 'Equipo';
  document.getElementById('item-edit-type').value = type;
  document.getElementById('item-edit-weight').value = String(item?.weight ?? 0);
  document.getElementById('item-edit-price').value = String(item?.price ?? 0);
  populateItemStatSelect(type);
  document.getElementById('item-edit-stat').value = item?.stat || 'hp';
  document.getElementById('item-edit-bonus').value = String(item?.statBonus ?? 0);
  document.getElementById('item-edit-temp').checked = !!item?.temporary;
  syncItemModalFields();
  updateItemImagePreview();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('itemModal')).show();
}

async function saveItemFromModal() {
  const id = document.getElementById('item-edit-id').value.trim();
  const normalized = normalizeCompendiumItem({
    id: id || undefined,
    name: document.getElementById('item-edit-name').value,
    description: document.getElementById('item-edit-desc').value,
    imageUrl: document.getElementById('item-edit-image').value,
    type: document.getElementById('item-edit-type').value,
    weight: document.getElementById('item-edit-weight').value,
    price: document.getElementById('item-edit-price').value,
    stat: document.getElementById('item-edit-stat').value,
    statBonus: document.getElementById('item-edit-bonus').value,
    temporary: document.getElementById('item-edit-temp').checked
  });
  if (!normalized) {
    alert('El nombre del objeto es obligatorio.');
    return;
  }
  const items = getCompendiumItems();
  const idx = items.findIndex((i) => i.id === normalized.id);
  if (idx >= 0) items[idx] = normalized;
  else items.push(normalized);
  try {
    await saveCompendiumItems(items);
    bootstrap.Modal.getInstance(document.getElementById('itemModal')).hide();
    renderItemsList(true);
  } catch (err) {
    alert(err.message);
  }
}
