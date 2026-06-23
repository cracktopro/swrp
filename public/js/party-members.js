import {
  db,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  arrayUnion,
  serverTimestamp
} from './firebase-config.js';
import { normalizeCharacter, getClassMeta } from './character-card.js';
import { docToCharacter } from './characters.js';

export async function getPartyMember(partyId, userId) {
  if (!partyId || !userId) return null;
  const snap = await getDoc(doc(db, 'parties', partyId, 'members', userId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function loadPartyMembers(partyId) {
  const snap = await getDocs(collection(db, 'parties', partyId, 'members'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function getPartyGM(members) {
  return members.find((m) => m.playMode === 'gm') || null;
}

export function isPartyGMUser(members, userId) {
  const gm = getPartyGM(members);
  return gm?.userId === userId;
}

export function isPartyMemberUser(members, userId) {
  return members.some((m) => m.userId === userId);
}

function omitUndefinedFields(obj) {
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) out[key] = val;
  }
  return out;
}

export function buildCharacterSnapshot(character) {
  const c = normalizeCharacter(character, character.id);
  return omitUndefinedFields({
    id: c.id,
    name: c.name,
    species: c.species || 'Humanos',
    class: c.class,
    level: c.level,
    type: c.type,
    portraitUrl: c.portraitUrl || '',
    skills: c.skills || [],
    attack: c.attack,
    defense: c.defense,
    damage: c.damage,
    hp: c.currentHp ?? c.hp,
    maxHp: c.maxHp,
    force: c.force
  });
}

export async function joinParty(partyId, user, profile, { playMode, character }) {
  const existing = await getPartyMember(partyId, user.uid);
  if (existing) throw new Error('Ya estás unido a esta partida');

  const members = await loadPartyMembers(partyId);
  if (playMode === 'gm') {
    const gm = getPartyGM(members);
    if (gm) throw new Error('Esta partida ya tiene un GM asignado');
  } else {
    if (!character?.id) throw new Error('Selecciona un personaje para unirte');
  }

  const { characterId, characterSnapshot } = resolveMembershipCharacter(playMode, character);

  const payload = {
    userId: user.uid,
    username: profile?.username || user.displayName || user.email,
    playMode,
    characterId,
    characterSnapshot,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, 'parties', partyId, 'members', user.uid), payload);
  await updateDoc(doc(db, 'users', user.uid), { joinedPartyIds: arrayUnion(partyId) });
  return payload;
}

export async function updatePartyMembership(partyId, userId, user, profile, { playMode, character }) {
  const member = await getPartyMember(partyId, userId);
  if (!member) throw new Error('No estás unido a esta partida');

  const members = await loadPartyMembers(partyId);
  if (playMode === 'gm') {
    const gm = getPartyGM(members);
    if (gm && gm.userId !== userId) {
      throw new Error('Solo el GM actual puede usar el rol de GM');
    }
  } else if (!character?.id) {
    throw new Error('Selecciona un personaje');
  }

  const { characterId, characterSnapshot } = resolveMembershipCharacter(playMode, character);

  await setDoc(doc(db, 'parties', partyId, 'members', userId), {
    userId,
    username: profile?.username || user.displayName || user.email,
    playMode,
    characterId,
    characterSnapshot,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Personajes unidos a la partida (jugadores y GM con personaje asignado). */
export function getJoinedCharacterRoster(members) {
  return members
    .filter((m) => m.characterSnapshot?.id)
    .map((m) => normalizeCharacter(m.characterSnapshot, m.characterSnapshot.id));
}

export function memberToActiveCharacter(member) {
  if (!member?.characterSnapshot?.id) return null;
  return normalizeCharacter(
    member.characterSnapshot,
    member.characterId || member.characterSnapshot.id
  );
}

function resolveMembershipCharacter(playMode, character) {
  const hasChar = !!character?.id;
  if (playMode === 'character' && !hasChar) {
    throw new Error('Selecciona un personaje');
  }
  return {
    characterId: hasChar ? character.id : null,
    characterSnapshot: hasChar ? buildCharacterSnapshot(character) : null
  };
}

export function tokenFromCharacter(char, kind = 'character') {
  const meta = getClassMeta(char.class);
  return {
    id: `char_${char.id}`,
    sourceId: char.id,
    kind,
    name: char.name,
    level: char.level,
    class: char.class,
    classLabel: meta.label,
    theme: meta.theme,
    color: meta.color,
    portraitUrl: char.portraitUrl || '',
    side: 'ally',
    characterSnapshot: buildCharacterSnapshot(char)
  };
}

export function tokenFromNpc(npc) {
  const meta = getClassMeta(npc.class);
  return {
    id: `npc_${npc.id}`,
    sourceId: npc.id,
    kind: 'npc',
    name: npc.name,
    level: npc.level,
    class: npc.class,
    classLabel: meta.label,
    theme: meta.theme,
    color: meta.color,
    portraitUrl: npc.image || npc.portraitUrl || '',
    side: 'enemy',
    characterSnapshot: buildCharacterSnapshot({
      ...npc,
      id: npc.id,
      name: npc.name,
      class: npc.class,
      level: npc.level,
      type: 'NPC',
      species: npc.species || 'Humanos',
    portraitUrl: npc.image || npc.portraitUrl || '',
      skills: npc.skills || [],
      hp: npc.hp,
      maxHp: npc.maxHp,
      defense: npc.defense,
      attack: npc.attack,
      damage: npc.damage,
      force: npc.force
    })
  };
}
