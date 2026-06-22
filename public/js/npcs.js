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
    type: 'NPC',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateNpc(npcId, data) {
  await updateDoc(doc(db, 'npcs', npcId), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function deleteNpc(npcId) {
  await deleteDoc(doc(db, 'npcs', npcId));
}

export function npcToCardData(npc) {
  return {
    ...npc,
    image: npc.portraitUrl || npc.image || '',
    portraitUrl: npc.portraitUrl || npc.image || ''
  };
}
