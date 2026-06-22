/**
 * Resuelve el ID de partida desde la URL (soporta id, party, partyId).
 */
export function getPartyIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('id') || params.get('party') || params.get('partyId');
  if (fromUrl?.trim()) return fromUrl.trim();

  const stored = sessionStorage.getItem('swrp_active_party_id');
  return stored?.trim() || '';
}

export function rememberPartyId(partyId) {
  if (partyId) sessionStorage.setItem('swrp_active_party_id', partyId);
}

export function partyPageUrl(partyId) {
  return `party?id=${encodeURIComponent(partyId)}`;
}

export function boardPageUrl(partyId) {
  return `board?party=${encodeURIComponent(partyId)}`;
}
