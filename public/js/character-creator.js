import {
  getStats,
  getClassList,
  getSkillsForClass,
  getUnlockableSkillLevels,
  getSpeciesList,
  loadCompendiumData,
  getCustomSkills,
  findCustomSkillById,
  mergeCustomSkills,
  normalizeCustomSkill,
  CUSTOM_SKILLS_CLASS,
  GAME_DATA
} from './compendium-store.js';
import {
  db,
  doc,
  addDoc,
  updateDoc,
  collection,
  serverTimestamp
} from './firebase-config.js';
import { renderCharacterCard } from './character-card.js';
import { loadCharacterById } from './characters.js';
import { loadNpcById, createNpc, updateNpc, buildNpcEraFormOptions, DEFAULT_NPC_ERA, normalizeNpcLoot, serializeNpcLoot, readNpcCategory, isVehicleNpc, NPC_CATEGORY_VEHICLE, NPC_CATEGORY_CHARACTER, VEHICLE_CLASS_KEY, vehicleClassFields } from './npcs.js';
import { normalizeLootTemplate } from './loot.js';
import { renderLootList, createLootItemPicker } from './loot-editor-ui.js';
import { characterViewUrl } from './character-url.js';
import { appUrl } from './app-path.js';

let selectedSkills = [];
let pendingCustomSkills = [];
let npcSkillSource = 'class';
let editingCharacterId = null;
let editingNpcId = null;
let mode = 'hero';
const NPC_SKILL_LEVEL = 20;
let statsOverride = null;
let npcLootDraft = normalizeLootTemplate({});
let npcLootPicker = null;
let npcEditorTab = 'general';

function showSaveAlert(message) {
  const alertEl = document.getElementById('save-alert');
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function hideSaveAlert() {
  document.getElementById('save-alert')?.classList.add('d-none');
}

function isNpcMode() {
  return mode === 'npc' || mode === 'vehicle';
}

function isVehicleMode() {
  return mode === 'vehicle';
}

function getPortraitUrlInput() {
  return document.getElementById('portrait-url').value.trim();
}

function isValidPortraitUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function populateEraSelect() {
  const sel = document.getElementById('char-era');
  if (!sel) return;
  sel.innerHTML = buildNpcEraFormOptions(DEFAULT_NPC_ERA);
}

function normalizeSelectedSkillIds(list) {
  return (list || [])
    .map((s) => (typeof s === 'string' ? s : s?.id))
    .filter(Boolean);
}

function isKnownCustomSkillId(skillId) {
  return !!findCustomSkillById(skillId)
    || pendingCustomSkills.some((s) => s.id === skillId);
}

function countSelectedClassSkills() {
  return selectedSkills.filter((id) => !isKnownCustomSkillId(id)).length;
}

function resolveSelectedSkill(skillId, classKey, level) {
  const fromClass = getSkillsForClass(classKey, level).find((s) => s.id === skillId);
  if (fromClass) return fromClass;
  return findCustomSkillById(skillId)
    || pendingCustomSkills.find((s) => s.id === skillId)
    || null;
}

function syncNpcOnlyFields() {
  const isNpc = isNpcMode();
  const isVehicle = isVehicleMode();
  document.getElementById('char-era-wrap')?.classList.toggle('d-none', !isNpc);
  document.getElementById('stats-edit-wrap')?.classList.toggle('d-none', !isNpc);
  document.getElementById('char-level-wrap')?.classList.toggle('d-none', isNpc);
  document.getElementById('char-class-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('char-species-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('npc-custom-skills-wrap')?.classList.toggle('d-none', !isNpc);
  document.getElementById('npc-editor-tabs')?.classList.toggle('d-none', !isNpc);
  document.getElementById('skills-picker-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('stat-force-wrap')?.classList.toggle('d-none', isVehicle);
  document.getElementById('stat-shields-wrap')?.classList.toggle('d-none', !isVehicle);
  document.getElementById('vehicle-size-wrap')?.classList.toggle('d-none', !isVehicle);
  document.getElementById('vehicle-move-wrap')?.classList.toggle('d-none', !isVehicle);
  document.getElementById('btn-load-base-stats')?.classList.toggle('d-none', !isNpc || isVehicle);
  if (!isNpc) {
    showNpcEditorTab('general');
  }
}

function showNpcEditorTab(tabName) {
  npcEditorTab = tabName;
  document.getElementById('npc-tab-general')?.classList.toggle('d-none', tabName !== 'general');
  document.getElementById('npc-tab-loot')?.classList.toggle('d-none', tabName !== 'loot');
  document.querySelectorAll('#npc-editor-tabs [data-npc-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.npcTab === tabName);
  });
}

function resetNpcLootDraft(loot) {
  npcLootDraft = normalizeNpcLoot(loot || {});
  const creditsEl = document.getElementById('npc-loot-credits');
  if (creditsEl) creditsEl.value = String(npcLootDraft.credits || 0);
  syncNpcLootList();
}

function syncNpcLootList() {
  renderLootList(document.getElementById('npc-loot-list'), npcLootDraft, (idx) => {
    npcLootDraft.items.splice(idx, 1);
    syncNpcLootList();
  });
}

function readNpcLootFromUi() {
  const credits = Math.max(0, parseInt(document.getElementById('npc-loot-credits')?.value, 10) || 0);
  return serializeNpcLoot({ ...npcLootDraft, credits });
}

function setupNpcLootEditor() {
  if (npcLootPicker) return;
  npcLootPicker = createLootItemPicker({
    modalEl: document.getElementById('lootItemModal'),
    getDraft: () => npcLootDraft,
    onItemsChanged: () => syncNpcLootList()
  });
  document.getElementById('npc-loot-add')?.addEventListener('click', () => {
    if (!isNpcMode()) return;
    npcLootPicker.open();
  });
  document.getElementById('npc-editor-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-npc-tab]');
    if (!tab || !isNpcMode()) return;
    showNpcEditorTab(tab.dataset.npcTab);
  });
}

