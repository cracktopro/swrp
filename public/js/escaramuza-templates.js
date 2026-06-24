import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  serverTimestamp
} from './firebase-config.js';
import { DEFAULT_NPC_ERA, NPC_ERAS } from './npcs.js';
import {
  joinParty,
  getPartyMember,
  memberToActiveCharacter,
  tokenFromCharacter,
  loadPartyMembers
} from './party-members.js';
import { normalizeBoardToken } from './board-vision.js';
import { CELL, DEFAULT_COLS, DEFAULT_ROWS } from './board.js';
import { appUrl } from './app-path.js';

const COLLECTION = 'escaramuzaTemplates';

export const ESCARAMUZA_DIFFICULTIES = [
  { id: 'padawan', label: 'Padawan', subtitle: 'Fácil', color: '#39ff14' },
  { id: 'jedi', label: 'Jedi', subtitle: 'Normal', color: '#00e5ff' },
  { id: 'caballero', label: 'Caballero Jedi', subtitle: 'Difícil', color: '#b24bf3' },
  { id: 'maestro', label: 'Maestro Jedi', subtitle: 'Muy Difícil', color: '#ff8c42' }
];

export const DEFAULT_ESCARAMUZA_DIFFICULTY = 'jedi';

export function readDifficulty(value) {
  const id = String(value || '').trim();
  return ESCARAMUZA_DIFFICULTIES.find((d) => d.id === id)?.id || null;
}

export function getDifficultyMeta(value) {
  const id = readDifficulty(value);
  return ESCARAMUZA_DIFFICULTIES.find((d) => d.id === id) || null;
}

export function formatDifficultyLabel(value) {
  const meta = getDifficultyMeta(resolveDifficulty(value));
  if (!meta) return '';
  return `${meta.label} · ${meta.subtitle}`;
}

export function buildDifficultyFormOptions(selected = DEFAULT_ESCARAMUZA_DIFFICULTY) {
  const current = readDifficulty(selected) || DEFAULT_ESCARAMUZA_DIFFICULTY;
  return ESCARAMUZA_DIFFICULTIES.map(
    (d) => `<option value="${d.id}"${d.id === current ? ' selected' : ''}>${d.label} — ${d.subtitle}</option>`
  ).join('');
}

export function resolveDifficulty(value) {
  return readDifficulty(value) || DEFAULT_ESCARAMUZA_DIFFICULTY;
}

export function applyDifficultyCardStyle(el, difficulty) {
  if (!el) return;
  ESCARAMUZA_DIFFICULTIES.forEach((d) => el.classList.remove(`swrp-difficulty-card--${d.id}`));
  const meta = getDifficultyMeta(resolveDifficulty(difficulty));
  if (!meta) return;
  el.classList.add(`swrp-difficulty-card--${meta.id}`);
  el.style.setProperty('--difficulty-color', meta.color);
  el.dataset.difficulty = meta.id;
}

function stripUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined);
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    const cleaned = stripUndefinedDeep(val);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function readTemplateEra(era) {
  if (!era) return DEFAULT_NPC_ERA;
  if (NPC_ERAS.includes(era)) return era;
  const normalized = NPC_ERAS.find(
    (candidate) => candidate.toLowerCase() === String(era).toLowerCase()
  );
  return normalized || DEFAULT_NPC_ERA;
}

