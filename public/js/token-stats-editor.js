import {
  getStats,
  getClassList,
  getSkillsForClass,
  getUnlockableSkillLevels,
  getSpeciesList,
  loadCompendiumData,
  getCustomSkills,
  findCustomSkillById,
  CUSTOM_SKILLS_CLASS,
  GAME_DATA
} from './compendium-store.js';
import { normalizeCharacter } from './character-card.js';
import { inferBoardTokenKind } from './board-vision.js';
import {
  VEHICLE_CLASS_KEY,
  vehicleClassFields
} from './npcs.js';

let selectedSkills = [];
let statsOverride = null;
let mounted = false;
/** @type {'character' | 'npc' | 'vehicle'} */
let tokenKind = 'npc';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function skillTypeClass(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'rol') return 'swrp-skill-badge--rol';
  if (t === 'pasiva') return 'swrp-skill-badge--pasiva';
  return 'swrp-skill-badge--activa';
}

function isPartyCharacter() {
  return tokenKind === 'character';
}

function isVehicleToken() {
  return tokenKind === 'vehicle';
}

function populateClassSelect() {
  const sel = document.getElementById('ctrl-stat-class');
  if (!sel) return;
  sel.innerHTML = getClassList()
    .map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
    .join('');
}

function populateSpeciesSelect() {
  const sel = document.getElementById('ctrl-stat-species');
  if (!sel) return;
  sel.innerHTML = getSpeciesList()
    .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
    .join('');
}

function syncVehicleFieldsVisibility() {
  const isVehicle = isVehicleToken();
  document.getElementById('ctrl-stat-class-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('ctrl-stat-species-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('ctrl-stat-force-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('ctrl-stat-shields-wrap')?.classList.toggle('d-none', !isVehicle);
  document.getElementById('ctrl-stat-vehicle-size-wrap')?.classList.toggle('d-none', !isVehicle);
  document.getElementById('ctrl-stat-vehicle-move-wrap')?.classList.toggle('d-none', !isVehicle);
  document.getElementById('ctrl-stat-skills-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('ctrl-stat-vehicle-skills-wrap')?.classList.toggle('d-none', !isVehicle);
}

function setStatsFieldsEditable(editable) {
  ['ctrl-stat-hp', 'ctrl-stat-defense', 'ctrl-stat-attack', 'ctrl-stat-damage', 'ctrl-stat-force', 'ctrl-stat-shields']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !editable;
    });
  ['ctrl-stat-span-cols', 'ctrl-stat-span-rows', 'ctrl-stat-move-range'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !editable;
  });
  document.getElementById('ctrl-stat-restore-base')?.classList.toggle('d-none', !editable || isVehicleToken());
}

function updateStatsHint() {
  const hint = document.getElementById('ctrl-stat-hint');
  if (!hint) return;
  if (isVehicleToken()) {
    hint.textContent = 'Los cambios solo afectan a esta chapa en la partida actual.';
    return;
  }
  hint.textContent = isPartyCharacter()
    ? 'Las estadísticas escalan con la clase y el nivel. Los cambios se guardan en el personaje del jugador (progreso global).'
    : 'Los cambios solo afectan a esta chapa en la partida actual. Puedes ajustar las stats manualmente.';
}

function syncStatsFieldsFromBase() {
  const classKey = document.getElementById('ctrl-stat-class')?.value;
  const level = parseInt(document.getElementById('ctrl-stat-level')?.value, 10) || 1;
  const base = getStats(classKey, level) || {};
  if (isPartyCharacter() || !statsOverride) {
    statsOverride = { ...base };
  }
  document.getElementById('ctrl-stat-hp').value = statsOverride.hp ?? 0;
  document.getElementById('ctrl-stat-defense').value = statsOverride.defense ?? 0;
  document.getElementById('ctrl-stat-attack').value = statsOverride.attack ?? 0;
  document.getElementById('ctrl-stat-damage').value = statsOverride.damage ?? 0;
  document.getElementById('ctrl-stat-force').value = statsOverride.force ?? '';
  const shieldsEl = document.getElementById('ctrl-stat-shields');
  if (shieldsEl) shieldsEl.value = statsOverride.shields ?? statsOverride.maxShields ?? 0;
}

