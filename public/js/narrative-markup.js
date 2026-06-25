export function mentionToken(characterId) {
  return `@{${characterId}}`;
}

export function colorMarkup(text, color) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const c = String(color || '').trim();
  if (c && c !== 'var(--swrp-gold)') {
    return `[C=${c}]${trimmed}[/C]`;
  }
  return `[C]${trimmed}[/C]`;
}

export function urlMarkup(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  return `[URL]${trimmed}[/URL]`;
}

export function tokenizeNarrativeMarkup(content) {
  if (!content) return [];
  const tokens = [];
  const re = /\[URL\]([\s\S]*?)\[\/URL\]|\[img\]([\s\S]*?)\[\/img\]|\[C(?:=([^[\]]*))?\]([\s\S]*?)\[\/C\]|@\{([^}]+)\}/gi;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'url', url: match[1], raw: match[0] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'img', url: match[2], raw: match[0] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'color', color: match[3], text: match[4], raw: match[0] });
    } else if (match[5] !== undefined) {
      tokens.push({ type: 'mention', id: match[5].trim(), raw: match[0] });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) {
    tokens.push({ type: 'text', text: content.slice(lastIndex) });
  }
  return tokens;
}

export function resolveNarrativeColor(raw) {
  if (!raw?.trim()) return 'var(--swrp-gold)';
  const value = raw.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^[a-z]+$/i.test(value)) return value;
  return 'var(--swrp-gold)';
}

export function isValidNarrativeImageUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
