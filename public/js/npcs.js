import {
  db,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from './firebase-config.js';

export const NPC_ERAS = [
  'Antigua República',
  'República',
  'Guerra Civil Galáctica',
  'Nueva República'
];

export const DEFAULT_NPC_ERA = 'República';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function readNpcEra(npc) {
  const era = npc?.era;
  return NPC_ERAS.includes(era) ? era : DEFAULT_NPC_ERA;
}

export function readNpcClassKey(npc) {
  return npc?.classKey || npc?.class || '';
}

export function filterNpcs(npcs, { nameQ = '', classQ = '', eraQ = '' } = {}) {
  const name = String(nameQ).trim().toLowerCase();
  return (npcs || []).filter((npc) => {
    if (name && !(npc.name || '').toLowerCase().includes(name)) return false;
    if (classQ && readNpcClassKey(npc) !== classQ) return false;
    if (eraQ && readNpcEra(npc) !== eraQ) return false;
    return true;
  });
}

export function buildNpcEraSelectOptions({ emptyLabel = 'Todas las eras', selected = '' } = {}) {
  const empty = emptyLabel
    ? `<option value="">${escapeHtml(emptyLabel)}</option>`
    : '';
  const options = NPC_ERAS.map((era) => {
    const sel = era === selected ? ' selected' : '';
    return `<option value="${escapeHtml(era)}"${sel}>${escapeHtml(era)}</option>`;
  });
  return empty + options.join('');
}

export function buildNpcEraFormOptions(selected = DEFAULT_NPC_ERA) {
  return NPC_ERAS.map((era) => {
    const sel = era === selected ? ' selected' : '';
    return `<option value="${escapeHtml(era)}"${sel}>${escapeHtml(era)}</option>`;
  }).join('');
}

export async function loadAllNpcs() {
  const snap = await getDocs(collection(db, 'npcs'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

export async function loadNpcById(npcId) {
  const snap = await getDoc(doc(db, 'npcs', npcId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createNpc(data) {
  const ref = await addDoc(collection(db, 'npcs'), {
    ...data,
    era: readNpcEra(data),
    type: 'NPC',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateNpc(npcId, data) {
  await updateDoc(doc(db, 'npcs', npcId), {
    ...data,
    era: readNpcEra(data),
    updatedAt: serverTimestamp()
  });
}

export async function deleteNpc(npcId) {
  await deleteDoc(doc(db, 'npcs', npcId));
}

export function npcToCardData(npc) {
  return {
    ...npc,
    era: readNpcEra(npc),
    image: npc.portraitUrl || npc.image || '',
    portraitUrl: npc.portraitUrl || npc.image || ''
  };
}

/** Objeto listo para snapshot de membresía / carta (escaramuza con NPC). */
export function npcToMembershipCharacter(npc) {
  const card = npcToCardData(npc);
  const classKey = readNpcClassKey(npc);
  return {
    ...card,
    id: npc.id,
    class: classKey,
    classKey,
    type: 'NPC',
    currentHp: npc.currentHp ?? npc.hp ?? npc.maxHp,
    maxHp: npc.maxHp ?? npc.hp,
    hp: npc.currentHp ?? npc.hp ?? npc.maxHp
  };
}

function nameInitials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function renderNpcPickerRow(npc, { selected = false, classMeta } = {}) {
  const meta = classMeta || {};
  const theme = meta.theme || 'soldado';
  const color = meta.color || '#00e5ff';
  const classLabel = meta.label || readNpcClassKey(npc) || '—';
  const url = npc.portraitUrl || npc.image || '';
  const era = readNpcEra(npc);
  const species = npc.species || 'Humanos';
  const thumb = url
    ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">`
    : `<span class="swrp-npc-picker-row__initials">${escapeHtml(nameInitials(npc.name))}</span>`;

  return `
    <button type="button"
      class="swrp-npc-picker-row theme-${escapeHtml(theme)}${selected ? ' is-selected' : ''}"
      data-npc-id="${escapeHtml(npc.id)}"
      style="--npc-class-color:${escapeHtml(color)}">
      <span class="swrp-npc-picker-row__thumb theme-${escapeHtml(theme)}">${thumb}</span>
      <span class="swrp-npc-picker-row__body">
        <span class="swrp-npc-picker-row__name">${escapeHtml(npc.name || 'Sin nombre')}</span>
        <span class="swrp-npc-picker-row__meta">
          <span>${escapeHtml(classLabel)}</span>
          <span class="swrp-npc-picker-row__dot" aria-hidden="true">·</span>
          <span>${escapeHtml(species)}</span>
          <span class="swrp-npc-picker-row__dot" aria-hidden="true">·</span>
          <span><span class="swrp-card__era-label">Era:</span> ${escapeHtml(era)}</span>
        </span>
      </span>
    </button>`;
}
