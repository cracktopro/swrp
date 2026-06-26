/** Pausa escrituras automáticas cuando Firestore devuelve resource-exhausted (cuota o ráfaga). */

const STORAGE_KEY = 'swrp_firestore_quota_until';
let memoryBlockedUntil = 0;

function readStoredBlockedUntil() {
  try {
    return Number(sessionStorage.getItem(STORAGE_KEY) || 0);
  } catch {
    return 0;
  }
}

export function getFirestoreQuotaBlockedUntil() {
  return Math.max(memoryBlockedUntil, readStoredBlockedUntil());
}

export function isFirestoreQuotaBlocked() {
  return Date.now() < getFirestoreQuotaBlockedUntil();
}

export function isQuotaExceededError(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return code === 'resource-exhausted' || message.includes('resource-exhausted');
}

/** Marca el bloqueo (~1 h) para no seguir escribiendo y empeorar el throttling. */
export function markFirestoreQuotaExceeded(err, { minutes = 60 } = {}) {
  if (!isQuotaExceededError(err)) return false;
  const until = Date.now() + minutes * 60 * 1000;
  memoryBlockedUntil = until;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(until));
  } catch { /* ignore */ }
  console.warn(
    'Firestore ha devuelto resource-exhausted (cuota o límite de ráfaga). '
    + 'Las escrituras automáticas de créditos pendientes quedan pausadas ~1 h.'
  );
  return true;
}
