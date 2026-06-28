import {
  getStats,
  getClassList,
  getSkillsForClass,
  getUnlockableSkillLevels,
  getSpeciesList,
  getCustomSkills,
  findCustomSkillById,
  normalizeCustomSkill,
  CUSTOM_SKILLS_CLASS,
  GAME_DATA
} from './compendium-store.js';
import { buildNpcEraFormOptions, DEFAULT_NPC_ERA, normalizeNpcLoot, serializeNpcLoot } from './npcs.js';
import { normalizeLootTemplate } from './loot.js';
import { renderLootList, createLootItemPicker } from './loot-editor-ui.js';
import { tokenFromNeutralBoardNpc } from './party-members.js';
import { getClassMeta } from './character-card.js';

const NEUTRAL_NPC_LIBRARY_KEY = 'swrp.neutralNpcLibrary';
const NPC_SKILL_LEVEL = 20;
let selectedSkills = [];
let pendingCustomSkills = [];
let npcSkillSource = 'class';
let statsOverride = null;
let lootDraft = normalizeLootTemplate({});
let lootPicker = null;
let npcEditorTab = 'general';
let selectedPresetId = null;
let bound = false;

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function skillTypeClass(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'rol') return 'swrp-skill-badge--rol';
  if (t === 'pasiva') return 'swrp-skill-badge--pasiva';
  return 'swrp-skill-badge--activa';
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

function readStatsFromFields() {
  const forceVal = el('bn-stat-force')?.value;
  return {
    hp: parseInt(el('bn-stat-hp')?.value, 10) || 0,
    maxHp: parseInt(el('bn-stat-hp')?.value, 10) || 0,
    currentHp: parseInt(el('bn-stat-hp')?.value, 10) || 0,
    defense: parseInt(el('bn-stat-defense')?.value, 10) || 0,
    attack: parseInt(el('bn-stat-attack')?.value, 10) || 0,
    damage: parseInt(el('bn-stat-damage')?.value, 10) || 0,
    force: forceVal === '' ? null : parseInt(forceVal, 10)
  };
}

function syncStatsFieldsFromBase() {
  const classKey = el('bn-char-class')?.value;
  const base = getStats(classKey, NPC_SKILL_LEVEL) || {};
  if (!statsOverride) statsOverride = { ...base };
  el('bn-stat-hp').value = statsOverride.hp ?? 0;
  el('bn-stat-defense').value = statsOverride.defense ?? 0;
  el('bn-stat-attack').value = statsOverride.attack ?? 0;
  el('bn-stat-damage').value = statsOverride.damage ?? 0;
  el('bn-stat-force').value = statsOverride.force ?? '';
}

function syncLootList() {
  renderLootList(el('bn-loot-list'), lootDraft, (idx) => {
    lootDraft.items.splice(idx, 1);
    syncLootList();
  });
}

function nameInitials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function generatePresetId() {
  return `npreset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadNeutralNpcLibrary() {
  try {
    const raw = localStorage.getItem(NEUTRAL_NPC_LIBRARY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNeutralNpcLibrary(list) {
  try {
    localStorage.setItem(NEUTRAL_NPC_LIBRARY_KEY, JSON.stringify(list));
  } catch {
    /* quota or private mode */
  }
}

function presetThumbHtml(preset) {
  const meta = getClassMeta(preset.classKey || preset.class);
  const themeClass = meta?.theme ? ` theme-${meta.theme}` : '';
  const url = preset.portraitUrl || '';
  if (url) {
    return `<span class="swrp-add-token-item__thumb${themeClass}"><img src="${escapeAttr(url)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="swrp-add-token-item__thumb swrp-add-token-item__thumb--empty${themeClass}">${escapeHtml(nameInitials(preset.name))}</span>`;
}

function buildPresetFromFormNpc(npc) {
  return {
    presetId: selectedPresetId || generatePresetId(),
    name: npc.name,
    classKey: npc.classKey || npc.class,
    species: npc.species,
    era: npc.era,
    portraitUrl: npc.portraitUrl || '',
    hp: npc.hp,
    maxHp: npc.maxHp,
    defense: npc.defense,
    attack: npc.attack,
    damage: npc.damage,
    force: npc.force,
    skills: (npc.skills || []).map((s) => ({ ...s })),
    pendingCustomSkills: pendingCustomSkills.map((s) => ({ ...s })),
    loot: npc.loot,
    savedAt: new Date().toISOString()
  };
}