function readStatsFromFields() {
  const forceVal = document.getElementById('ctrl-stat-force')?.value;
  const shieldsVal = document.getElementById('ctrl-stat-shields')?.value;
  const base = {
    hp: parseInt(document.getElementById('ctrl-stat-hp')?.value, 10) || 0,
    maxHp: parseInt(document.getElementById('ctrl-stat-hp')?.value, 10) || 0,
    defense: parseInt(document.getElementById('ctrl-stat-defense')?.value, 10) || 0,
    attack: parseInt(document.getElementById('ctrl-stat-attack')?.value, 10) || 0,
    damage: parseInt(document.getElementById('ctrl-stat-damage')?.value, 10) || 0,
    force: forceVal === '' ? null : parseInt(forceVal, 10)
  };
  if (isVehicleToken()) {
    const shields = parseInt(shieldsVal, 10) || 0;
    base.shields = shields;
    base.maxShields = shields;
    base.force = null;
  }
  return base;
}

function readVehicleFieldsFromUi() {
  return {
    spanCols: Math.max(1, parseInt(document.getElementById('ctrl-stat-span-cols')?.value, 10) || 1),
    spanRows: Math.max(1, parseInt(document.getElementById('ctrl-stat-span-rows')?.value, 10) || 1),
    moveRange: Math.max(1, parseInt(document.getElementById('ctrl-stat-move-range')?.value, 10) || 6)
  };
}

function resolveStatsForSave() {
  const classKey = document.getElementById('ctrl-stat-class')?.value;
  const level = parseInt(document.getElementById('ctrl-stat-level')?.value, 10) || 1;
  if (isPartyCharacter()) {
    const base = getStats(classKey, level) || {};
    return {
      hp: base.hp ?? 0,
      maxHp: base.hp ?? 0,
      defense: base.defense ?? 0,
      attack: base.attack ?? 0,
      damage: base.damage ?? 0,
      force: base.force ?? null
    };
  }
  return readStatsFromFields();
}

function updatePortraitPreview(url) {
  const img = document.getElementById('ctrl-stat-portrait-preview');
  const err = document.getElementById('ctrl-stat-portrait-error');
  if (!img) return;
  if (!url) {
    img.classList.add('d-none');
    img.removeAttribute('src');
    err?.classList.add('d-none');
    return;
  }
  img.src = url;
  img.classList.remove('d-none');
  img.onerror = () => err?.classList.remove('d-none');
  img.onload = () => err?.classList.add('d-none');
}

