import { getStats, formatAttack, findSkillById, findCustomSkillById, GAME_DATA } from './compendium-store.js';
import { applyPermanentModifiers, computeEquipmentBonus } from './inventory.js';
import { CARD_LOGO_SRC } from './assets.js';
import {
  VEHICLE_CLASS_KEY,
  VEHICLE_CLASS_LABEL,
  getVehicleClassMeta,
  isVehicleNpc
} from './npcs.js';

export function getClassMeta(classKey) {
  if (classKey === VEHICLE_CLASS_KEY) return getVehicleClassMeta();
  return GAME_DATA.CLASS_META[classKey] || {
    label: classKey,
    theme: 'default',
    color: '#888'
  };
}

/** Clase de personaje (Firestore: classKey; legacy: class). */
export function readCharacterClass(data) {
  return data?.classKey || data?.class || data?.Clase || 'Soldado';
}

/** Normaliza un documento Firestore a objeto personaje usable en UI. */
export function normalizeCharacter(data, id = null) {
  if (!data) return null;
  const level = Number(data.level) || 1;
  const vehicle = isVehicleNpc(data);
  const classKey = vehicle ? VEHICLE_CLASS_KEY : readCharacterClass(data);
  return {
    id: id ?? data.id ?? null,
    name: data.name || 'Sin nombre',
    species: vehicle ? null : (data.species || 'Humanos'),
    era: data.era || null,
    class: classKey,
    classKey,
    level,
    type: data.type || 'Heroe',
    portraitUrl: data.portraitUrl || '',
    hp: data.hp,
    maxHp: data.maxHp,
    currentHp: data.currentHp ?? data.hp,
    defense: data.defense,
    attack: data.attack,
    damage: data.damage,
    force: data.force ?? null,
    shields: data.shields ?? null,
    maxShields: data.maxShields ?? null,
    spanCols: data.spanCols ?? null,
    spanRows: data.spanRows ?? null,
    moveRange: data.moveRange ?? null,
    npcCategory: data.npcCategory || null,
    credits: Math.max(0, Math.round(Number(data.credits) || 0)),
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
    equippedItemId: data.equippedItemId || null,
    statBonuses: data.statBonuses || {},
    skills: (data.skills || []).map((s) => {
      if (typeof s === 'string') return s;
      if (s?.id && s?.name) return { ...s };
      return s?.id;
    }).filter(Boolean),
    userId: data.userId
  };
}

export function isHeroCharacter(data) {
  const type = data?.type;
  return type !== 'NPC';
}

export function resolveCharacterStats(character) {
  const char = normalizeCharacter(character, character?.id);
  const base = getStats(char.class, char.level) || {};

  let stats;
  if (isHeroCharacter(char)) {
    stats = {
      hp: char.currentHp ?? char.hp ?? base.hp ?? 0,
      maxHp: char.maxHp ?? base.hp ?? 0,
      defense: base.defense ?? 0,
      attack: base.attack ?? 0,
      damage: base.damage ?? 0,
      force: base.force ?? null
    };
  } else {
    stats = {
      hp: char.currentHp ?? char.hp ?? base.hp ?? 0,
      maxHp: char.maxHp ?? base.hp ?? 0,
      defense: char.defense ?? base.defense ?? 0,
      attack: char.attack ?? base.attack ?? 0,
      damage: char.damage ?? base.damage ?? 0,
      force: char.force ?? base.force ?? null,
      shields: char.shields ?? char.maxShields ?? null,
      maxShields: char.maxShields ?? char.shields ?? null
    };
  }

  if (isHeroCharacter(char)) {
    const withEquip = applyPermanentModifiers(stats, char);
    // La cura (hp) nunca supera el máximo (que sí puede subir el equipo).
    if (withEquip.maxHp != null && withEquip.hp > withEquip.maxHp) {
      withEquip.hp = withEquip.maxHp;
    }
    return withEquip;
  }
  return stats;
}

/** Stats con bonus de equipo equipado (para resaltar en verde en la carta). */
export function getEquipmentBoostedStatKeys(character) {
  const char = normalizeCharacter(character, character?.id);
  if (!isHeroCharacter(char)) return new Set();
  const bonus = computeEquipmentBonus(char.equippedItemId);
  if (!bonus?.stat || !bonus.amount) return new Set();
  return new Set([bonus.stat === 'hp' ? 'hp' : bonus.stat]);
}

function statHexClass(statKey, { boardContext, equipBoosted }) {
  if (statKey === 'hp' && boardContext?.hpDamaged) return 'swrp-card__hex--hp-damaged';
  if (statKey === 'defense' && boardContext?.defenseInCover) return 'swrp-card__hex--defense-cover';
  if (equipBoosted?.has(statKey)) return 'swrp-card__hex--stat-boosted';
  return '';
}