function populateSpeciesSelect() {
  const sel = document.getElementById('char-species');
  if (!sel) return;
  sel.innerHTML = getSpeciesList()
    .map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`)
    .join('');
}

function populateClassSelect() {
  const sel = document.getElementById('char-class');
  sel.innerHTML = getClassList()
    .map((c) => `<option value="${c.key}">${c.label}</option>`)
    .join('');
}

function syncStatsFieldsFromBase() {
  const classKey = document.getElementById('char-class').value;
  const level = isNpcMode()
    ? NPC_SKILL_LEVEL
    : (parseInt(document.getElementById('char-level').value, 10) || 1);
  const base = getStats(classKey, level) || {};
  if (!isNpcMode() || !statsOverride) {
    statsOverride = { ...base };
  }
  document.getElementById('stat-hp').value = statsOverride.hp ?? 0;
  document.getElementById('stat-defense').value = statsOverride.defense ?? 0;
  document.getElementById('stat-attack').value = statsOverride.attack ?? 0;
  document.getElementById('stat-damage').value = statsOverride.damage ?? 0;
  document.getElementById('stat-force').value = statsOverride.force ?? '';
  const shieldsEl = document.getElementById('stat-shields');
  if (shieldsEl) shieldsEl.value = statsOverride.shields ?? statsOverride.maxShields ?? 0;
}

function readStatsFromFields() {
  const forceVal = document.getElementById('stat-force').value;
  const shieldsVal = document.getElementById('stat-shields')?.value;
  const base = {
    hp: parseInt(document.getElementById('stat-hp').value, 10) || 0,
    maxHp: parseInt(document.getElementById('stat-hp').value, 10) || 0,
    currentHp: parseInt(document.getElementById('stat-hp').value, 10) || 0,
    defense: parseInt(document.getElementById('stat-defense').value, 10) || 0,
    attack: parseInt(document.getElementById('stat-attack').value, 10) || 0,
    damage: parseInt(document.getElementById('stat-damage').value, 10) || 0,
    force: forceVal === '' ? null : parseInt(forceVal, 10)
  };
  if (isVehicleMode()) {
    const shields = parseInt(shieldsVal, 10) || 0;
    base.shields = shields;
    base.maxShields = shields;
    base.force = null;
  }
  return base;
}

function readVehicleFieldsFromUi() {
  return {
    spanCols: Math.max(1, parseInt(document.getElementById('vehicle-span-cols')?.value, 10) || 1),
    spanRows: Math.max(1, parseInt(document.getElementById('vehicle-span-rows')?.value, 10) || 1),
    moveRange: Math.max(1, parseInt(document.getElementById('vehicle-move-range')?.value, 10) || 6)
  };
}

function applyVehicleFieldsToForm(entity) {
  const spanColsEl = document.getElementById('vehicle-span-cols');
  const spanRowsEl = document.getElementById('vehicle-span-rows');
  const moveEl = document.getElementById('vehicle-move-range');
  if (spanColsEl) spanColsEl.value = String(Math.max(1, Number(entity.spanCols) || 1));
  if (spanRowsEl) spanRowsEl.value = String(Math.max(1, Number(entity.spanRows) || 1));
  if (moveEl) moveEl.value = String(Math.max(1, Number(entity.moveRange) || 6));
}

export async function initCharacterCreator(userId, { characterId = null, npcId = null, isAdmin = false, creatorMode = null } = {}) {
  await loadCompendiumData();
  editingCharacterId = characterId;
  editingNpcId = npcId;
  const urlMode = new URLSearchParams(window.location.search).get('mode');
  mode = npcId
    ? 'npc'
    : ((urlMode === 'npc' || urlMode === 'vehicle') && isAdmin ? urlMode : (creatorMode === 'vehicle' && isAdmin ? 'vehicle' : 'hero'));

  populateClassSelect();
  populateSpeciesSelect();
  populateEraSelect();
  setupCreatorTabs(isAdmin);
  bindFormEvents(userId);
  bindCustomSkillForm();
  setupNpcLootEditor();
  syncNpcOnlyFields();

  if (npcId) {
    const npc = await loadNpcById(npcId);
    if (!npc) {
      showSaveAlert('NPC no encontrado.');
      return;
    }
    mode = isVehicleNpc(npc) ? 'vehicle' : 'npc';
    document.querySelectorAll('#creator-tabs [data-creator-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.creatorMode === mode);
    });
    document.getElementById('form-title').textContent = isVehicleNpc(npc) ? 'Editar Vehículo' : 'Editar NPC';
    applyEntityToForm(npc);
  } else if (characterId) {
    const result = await loadCharacterById(characterId, userId);
    if (result.error) {
      showSaveAlert(result.message);
      return;
    }
    applyEntityToForm(result.character);
  } else {
    statsOverride = null;
    pendingCustomSkills = [];
    npcSkillSource = 'class';
    resetNpcLootDraft({});
    syncStatsFieldsFromBase();
    updateSkillPicker();
    updatePreview();
  }
  syncNpcOnlyFields();
}

function setupCreatorTabs(isAdmin) {
  const tabsWrap = document.getElementById('creator-tabs');
  const npcTab = document.getElementById('tab-npc');
  if (!isAdmin) {
    tabsWrap?.classList.add('d-none');
    mode = 'hero';
    return;
  }
  tabsWrap?.classList.remove('d-none');

  document.querySelectorAll('#creator-tabs [data-creator-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.creatorMode === mode);
    btn.addEventListener('click', () => {
      if (btn.dataset.creatorMode === mode) return;
      mode = btn.dataset.creatorMode;
      editingCharacterId = null;
      editingNpcId = null;
      selectedSkills = [];
      pendingCustomSkills = [];
      npcSkillSource = 'class';
      statsOverride = null;
      document.querySelectorAll('#creator-tabs [data-creator-mode]').forEach((b) => {
        b.classList.toggle('active', b.dataset.creatorMode === mode);
      });
      const titles = { hero: 'Crear Personaje', npc: 'Crear NPC', vehicle: 'Crear Vehículo' };
      document.getElementById('form-title').textContent = titles[mode] || 'Crear';
      document.getElementById('save-btn').textContent = mode === 'vehicle' ? 'Guardar Vehículo' : 'Guardar';
      document.getElementById('char-form').reset();
      document.getElementById('char-level').value = 1;
      if (mode === 'vehicle') {
        document.getElementById('vehicle-span-cols').value = '1';
        document.getElementById('vehicle-span-rows').value = '1';
        document.getElementById('vehicle-move-range').value = '6';
      }
      resetNpcLootDraft({});
      populateClassSelect();
      syncStatsFieldsFromBase();
      updateSkillPicker();
      updatePreview();
      syncNpcOnlyFields();
    });
  });

  if (mode === 'npc' || mode === 'vehicle') {
    document.getElementById('tab-hero')?.classList.remove('active');
    const activeTab = document.querySelector(`#creator-tabs [data-creator-mode="${mode}"]`);
    activeTab?.classList.add('active');
    if (!editingNpcId) {
      document.getElementById('form-title').textContent = mode === 'vehicle' ? 'Crear Vehículo' : 'Crear NPC';
    }
  }
}