export function exportNeutralNpcLibrary() {
  return loadNeutralNpcLibrary();
}

export function importNeutralNpcLibrary(presets) {
  if (!Array.isArray(presets) || !presets.length) return;
  const library = loadNeutralNpcLibrary();
  const byId = new Map(library.map((p) => [p.presetId, p]));
  presets.forEach((preset) => {
    if (!preset?.presetId) return;
    byId.set(preset.presetId, { ...preset });
  });
  const merged = [...byId.values()].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  saveNeutralNpcLibrary(merged);
  renderNeutralNpcLibraryList();
}

export function registerNeutralNpcPresetAfterPlace() {
  const npc = readFormNpc();
  const preset = buildPresetFromFormNpc(npc);
  const library = loadNeutralNpcLibrary();
  const idx = library.findIndex((p) => p.presetId === preset.presetId);
  if (idx >= 0) library[idx] = preset;
  else library.unshift(preset);
  saveNeutralNpcLibrary(library);
  selectedPresetId = preset.presetId;
  renderNeutralNpcLibraryList();
}

function applyPresetToForm(preset) {
  if (!preset) return;
  selectedPresetId = preset.presetId;
  pendingCustomSkills = (preset.pendingCustomSkills || []).map((s) => normalizeCustomSkill(s));
  selectedSkills = (preset.skills || []).map((s) => s.id).filter(Boolean);
  statsOverride = {
    hp: preset.hp ?? 0,
    maxHp: preset.maxHp ?? preset.hp ?? 0,
    currentHp: preset.hp ?? 0,
    defense: preset.defense ?? 0,
    attack: preset.attack ?? 0,
    damage: preset.damage ?? 0,
    force: preset.force ?? null
  };
  lootDraft = normalizeLootTemplate(preset.loot || {});

  el('bn-char-name').value = preset.name || '';
  if (el('bn-char-class')) el('bn-char-class').value = preset.classKey || preset.class || '';
  if (el('bn-char-species')) el('bn-char-species').value = preset.species || '';
  if (el('bn-char-era')) el('bn-char-era').value = preset.era || DEFAULT_NPC_ERA;
  el('bn-portrait-url').value = preset.portraitUrl || '';
  el('bn-loot-credits').value = String(lootDraft.credits ?? 0);

  syncStatsFieldsFromBase();
  syncLootList();
  updatePortraitPreview();
  updateSkillPicker();
  showNpcEditorTab('general');
  renderNeutralNpcLibraryList();
}

export function renderNeutralNpcLibraryList() {
  const listEl = el('bn-neutral-library-list');
  if (!listEl) return;
  const library = loadNeutralNpcLibrary();
  if (!library.length) {
    listEl.innerHTML = '<p class="small text-muted mb-0">Aún no hay NPCs neutrales guardados. Coloca uno en el tablero para añadirlo aquí.</p>';
    return;
  }

  listEl.innerHTML = library.map((preset) => {
    const meta = getClassMeta(preset.classKey || preset.class);
    const selected = preset.presetId === selectedPresetId;
    return `
      <button type="button" class="swrp-add-token-item${selected ? ' is-selected' : ''}" data-preset-id="${escapeAttr(preset.presetId)}">
        ${presetThumbHtml(preset)}
        <span class="swrp-add-token-item__body">
          <strong>${escapeHtml(preset.name || 'Sin nombre')}</strong>
          <span class="small text-muted d-block">${escapeHtml(meta?.label || preset.classKey || '')} · ${escapeHtml(preset.species || '')}</span>
        </span>
      </button>`;
  }).join('');

  listEl.querySelectorAll('[data-preset-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = library.find((p) => p.presetId === btn.dataset.presetId);
      applyPresetToForm(preset);
    });
  });
}