function uniqueTokenId(template) {
  const base = `${template.kind || 'token'}_${template.sourceId || 'x'}`;
  return `${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function validateEscaramuzaTemplate({
  name,
  boardLayout,
  minPlayers,
  maxSlots,
  allySpawns,
  difficulty
}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Indica un nombre para la escaramuza');

  if (!readDifficulty(difficulty)) {
    throw new Error('Selecciona una dificultad');
  }

  const min = Number(minPlayers);
  const max = Number(maxSlots);
  if (!Number.isFinite(min) || min < 1) {
    throw new Error('El mínimo de jugadores debe ser al menos 1');
  }
  if (!Number.isFinite(max) || max < min) {
    throw new Error('El máximo de plazas debe ser mayor o igual al mínimo de jugadores');
  }

  const enemies = (boardLayout?.tokens || []).filter((t) => t.side === 'enemy');
  if (!enemies.length) {
    throw new Error('Debes colocar al menos un enemigo en el tablero');
  }

  const spawns = Array.isArray(allySpawns) ? allySpawns : [];
  if (spawns.length < min) {
    throw new Error(`Necesitas al menos ${min} spawn(s) de aliado (tienes ${spawns.length})`);
  }
}

export function buildLayoutFromBoard(board, { enemyOnly = true } = {}) {
  const tokens = enemyOnly
    ? board.tokens.filter((t) => t.side === 'enemy')
    : board.tokens;
  return stripUndefinedDeep({
    tokens: tokens.map((t) => stripUndefinedDeep({ ...t })),
    mapUrl: board._mapUrl ?? null,
    grid: {
      cols: board.cols,
      rows: board.rows,
      cellSize: CELL
    }
  });
}

export function buildFreshBoardState(boardLayout) {
  const layout = boardLayout || {};
  return stripUndefinedDeep({
    tokens: (layout.tokens || []).map((t) => normalizeBoardToken({ ...t })),
    mapUrl: layout.mapUrl ?? null,
    grid: layout.grid || { cols: DEFAULT_COLS, rows: DEFAULT_ROWS, cellSize: CELL },
    combatStarted: false,
    log: [],
    initiativeLog: [],
    initiativeOpen: false,
    turnOrder: [],
    turnOrderIndex: 0,
    activeTurn: null,
    turnActions: {
      movesUsed: 0,
      attacksUsed: 0,
      activeMode: null,
      bonusMoves: 0,
      bonusAttacks: 0
    }
  });
}

function cloneTokensForInstance(tokens) {
  return (tokens || []).map((t) => normalizeBoardToken({
    ...t,
    id: uniqueTokenId(t)
  }));
}

export async function loadAllEscaramuzaTemplates() {
  const snap = await getDocs(collection(db, COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

export async function loadUserEscaramuzaTemplates(userId) {
  const q = query(collection(db, COLLECTION), where('creatorId', '==', userId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aMs = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const bMs = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    });
}

export async function loadCommunityEscaramuzaTemplates(userId) {
  const all = await loadAllEscaramuzaTemplates();
  return all
    .filter((t) => t.creatorId !== userId)
    .sort((a, b) => {
      const aMs = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const bMs = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    });
}

export async function loadEscaramuzaTemplate(templateId) {
  const snap = await getDoc(doc(db, COLLECTION, templateId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function saveEscaramuzaTemplate(userId, username, data, templateId = null) {
  const payload = stripUndefinedDeep({
    creatorId: userId,
    creatorUsername: username || 'Usuario',
    name: String(data.name || '').trim(),
    imageUrl: String(data.imageUrl || '').trim(),
    description: String(data.description || '').trim(),
    era: readTemplateEra(data.era),
    difficulty: readDifficulty(data.difficulty) || DEFAULT_ESCARAMUZA_DIFFICULTY,
    minPlayers: Number(data.minPlayers) || 1,
    maxSlots: Number(data.maxSlots) || 1,
    allySpawns: (data.allySpawns || []).map((s) => ({ col: s.col, row: s.row })),
    boardLayout: data.boardLayout,
    updatedAt: serverTimestamp()
  });

  validateEscaramuzaTemplate({
    name: payload.name,
    boardLayout: payload.boardLayout,
    minPlayers: payload.minPlayers,
    maxSlots: payload.maxSlots,
    allySpawns: payload.allySpawns,
    difficulty: payload.difficulty
  });

  if (templateId) {
    const existing = await loadEscaramuzaTemplate(templateId);
    if (!existing) throw new Error('Plantilla no encontrada');
    if (existing.creatorId !== userId) throw new Error('No puedes editar esta plantilla');
    await updateDoc(doc(db, COLLECTION, templateId), payload);
    return templateId;
  }

  const ref = await addDoc(collection(db, COLLECTION), {
    ...payload,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function deleteEscaramuzaTemplate(userId, templateId) {
  const existing = await loadEscaramuzaTemplate(templateId);
  if (!existing) throw new Error('Plantilla no encontrada');
  if (existing.creatorId !== userId) throw new Error('No puedes eliminar esta plantilla');
  await deleteDoc(doc(db, COLLECTION, templateId));
}

export async function placeMemberTokenAtSpawn(partyId, member, col, row) {
  const char = memberToActiveCharacter(member);
  if (!char) return;

  const ref = doc(db, 'parties', partyId, 'state', 'board');
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : { tokens: [] };
  const tokens = (data.tokens || []).map((t) => normalizeBoardToken({ ...t }));

  const occupied = tokens.some((t) => t.col === col && t.row === row);
  if (occupied) throw new Error('La celda de spawn está ocupada');

  const template = tokenFromCharacter(char);
  const token = normalizeBoardToken({
    ...template,
    id: uniqueTokenId(template),
    col,
    row,
    side: 'ally',
    facing: 'left',
    spawnCol: col,
    spawnRow: row
  });

  await setDoc(ref, {
    tokens: [...tokens, stripUndefinedDeep(token)],
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function getCharacterMemberSpawnIndex(members, userId) {
  const chars = members.filter(
    (m) => m.characterSnapshot?.id && (m.playMode === 'character' || m.playMode === 'gm')
  );
  return chars.findIndex((m) => m.userId === userId);
}

export async function assignSpawnToMember(party, partyId, userId) {
  const spawns = party.allySpawns || [];
  if (!spawns.length) return;

  const members = await loadPartyMembers(partyId);
  const index = getCharacterMemberSpawnIndex(members, userId);
  if (index < 0) return;

  const spawn = spawns[index];
  if (!spawn) throw new Error('No hay spawn disponible para tu personaje');

  const member = members.find((m) => m.userId === userId);
  if (!member) return;

  await placeMemberTokenAtSpawn(partyId, member, spawn.col, spawn.row);
}

export async function createEscaramuzaFromTemplate(user, profile, templateId, character) {
  const template = await loadEscaramuzaTemplate(templateId);
  if (!template) throw new Error('Plantilla no encontrada');
  if (!character?.id) throw new Error('Selecciona un personaje');

  const ref = await addDoc(collection(db, 'parties'), {
    name: template.name,
    type: 'Escaramuza',
    era: readTemplateEra(template.era),
    imageUrl: template.imageUrl || '',
    description: template.description || '',
    status: 'active',
    phase: 'board',
    templateId,
    difficulty: readDifficulty(template.difficulty) || DEFAULT_ESCARAMUZA_DIFFICULTY,
    createdBy: user.uid,
    creatorUsername: profile?.username || user.displayName || user.email || 'Usuario',
    minPlayers: template.minPlayers || 1,
    maxSlots: template.maxSlots || 1,
    allySpawns: template.allySpawns || [],
    createdAt: serverTimestamp()
  });

  await joinParty(ref.id, user, profile, { playMode: 'gm', character });

  const boardState = buildFreshBoardState(template.boardLayout);
  boardState.tokens = cloneTokensForInstance(boardState.tokens);

  await setDoc(doc(db, 'parties', ref.id, 'state', 'board'), {
    ...boardState,
    updatedAt: serverTimestamp()
  });

  const party = { allySpawns: template.allySpawns || [] };
  await assignSpawnToMember(party, ref.id, user.uid);

  return ref.id;
}

export function renderTemplatePickCard(template, { selected = false, onSelect } = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `swrp-template-pick-card${selected ? ' is-selected' : ''}`;
  el.dataset.templateId = template.id;
  applyDifficultyCardStyle(el, template.difficulty);

  const media = template.imageUrl
    ? `<img class="swrp-template-pick-card__img" src="${escapeAttr(template.imageUrl)}" alt="" loading="lazy">`
    : `<div class="swrp-template-pick-card__placeholder">Escaramuza</div>`;

  const diffLine = formatDifficultyLabel(template.difficulty);
  const diffMeta = `<span class="swrp-template-pick-card__difficulty">${escapeHtml(diffLine)}</span>`;

  el.innerHTML = `
    <div class="swrp-template-pick-card__media">${media}</div>
    <div class="swrp-template-pick-card__body">
      <strong class="swrp-template-pick-card__name">${escapeHtml(template.name)}</strong>
      ${diffMeta}
      <span class="swrp-template-pick-card__meta">Por ${escapeHtml(template.creatorUsername || 'Usuario')}</span>
      <p class="swrp-template-pick-card__desc">${escapeHtml(template.description || 'Sin descripción.')}</p>
    </div>`;

  el.addEventListener('click', () => onSelect?.(template));
  return el;
}

export function renderEscaramuzaListCard(template, { mode = 'mine', userId, onDelete } = {}) {
  const card = document.createElement('article');
  card.className = 'swrp-party-card mb-3';
  applyDifficultyCardStyle(card, template.difficulty);

  const media = template.imageUrl
    ? `<img class="swrp-party-card__img" src="${escapeAttr(template.imageUrl)}" alt="" loading="lazy">`
    : '<div class="swrp-party-card__placeholder"><span>Escaramuza</span></div>';

  const diffLine = formatDifficultyLabel(template.difficulty);
  const diffMeta = ` · ${escapeHtml(diffLine)}`;
  const creatorMeta = mode === 'community'
    ? `<p class="swrp-party-card__meta">Por ${escapeHtml(template.creatorUsername || 'Usuario')}</p>`
    : '';

  const editHref = mode === 'community'
    ? appUrl(`map-editor?fork=${encodeURIComponent(template.id)}`)
    : appUrl(`map-editor?template=${encodeURIComponent(template.id)}`);

  const editLabel = 'Editar';
  const deleteBtn = mode === 'mine'
    ? '<button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-delete-template">Eliminar</button>'
    : '';

  card.innerHTML = `
    <div class="swrp-party-card__media">${media}</div>
    <div class="swrp-party-card__body">
      <h3 class="swrp-party-card__title">${escapeHtml(template.name)}</h3>
      <p class="swrp-party-card__meta">${template.minPlayers || 1}–${template.maxSlots || 1} jugadores · ${template.allySpawns?.length || 0} spawns${diffMeta}</p>
      ${creatorMeta}
      <p class="swrp-party-card__desc">${escapeHtml(template.description || 'Sin descripción.')}</p>
      <div class="swrp-party-card__actions">
        <a href="${editHref}" class="btn btn-sm btn-swrp btn-swrp-primary">${editLabel}</a>
        ${deleteBtn}
      </div>
    </div>`;

  card.querySelector('.btn-delete-template')?.addEventListener('click', () => onDelete?.(template));
  return card;
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