function bindFormEvents(userId) {
  const fields = ['char-name', 'char-class', 'char-level', 'char-species', 'portrait-url'];
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', onFormChange);
    el.addEventListener('input', onFormChange);
  });

  ['stat-hp', 'stat-defense', 'stat-attack', 'stat-damage', 'stat-force', 'stat-shields'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (isNpcMode()) {
        statsOverride = readStatsFromFields();
        updatePreview();
      }
    });
  });

  ['vehicle-span-cols', 'vehicle-span-rows', 'vehicle-move-range'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (isVehicleMode()) updatePreview();
    });
  });

  document.getElementById('btn-load-base-stats')?.addEventListener('click', () => {
    statsOverride = null;
    syncStatsFieldsFromBase();
    updatePreview();
  });

  document.getElementById('char-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideSaveAlert();
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      if (isNpcMode()) await saveNpc(userId);
      else await saveCharacter(userId);
    } catch (err) {
      showSaveAlert(err.message || 'Error al guardar');
      btn.disabled = false;
      btn.textContent = editingNpcId || editingCharacterId ? 'Guardar cambios' : 'Guardar';
    }
  });
}

function onFormChange(e) {
  if (e.target.id === 'portrait-url') hideSaveAlert();
  if (['char-class'].includes(e.target.id) && isNpcMode()) {
    if (!statsOverride) syncStatsFieldsFromBase();
    selectedSkills = selectedSkills.filter((id) => isKnownCustomSkillId(id));
  } else if (['char-class', 'char-level'].includes(e.target.id)) {
    selectedSkills = [];
    if (!isNpcMode()) syncStatsFieldsFromBase();
  }
  updateSkillPicker();
  updatePreview();
}

