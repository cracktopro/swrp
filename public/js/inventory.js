import {
  db,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from './firebase-config.js';
import { getItemById, ITEM_STAT_DEFS } from './compendium-store.js';

export const INVENTORY_COLS = 4;
export const INVENTORY_ROWS = 8;
export const INVENTORY_MAX_SLOTS = INVENTORY_COLS * INVENTORY_ROWS; // 32

export const BASE_MOVE_RANGE = 6;
export const OVERWEIGHT_MOVE_RANGE = 3;
export const OVERWEIGHT_FULL_MOVE_RANGE = 1;

/** Peso máximo soportado por clase (KG). */
export const CLASS_MAX_WEIGHT = {
  'Jedi Guardian': 10,
  'Guerrero Sith': 10,
  'Jedi Consul': 8,
  'Inquisidor Sith': 8,
  'Soldado': 15,
  'Contrabandista': 15,
  'Especialista Técnico': 20,
  'Cazarrecompensas': 20,
  'Noble': 12
};

const DEFAULT_MAX_WEIGHT = 10;

export function getClassMaxWeight(classKey) {
  return CLASS_MAX_WEIGHT[classKey] ?? DEFAULT_MAX_WEIGHT;
}

export function statLabel(statKey) {
  return ITEM_STAT_DEFS.find((s) => s.key === statKey)?.label || statKey;
}

/** Normaliza los campos de inventario de un personaje. */
export function normalizeInventory(character) {
  const credits = Math.max(0, Math.round(Number(character?.credits) || 0));
  const inventory = Array.isArray(character?.inventory)
    ? character.inventory
        .map((entry) => ({
          itemId: String(entry?.itemId || '').trim(),
          qty: Math.max(0, Math.round(Number(entry?.qty) || 0))
        }))
        .filter((e) => e.itemId && e.qty > 0)
    : [];
  const equippedItemId = character?.equippedItemId || null;
  const statBonuses = sanitizeStatBonuses(character?.statBonuses);
  return { credits, inventory, equippedItemId, statBonuses };
}

export function sanitizeStatBonuses(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const { key } of ITEM_STAT_DEFS) {
    const val = Math.round(Number(raw[key]) || 0);
    if (val) out[key] = val;
  }
  return out;
}

/** Peso total transportado (incluye el objeto equipado). */
export function computeInventoryWeight(inventory, equippedItemId) {
  let total = 0;
  for (const entry of inventory || []) {
    const item = getItemById(entry.itemId);
    if (item) total += (Number(item.weight) || 0) * entry.qty;
  }
  if (equippedItemId) {
    const equipped = getItemById(equippedItemId);
    if (equipped) total += Number(equipped.weight) || 0;
  }
  return Math.round(total * 100) / 100;
}

/** Nº de casillas ocupadas en la rejilla (cada tipo de objeto ocupa una). */
export function computeUsedSlots(inventory) {
  return (inventory || []).filter((e) => e.qty > 0).length;
}

export function isOverweight(character) {
  const { inventory, equippedItemId } = normalizeInventory(character);
  const weight = computeInventoryWeight(inventory, equippedItemId);
  return weight > getClassMaxWeight(character?.class || character?.classKey);
}

/**
 * Rango de movimiento por turno según peso/llenado del inventario.
 * 6 normal · 3 si supera peso · 1 si supera peso Y rejilla llena (32).
 */
export function computeMoveRange(character) {
  const { inventory, equippedItemId } = normalizeInventory(character);
  const weight = computeInventoryWeight(inventory, equippedItemId);
  const maxWeight = getClassMaxWeight(character?.class || character?.classKey);
  const slots = computeUsedSlots(inventory);
  if (weight > maxWeight) {
    return slots >= INVENTORY_MAX_SLOTS ? OVERWEIGHT_FULL_MOVE_RANGE : OVERWEIGHT_MOVE_RANGE;
  }
  return BASE_MOVE_RANGE;
}

/** Bonus de la ranura de equipo: { stat, amount } o null. */
export function computeEquipmentBonus(equippedItemId) {
  const item = getItemById(equippedItemId);
  if (!item || item.type !== 'Equipo') return null;
  if (!item.stat || !item.statBonus) return null;
  return { stat: item.stat, amount: Number(item.statBonus) || 0 };
}

/**
 * Aplica a un objeto de stats los modificadores permanentes del personaje:
 * equipo equipado + bonificaciones permanentes (consumibles permanentes).
 * No toca hp/maxHp salvo equipo de tipo hp (sube el máximo).
 */
export function applyPermanentModifiers(stats, character) {
  const { equippedItemId, statBonuses } = normalizeInventory(character);
  const out = { ...stats };
  const bonus = computeEquipmentBonus(equippedItemId);
  if (bonus) {
    if (bonus.stat === 'hp') {
      out.hp = (Number(out.hp) || 0) + bonus.amount;
      out.maxHp = (Number(out.maxHp ?? out.hp) || 0) + bonus.amount;
    } else {
      out[bonus.stat] = (Number(out[bonus.stat]) || 0) + bonus.amount;
    }
  }
  for (const [key, amount] of Object.entries(statBonuses || {})) {
    if (key === 'hp') continue; // las curas no suben el máximo
    out[key] = (Number(out[key]) || 0) + amount;
  }
  return out;
}