function showNpcEditorTab(tabName) {
  npcEditorTab = tabName;
  el('bn-tab-general')?.classList.toggle('d-none', tabName !== 'general');
  el('bn-tab-loot')?.classList.toggle('d-none', tabName !== 'loot');
  el('bn-tab-library')?.classList.toggle('d-none', tabName !== 'library');
  document.querySelectorAll('#bn-editor-tabs [data-bn-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.bnTab === tabName);
  });
  if (tabName === 'library') renderNeutralNpcLibraryList();
}

function updatePortraitPreview() {
  const url = el('bn-portrait-url')?.value.trim() || '';
  const img = el('bn-portrait-preview');
  const err = el('bn-portrait-preview-error');
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
  const classKey = el('bn-char-class')?.value;
  const container = el('bn-skills-picker');
  if (!container || !classKey) return;

  const unlockLevels = getUnlockableSkillLevels(NPC_SKILL_LEVEL);
  const maxClassSlots = Math.min(GAME_DATA.MAX_SKILLS, unlockLevels.length);
  const classSlotsUsed = countSelectedClassSkills();
  const customSelected = selectedSkills.filter((id) => isKnownCustomSkillId(id)).length;

  container.innerHTML = `
    <div class="row g-2 mb-3 align-items-end">
      <div class="col-md-6">
        <label class="form-label small mb-1">Origen de habilidades</label>
        <select class="form-select form-select-sm" id="bn-skill-source">
          <option value="class">Clase del NPC</option>
          <option value="otros">${escapeHtml(CUSTOM_SKILLS_CLASS)}</option>
        </select>
      </div>
      <div class="col-md-6">
        <p class="small text-muted mb-0">Clase: ${classSlotsUsed}/${maxClassSlots} · ${escapeHtml(CUSTOM_SKILLS_CLASS)}: ${customSelected}</p>
      </div>
    </div>
    <div id="bn-skill-list"></div>`;

  const sourceSel = container.querySelector('#bn-skill-source');
  sourceSel.value = npcSkillSource;
  sourceSel.addEventListener('change', (e) => {
    npcSkillSource = e.target.value;
    renderSkillList(container.querySelector('#bn-skill-list'), classKey, maxClassSlots);
  });
  renderSkillList(container.querySelector('#bn-skill-list'), classKey, maxClassSlots);
}

function renderSkillList(listEl, classKey, maxClassSlots) {
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
      });
      listEl.appendChild(label);
    });
    return;
  }

  const available = getSkillsForClass(classKey, NPC_SKILL_LEVEL)
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
      });
      section.appendChild(label);
    });
    listEl.appendChild(section);
  });
}