function applyEntityToForm(entity) {
  syncNpcOnlyFields();
  document.getElementById('char-name').value = entity.name || '';
  if (!isVehicleMode()) {
    document.getElementById('char-class').value = entity.class || entity.classKey || getClassList()[0]?.key;
  }
  if (!isNpcMode()) {
    document.getElementById('char-level').value = entity.level ?? 1;
  }
  document.getElementById('char-species').value = entity.species || getSpeciesList()[0];
  const eraEl = document.getElementById('char-era');
  if (eraEl) eraEl.value = entity.era || DEFAULT_NPC_ERA;
  document.getElementById('portrait-url').value = entity.portraitUrl || entity.image || '';
  selectedSkills = normalizeSelectedSkillIds(entity.skills);
  pendingCustomSkills = [];
  npcSkillSource = 'class';
  if (isNpcMode()) {
    statsOverride = {
      hp: entity.hp ?? entity.maxHp ?? entity.currentHp ?? 0,
      defense: entity.defense ?? 0,
      attack: entity.attack ?? 0,
      damage: entity.damage ?? 0,
      force: entity.force ?? null,
      shields: entity.shields ?? entity.maxShields ?? 0,
      maxShields: entity.maxShields ?? entity.shields ?? 0
    };
    if (isVehicleMode()) {
      applyVehicleFieldsToForm(entity);
    }
  } else {
    statsOverride = null;
  }
  syncStatsFieldsFromBase();
  updatePortraitPreview(entity.portraitUrl || entity.image);
  updateSkillPicker();
  updatePreview();
  if (isNpcMode()) {
    resetNpcLootDraft(entity.loot);
  }
  syncNpcOnlyFields();
}

