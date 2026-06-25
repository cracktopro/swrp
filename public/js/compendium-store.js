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

let progression = null;
let skills = null;
let speciesList = null;
let boardsList = null;
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

function getTargetSeedVersion() {
  return GAME_DATA.COMPENDIUM_SEED_VERSION || 1;
}

export function isCompendiumSeedStale() {
  return firestoreSeedVersion < getTargetSeedVersion();
}

function applyDerivedSeedMerge() {
  const seedSkills = cloneSkills();
  const seedProgression = cloneProgression();
  skills = { ...getCompendiumSkills() };
  progression = { ...getCompendiumProgression() };

  for (const cls of DERIVED_SEED_CLASSES) {
    if (seedSkills[cls]) skills[cls] = seedSkills[cls];
    if (seedProgression[cls]) progression[cls] = seedProgression[cls];
  }
}

async function persistCompendium(partial = {}) {
  await setDoc(COMPENDIUM_DOC, {
    progression: partial.progression ?? getCompendiumProgression(),
    skills: partial.skills ?? getCompendiumSkills(),
    species: partial.species ?? getSpeciesList(),
    boards: partial.boards ?? getCompendiumBoards(),
    seedVersion: partial.seedVersion ?? firestoreSeedVersion,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function loadCompendiumData() {
  if (loaded) return { progression, skills, species: speciesList };
  progression = cloneProgression();
  skills = cloneSkills();
  speciesList = cloneSpecies();
  boardsList = cloneBoards();
  firestoreSeedVersion = 0;

  try {
    const snap = await getDoc(COMPENDIUM_DOC);
    if (snap.exists()) {
      const data = snap.data();
      if (data.progression) progression = data.progression;
      if (data.skills) skills = data.skills;
      if (Array.isArray(data.species) && data.species.length) speciesList = data.species;
      if (Array.isArray(data.boards)) boardsList = data.boards;
      firestoreSeedVersion = data.seedVersion || 0;
    }
  } catch (err) {
    console.warn('loadCompendiumData:', err);
  }

  if (isCompendiumSeedStale()) {
    applyDerivedSeedMerge();
  }

  loaded = true;
  return { progression, skills, species: speciesList, seedStale: isCompendiumSeedStale() };
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
  return skills || cloneSkills();
}

export function getSpeciesList() {
  return speciesList ? [...speciesList] : cloneSpecies();
}

export function getCompendiumBoards() {
  return boardsList ? boardsList.map((b) => ({ ...b })) : [];
}

export async function saveCompendiumBoards(list) {
  boardsList = (list || []).map((b) => normalizeCompendiumBoard(b)).filter(Boolean);
  await persistCompendium({ boards: boardsList });
  return boardsList;
}

export function normalizeCompendiumBoard(raw) {
  if (!raw?.name?.trim() || !raw?.mapUrl?.trim()) return null;
  const cols = Math.min(48, Math.max(4, Math.round(Number(raw.cols) || 24)));
  const rows = Math.min(48, Math.max(4, Math.round(Number(raw.rows) || 16)));
  const cellWidth = Math.min(28, Math.max(12, Math.round(Number(raw.cellWidth ?? raw.cellSize) || 28)));
  const cellHeight = Math.min(28, Math.max(12, Math.round(Number(raw.cellHeight ?? raw.cellSize) || 28)));
  return {
    id: raw.id || `board_${Date.now().toString(36)}`,
    name: String(raw.name).trim(),
    mapUrl: String(raw.mapUrl).trim(),
    cols,
    rows,
    cellWidth,
    cellHeight
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
  return (getCompendiumSkills()[classKey] || []).find((s) => s.id === skillId);
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

export async function saveSpeciesList(list) {
  const trimmed = list.map((s) => String(s).trim()).filter(Boolean);
  if (!trimmed.length) throw new Error('Debe haber al menos una especie.');
  speciesList = trimmed;
  await persistCompendium({ species: speciesList });
}

export async function resetCompendiumToDefaults() {
  progression = cloneProgression();
  skills = cloneSkills();
  speciesList = cloneSpecies();
  boardsList = cloneBoards();
  firestoreSeedVersion = getTargetSeedVersion();
  await persistCompendium({
    progression,
    skills,
    species: speciesList,
    boards: boardsList,
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