export function renderCharacterCard(character, options = {}) {
  const { mini = false, showSkills = true, isNpc = false, isVehicle = false, copyMentionId = null, boardContext = null, inventory = null, loot = null } = options;
  const char = normalizeCharacter(character, character?.id);
  const isVehicleCard = isVehicle || isVehicleNpc(char);
  const meta = isVehicleCard ? getVehicleClassMeta() : getClassMeta(char.class);
  const stats = resolveCharacterStats(char);
  const displayStats = boardContext
    ? {
        ...stats,
        hp: boardContext.hp ?? stats.hp,
        maxHp: boardContext.maxHp ?? stats.maxHp,
        defense: boardContext.defense ?? stats.defense
      }
    : stats;
  const skills = (char.skills || [])
    .map((s) => resolveSkillRef(s, char.class))
    .filter(Boolean);

  const rolSkills = (GAME_DATA.skills[char.class] || [])
    .filter((s) => s.unlockLevel === 'always');

  const card = document.createElement('article');
  card.className = `swrp-card theme-${meta.theme}${mini ? ' swrp-card--mini' : ''}${isNpc ? ' swrp-card--npc' : ''}`;
  card.dataset.class = char.class;

  const equipBoosted = getEquipmentBoostedStatKeys(char);
  const attackFmt = formatAttack(displayStats.attack ?? stats.attack);
  const forceBlock = !isVehicleCard && meta.hasForce && stats.force != null
    ? `<p class="swrp-card__force"><em>Fuerza: ${stats.force}</em></p>`
    : '';
  const shieldsBlock = isVehicleCard && (stats.shields != null || stats.maxShields != null)
    ? `<p class="swrp-card__force swrp-card__shields"><em>Escudos: ${stats.shields ?? stats.maxShields ?? 0}</em></p>`
    : '';
  const vehicleSizeBlock = isVehicleCard
    ? `<p class="swrp-card__vehicle-meta small text-muted mb-0">${Number(char.spanCols) || 1}×${Number(char.spanRows) || 1} celdas · Mov. ${Number(char.moveRange) || 6}</p>`
    : '';

  const skillItems = showSkills
    ? [...rolSkills, ...skills].map(renderSkillItem).join('')
    : '';

  const npcBadge = isVehicleCard
    ? '<span class="swrp-card__badge-npc swrp-card__badge-vehicle">VEHÍCULO</span>'
    : (isNpc ? '<span class="swrp-card__badge-npc">NPC</span>' : '');

  const copyIdBtn = copyMentionId
    ? `<button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost swrp-card__copy-id" data-copy-mention="@{${escapeHtml(copyMentionId)}}">Copiar ID</button>`
    : '';

  const levelBlock = isNpc
    ? ''
    : `<div class="swrp-card__level">
          <span class="swrp-card__level-label">NIVEL</span>
          <div class="swrp-card__hex swrp-card__hex--level">${char.level}</div>
        </div>`;

  const eraLine = char.era
    ? `<span class="swrp-card__era-label">Era:</span> ${escapeHtml(char.era)}`
    : '';
  const speciesLine = isVehicleCard
    ? (eraLine ? `<p class="swrp-card__species">${eraLine}</p>` : '')
    : `<p class="swrp-card__species">${escapeHtml(char.species)}${eraLine ? ` · ${eraLine}` : ''}</p>`;

  card.innerHTML = `
    <header class="swrp-card__header">
      <div class="swrp-card__identity">
        <h2 class="swrp-card__name" title="${escapeHtml(char.name)}">
          <span class="swrp-card__name-text">${escapeHtml(char.name)}</span>${npcBadge}
        </h2>
        <p class="swrp-card__class">${escapeHtml(isVehicleCard ? VEHICLE_CLASS_LABEL : meta.label)}</p>
        ${speciesLine}
        ${vehicleSizeBlock}
      </div>
      <div class="swrp-card__header-actions">
        ${copyIdBtn}
        ${levelBlock}
      </div>
    </header>
    <div class="swrp-card__body">
      <div class="swrp-card__left">
        <div class="swrp-card__stats">
          ${statRow('P.GOLPE', displayStats.hp, statHexClass('hp', { boardContext, equipBoosted }))}
          ${statRow('DEFENSA', displayStats.defense, statHexClass('defense', { boardContext, equipBoosted }))}
          ${statRow('ATAQUE', attackFmt, statHexClass('attack', { boardContext, equipBoosted }))}
          ${statRow('DAÑO', displayStats.damage, statHexClass('damage', { boardContext, equipBoosted }))}
        </div>
        ${char.portraitUrl ? `
          <div class="swrp-card__portrait">
            <img src="${escapeHtml(char.portraitUrl)}" alt="${escapeHtml(char.name)}" loading="lazy">
          </div>` : ''}
      </div>
      <div class="swrp-card__skills-panel">
        <h3 class="swrp-card__skills-title">HABILIDADES</h3>
        ${forceBlock}
        ${shieldsBlock}
        <div class="swrp-card__skills-list">${skillItems || '<p class="text-muted small">Sin habilidades seleccionadas</p>'}</div>
      </div>
    </div>
    <footer class="swrp-card__footer">
      <img class="swrp-card__logo" src="${CARD_LOGO_SRC}" alt="Star Wars Expanded RP">
    </footer>
    ${inventory ? '<button type="button" class="swrp-card__inventory-btn" title="Abrir inventario" aria-label="Abrir inventario">Inventario</button>' : ''}
    ${loot ? '<button type="button" class="swrp-card__loot-btn" title="Saquear enemigo" aria-label="Saquear">Saquear</button>' : ''}
  `;

  card.querySelector('.swrp-card__copy-id')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = btn.dataset.copyMention;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = '¡Copiado!';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    } catch {
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Copiar ID'; }, 1200);
    }
  });

  scheduleCardNameFit(card);

  if (inventory && typeof inventory.onOpen === 'function') {
    card.querySelector('.swrp-card__inventory-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      inventory.onOpen(character);
    });
  }

  if (loot && typeof loot.onOpen === 'function') {
    card.querySelector('.swrp-card__loot-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      loot.onOpen(character);
    });
  }

  return card;
}