function updatePortraitPreview(url) {
  const img = document.getElementById('portrait-preview');
  const err = document.getElementById('portrait-preview-error');
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

function getFormClassKey() {
  return isVehicleMode() ? VEHICLE_CLASS_KEY : document.getElementById('char-class').value;
}

function getFormCharacter() {
  const classKey = getFormClassKey();
  const level = isNpcMode()
    ? NPC_SKILL_LEVEL
    : (parseInt(document.getElementById('char-level').value, 10) || 1);
  const stats = isNpcMode() ? readStatsFromFields() : (getStats(classKey, level) || {});
  const skillObjs = selectedSkills
    .map((id) => resolveSelectedSkill(id, classKey, level))
    .filter(Boolean);

  const char = {
    name: document.getElementById('char-name').value.trim() || 'Sin nombre',
    class: isVehicleMode() ? VEHICLE_CLASS_KEY : classKey,
    classKey: isVehicleMode() ? VEHICLE_CLASS_KEY : classKey,
    species: isVehicleMode() ? null : document.getElementById('char-species').value,
    era: isNpcMode() ? (document.getElementById('char-era')?.value || DEFAULT_NPC_ERA) : undefined,
    type: isNpcMode() ? 'NPC' : 'Heroe',
    npcCategory: isVehicleMode() ? NPC_CATEGORY_VEHICLE : (isNpcMode() ? NPC_CATEGORY_CHARACTER : undefined),
    portraitUrl: getPortraitUrlInput(),
    hp: stats.hp,
    maxHp: stats.maxHp ?? stats.hp,
    currentHp: stats.currentHp ?? stats.hp,
    defense: stats.defense,
    attack: stats.attack,
    damage: stats.damage,
    force: stats.force ?? null,
    shields: stats.shields,
    maxShields: stats.maxShields,
    skills: skillObjs
  };
  if (isVehicleMode()) {
    Object.assign(char, readVehicleFieldsFromUi());
  }
  if (!isNpcMode()) char.level = level;
  return char;
}

function updatePreview() {
  updatePortraitPreview(getPortraitUrlInput());
  const char = getFormCharacter();
  const wrap = document.getElementById('card-preview');
  wrap.innerHTML = '';
  wrap.appendChild(renderCharacterCard(char, { isNpc: isNpcMode(), isVehicle: isVehicleMode() }));

  if (!isNpcMode()) {
    const stats = getStats(char.class, char.level);
    document.getElementById('stats-readout').innerHTML = stats
      ? `<small class="text-muted">Auto: PG ${stats.hp} · Def ${stats.defense} · Ataque +${stats.attack} · Daño ${stats.damage}${stats.force != null ? ` · Fuerza ${stats.force}` : ''}</small>`
      : '';
  } else {
    document.getElementById('stats-readout').innerHTML = '';
  }
}

function updateSkillPicker() {
  const classKey = document.getElementById('char-class').value;
  const level = isNpcMode()
    ? NPC_SKILL_LEVEL
    : (parseInt(document.getElementById('char-level').value, 10) || 1);
  const container = document.getElementById('skills-picker');

  if (isNpcMode()) {
    if (isVehicleMode()) {
      renderVehicleCustomSkillPicker(container);
      return;
    }
    renderNpcSkillPicker(container, classKey, level);
    return;
  }

  if (classKey === CUSTOM_SKILLS_CLASS) {
    renderPlayerOtrosSkillPicker(container, level);
    return;
  }

  const available = getSkillsForClass(classKey, level)
    .filter((s) => s.unlockLevel !== 'always' && s.type !== 'Rol');

  const unlockLevels = getUnlockableSkillLevels(level);
  const slotsUsed = selectedSkills.length;
  const maxSlots = Math.min(GAME_DATA.MAX_SKILLS, unlockLevels.length);

  container.innerHTML = `
    <p class="small text-muted">Elige hasta ${maxSlots} habilidades (niveles 1/5/10/15). Rol siempre disponible.</p>
    <p class="small">Seleccionadas: ${slotsUsed}/${maxSlots}</p>`;

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
        <input type="checkbox" value="${skill.id}" ${checked ? 'checked' : ''}
          ${!checked && slotsUsed >= maxSlots ? 'disabled' : ''}>
        <span class="swrp-skill-badge ${skillTypeClass(skill.type)}">${skill.type}</span>
        <strong>${escapeHtml(skill.name)}</strong> — ${escapeHtml(skill.description)}`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (selectedSkills.length < maxSlots) selectedSkills.push(skill.id);
        } else {
          selectedSkills = selectedSkills.filter((sid) => sid !== skill.id);
        }
        updateSkillPicker();
        updatePreview();
      });
      section.appendChild(label);
    });
    container.appendChild(section);
  });
}

function renderPlayerOtrosSkillPicker(container, level) {
  const unlockLevels = getUnlockableSkillLevels(level);
  const maxSlots = Math.min(GAME_DATA.MAX_SKILLS, unlockLevels.length);
  const slotsUsed = selectedSkills.length;
  const customSkills = getCustomSkills()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));

  container.innerHTML = `
    <p class="small text-muted">Clase «Otros»: elige hasta ${maxSlots} habilidades personalizadas creadas en el compendio.</p>
    <p class="small mb-2">Seleccionadas: ${slotsUsed}/${maxSlots}</p>`;

  if (!customSkills.length) {
    const empty = document.createElement('p');
    empty.className = 'small text-muted mb-0';
    empty.textContent = 'Aún no hay habilidades en «Otros». Se añaden al crear o editar NPCs.';
    container.appendChild(empty);
    return;
  }

  customSkills.forEach((skill) => {
    const checked = selectedSkills.includes(skill.id);
    const label = document.createElement('label');
    label.className = 'd-block small mb-1';
    label.innerHTML = `
      <input type="checkbox" value="${escapeAttr(skill.id)}" ${checked ? 'checked' : ''}
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
      updatePreview();
    });
    container.appendChild(label);
  });
}

