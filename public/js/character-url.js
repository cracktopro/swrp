/** Solo parámetros de la URL (sin sessionStorage). Útil al crear personaje nuevo. */
export function getCharacterIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('id') || params.get('characterId') || params.get('char');
  return fromUrl?.trim() || '';
}

/** Resuelve el ID de personaje desde la URL (+ respaldo en sessionStorage). */
export function getCharacterIdFromUrl() {
  const fromUrl = getCharacterIdFromQuery();
  if (fromUrl) {
    rememberCharacterId(fromUrl);
    return fromUrl;
  }

  const stored = sessionStorage.getItem('swrp_active_character_id');
  return stored?.trim() || '';
}

export function rememberCharacterId(characterId) {
  if (characterId) {
    sessionStorage.setItem('swrp_active_character_id', characterId);
  }
}

export function characterViewUrl(characterId) {
  if (!characterId) return 'dashboard';
  rememberCharacterId(characterId);
  return `character-view?id=${encodeURIComponent(characterId)}`;
}

export function characterEditUrl(characterId) {
  if (!characterId) return 'character-create';
  rememberCharacterId(characterId);
  return `character-create?id=${encodeURIComponent(characterId)}`;
}
