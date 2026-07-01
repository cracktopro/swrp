// Lógica del sistema de loot (botín de enemigos y cajas).
// La probabilidad se expresa en niveles 1-5 (1 = 5%, 5 = 100%), interpolado linealmente.

export const LOOT_PROB_LEVELS = [1, 2, 3, 4, 5];

// 1 → 5% ... 5 → 100% (lineal: 5 + (n-1)*23.75, redondeado).
export const LOOT_PROB_PCT = { 1: 5, 2: 29, 3: 53, 4: 76, 5: 100 };

export function clampProbLevel(level) {
  const n = Math.round(Number(level) || 1);
  return Math.min(5, Math.max(1, n));
}

export function lootProbPercent(level) {
  return LOOT_PROB_PCT[clampProbLevel(level)] ?? 5;
}

export function lootProbLabel(level) {
  return `${lootProbPercent(level)}%`;
}

/** Normaliza un objeto de loot (común a enemigos y cajas). */
export function normalizeLoot(raw) {
  const credits = Math.max(0, Math.round(Number(raw?.credits) || 0));
  const items = Array.isArray(raw?.items)
    ? raw.items
        .map((e) => ({
          itemId: String(e?.itemId || '').trim(),
          prob: clampProbLevel(e?.prob)
        }))
        .filter((e) => e.itemId)
    : [];
  const creditsClaimed = raw?.creditsClaimed === true;
  const creditsClaimedBy = (raw?.creditsClaimedBy && typeof raw.creditsClaimedBy === 'object')
    ? { ...raw.creditsClaimedBy }
    : {};
  let creditShares = null;
  if (raw?.creditShares && typeof raw.creditShares === 'object') {
    creditShares = {};
    for (const [id, amt] of Object.entries(raw.creditShares)) {
      const n = Math.max(0, Math.round(Number(amt) || 0));
      if (id && n > 0) creditShares[id] = n;
    }
    if (!Object.keys(creditShares).length) creditShares = null;
  }
  const resolved = Array.isArray(raw?.resolved)
    ? raw.resolved
        .map((e) => ({
          itemId: String(e?.itemId || '').trim(),
          qty: Math.max(0, Math.round(Number(e?.qty) || 0))
        }))
        .filter((e) => e.itemId && e.qty > 0)
    : null;
  return { credits, items, creditsClaimed, creditsClaimedBy, creditShares, resolved };
}

/** Solo configuración de botín (plantillas / instancias nuevas): sin estado de partida. */
export function normalizeLootTemplate(raw) {
  const l = normalizeLoot(raw);
  return { credits: l.credits, items: l.items, creditsClaimed: false, resolved: null };
}

/** Normaliza una caja para plantilla o estado inicial. */
export function normalizeChestTemplate(raw) {
  return {
    id: String(raw?.id || '').trim() || `chest_${Date.now().toString(36)}`,
    col: Math.max(0, Math.round(Number(raw?.col) || 0)),
    row: Math.max(0, Math.round(Number(raw?.row) || 0)),
    imageUrl: String(raw?.imageUrl || '').trim(),
    hidden: raw?.hidden === true,
    opened: false,
    loot: normalizeLootTemplate(raw?.loot)
  };
}

export const CHEST_ICONS = {
  closed: 'icons/caja_cerrada.png',
  open: 'icons/caja_abierta.png',
  empty: 'icons/caja_vacia.png'
};

/** Estado visual de la caja en el tablero: cerrada | abierta | vacía. */
export function getChestVisualState(chest) {
  const opened = chest?.opened === true;
  if (!opened) return 'closed';
  const l = normalizeLoot(chest?.loot);
  // Coincide con el modal: sin filas en resolved → caja vacía (aunque queden créditos).
  if (l.resolved !== null) {
    return l.resolved.length > 0 ? 'open' : 'empty';
  }
  return lootHasRemaining(l) ? 'open' : 'empty';
}

/** ¿Hay algo configurado en el loot (créditos u objetos)? */
export function lootHasConfig(loot) {
  const l = normalizeLoot(loot);
  return l.credits > 0 || l.items.length > 0;
}

/**
 * ¿Queda algo por saquear (cualquier jugador)?
 * - Objetos sin coger.
 * - Créditos con parte sin reclamar por alguien.
 */
export function lootHasRemaining(loot) {
  const l = normalizeLoot(loot);
  if (l.resolved !== null) {
    if (l.resolved.length > 0) return true;
    return lootHasUnclaimedCredits(l);
  }
  return l.items.length > 0 || l.credits > 0;
}

/** ¿Este personaje tiene algo que reclamar en el botín? */
export function lootHasRemainingForCharacter(loot, characterId) {
  if (!characterId) return lootHasRemaining(loot);
  const l = normalizeLoot(loot);
  if (l.resolved?.length) return true;
  if (l.creditShares) {
    return (Number(l.creditShares[characterId]) || 0) > 0 && !l.creditsClaimedBy[characterId];
  }
  if (!l.creditsClaimed && l.credits > 0) return true;
  return l.items.length > 0;
}

/** ¿Quedan créditos sin reclamar por algún jugador? */
export function lootHasUnclaimedCredits(loot) {
  const l = normalizeLoot(loot);
  if (l.creditShares) {
    return Object.entries(l.creditShares).some(
      ([id, amt]) => (Number(amt) || 0) > 0 && !l.creditsClaimedBy[id]
    );
  }
  return !l.creditsClaimed && l.credits > 0;
}

/** Calcula la parte de créditos por personaje al resolver el botín. */
export function buildCreditShares(total, recipientIds) {
  const ids = (recipientIds || []).filter(Boolean);
  const split = splitCredits(total, ids.length);
  const shares = {};
  for (let i = 0; i < ids.length; i++) {
    const share = split.base + (i < split.remainder ? 1 : 0);
    if (share > 0) shares[ids[i]] = share;
  }
  return { shares, split };
}

/** Tira cada objeto configurado por su probabilidad. Devuelve [{ itemId, qty }]. */
export function rollLootItems(items) {
  const out = [];
  for (const e of items || []) {
    const pct = lootProbPercent(e.prob);
    if (Math.random() * 100 < pct) {
      const existing = out.find((o) => o.itemId === e.itemId);
      if (existing) existing.qty += 1;
      else out.push({ itemId: e.itemId, qty: 1 });
    }
  }
  return out;
}

/** Resuelve el loot: tira los objetos si todavía no se había hecho. */
export function resolveLoot(loot) {
  const l = normalizeLoot(loot);
  if (l.resolved) return l;
  l.resolved = rollLootItems(l.items);
  return l;
}

/** Reparte una cantidad de créditos entre N jugadores. Devuelve { count, total, base, remainder }. */
export function splitCredits(total, count) {
  const amount = Math.max(0, Math.round(Number(total) || 0));
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (!n || !amount) return { count: n, total: amount, base: 0, remainder: amount };
  const base = Math.floor(amount / n);
  const remainder = amount - base * n;
  return { count: n, total: amount, base, remainder };
}
