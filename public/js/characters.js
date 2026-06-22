import {
  db,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc
} from './firebase-config.js';
import { normalizeCharacter } from './character-card.js';

/** El ID del documento Firestore siempre prevalece sobre campos del body. */
export function docToCharacter(docSnap) {
  return normalizeCharacter(docSnap.data(), docSnap.id);
}

export async function loadUserCharacters(userId) {
  const q = query(collection(db, 'characters'), where('userId', '==', userId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => docToCharacter(d))
    .filter((c) => c.type !== 'NPC');
}

export async function loadCharacterById(characterId, userId) {
  if (!characterId) {
    return { error: 'missing_id', message: 'No se indicó qué personaje abrir.' };
  }

  const snap = await getDoc(doc(db, 'characters', characterId));
  if (!snap.exists()) {
    return { error: 'not_found', message: 'Personaje no encontrado.' };
  }

  const data = snap.data();
  if (data.userId && data.userId !== userId) {
    return { error: 'forbidden', message: 'No tienes permiso para acceder a este personaje.' };
  }

  return { character: docToCharacter(snap) };
}
