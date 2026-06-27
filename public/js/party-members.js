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
import { getStats } from './compendium-store.js';
import { npcToMembershipCharacter, normalizeNpcLoot, npcHasDefaultLoot } from './npcs.js';
import { loadParty } from './party.js';
import { hasEscaramuzaSlotConfig } from './escaramuza-templates.js';
import { applyPermanentModifiers, computeMoveRange, normalizeInventory } from './inventory.js';

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
  const inv = normalizeInventory(c);
  return omitUndefinedFields({
    id: c.id,
    name: c.name,
    species: c.species || 'Humanos',
    class: c.class,
    ...(c.type !== 'NPC' ? { level: c.level } : {}),
    type: c.type,
    era: c.era || null,
    portraitUrl: c.portraitUrl || '',
    skills: c.skills || [],
    attack: c.attack,
    defense: c.defense,
    damage: c.damage,
    hp: c.currentHp ?? c.hp,
    maxHp: c.maxHp,
    force: c.force,
    ...(c.type !== 'NPC' ? {
      equippedItemId: inv.equippedItemId || null,
      statBonuses: inv.statBonuses
    } : {})
  });
}

export function getMemberPlaySource(member) {
  if (!member) {
    return { sourceId: null, tokenKind: 'character', playMode: null };
  }
  if (member.playMode === 'npc' || member.npcId) {
    return {
      sourceId: member.npcId || member.characterSnapshot?.id || null,
      tokenKind: 'npc',
      playMode: member.playMode || 'npc'
    };
  }
  return {
    sourceId: member.characterId || member.characterSnapshot?.id || null,
    tokenKind: 'character',
    playMode: member.playMode || 'character'
  };
}

export async function joinParty(partyId, user, profile, { playMode, character }) {
  const existing = await getPartyMember(partyId, user.uid);
  if (existing) throw new Error('Ya estás unido a esta partida');

  const members = await loadPartyMembers(partyId);
  const party = await loadParty(partyId);
  if (party?.type === 'Escaramuza' && hasEscaramuzaSlotConfig(party)) {
    if (members.length >= party.maxSlots) {
      throw new Error('No quedan plazas en esta escaramuza');
    }
  }
  if (party?.templateId) {
    if (playMode === 'gm') {
      const gm = getPartyGM(members);
      if (gm) throw new Error('Esta partida ya tiene un GM asignado');
    } else if (playMode === 'npc') {
      throw new Error('En escaramuzas predefinidas solo puedes unirte con un personaje propio');
    } else if (!character?.id) {
      throw new Error('Selecciona un personaje para unirte');
    }
  } else if (playMode === 'gm') {
    const gm = getPartyGM(members);
    if (gm) throw new Error('Esta partida ya tiene un GM asignado');
  } else if (playMode === 'npc') {
    if (!character?.id) throw new Error('Selecciona un NPC para unirte');
  } else if (!character?.id) {
    throw new Error('Selecciona un personaje para unirte');
  }

  const { characterId, npcId, characterSnapshot } = resolveMembershipCharacter(playMode, character);

  const payload = {
    userId: user.uid,
    username: profile?.username || user.displayName || user.email,
    playMode,
    characterId,
    npcId: npcId || null,
    characterSnapshot,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, 'parties', partyId, 'members', user.uid), payload);
  await updateDoc(doc(db, 'users', user.uid), { joinedPartyIds: arrayUnion(partyId) });
  if (characterId && playMode === 'character') {
    await linkCharacterToActiveParty(characterId, partyId);
  }
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
  } else if (playMode === 'npc') {
    if (!character?.id) throw new Error('Selecciona un NPC');
  } else if (!character?.id) {
    throw new Error('Selecciona un personaje');
  }

  const { characterId, npcId, characterSnapshot } = resolveMembershipCharacter(playMode, character);

  await setDoc(doc(db, 'parties', partyId, 'members', userId), {
    userId,
    username: profile?.username || user.displayName || user.email,
    playMode,
    characterId,
    npcId: npcId || null,
    characterSnapshot,
    updatedAt: serverTimestamp()
  }, { merge: true });
  if (characterId && playMode === 'character') {
    await linkCharacterToActiveParty(characterId, partyId);
  }
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
  if (playMode === 'gm') {
    if (character?.type === 'NPC') {
      return {
        characterId: null,
        npcId: character.id,
        characterSnapshot: buildCharacterSnapshot(npcToMembershipCharacter(character))
      };
    }
    return {
      characterId: hasChar ? character.id : null,
      npcId: null,
      characterSnapshot: hasChar ? buildCharacterSnapshot(character) : null
    };
  }
  if (playMode === 'npc') {
    if (!hasChar) throw new Error('Selecciona un NPC');
    return {
      characterId: null,
      npcId: character.id,
      characterSnapshot: buildCharacterSnapshot(npcToMembershipCharacter(character))
    };
  }
  if (playMode === 'character' && !hasChar) {
    throw new Error('Selecciona un personaje');
  }
  return {
    characterId: hasChar ? character.id : null,
    npcId: null,
    characterSnapshot: hasChar ? buildCharacterSnapshot(character) : null
  };
}

