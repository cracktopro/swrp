import {
  getStats,
  getClassList,
  getSkillsForClass,
  getUnlockableSkillLevels,
  getSpeciesList,
  loadCompendiumData,
  GAME_DATA
} from './compendium-store.js';
import { normalizeCharacter } from './character-card.js';

let selectedSkills = [];
let statsOverride = null;
let mounted = false;
/** @type {'character' | 'npc'} */
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

function setStatsFieldsEditable(editable) {
  ['ctrl-stat-hp', 'ctrl-stat-defense', 'ctrl-stat-attack', 'ctrl-stat-damage', 'ctrl-stat-force']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !editable;
    });
  document.getElementById('ctrl-stat-restore-base')?.classList.toggle('d-none', !editable);
}

function updateStatsHint() {
  const hint = document.getElementById('ctrl-stat-hint');
  if (!hint) return;
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
}

function readStatsFromFields() {
  const forceVal = document.getElementById('ctrl-stat-force')?.value;
  const hp = parseInt(document.getElementById('ctrl-stat-hp')?.value, 10) || 0;
  return {
    hp,
    maxHp: hp,
    defense: parseInt(document.getElementById('ctrl-stat-defense')?.value, 10) || 0,
    attack: parseInt(document.getElementById('ctrl-stat-attack')?.value, 10) || 0,
    damage: parseInt(document.getElementById('ctrl-stat-damage')?.value, 10) || 0,
    force: forceVal === '' ? null : parseInt(forceVal, 10)
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
  if (!container || !classKey) return;

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

function onFormChange(e) {
  if (['ctrl-stat-class', 'ctrl-stat-level'].includes(e.target.id)) {
    if (isPartyCharacter() || (tokenKind === 'npc' && !statsOverride)) {
      syncStatsFieldsFromBase();
    }
    selectedSkills = [];
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

  ['ctrl-stat-hp', 'ctrl-stat-defense', 'ctrl-stat-attack', 'ctrl-stat-damage', 'ctrl-stat-force']
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
      <div class="col-md-6">
        <label class="form-label small" for="ctrl-stat-class">Clase</label>
        <select class="form-select form-select-sm" id="ctrl-stat-class"></select>
      </div>
      <div class="col-md-3" id="ctrl-stat-level-wrap">
        <label class="form-label small" for="ctrl-stat-level">Nivel</label>
        <input type="number" class="form-control form-control-sm" id="ctrl-stat-level" min="1" max="20" value="1">
      </div>
      <div class="col-md-3">
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
        <div class="col-4 col-md"><label class="form-label small">Fuerza</label><input type="number" class="form-control form-control-sm" id="ctrl-stat-force" placeholder="—"></div>
      </div>
      <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost mt-2" id="ctrl-stat-restore-base">Aplicar stats del nivel actual</button>
    </div>
    <div class="mb-3">
      <label class="form-label small" for="ctrl-stat-portrait">URL del retrato</label>
      <input type="url" class="form-control form-control-sm" id="ctrl-stat-portrait" placeholder="https://…">
      <img id="ctrl-stat-portrait-preview" class="d-none mt-2" style="max-width:100px;border:1px solid #444" alt="">
      <p id="ctrl-stat-portrait-error" class="small text-warning d-none mb-0 mt-1">No se pudo cargar la imagen.</p>
    </div>
    <div class="mb-2">
      <label class="form-label small">Habilidades de combate</label>
      <div id="ctrl-stat-skills" class="swrp-scrollbar-thin" style="max-height:12rem;overflow-y:auto"></div>
    </div>
    <p id="ctrl-stat-hint" class="small text-muted mb-0"></p>`;

  populateClassSelect();
  populateSpeciesSelect();
  bindEvents();
  mounted = true;
}

export function loadTokenStatsEditor(token) {
  tokenKind = token.kind === 'npc' ? 'npc' : 'character';
  document.getElementById('ctrl-stat-level-wrap')?.classList.toggle('d-none', tokenKind === 'npc');
  setStatsFieldsEditable(!isPartyCharacter());
  updateStatsHint();

  const snap = token.characterSnapshot || {};
  const entity = normalizeCharacter(
    {
      ...snap,
      name: token.name || snap.name,
      class: token.class || snap.class,
      ...(tokenKind === 'npc' ? {} : { level: token.level ?? snap.level }),
      portraitUrl: token.portraitUrl || snap.portraitUrl || ''
    },
    snap.id || token.sourceId
  );

  document.getElementById('ctrl-stat-name').value = entity.name || '';
  document.getElementById('ctrl-stat-class').value = entity.class || entity.classKey;
  if (tokenKind !== 'npc') {
    document.getElementById('ctrl-stat-level').value = String(entity.level || 1);
  }
  document.getElementById('ctrl-stat-species').value = entity.species || getSpeciesList()[0];
  document.getElementById('ctrl-stat-portrait').value = entity.portraitUrl || '';

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
      force: entity.force ?? null
    };
  }
  syncStatsFieldsFromBase();
  updatePortraitPreview(entity.portraitUrl || '');
  updateSkillPicker();
}

export function readTokenStatsEditor() {
  const classKey = document.getElementById('ctrl-stat-class')?.value;
  const level = tokenKind === 'npc'
    ? 20
    : (parseInt(document.getElementById('ctrl-stat-level')?.value, 10) || 1);
  const stats = resolveStatsForSave();
  const payload = {
    name: document.getElementById('ctrl-stat-name')?.value.trim() || 'Sin nombre',
    class: classKey,
    classKey,
    species: document.getElementById('ctrl-stat-species')?.value,
    portraitUrl: document.getElementById('ctrl-stat-portrait')?.value.trim() || '',
    skills: [...selectedSkills],
    hp: stats.hp,
    maxHp: stats.maxHp,
    defense: stats.defense,
    attack: stats.attack,
    damage: stats.damage,
    force: stats.force
  };
  if (tokenKind !== 'npc') payload.level = level;
  return payload;
}
