import {
  db,
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from './firebase-config.js';
import { isAdmin } from './auth.js';
import { loadParty } from './party.js';
import { getPartyMember, loadPartyMembers } from './party-members.js';
import { renderCharacterCard } from './character-card.js';
import { loadUserCharacters } from './characters.js';
import { partyPageUrl, boardPageUrl, rememberPartyId } from './party-url.js';
import {
  applyDifficultyCardStyle,
  buildDifficultyCardHtml,
  buildPlayerRangeHtml,
  readDifficulty
} from './escaramuza-templates.js';
import { characterEditUrl } from './character-url.js';
import { NPC_ERAS, DEFAULT_NPC_ERA } from './npcs.js';

export { NPC_ERAS as PARTY_ERAS, DEFAULT_NPC_ERA as DEFAULT_PARTY_ERA };

export function readPartyEra(party) {
  const era = party?.era;
  if (!era) return DEFAULT_NPC_ERA;
  if (NPC_ERAS.includes(era)) return era;
  const normalized = NPC_ERAS.find(
    (candidate) => candidate.toLowerCase() === String(era).toLowerCase()
  );
  return normalized || DEFAULT_NPC_ERA;
}

function unwrapPartyEntry(entry) {
  return entry?.party ?? entry;
}

export function filterPartiesByType(parties, typeFilter = '') {
  if (!typeFilter) return parties || [];
  return (parties || []).filter((entry) => {
    const party = unwrapPartyEntry(entry);
    return (party.type || 'Campaña') === typeFilter;
  });
}

export function filterParties(parties, { nameQ = '', eraQ = '', typeQ = '' } = {}) {
  const needle = String(nameQ).trim().toLowerCase();
  return (parties || []).filter((entry) => {
    const party = unwrapPartyEntry(entry);
    if (typeQ && (party.type || 'Campaña') !== typeQ) return false;
    if (needle && !(party.name || '').toLowerCase().includes(needle)) return false;
    if (eraQ && readPartyEra(party) !== eraQ) return false;
    return true;
  });
}

export { loadUserCharacters };

export async function loadUserPartyIds(userId) {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  const stored = userSnap.data()?.joinedPartyIds;
  if (Array.isArray(stored)) return stored;

  const partiesSnap = await getDocs(collection(db, 'parties'));
  const ids = [];
  for (const partyDoc of partiesSnap.docs) {
    const memberSnap = await getDoc(doc(db, 'parties', partyDoc.id, 'members', userId));
    if (memberSnap.exists()) ids.push(partyDoc.id);
  }

  if (userSnap.exists()) {
    await updateDoc(userRef, { joinedPartyIds: ids });
  }
  return ids;
}

export async function loadUserParties(userId) {
  const ids = [...new Set(await loadUserPartyIds(userId))];
  const parties = await Promise.all(ids.map((id) => loadParty(id)));
  return parties.filter(Boolean);
}

export async function loadAllParties() {
  const snap = await getDocs(collection(db, 'parties'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

export async function createParty(profile, { name, type, era, difficulty, imageUrl = '', description = '' }) {
  if (!isAdmin(profile)) throw new Error('Solo un administrador puede crear partidas');
  const diff = readDifficulty(difficulty);
  if (!diff) throw new Error('Selecciona una dificultad');
  const ref = await addDoc(collection(db, 'parties'), {
    name,
    type,
    era: readPartyEra({ era }),
    difficulty: diff,
    imageUrl: imageUrl.trim(),
    description: description.trim(),
    status: 'active',
    phase: 'narrative',
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateParty(profile, partyId, data) {
  if (!isAdmin(profile)) throw new Error('Solo un administrador puede editar partidas');
  const diff = readDifficulty(data.difficulty);
  if (!diff) throw new Error('Selecciona una dificultad');
  await updateDoc(doc(db, 'parties', partyId), {
    name: data.name.trim(),
    type: data.type,
    era: readPartyEra({ era: data.era }),
    difficulty: diff,
    imageUrl: (data.imageUrl || '').trim(),
    description: (data.description || '').trim(),
    updatedAt: serverTimestamp()
  });
}

export function openParty(partyId) {
  rememberPartyId(partyId);
  window.location.assign(partyPageUrl(partyId));
}

export async function deleteCharacter(userId, charId) {
  const ref = doc(db, 'characters', charId);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().userId !== userId) {
    throw new Error('No puedes eliminar este personaje');
  }
  await deleteDoc(ref);
}

export async function deleteParty(profile, partyId) {
  if (!isAdmin(profile)) throw new Error('Solo un administrador puede eliminar partidas');
  await deleteDoc(doc(db, 'parties', partyId));
}

export function renderCharacterPanel(characters, container, { onDelete } = {}) {
  container.innerHTML = '';

  if (!characters.length) {
    container.innerHTML = '<p class="text-muted">Aún no tienes personajes. ¡Crea el primero!</p>';
    return null;
  }

  const panel = document.createElement('div');
  panel.className = 'swrp-char-panel';
  panel.innerHTML = `
    <label class="form-label swrp-field-label" for="dash-char-select">Seleccionar personaje</label>
    <select class="form-select mb-3" id="dash-char-select"></select>
    <div class="swrp-char-panel__preview" id="dash-char-preview"></div>
    <div class="d-flex gap-2 flex-wrap justify-content-center mt-3" id="dash-char-actions"></div>`;
  container.appendChild(panel);

  const select = panel.querySelector('#dash-char-select');
  const preview = panel.querySelector('#dash-char-preview');
  const actions = panel.querySelector('#dash-char-actions');

  select.innerHTML = characters
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
    .join('');

  function getSelected() {
    return characters.find((c) => c.id === select.value) || characters[0];
  }

  function renderPreview() {
    const char = getSelected();
    preview.innerHTML = '';
    preview.appendChild(renderCharacterCard(char));
  }

  actions.innerHTML = `
    <a href="#" class="btn btn-sm btn-swrp btn-swrp-primary btn-char-edit">Editar</a>
    ${onDelete ? '<button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-delete-char">Eliminar</button>' : ''}`;

  actions.querySelector('.btn-char-edit').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.assign(characterEditUrl(getSelected().id));
  });

  actions.querySelector('.btn-delete-char')?.addEventListener('click', () => onDelete?.(getSelected()));

  select.addEventListener('change', renderPreview);
  renderPreview();

  return {
    getSelected,
    setSelected(id) {
      if (characters.some((c) => c.id === id)) {
        select.value = id;
        renderPreview();
      }
    }
  };
}

export function formatPartyMemberNames(members = []) {
  if (!members.length) return [];
  return members.map((m) => {
    const name = m.username || 'Usuario';
    if (m.playMode === 'gm') return `${name} (GM)`;
    return name;
  });
}

export function renderPartyCard(party, userId, container, { isAdmin, isMember, members = [], onEdit, onDelete } = {}) {
  const el = document.createElement('article');
  el.className = 'swrp-party-card';
  applyDifficultyCardStyle(el, party.difficulty);

  const media = party.imageUrl
    ? `<img class="swrp-party-card__img" src="${escapeAttr(party.imageUrl)}" alt="${escapeAttr(party.name)}" loading="lazy">`
    : `<div class="swrp-party-card__placeholder"><span>${escapeHtml(party.type)}</span></div>`;

  const desc = party.description
    ? `<p class="swrp-party-card__desc">${escapeHtml(party.description)}</p>`
    : '<p class="swrp-party-card__desc swrp-party-card__desc--empty text-muted">Sin descripción.</p>';

  const enterUrl = isMember && party.type === 'Escaramuza'
    ? boardPageUrl(party.id)
    : partyPageUrl(party.id);

  const primaryAction = isMember
    ? `<a href="${enterUrl}" class="btn btn-sm btn-swrp btn-swrp-primary">Entrar</a>`
    : `<a href="${partyPageUrl(party.id)}" class="btn btn-sm btn-swrp btn-swrp-success">Unirse</a>`;

  const memberNames = formatPartyMemberNames(members);
  const slotsLine = party.type === 'Escaramuza'
    ? `<p class="swrp-party-card__meta swrp-party-card__slots">${buildPlayerRangeHtml(party.minPlayers, party.maxSlots)}</p>`
    : '';
  const membersBlock = memberNames.length
    ? `<p class="swrp-party-card__members"><span class="swrp-party-card__members-label">Unidos:</span> ${memberNames.map((n) => escapeHtml(n)).join(', ')}</p>`
    : '<p class="swrp-party-card__members swrp-party-card__members--empty text-muted">Nadie se ha unido aún.</p>';

  const displayTitle = party.templateId && party.creatorUsername
    ? `${party.name} (${party.creatorUsername})`
    : (party.name || '');

  const diffLine = buildDifficultyCardHtml(party.difficulty);
  const diffMeta = `<p class="swrp-party-card__difficulty">${diffLine}</p>`;

  el.innerHTML = `
    <div class="swrp-party-card__media">${media}</div>
    <div class="swrp-party-card__body">
      <h3 class="swrp-party-card__title">${escapeHtml(displayTitle)}</h3>
      <p class="swrp-party-card__meta">${escapeHtml(party.type)} · <span class="swrp-card__era-label">Era:</span> ${escapeHtml(readPartyEra(party))}</p>
      ${diffMeta}
      ${slotsLine}
      ${membersBlock}
      ${desc}
      <div class="swrp-party-card__actions">
        ${primaryAction}
        ${isAdmin && onEdit ? '<button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost btn-party-edit">Opciones</button>' : ''}
        ${isAdmin && onDelete ? '<button type="button" class="btn btn-sm btn-swrp btn-swrp-danger btn-party-delete">Eliminar</button>' : ''}
      </div>
    </div>`;

  el.querySelector('.btn-party-edit')?.addEventListener('click', () => onEdit(party));
  el.querySelector('.btn-party-delete')?.addEventListener('click', () => onDelete(party));
  container.appendChild(el);
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
