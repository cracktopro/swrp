/** Pausa escrituras cuando Firestore devuelve resource-exhausted (cuota diaria o ráfaga). */

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

export function getFirestoreQuotaStatusMessage() {
  if (!isFirestoreQuotaBlocked()) return null;
  const until = getFirestoreQuotaBlockedUntil();
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return `Firestore está limitando escrituras (resource-exhausted). `
    + `Espera unos ${mins} min, cierra pestañas del tablero y evita recargar en bucle. `
    + `El panel de uso diario puede seguir mostrando pocos registros: este límite es distinto.`;
}

/** Lanza un error legible antes de intentar escribir si ya estamos bloqueados. */
export function assertFirestoreWritable(action = 'guardar cambios') {
  const msg = getFirestoreQuotaStatusMessage();
  if (msg) {
    throw new Error(`No se puede ${action}. ${msg}`);
  }
}

/** Convierte errores de Firestore en mensajes útiles para alertas. */
export function formatFirestoreWriteError(err, action = 'completar la operación') {
  if (isQuotaExceededError(err)) {
    markFirestoreQuotaExceeded(err);
    return `No se pudo ${action}. ${getFirestoreQuotaStatusMessage()}`;
  }
  return err?.message || `Error al ${action}.`;
}

/** Marca el bloqueo (~1 h) para no seguir escribiendo y empeorar el throttling. */
export function markFirestoreQuotaExceeded(err, { minutes = 60 } = {}) {
  if (!isQuotaExceededError(err)) return false;
  const until = Date.now() + minutes * 60 * 1000;
  memoryBlockedUntil = until;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(until));
  } catch { /* ignore */ }
  console.warn(getFirestoreQuotaStatusMessage());
  return true;
}