/** Persiste los campos de inventario del personaje. */
export async function saveCharacterInventory(characterId, patch) {
  if (!characterId) throw new Error('Personaje no válido.');
  const payload = { updatedAt: serverTimestamp() };
  if (patch.credits !== undefined) payload.credits = Math.max(0, Math.round(patch.credits));
  if (patch.inventory !== undefined) {
    payload.inventory = (patch.inventory || [])
      .filter((e) => e.itemId && e.qty > 0)
      .map((e) => ({ itemId: e.itemId, qty: Math.round(e.qty) }));
  }
  if (patch.equippedItemId !== undefined) payload.equippedItemId = patch.equippedItemId || null;
  if (patch.statBonuses !== undefined) payload.statBonuses = sanitizeStatBonuses(patch.statBonuses);
  if (patch.currentHp !== undefined) payload.currentHp = Math.max(0, Math.round(patch.currentHp));
  await updateDoc(doc(db, 'characters', characterId), payload);
}

/** Añade un objeto al inventario (agrupando por tipo). Devuelve nuevo array o lanza error. */
export function addItemToInventory(inventory, itemId, qty = 1) {
  const list = (inventory || []).map((e) => ({ ...e }));
  const existing = list.find((e) => e.itemId === itemId);
  if (existing) {
    existing.qty += qty;
    return list;
  }
  if (computeUsedSlots(list) >= INVENTORY_MAX_SLOTS) {
    throw new Error('El inventario está lleno (32 casillas).');
  }
  list.push({ itemId, qty });
  return list;
}

/** Quita una cantidad de un objeto. Devuelve nuevo array. */
export function removeItemFromInventory(inventory, itemId, qty = 1) {
  const list = (inventory || []).map((e) => ({ ...e }));
  const entry = list.find((e) => e.itemId === itemId);
  if (!entry) return list;
  entry.qty -= qty;
  return list.filter((e) => e.qty > 0);
}

function tokenMaxHp(token) {
  return Number(token.characterSnapshot?.maxHp ?? token.maxHp) || 1;
}

/**
 * Aplica el efecto de un consumible al token del personaje en el tablero.
 * Devuelve { applied, reason }.
 * - hp: cura limitada al máximo (no se revierte).
 * - otras stats: si el consumible es temporal y hay combate, se registra en
 *   token.tempEffects para revertir al finalizar combate; si es permanente, se
 *   suma directamente al snapshot.
 */
export async function applyConsumableToBoardToken(partyId, characterId, item) {
  if (!partyId || !characterId || !item) return { applied: false, reason: 'bad-args' };
  if (!item.stat || item.stat === 'none') return { applied: false, reason: 'no-effect' };
  const ref = doc(db, 'parties', partyId, 'state', 'board');
  const snap = await getDoc(ref);
  if (!snap.exists()) return { applied: false, reason: 'no-board' };
  const data = snap.data();
  const tokens = data.tokens || [];
  const token = tokens.find((t) => t.sourceId === characterId && t.side !== 'enemy');
  if (!token) return { applied: false, reason: 'no-token' };

  if (!token.characterSnapshot) token.characterSnapshot = {};
  const snapStats = token.characterSnapshot;
  const amount = Number(item.statBonus) || 0;

  if (item.stat === 'hp') {
    const max = tokenMaxHp(token);
    const current = Number(snapStats.hp ?? token.hp ?? max) || 0;
    snapStats.hp = Math.min(max, current + amount);
  } else if (item.stat) {
    if (item.temporary) {
      // Solo durante el combate: se registra para revertir al finalizar.
      if (!data.combatStarted) return { applied: false, reason: 'no-combat' };
      snapStats[item.stat] = (Number(snapStats[item.stat]) || 0) + amount;
      token.tempEffects = [...(token.tempEffects || []), { stat: item.stat, amount }];
    } else {
      // Permanente: refleja en el token actual (el bono permanente vive en el personaje).
      snapStats[item.stat] = (Number(snapStats[item.stat]) || 0) + amount;
    }
  }

  await updateDoc(ref, { tokens, updatedAt: serverTimestamp() });
  return { applied: true };
}

/** Revierte en todos los tokens los efectos temporales acumulados. */
export function revertTemporaryEffectsOnTokens(tokens) {
  let changed = false;
  for (const token of tokens || []) {
    if (!Array.isArray(token.tempEffects) || !token.tempEffects.length) continue;
    if (!token.characterSnapshot) token.characterSnapshot = {};
    for (const eff of token.tempEffects) {
      if (!eff?.stat || eff.stat === 'hp') continue;
      token.characterSnapshot[eff.stat] =
        (Number(token.characterSnapshot[eff.stat]) || 0) - (Number(eff.amount) || 0);
    }
    token.tempEffects = [];
    changed = true;
  }
  return changed;
}

/** Actualiza el rango de movimiento del token del personaje en el tablero (peso). */
export async function updateBoardTokenMoveRange(partyId, character) {
  if (!partyId || !character?.id) return;
  const ref = doc(db, 'parties', partyId, 'state', 'board');
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const tokens = data.tokens || [];
  const token = tokens.find((t) => t.sourceId === character.id && t.side !== 'enemy');
  if (!token) return;
  const newRange = computeMoveRange(character);
  if (token.moveRange === newRange) return;
  token.moveRange = newRange;
  await updateDoc(ref, { tokens, updatedAt: serverTimestamp() });
}
