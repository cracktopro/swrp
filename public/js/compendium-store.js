import { GAME_DATA, getClassList, getUnlockableSkillLevels, formatAttack } from './game-data.js';
import {
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from './firebase-config.js';

const COMPENDIUM_DOC = doc(db, 'compendium', 'data');

const DERIVED_SEED_CLASSES = ['Guerrero Sith', 'Inquisidor Sith', 'Cazarrecompensas'];

/** Habilidades personalizadas de NPC (no ligadas a una clase de juego). */
export const CUSTOM_SKILLS_CLASS = 'Otros';

let progression = null;
let skills = null;
let speciesList = null;
let boardsList = null;
let itemsList = null;
let firestoreSeedVersion = 0;
let loaded = false;

function cloneProgression() {
  return JSON.parse(JSON.stringify(GAME_DATA.progression));
}

function cloneSkills() {
  return JSON.parse(JSON.stringify(GAME_DATA.skills));
}

function cloneSpecies() {
  return [...(GAME_DATA.SPECIES_LIST || [])];
}

function cloneBoards() {
  return [];
}

function cloneItems() {
  return [];
}

function ensureCustomSkillsBucket(current) {
  if (!current[CUSTOM_SKILLS_CLASS]) current[CUSTOM_SKILLS_CLASS] = [];
  return current;
}

export function getCustomSkills() {
  return [...(getCompendiumSkills()[CUSTOM_SKILLS_CLASS] || [])];
}

export function getSkillsClassList() {
  return getClassList();
}

export function generateCustomSkillId(name) {
  const slug = String(name || 'habilidad')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'habilidad';
  return `otros-${slug}-${Date.now().toString(36)}`;
}

export function normalizeCustomSkill(raw) {
  const type = raw?.type === 'Pasiva' ? 'Pasiva' : 'Activa';
  const name = String(raw?.name || '').trim();
  return {
    id: String(raw?.id || generateCustomSkillId(name)).trim(),
    name,
    type,
    description: String(raw?.description || '').trim(),
    class: CUSTOM_SKILLS_CLASS,
    unlockLevel: 1,
    forceCost: 0,
    custom: true
  };
}

export function findCustomSkillById(skillId) {
  return (getCompendiumSkills()[CUSTOM_SKILLS_CLASS] || []).find((s) => s.id === skillId) || null;
}

export function isCustomSkillId(skillId) {
  return !!findCustomSkillById(skillId);
}

function getTargetSeedVersion() {
  return GAME_DATA.COMPENDIUM_SEED_VERSION || 1;
}

export function isCompendiumSeedStale() {
  return firestoreSeedVersion < getTargetSeedVersion();
}

function applyDerivedSeedMerge() {
  const seedSkills = cloneSkills();
  const seedProgression = cloneProgression();
  const otros = getCompendiumSkills()[CUSTOM_SKILLS_CLASS] || [];
  skills = { ...getCompendiumSkills() };
  progression = { ...getCompendiumProgression() };

  for (const cls of DERIVED_SEED_CLASSES) {
    if (seedSkills[cls]) skills[cls] = seedSkills[cls];
    if (seedProgression[cls]) progression[cls] = seedProgression[cls];
  }
  skills[CUSTOM_SKILLS_CLASS] = otros;
  ensureCustomSkillsBucket(skills);
}

async function persistCompendium(partial = {}) {
  await setDoc(COMPENDIUM_DOC, {
    progression: partial.progression ?? getCompendiumProgression(),
    skills: partial.skills ?? getCompendiumSkills(),
    species: partial.species ?? getSpeciesList(),
    boards: partial.boards ?? getCompendiumBoards(),
    items: partial.items ?? getCompendiumItems(),
    seedVersion: partial.seedVersion ?? firestoreSeedVersion,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function loadCompendiumData() {
  if (loaded) {
    return {
      progression,
      skills,
      species: speciesList,
      boards: getCompendiumBoards(),
      seedStale: isCompendiumSeedStale()
    };
  }
  progression = cloneProgression();
  skills = cloneSkills();
  speciesList = cloneSpecies();
  boardsList = cloneBoards();
  itemsList = cloneItems();
  firestoreSeedVersion = 0;

  try {
    const snap = await getDoc(COMPENDIUM_DOC);
    if (snap.exists()) {
      const data = snap.data();
      if (data.progression) progression = data.progression;
      if (data.skills) skills = data.skills;
      if (Array.isArray(data.species) && data.species.length) speciesList = data.species;
      if (Array.isArray(data.boards)) boardsList = data.boards;
      if (Array.isArray(data.items)) itemsList = data.items;
      firestoreSeedVersion = data.seedVersion || 0;
    }
  } catch (err) {
    console.warn('loadCompendiumData:', err);
  }

  if (isCompendiumSeedStale()) {
    applyDerivedSeedMerge();
  }

  ensureCustomSkillsBucket(skills);
  const seedProg = cloneProgression();
  if (!progression[CUSTOM_SKILLS_CLASS] && seedProg[CUSTOM_SKILLS_CLASS]) {
    progression[CUSTOM_SKILLS_CLASS] = seedProg[CUSTOM_SKILLS_CLASS];
  }
  loaded = true;
  return {
    progression,
    skills,
    species: speciesList,
    boards: getCompendiumBoards(),
    seedStale: isCompendiumSeedStale()
  };
}

/** Admin: escribe en Firestore las clases derivadas desde game-data.js */
export async function syncCompendiumSeed() {
  applyDerivedSeedMerge();
  firestoreSeedVersion = getTargetSeedVersion();
  await persistCompendium({
    progression,
    skills,
    species: getSpeciesList(),
    boards: getCompendiumBoards(),
    seedVersion: firestoreSeedVersion
  });
}

export function getCompendiumProgression() {
  return progression || cloneProgression();
}

export function getCompendiumSkills() {
  const data = skills || cloneSkills();
  ensureCustomSkillsBucket(data);
  return data;
}

export function getSpeciesList() {
  return speciesList ? [...speciesList] : cloneSpecies();
}

export function getCompendiumBoards() {
  return boardsList ? boardsList.map((b) => ({ ...b })) : [];
}

export const ITEM_TYPES = ['Equipo', 'Consumible', 'Sin utilidad'];

/** Estadísticas que un objeto puede afectar (clave interna → etiqueta). */
export const ITEM_STAT_DEFS = [
  { key: 'hp', label: 'Puntos de Golpe' },
  { key: 'defense', label: 'Defensa' },
  { key: 'attack', label: 'Ataque' },
  { key: 'damage', label: 'Daño' },
  { key: 'force', label: 'Fuerza' }
];

export function getCompendiumItems() {
  return itemsList ? itemsList.map((it) => ({ ...it })) : [];
}

export function getItemById(itemId) {
  if (!itemId) return null;
  return (itemsList || []).find((it) => it.id === itemId) || null;
}

export function normalizeCompendiumItem(raw) {
  const name = String(raw?.name || '').trim();
  if (!name) return null;
  const type = ITEM_TYPES.includes(raw?.type) ? raw.type : 'Sin utilidad';
  const item = {
    id: raw.id || `item_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    name,
    description: String(raw?.description || '').trim(),
    imageUrl: String(raw?.imageUrl || '').trim(),
    type,
    weight: Math.max(0, Number(raw?.weight) || 0),
    price: Math.max(0, Math.round(Number(raw?.price) || 0))
  };
  if (type === 'Equipo' || type === 'Consumible') {
    // «Ninguna» (stat sin efecto) solo es válida para consumibles narrativos.
    const isNone = type === 'Consumible' && (raw?.stat === 'none' || raw?.stat === 'Ninguna');
    const statKey = isNone
      ? 'none'
      : (ITEM_STAT_DEFS.some((s) => s.key === raw?.stat) ? raw.stat : 'hp');
    item.stat = statKey;
    item.statBonus = statKey === 'none' ? 0 : Math.round(Number(raw?.statBonus) || 0);
  }
  if (type === 'Consumible') {
    item.temporary = item.stat !== 'none' && (raw?.temporary === true || raw?.temporary === 'true');
  }
  if (type === 'Equipo') {
    // Clase que puede equiparlo ('all' = todas) y nivel mínimo (1-20).
    const classKeys = getClassList().map((c) => c.key);
    const eq = raw?.equipClass;
    item.equipClass = (eq === 'all' || classKeys.includes(eq)) ? eq : 'all';
    item.equipLevel = Math.min(20, Math.max(1, Math.round(Number(raw?.equipLevel) || 1)));
  }
  return item;
}

export async function saveCompendiumItems(list) {
  itemsList = (list || []).map((it) => normalizeCompendiumItem(it)).filter(Boolean);
  await persistCompendium({ items: itemsList });
  return itemsList;
}

export async function saveCompendiumBoards(list) {
  boardsList = (list || []).map((b) => normalizeCompendiumBoard(b)).filter(Boolean);
  await persistCompendium({ boards: boardsList });
  return boardsList;
}

export async function refreshCompendiumBoards() {
  try {
    const snap = await getDoc(COMPENDIUM_DOC);
    if (snap.exists() && Array.isArray(snap.data().boards)) {
      boardsList = snap.data().boards;
    }
  } catch (err) {
    console.warn('refreshCompendiumBoards:', err);
  }
  return getCompendiumBoards();
}

export function normalizeCompendiumBoard(raw) {
  if (!raw?.name?.trim() || !raw?.mapUrl?.trim()) return null;
  const cols = Math.min(48, Math.max(4, Math.round(Number(raw.cols) || 24)));
  const rows = Math.min(48, Math.max(4, Math.round(Number(raw.rows) || 16)));
  return {
    id: raw.id || `board_${Date.now().toString(36)}`,
    name: String(raw.name).trim(),
    mapUrl: String(raw.mapUrl).trim(),
    cols,
    rows,
    cellWidth: 48,
    cellHeight: 48
  };
}

export function getStats(classKey, level) {
  const table = getCompendiumProgression()[classKey];
  if (!table) return null;
  return table[level] || table[20];
}

export function getSkillsForClass(classKey, characterLevel) {
  const all = getCompendiumSkills()[classKey] || [];
  return all.filter((s) => {
    if (s.unlockLevel === 'always') return true;
    return s.unlockLevel <= characterLevel;
  });
}

export function findSkillById(classKey, skillId) {
  const fromClass = (getCompendiumSkills()[classKey] || []).find((s) => s.id === skillId);
  if (fromClass) return fromClass;
  return findCustomSkillById(skillId);
}

export async function saveClassProgression(classKey, levelStats) {
  const current = getCompendiumProgression();
  current[classKey] = levelStats;
  progression = current;
  await persistCompendium({ progression: current });
}

export async function saveClassSkills(classKey, skillList) {
  const current = getCompendiumSkills();
  current[classKey] = skillList;
  skills = current;
  await persistCompendium({ skills: current });
}

export async function mergeCustomSkills(newSkills) {
  const merged = [...getCustomSkills()];
  for (const raw of newSkills || []) {
    const skill = normalizeCustomSkill(raw);
    if (!skill.name) continue;
    const idx = merged.findIndex((s) => s.id === skill.id);
    if (idx >= 0) merged[idx] = skill;
    else merged.push(skill);
  }
  await saveClassSkills(CUSTOM_SKILLS_CLASS, merged);
  return merged;
}

export async function saveSpeciesList(list) {
  const trimmed = list.map((s) => String(s).trim()).filter(Boolean);
  if (!trimmed.length) throw new Error('Debe haber al menos una especie.');
  speciesList = trimmed;
  await persistCompendium({ species: speciesList });
}

export async function resetCompendiumToDefaults() {
  const otros = getCustomSkills();
  const items = getCompendiumItems();
  progression = cloneProgression();
  skills = cloneSkills();
  skills[CUSTOM_SKILLS_CLASS] = otros;
  speciesList = cloneSpecies();
  boardsList = cloneBoards();
  itemsList = items;
  firestoreSeedVersion = getTargetSeedVersion();
  await persistCompendium({
    progression,
    skills,
    species: speciesList,
    boards: boardsList,
    items: itemsList,
    seedVersion: firestoreSeedVersion
  });
}

export function skillTypeBadgeClass(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'rol') return 'swrp-skill-badge--rol';
  if (t === 'pasiva') return 'swrp-skill-badge--pasiva';
  return 'swrp-skill-badge--activa';
}

export { getClassList, getUnlockableSkillLevels, formatAttack, GAME_DATA };
