import { getStats, formatAttack, findSkillById, GAME_DATA } from './compendium-store.js';
import { CARD_LOGO_SRC } from './assets.js';

export function getClassMeta(classKey) {
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
  const classKey = readCharacterClass(data);
  return {
    id: id ?? data.id ?? null,
    name: data.name || 'Sin nombre',
    species: data.species || 'Humanos',
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
    skills: (data.skills || []).map((s) =>
      typeof s === 'string' ? s : s?.id
    ).filter(Boolean),
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

  if (isHeroCharacter(char)) {
    return {
      hp: char.currentHp ?? char.hp ?? base.hp ?? 0,
      maxHp: char.maxHp ?? base.hp ?? 0,
      defense: base.defense ?? 0,
      attack: base.attack ?? 0,
      damage: base.damage ?? 0,
      force: base.force ?? null
    };
  }

  return {
    hp: char.currentHp ?? char.hp ?? base.hp ?? 0,
    maxHp: char.maxHp ?? base.hp ?? 0,
    defense: char.defense ?? base.defense ?? 0,
    attack: char.attack ?? base.attack ?? 0,
    damage: char.damage ?? base.damage ?? 0,
    force: char.force ?? base.force ?? null
  };
}

export function renderCharacterCard(character, options = {}) {
  const { mini = false, showSkills = true, isNpc = false, copyMentionId = null, boardContext = null } = options;
  const char = normalizeCharacter(character, character?.id);
  const meta = getClassMeta(char.class);
  const stats = resolveCharacterStats(char);
  const displayStats = boardContext
    ? {
        ...stats,
        hp: boardContext.hp ?? stats.hp,
        maxHp: boardContext.maxHp ?? stats.maxHp,
        defense: boardContext.defense ?? stats.defense
      }
    : stats;
  const skills = (char.skills || []).map((s) =>
    typeof s === 'string' ? findSkillById(char.class, s) : s
  ).filter(Boolean);

  const rolSkills = (GAME_DATA.skills[char.class] || [])
    .filter((s) => s.unlockLevel === 'always');

  const card = document.createElement('article');
  card.className = `swrp-card theme-${meta.theme}${mini ? ' swrp-card--mini' : ''}${isNpc ? ' swrp-card--npc' : ''}`;
  card.dataset.class = char.class;

  const attackFmt = formatAttack(stats.attack);
  const forceBlock = meta.hasForce && stats.force != null
    ? `<p class="swrp-card__force"><em>Fuerza: ${stats.force}</em></p>`
    : '';

  const skillItems = showSkills
    ? [...rolSkills, ...skills].map(renderSkillItem).join('')
    : '';

  const npcBadge = isNpc
    ? '<span class="swrp-card__badge-npc">NPC</span>'
    : '';

  const copyIdBtn = copyMentionId
    ? `<button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost swrp-card__copy-id" data-copy-mention="@{${escapeHtml(copyMentionId)}}">Copiar ID</button>`
    : '';

  card.innerHTML = `
    <header class="swrp-card__header">
      <div class="swrp-card__identity">
        <h2 class="swrp-card__name">${escapeHtml(char.name)}${npcBadge}</h2>
        <p class="swrp-card__class">${escapeHtml(meta.label)}</p>
        <p class="swrp-card__species">${escapeHtml(char.species)}${isNpc && char.era ? ` · ${escapeHtml(char.era)}` : ''}</p>
      </div>
      <div class="swrp-card__header-actions">
        ${copyIdBtn}
        <div class="swrp-card__level">
          <span class="swrp-card__level-label">NIVEL</span>
          <div class="swrp-card__hex swrp-card__hex--level">${char.level}</div>
        </div>
      </div>
    </header>
    <div class="swrp-card__body">
      <div class="swrp-card__left">
        <div class="swrp-card__stats">
          ${statRow('P.GOLPE', displayStats.hp, boardContext?.hpDamaged ? 'swrp-card__hex--hp-damaged' : '')}
          ${statRow('DEFENSA', displayStats.defense, boardContext?.defenseInCover ? 'swrp-card__hex--defense-cover' : '')}
          ${statRow('ATAQUE', attackFmt)}
          ${statRow('DAÑO', displayStats.damage)}
        </div>
        ${char.portraitUrl ? `
          <div class="swrp-card__portrait">
            <img src="${escapeHtml(char.portraitUrl)}" alt="${escapeHtml(char.name)}" loading="lazy">
          </div>` : ''}
      </div>
      <div class="swrp-card__skills-panel">
        <h3 class="swrp-card__skills-title">HABILIDADES</h3>
        ${forceBlock}
        <div class="swrp-card__skills-list">${skillItems || '<p class="text-muted small">Sin habilidades seleccionadas</p>'}</div>
      </div>
    </div>
    <footer class="swrp-card__footer">
      <img class="swrp-card__logo" src="${CARD_LOGO_SRC}" alt="Star Wars Expanded RP">
    </footer>
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

  return card;
}

export function renderCharacterTag(snapshot, onClick) {
  if (!snapshot?.name) return null;
  const meta = getClassMeta(snapshot.class);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `swrp-char-tag theme-${meta.theme}`;
  btn.title = 'Ver carta de personaje';
  btn.innerHTML = `
    <span class="swrp-char-tag__name">${escapeHtml(snapshot.name)}</span>
    <span class="swrp-char-tag__level">Nv.${Number(snapshot.level) || 1}</span>`;
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

function renderSkillItem(skill) {
  const badgeClass = skillBadgeClass(skill.type);
  const prefix = skill.type === 'Pasiva' ? '<strong class="skill-type">Pasiva:</strong> ' : '';
  return `
    <div class="swrp-card__skill">
      <span class="swrp-skill-badge ${badgeClass}">${escapeHtml(skill.type)}</span>
      <strong>${escapeHtml(skill.name)}:</strong> ${prefix}${escapeHtml(skill.description)}
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