function readFormNpc() {
  const classKey = el('bn-char-class')?.value;
  const stats = readStatsFromFields();
  const skillObjs = selectedSkills
    .map((id) => resolveSelectedSkill(id, classKey, NPC_SKILL_LEVEL))
    .filter(Boolean);
  const credits = Math.max(0, parseInt(el('bn-loot-credits')?.value, 10) || 0);
  const loot = serializeNpcLoot({ ...lootDraft, credits });

  return {
    id: `neutral_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: el('bn-char-name')?.value.trim() || 'Sin nombre',
    class: classKey,
    classKey,
    species: el('bn-char-species')?.value,
    era: el('bn-char-era')?.value || DEFAULT_NPC_ERA,
    type: 'NPC',
    portraitUrl: el('bn-portrait-url')?.value.trim() || '',
    hp: stats.hp,
    maxHp: stats.maxHp,
    currentHp: stats.currentHp,
    defense: stats.defense,
    attack: stats.attack,
    damage: stats.damage,
    force: stats.force,
    skills: skillObjs,
    loot
  };
}

export function resetBoardNeutralNpcForm() {
  selectedSkills = [];
  pendingCustomSkills = [];
  npcSkillSource = 'class';
  statsOverride = null;
  selectedPresetId = null;
  lootDraft = normalizeLootTemplate({});
  el('bn-char-name').value = '';
  el('bn-portrait-url').value = '';
  if (el('bn-char-class')?.options.length) el('bn-char-class').selectedIndex = 0;
  if (el('bn-char-species')?.options.length) el('bn-char-species').selectedIndex = 0;
  if (el('bn-char-era')) el('bn-char-era').value = DEFAULT_NPC_ERA;
  el('bn-loot-credits').value = '0';
  el('bn-custom-skill-name').value = '';
  el('bn-custom-skill-desc').value = '';
  el('bn-custom-skill-type').value = 'Activa';
  syncStatsFieldsFromBase();
  syncLootList();
  updatePortraitPreview();
  updateSkillPicker();
  showNpcEditorTab('general');
}

export function validateBoardNeutralNpcForm() {
  const name = el('bn-char-name')?.value.trim();
  if (!name) return { ok: false, message: 'Indica un nombre para el NPC neutral.' };
  const url = el('bn-portrait-url')?.value.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, message: 'La URL del retrato debe empezar por http:// o https://' };
      }
    } catch {
      return { ok: false, message: 'La URL del retrato no es válida.' };
    }
  }
  return { ok: true };
}

export function buildNeutralTokenTemplateFromForm() {
  const npc = readFormNpc();
  return tokenFromNeutralBoardNpc(npc);
}

export function initBoardNeutralNpcForm({ lootItemModalEl } = {}) {
  if (!el('bn-char-class')) return;

  el('bn-char-class').innerHTML = getClassList()
    .map((c) => `<option value="${escapeAttr(c.key)}">${escapeHtml(c.label)}</option>`)
    .join('');
  el('bn-char-species').innerHTML = getSpeciesList()
    .map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`)
    .join('');
  if (el('bn-char-era')) {
    el('bn-char-era').innerHTML = buildNpcEraFormOptions(DEFAULT_NPC_ERA);
  }

  if (!lootPicker && lootItemModalEl) {
    lootPicker = createLootItemPicker({
      modalEl: lootItemModalEl,
      getDraft: () => lootDraft,
      onItemsChanged: () => syncLootList()
    });
  }

  if (bound) {
    resetBoardNeutralNpcForm();
    renderNeutralNpcLibraryList();
    return;
  }
  bound = true;

  ['bn-char-name', 'bn-char-class', 'bn-char-species', 'bn-portrait-url'].forEach((id) => {
    el(id)?.addEventListener('input', () => {
      if (id === 'bn-char-class') {
        statsOverride = null;
        syncStatsFieldsFromBase();
        selectedSkills = selectedSkills.filter((sid) => isKnownCustomSkillId(sid));
        updateSkillPicker();
      }
      if (id === 'bn-portrait-url') updatePortraitPreview();
    });
    el(id)?.addEventListener('change', () => {
      if (id === 'bn-char-class') {
        statsOverride = null;
        syncStatsFieldsFromBase();
        updateSkillPicker();
      }
    });
  });

  ['bn-stat-hp', 'bn-stat-defense', 'bn-stat-attack', 'bn-stat-damage', 'bn-stat-force'].forEach((id) => {
    el(id)?.addEventListener('input', () => {
      statsOverride = readStatsFromFields();
    });
  });

  el('bn-btn-load-base-stats')?.addEventListener('click', () => {
    statsOverride = null;
    syncStatsFieldsFromBase();
  });

  el('bn-loot-add')?.addEventListener('click', () => lootPicker?.open());

  el('bn-btn-add-custom-skill')?.addEventListener('click', () => {
    const name = el('bn-custom-skill-name')?.value.trim();
    const type = el('bn-custom-skill-type')?.value || 'Activa';
    const description = el('bn-custom-skill-desc')?.value.trim() || '';
    if (!name) return;
    const skill = normalizeCustomSkill({ name, type, description });
    pendingCustomSkills.push(skill);
    if (!selectedSkills.includes(skill.id)) selectedSkills.push(skill.id);
    el('bn-custom-skill-name').value = '';
    el('bn-custom-skill-desc').value = '';
    el('bn-custom-skill-type').value = 'Activa';
    npcSkillSource = 'otros';
    updateSkillPicker();
  });

  document.getElementById('bn-editor-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-bn-tab]');
    if (!tab) return;
    showNpcEditorTab(tab.dataset.bnTab);
  });

  resetBoardNeutralNpcForm();
  renderNeutralNpcLibraryList();
}