/** Reduce el tamaño del nombre hasta que quepa en una sola línea. */
export function fitCardNameText(card) {
  const nameEl = card?.querySelector('.swrp-card__name');
  const textEl = card?.querySelector('.swrp-card__name-text');
  if (!nameEl || !textEl) return;

  const isMini = card.classList.contains('swrp-card--mini');
  const maxRem = isMini ? 0.95 : 1.15;
  const minRem = isMini ? 0.5 : 0.55;
  const badge = nameEl.querySelector('.swrp-card__badge-npc');
  const badgeWidth = badge ? badge.offsetWidth + 6 : 0;
  const available = Math.max(nameEl.clientWidth - badgeWidth, 40);

  textEl.style.maxWidth = `${available}px`;
  let size = maxRem;
  textEl.style.fontSize = `${size}rem`;

  while (size > minRem && textEl.scrollWidth > textEl.clientWidth + 1) {
    size = Math.max(minRem, size - 0.04);
    textEl.style.fontSize = `${size}rem`;
  }
}

function scheduleCardNameFit(card) {
  if (card.dataset.nameFitBound) return;
  card.dataset.nameFitBound = '1';

  const run = () => {
    if (card.clientWidth > 0) fitCardNameText(card);
  };

  requestAnimationFrame(run);

  const observer = new ResizeObserver(() => run());
  observer.observe(card);
}

export function fitAllCardNames(root = document) {
  root.querySelectorAll('.swrp-card').forEach((card) => scheduleCardNameFit(card));
}

export function isNpcEntity(char) {
  return char?.type === 'NPC' || char?.kind === 'npc';
}

export function renderCharacterTag(snapshot, onClick) {
  if (!snapshot?.name) return null;
  const meta = getClassMeta(snapshot.class);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `swrp-char-tag theme-${meta.theme}`;
  btn.title = 'Ver carta de personaje';
  const levelTag = isNpcEntity(snapshot)
    ? ''
    : `<span class="swrp-char-tag__level">Nv.${Number(snapshot.level) || 1}</span>`;
  btn.innerHTML = `
    <span class="swrp-char-tag__name">${escapeHtml(snapshot.name)}</span>
    ${levelTag}`;
  if (onClick) {
    btn.addEventListener('click', () => onClick(normalizeCharacter(snapshot)));
  }
  return btn;
}

export function renderNpcCard(npc) {
  return renderCharacterCard(
    {
      ...npc,
      portraitUrl: npc.portraitUrl || npc.image || ''
    },
    { isNpc: true }
  );
}

function statRow(label, value, hexClass = '') {
  const hexMods = ['swrp-card__hex--stat', hexClass].filter(Boolean).join(' ');
  return `
    <div class="swrp-card__stat-row">
      <span class="swrp-card__stat-label">${label}</span>
      <div class="swrp-card__stat-bar"></div>
      <div class="swrp-card__hex ${hexMods}">${escapeHtml(String(value))}</div>
    </div>`;
}

function resolveSkillRef(skillRef, classKey) {
  if (skillRef && typeof skillRef === 'object' && skillRef.name) return skillRef;
  const id = typeof skillRef === 'string' ? skillRef : skillRef?.id;
  if (!id) return null;
  return findSkillById(classKey, id) || findCustomSkillById(id);
}

function renderSkillItem(skill) {
  const badgeClass = skillBadgeClass(skill.type);
  return `
    <div class="swrp-card__skill">
      <span class="swrp-skill-badge ${badgeClass}">${escapeHtml(skill.type)}</span>
      <strong>${escapeHtml(skill.name)}:</strong> ${escapeHtml(skill.description)}
    </div>`;
}

function skillBadgeClass(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'rol') return 'swrp-skill-badge--rol';
  if (t === 'pasiva') return 'swrp-skill-badge--pasiva';
  return 'swrp-skill-badge--activa';
}

function findSkillByIdLocal(classKey, skillId) {
  return findSkillById(classKey, skillId);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { findSkillByIdLocal as findSkillById };