function renderVehicleCustomSkillPicker(container) {
  container.innerHTML = '<p class="small text-muted mb-2">Solo habilidades custom (clase «Otros»). Añádelas abajo.</p><div id="npc-skill-list"></div>';
  npcSkillSource = 'otros';
  renderNpcSkillList(container.querySelector('#npc-skill-list'), VEHICLE_CLASS_KEY, NPC_SKILL_LEVEL, 0);
}

function renderNpcSkillPicker(container, classKey, level) {
  const unlockLevels = getUnlockableSkillLevels(level);
  const maxClassSlots = Math.min(GAME_DATA.MAX_SKILLS, unlockLevels.length);
  const classSlotsUsed = countSelectedClassSkills();
  const customSelected = selectedSkills.filter((id) => isKnownCustomSkillId(id)).length;

  container.innerHTML = `
    <div class="row g-2 mb-3 align-items-end">
      <div class="col-md-6">
        <label class="form-label small mb-1">Origen de habilidades</label>
        <select class="form-select form-select-sm" id="npc-skill-source">
          <option value="class">Clase del NPC</option>
          <option value="otros">${escapeHtml(CUSTOM_SKILLS_CLASS)}</option>
        </select>
      </div>
      <div class="col-md-6">
        <p class="small text-muted mb-0">Clase: ${classSlotsUsed}/${maxClassSlots} · ${escapeHtml(CUSTOM_SKILLS_CLASS)}: ${customSelected}</p>
      </div>
    </div>
    <div id="npc-skill-list"></div>`;

  const sourceSel = container.querySelector('#npc-skill-source');
  sourceSel.value = npcSkillSource;
  sourceSel.addEventListener('change', (e) => {
    npcSkillSource = e.target.value;
    renderNpcSkillList(container.querySelector('#npc-skill-list'), classKey, level, maxClassSlots);
  });

  renderNpcSkillList(container.querySelector('#npc-skill-list'), classKey, level, maxClassSlots);
}

