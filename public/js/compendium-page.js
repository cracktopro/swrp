import { appUrl } from './app-path.js';
import {
  loadCompendiumData,
  getStats,
  getClassList,
  getCompendiumProgression,
  getCompendiumSkills,
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
  normalizeCompendiumBoard
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
    sel.innerHTML = getClassList()
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
  }

  const firstClass = getClassList()[0]?.key;
  renderStatsTable(firstClass, isAdmin);
  renderSkillsList(firstClass, isAdmin);
  renderSpeciesList(isAdmin);
  renderBoardsList(isAdmin);
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
  const skills = getCompendiumSkills()[classKey] || [];
  container.innerHTML = skills.map((s, idx) => `
    <div class="swrp-comp-skill-row mb-3 pb-2 border-bottom border-secondary" data-skill-idx="${idx}">
      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
        <div>
          <strong class="text-gold">${escapeHtml(s.name)}</strong>
          <span class="swrp-skill-badge ${skillTypeBadgeClass(s.type)} ms-2">${escapeHtml(s.type)}</span>
          <span class="text-muted small ms-2">Nv. ${s.unlockLevel}</span>
        </div>
        ${isAdmin ? `<div class="d-flex gap-1">
          <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-edit-skill" data-idx="${idx}">Editar</button>
          <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-del-skill" data-idx="${idx}">Borrar</button>
        </div>` : ''}
      </div>
      <p class="mb-0 small mt-1">${escapeHtml(s.description)}</p>
    </div>`).join('') || '<p class="text-muted">Sin habilidades para esta clase.</p>';

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
  const skills = getCompendiumSkills()[classKey] || [];
  const skill = skillIdx != null ? skills[skillIdx] : {
    id: `${classKey}-nueva-habilidad`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: '',
    unlockLevel: 1,
    type: 'Activa',
    description: '',
    class: classKey,
    forceCost: 0
  };

  document.getElementById('skill-edit-idx').value = skillIdx ?? '';
  document.getElementById('skill-edit-class').value = classKey;
  document.getElementById('skill-edit-id').value = skill.id;
  document.getElementById('skill-edit-name').value = skill.name;
  document.getElementById('skill-edit-unlock').value = skill.unlockLevel === 'always' ? 'always' : skill.unlockLevel;
  document.getElementById('skill-edit-type').value = skill.type;
  document.getElementById('skill-edit-desc').value = skill.description;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('skillModal')).show();
}

async function saveSkillFromModal() {
  const classKey = document.getElementById('skill-edit-class').value;
  const idxRaw = document.getElementById('skill-edit-idx').value;
  const skill = {
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
          <p class="small text-muted mb-1">${board.cols}×${board.rows} · celda 28 px</p>
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