function updateSkillPicker() {
  const classKey = document.getElementById('ctrl-stat-class')?.value;
  const level = parseInt(document.getElementById('ctrl-stat-level')?.value, 10) || 1;
  const container = document.getElementById('ctrl-stat-skills');
  const vehicleContainer = document.getElementById('ctrl-stat-vehicle-skills');
  if (isVehicleToken()) {
    renderVehicleSkillPicker(vehicleContainer);
    return;
  }
  if (!container || !classKey) return;

  if (classKey === CUSTOM_SKILLS_CLASS) {
    const unlockLevels = getUnlockableSkillLevels(level);
    const maxSlots = Math.min(GAME_DATA.MAX_SKILLS, unlockLevels.length);
    const slotsUsed = selectedSkills.length;
    const customSkills = getCustomSkills()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));

    container.innerHTML = `
      <p class="small text-muted mb-1">Clase «Otros»: hasta ${maxSlots} habilidades personalizadas.</p>
      <p class="small mb-2">Seleccionadas: ${slotsUsed}/${maxSlots}</p>`;

    if (!customSkills.length) {
      container.innerHTML += '<p class="small text-muted mb-0">Sin habilidades en «Otros».</p>';
      return;
    }

    customSkills.forEach((skill) => {
      const checked = selectedSkills.includes(skill.id);
      const label = document.createElement('label');
      label.className = 'd-block small mb-1';
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(skill.id)}" ${checked ? 'checked' : ''}
          ${!checked && slotsUsed >= maxSlots ? 'disabled' : ''}>
        <span class="swrp-skill-badge ${skillTypeClass(skill.type)}">${escapeHtml(skill.type)}</span>
        <strong>${escapeHtml(skill.name)}</strong> — ${escapeHtml(skill.description)}`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (selectedSkills.length < maxSlots) selectedSkills.push(skill.id);
        } else {
          selectedSkills = selectedSkills.filter((sid) => sid !== skill.id);
        }
        updateSkillPicker();
      });
      container.appendChild(label);
    });
    return;
  }

  const available = getSkillsForClass(classKey, level)
    .filter((s) => s.unlockLevel !== 'always' && s.type !== 'Rol');

  const unlockLevels = getUnlockableSkillLevels(level);
  const slotsUsed = selectedSkills.length;
  const maxSlots = Math.min(GAME_DATA.MAX_SKILLS, unlockLevels.length);

  container.innerHTML = `
    <p class="small text-muted mb-1">Elige hasta ${maxSlots} habilidades (niveles 1/5/10/15). Rol siempre disponible.</p>
    <p class="small mb-2">Seleccionadas: ${slotsUsed}/${maxSlots}</p>`;

  const grouped = {};
  available.forEach((s) => {
    const lv = s.unlockLevel;
    if (!grouped[lv]) grouped[lv] = [];
    grouped[lv].push(s);
  });

  Object.entries(grouped).forEach(([lv, skillList]) => {
    const section = document.createElement('div');
    section.className = 'mb-2';
    section.innerHTML = `<div class="text-gold small mb-1">Nivel ${lv}</div>`;
    skillList.forEach((skill) => {
      const checked = selectedSkills.includes(skill.id);
      const label = document.createElement('label');
      label.className = 'd-block small mb-1';
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(skill.id)}" ${checked ? 'checked' : ''}
          ${!checked && slotsUsed >= maxSlots ? 'disabled' : ''}>
        <span class="swrp-skill-badge ${skillTypeClass(skill.type)}">${escapeHtml(skill.type)}</span>
        <strong>${escapeHtml(skill.name)}</strong> — ${escapeHtml(skill.description)}`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (selectedSkills.length < maxSlots) selectedSkills.push(skill.id);
        } else {
          selectedSkills = selectedSkills.filter((sid) => sid !== skill.id);
        }
        updateSkillPicker();
      });
      section.appendChild(label);
    });
    container.appendChild(section);
  });
}