function renderNpcSkillList(listEl, classKey, level, maxClassSlots) {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (npcSkillSource === 'otros') {
    const customSkills = [
      ...getCustomSkills(),
      ...pendingCustomSkills.filter((p) => !getCustomSkills().some((s) => s.id === p.id))
    ].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));

    if (!customSkills.length) {
      listEl.innerHTML = '<p class="small text-muted">Aún no hay habilidades en «Otros». Crea una abajo.</p>';
      return;
    }

    customSkills.forEach((skill) => {
      const checked = selectedSkills.includes(skill.id);
      const label = document.createElement('label');
      label.className = 'd-block small mb-1';
      label.innerHTML = `
        <input type="checkbox" value="${escapeAttr(skill.id)}" ${checked ? 'checked' : ''}>
        <span class="swrp-skill-badge ${skillTypeClass(skill.type)}">${escapeHtml(skill.type)}</span>
        <strong>${escapeHtml(skill.name)}</strong> — ${escapeHtml(skill.description)}`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (!selectedSkills.includes(skill.id)) selectedSkills.push(skill.id);
        } else {
          selectedSkills = selectedSkills.filter((sid) => sid !== skill.id);
        }
        updateSkillPicker();
        updatePreview();
      });
      listEl.appendChild(label);
    });
    return;
  }

  const available = getSkillsForClass(classKey, level)
    .filter((s) => s.unlockLevel !== 'always' && s.type !== 'Rol');
  const classSlotsUsed = countSelectedClassSkills();
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
        <input type="checkbox" value="${escapeAttr(skill.id)}" ${checked ? 'checked' : ''}
          ${!checked && classSlotsUsed >= maxClassSlots ? 'disabled' : ''}>
        <span class="swrp-skill-badge ${skillTypeClass(skill.type)}">${escapeHtml(skill.type)}</span>
        <strong>${escapeHtml(skill.name)}</strong> — ${escapeHtml(skill.description)}`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (countSelectedClassSkills() < maxClassSlots) selectedSkills.push(skill.id);
        } else {
          selectedSkills = selectedSkills.filter((sid) => sid !== skill.id);
        }
        updateSkillPicker();
        updatePreview();
      });
      section.appendChild(label);
    });
    listEl.appendChild(section);
  });
}

function bindCustomSkillForm() {
  const btn = document.getElementById('btn-add-custom-skill');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    addPendingCustomSkillFromFields();
  });
}

function addPendingCustomSkillFromFields() {
  const name = document.getElementById('npc-custom-skill-name')?.value.trim();
  const type = document.getElementById('npc-custom-skill-type')?.value || 'Activa';
  const description = document.getElementById('npc-custom-skill-desc')?.value.trim() || '';
  if (!name) {
    showSaveAlert('Indica un nombre para la habilidad custom.');
    return;
  }
  hideSaveAlert();
  const skill = normalizeCustomSkill({ name, type, description });
  pendingCustomSkills.push(skill);
  if (!selectedSkills.includes(skill.id)) selectedSkills.push(skill.id);
  document.getElementById('npc-custom-skill-name').value = '';
  document.getElementById('npc-custom-skill-desc').value = '';
  document.getElementById('npc-custom-skill-type').value = 'Activa';
  npcSkillSource = 'otros';
  updateSkillPicker();
  updatePreview();
}

function skillTypeClass(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'rol') return 'swrp-skill-badge--rol';
  if (t === 'pasiva') return 'swrp-skill-badge--pasiva';
  return 'swrp-skill-badge--activa';
}

async function saveCharacter(userId) {
  const portraitUrl = getPortraitUrlInput();
  if (!isValidPortraitUrl(portraitUrl)) {
    throw new Error('La URL del retrato debe empezar por http:// o https://');
  }

  const char = getFormCharacter();
  const payload = {
    name: char.name,
    species: char.species,
    classKey: char.classKey,
    class: char.classKey,
    level: char.level,
    type: 'Heroe',
    portraitUrl,
    hp: char.hp ?? 0,
    maxHp: char.maxHp ?? char.hp ?? 0,
    currentHp: char.currentHp ?? char.hp ?? 0,
    defense: char.defense ?? 0,
    attack: char.attack ?? 0,
    damage: char.damage ?? 0,
    force: char.force,
    userId,
    skills: selectedSkills,
    updatedAt: serverTimestamp()
  };

  if (editingCharacterId) {
    await updateDoc(doc(db, 'characters', editingCharacterId), payload);
    window.location.assign(characterViewUrl(editingCharacterId));
  } else {
    payload.createdAt = serverTimestamp();
    const refDoc = await addDoc(collection(db, 'characters'), payload);
    window.location.assign(characterViewUrl(refDoc.id));
  }
}

async function saveNpc(userId) {
  const portraitUrl = getPortraitUrlInput();
  if (!isValidPortraitUrl(portraitUrl)) {
    throw new Error('La URL del retrato debe empezar por http:// o https://');
  }

  if (pendingCustomSkills.length) {
    await mergeCustomSkills(pendingCustomSkills);
    pendingCustomSkills = [];
  }

  const char = getFormCharacter();
  const skillIds = normalizeSelectedSkillIds(selectedSkills);
  const payload = {
    name: char.name,
    ...(isVehicleMode() ? vehicleClassFields() : {
      species: char.species,
      classKey: char.classKey,
      class: char.classKey
    }),
    type: 'NPC',
    npcCategory: isVehicleMode() ? NPC_CATEGORY_VEHICLE : NPC_CATEGORY_CHARACTER,
    era: document.getElementById('char-era')?.value || DEFAULT_NPC_ERA,
    portraitUrl,
    hp: char.hp ?? 0,
    maxHp: char.maxHp ?? char.hp ?? 0,
    defense: char.defense ?? 0,
    attack: char.attack ?? 0,
    damage: char.damage ?? 0,
    force: isVehicleMode() ? null : char.force,
    shields: isVehicleMode() ? (char.shields ?? 0) : null,
    maxShields: isVehicleMode() ? (char.maxShields ?? char.shields ?? 0) : null,
    skills: skillIds,
    createdBy: userId
  };
  if (isVehicleMode()) {
    Object.assign(payload, readVehicleFieldsFromUi());
  }
  const loot = readNpcLootFromUi();
  payload.loot = loot;

  const redirectHash = isVehicleMode() ? '#npcs-vehicles' : '#npcs';

  if (editingNpcId) {
    const { createdBy, ...updatePayload } = payload;
    await updateNpc(editingNpcId, updatePayload);
    window.location.href = appUrl(`compendium${redirectHash}`);
  } else {
    await createNpc(payload);
    window.location.href = appUrl(`compendium${redirectHash}`);
  }
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