export function tokenFromCharacter(char, kind = 'character') {
  const meta = getClassMeta(char.class);
  const snapshot = buildCharacterSnapshot(char);
  // Aplica equipo + bonificaciones permanentes a las stats de combate del token.
  if (char.type !== 'NPC') {
    const eff = applyPermanentModifiers({
      hp: snapshot.hp,
      maxHp: snapshot.maxHp,
      defense: snapshot.defense,
      attack: snapshot.attack,
      damage: snapshot.damage,
      force: snapshot.force
    }, char);
    if (eff.maxHp != null && eff.hp > eff.maxHp) eff.hp = eff.maxHp;
    Object.assign(snapshot, omitUndefinedFields(eff));
  }
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
    ...(char.type !== 'NPC' ? { moveRange: computeMoveRange(char) } : {}),
    characterSnapshot: snapshot
  };
}

export function tokenFromNpc(npc) {
  const meta = getClassMeta(npc.class);
  const token = {
    id: `npc_${npc.id}`,
    sourceId: npc.id,
    kind: 'npc',
    name: npc.name,
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
  if (npcHasDefaultLoot(npc)) {
    token.loot = normalizeNpcLoot(npc.loot);
  }
  return token;
}

/** Vincula el personaje a la partida activa (permite al GM guardar progreso global). */
export async function linkCharacterToActiveParty(characterId, partyId) {
  if (!characterId || !partyId) return;
  await updateDoc(doc(db, 'characters', characterId), {
    activePartyId: partyId,
    updatedAt: serverTimestamp()
  });
}

function findMemberForCharacter(members, characterId) {
  return members.find((m) =>
    m.characterId === characterId || m.characterSnapshot?.id === characterId
  );
}

/** GM: persiste stats del personaje en Firestore y en el snapshot del miembro de la partida. */
export async function saveCharacterProgressFromBoard(partyId, characterId, entity, { currentHp } = {}) {
  if (!partyId || !characterId || !entity) {
    throw new Error('Datos de personaje incompletos.');
  }

  const charSnap = await getDoc(doc(db, 'characters', characterId));
  if (!charSnap.exists()) {
    throw new Error('Personaje no encontrado.');
  }

  const charData = charSnap.data();
  const members = await loadPartyMembers(partyId);
  const member = findMemberForCharacter(members, characterId);
  const ownerId = charData.userId || member?.userId;

  const classKey = entity.classKey || entity.class;
  const level = Number(entity.level) || 1;
  const isHero = (charData.type || entity.type || 'Heroe') !== 'NPC';
  const baseStats = getStats(classKey, level) || {};
  const maxHp = isHero
    ? (Number(baseStats.hp) || Number(entity.maxHp ?? entity.hp) || 1)
    : (Number(entity.maxHp ?? entity.hp) || 1);
  const combat = isHero
    ? {
        defense: Number(baseStats.defense) || 0,
        attack: Number(baseStats.attack) || 0,
        damage: Number(baseStats.damage) || 0,
        force: baseStats.force ?? null
      }
    : {
        defense: Number(entity.defense) || 0,
        attack: Number(entity.attack) || 0,
        damage: Number(entity.damage) || 0,
        force: entity.force ?? null
      };
  const hp = Math.min(
    Math.max(0, Number(currentHp) ?? charData.currentHp ?? maxHp),
    maxHp
  );

  const payload = omitUndefinedFields({
    name: entity.name,
    species: entity.species || 'Humanos',
    classKey,
    class: classKey,
    level,
    type: charData.type || 'Heroe',
    portraitUrl: entity.portraitUrl || '',
    hp: maxHp,
    maxHp,
    currentHp: hp,
    ...combat,
    skills: entity.skills || [],
    activePartyId: partyId,
    updatedAt: serverTimestamp()
  });

  if (ownerId) {
    payload.userId = ownerId;
  }

  await updateDoc(doc(db, 'characters', characterId), payload);

  if (member) {
    await updateDoc(doc(db, 'parties', partyId, 'members', member.userId), {
      characterSnapshot: buildCharacterSnapshot({
        ...payload,
        id: characterId,
        currentHp: hp
      }),
      updatedAt: serverTimestamp()
    });
  }

  return payload;
}