function renderVehicleSkillPicker(container) {
  if (!container) return;
  const customSkills = getCustomSkills().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
  if (!customSkills.length) {
    container.innerHTML = '<p class="small text-muted mb-0">Sin habilidades custom asignadas.</p>';
    return;
  }
  container.innerHTML = '';
  customSkills.forEach((skill) => {
    const checked = selectedSkills.includes(skill.id);
    const label = document.createElement('label');
    label.className = 'd-block small mb-1';
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(skill.id)}" ${checked ? 'checked' : ''}>
      <span class="swrp-skill-badge ${skillTypeClass(skill.type)}">${escapeHtml(skill.type)}</span>
      <strong>${escapeHtml(skill.name)}</strong> — ${escapeHtml(skill.description)}`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!selectedSkills.includes(skill.id)) selectedSkills.push(skill.id);
      } else {
        selectedSkills = selectedSkills.filter((sid) => sid !== skill.id);
      }
      updateSkillPicker();
    });
    container.appendChild(label);
  });
}

function onFormChange(e) {
  if (['ctrl-stat-class', 'ctrl-stat-level'].includes(e.target.id)) {
    if (isPartyCharacter() || (tokenKind === 'npc' && !statsOverride)) {
      syncStatsFieldsFromBase();
    }
    if (!isVehicleToken()) selectedSkills = [];
  }
  if (e.target.id === 'ctrl-stat-portrait') {
    updatePortraitPreview(e.target.value.trim());
  }
  updateSkillPicker();
}

function bindEvents() {
  ['ctrl-stat-name', 'ctrl-stat-class', 'ctrl-stat-level', 'ctrl-stat-species', 'ctrl-stat-portrait']
    .forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener('change', onFormChange);
      el?.addEventListener('input', onFormChange);
    });

  ['ctrl-stat-hp', 'ctrl-stat-defense', 'ctrl-stat-attack', 'ctrl-stat-damage', 'ctrl-stat-force', 'ctrl-stat-shields']
    .forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        if (!isPartyCharacter()) {
          statsOverride = readStatsFromFields();
        }
      });
    });

  document.getElementById('ctrl-stat-restore-base')?.addEventListener('click', () => {
    statsOverride = null;
    syncStatsFieldsFromBase();
  });
}

export async function ensureTokenStatsEditor(container) {
  if (mounted) return;
  await loadCompendiumData();

  container.innerHTML = `
    <div class="mb-3">
      <label class="form-label small" for="ctrl-stat-name">Nombre</label>
      <input type="text" class="form-control form-control-sm" id="ctrl-stat-name" maxlength="40">
    </div>
    <div class="row g-2 mb-3">
      <div class="col-md-6" id="ctrl-stat-class-wrap">
        <label class="form-label small" for="ctrl-stat-class">Clase</label>
        <select class="form-select form-select-sm" id="ctrl-stat-class"></select>
      </div>
      <div class="col-md-3" id="ctrl-stat-level-wrap">
        <label class="form-label small" for="ctrl-stat-level">Nivel</label>
        <input type="number" class="form-control form-control-sm" id="ctrl-stat-level" min="1" max="20" value="1">
      </div>
      <div class="col-md-3" id="ctrl-stat-species-wrap">
        <label class="form-label small" for="ctrl-stat-species">Especie</label>
        <select class="form-select form-select-sm" id="ctrl-stat-species"></select>
      </div>
    </div>
    <div class="mb-3">
      <label class="form-label small">Estadísticas</label>
      <div class="row g-2">
        <div class="col-4 col-md"><label class="form-label small">P.Golpe</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-hp" min="0"></div>
        <div class="col-4 col-md"><label class="form-label small">Defensa</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-defense" min="0"></div>
        <div class="col-4 col-md"><label class="form-label small">Ataque</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-attack"></div>
        <div class="col-4 col-md"><label class="form-label small">Daño</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-damage" min="0"></div>
        <div class="col-4 col-md" id="ctrl-stat-force-wrap"><label class="form-label small">Fuerza</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-force" placeholder="—"></div>
        <div class="col-4 col-md d-none" id="ctrl-stat-shields-wrap"><label class="form-label small">Escudos</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-shields" min="0"></div>
      </div>
      <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost mt-2" id="ctrl-stat-restore-base">Aplicar stats del nivel actual</button>
    </div>
    <div class="mb-3 d-none" id="ctrl-stat-vehicle-size-wrap">
      <label class="form-label small">Tamaño (celdas)</label>
      <div class="row g-2">
        <div class="col-6"><label class="form-label small" for="ctrl-stat-span-cols">Ancho</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-span-cols" min="1" max="12" value="1"></div>
        <div class="col-6"><label class="form-label small" for="ctrl-stat-span-rows">Alto</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-span-rows" min="1" max="12" value="1"></div>
      </div>
    </div>
    <div class="mb-3 d-none" id="ctrl-stat-vehicle-move-wrap">
      <label class="form-label small" for="ctrl-stat-move-range">Movimiento (celdas/acción)</label>
      <input type="number" class="form-control form-control-sm" id="ctrl-stat-move-range" min="1" max="99" value="6">
    </div>
    <div class="mb-3">
      <label class="form-label small" for="ctrl-stat-portrait">URL del retrato</label>
      <input type="url" class="form-control form-control-sm" id="ctrl-stat-portrait" placeholder="https://…">
      <img id="ctrl-stat-portrait-preview" class="d-none mt-2" style="max-width:100px;border:1px solid #444" alt="">
      <p id="ctrl-stat-portrait-error" class="small text-warning d-none mb-0 mt-1">No se pudo cargar la imagen.</p>
    </div>
    <div class="mb-2" id="ctrl-stat-skills-wrap">
      <label class="form-label small">Habilidades de combate</label>
      <div id="ctrl-stat-skills" class="swrp-scrollbar-thin" style="max-height:12rem;overflow-y:auto"></div>
    </div>
    <div class="mb-2 d-none" id="ctrl-stat-vehicle-skills-wrap">
      <label class="form-label small">Habilidades custom (${escapeHtml(CUSTOM_SKILLS_CLASS)})</label>
      <div id="ctrl-stat-vehicle-skills" class="swrp-scrollbar-thin" style="max-height:12rem;overflow-y:auto"></div>
    </div>
    <p id="ctrl-stat-hint" class="small text-muted mb-0"></p>`;

  populateClassSelect();
  populateSpeciesSelect();
  bindEvents();
  mounted = true;
}

export function loadTokenStatsEditor(token) {
  tokenKind = inferBoardTokenKind(token);
  document.getElementById('ctrl-stat-level-wrap')?.classList.toggle('d-none', tokenKind !== 'character');
  syncVehicleFieldsVisibility();
  setStatsFieldsEditable(!isPartyCharacter());
  updateStatsHint();

  const snap = token.characterSnapshot || {};
  const entity = normalizeCharacter(
    {
      ...snap,
      name: token.name || snap.name,
      class: token.class || snap.class,
      ...(tokenKind === 'character' ? { level: token.level ?? snap.level } : {}),
      portraitUrl: token.portraitUrl || snap.portraitUrl || '',
      spanCols: token.spanCols ?? snap.spanCols,
      spanRows: token.spanRows ?? snap.spanRows,
      moveRange: token.moveRange ?? snap.moveRange,
      shields: token.shields ?? snap.shields,
      maxShields: token.maxShields ?? snap.maxShields
    },
    snap.id || token.sourceId
  );

  document.getElementById('ctrl-stat-name').value = entity.name || '';
  if (!isVehicleToken()) {
    document.getElementById('ctrl-stat-class').value = entity.class || entity.classKey;
  }
  if (tokenKind === 'character') {
    document.getElementById('ctrl-stat-level').value = String(entity.level || 1);
  }
  document.getElementById('ctrl-stat-species').value = entity.species || getSpeciesList()[0];
  document.getElementById('ctrl-stat-portrait').value = entity.portraitUrl || '';

  if (isVehicleToken()) {
    document.getElementById('ctrl-stat-span-cols').value = String(Math.max(1, Number(entity.spanCols ?? token.spanCols) || 1));
    document.getElementById('ctrl-stat-span-rows').value = String(Math.max(1, Number(entity.spanRows ?? token.spanRows) || 1));
    document.getElementById('ctrl-stat-move-range').value = String(Math.max(1, Number(entity.moveRange ?? token.moveRange) || 6));
  }

  selectedSkills = (entity.skills || [])
    .map((s) => (typeof s === 'string' ? s : s?.id))
    .filter(Boolean);

  if (isPartyCharacter()) {
    statsOverride = null;
  } else {
    statsOverride = {
      hp: entity.maxHp ?? entity.hp ?? 0,
      defense: entity.defense ?? 0,
      attack: entity.attack ?? 0,
      damage: entity.damage ?? 0,
      force: entity.force ?? null,
      shields: entity.shields ?? entity.maxShields ?? 0,
      maxShields: entity.maxShields ?? entity.shields ?? 0
    };
  }
  syncStatsFieldsFromBase();
  updatePortraitPreview(entity.portraitUrl || '');
  updateSkillPicker();
}

export function readTokenStatsEditor() {
  const classKey = isVehicleToken()
    ? VEHICLE_CLASS_KEY
    : document.getElementById('ctrl-stat-class')?.value;
  const level = tokenKind === 'character'
    ? (parseInt(document.getElementById('ctrl-stat-level')?.value, 10) || 1)
    : 20;
  const stats = resolveStatsForSave();
  const payload = {
    name: document.getElementById('ctrl-stat-name')?.value.trim() || 'Sin nombre',
    class: classKey,
    classKey,
    species: isVehicleToken() ? null : document.getElementById('ctrl-stat-species')?.value,
    portraitUrl: document.getElementById('ctrl-stat-portrait')?.value.trim() || '',
    skills: [...selectedSkills],
    hp: stats.hp,
    maxHp: stats.maxHp,
    defense: stats.defense,
    attack: stats.attack,
    damage: stats.damage,
    force: stats.force
  };
  if (tokenKind === 'character') payload.level = level;
  if (isVehicleToken()) {
    Object.assign(payload, readVehicleFieldsFromUi());
    payload.shields = stats.shields;
    payload.maxShields = stats.maxShields;
    payload.force = null;
  }
  return payload;
}
