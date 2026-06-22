import { normalizeCharacter, getClassMeta, renderCharacterTag } from './character-card.js';

function boardCellLabel(col, row) {
  const letter = String.fromCharCode(65 + Number(col));
  return `${letter}${Number(row) + 1}`;
}

const MARKUP_RE = /(\[img\]([\s\S]*?)\[\/img\]|\[C(?:=([^[\]]*))?\]([\s\S]*?)\[\/C\]|@\{([^}]+)\})/gi;

export function mentionToken(characterId) {
  return `@{${characterId}}`;
}

export function insertMention(textarea, atIndex, characterId) {
  const val = textarea.value;
  const before = val.slice(0, atIndex);
  const after = val.slice(atIndex + 1);
  const insert = mentionToken(characterId);
  textarea.value = before + insert + after;
  const newPos = before.length + insert.length;
  textarea.focus();
  textarea.setSelectionRange(newPos, newPos);
}

export function buildBoardTokenMap(tokens = []) {
  const map = new Map();
  tokens.forEach((token) => {
    if (!token?.id) return;
    const snap = token.characterSnapshot || {
      id: token.sourceId,
      name: token.name,
      class: token.class,
      level: token.level,
      portraitUrl: token.portraitUrl || ''
    };
    map.set(token.id, {
      snapshot: normalizeCharacter({ ...snap, id: snap.id || token.sourceId }, snap.id || token.sourceId),
      cell: boardCellLabel(token.col, token.row),
      token
    });
  });
  return map;
}

function renderCharacterTagWithCell(snapshot, cell, onClick) {
  const tag = renderCharacterTag(snapshot, onClick);
  if (!tag) return null;
  if (cell) {
    const badge = document.createElement('span');
    badge.className = 'board-cell-badge swrp-char-tag__cell';
    badge.textContent = cell;
    tag.insertBefore(badge, tag.querySelector('.swrp-char-tag__level'));
  }
  return tag;
}

function renderCharacterTagHtml(snapshot, { cell = null, mentionId = null, inline = true } = {}) {
  if (!snapshot?.name) return escapeHtml(mentionId ? `@{${mentionId}}` : '');
  const meta = getClassMeta(snapshot.class);
  const id = mentionId || snapshot.id || '';
  const cellBadge = cell
    ? `<span class="board-cell-badge swrp-char-tag__cell">${escapeHtml(cell)}</span>`
    : '';
  return `<button type="button" class="swrp-char-tag theme-${escapeHtml(meta.theme)}${inline ? ' swrp-char-tag--inline' : ''}" data-mention-id="${escapeHtml(id)}" title="Ver carta de personaje">
    <span class="swrp-char-tag__name">${escapeHtml(snapshot.name)}</span>${cellBadge}<span class="swrp-char-tag__level">Nv.${Number(snapshot.level) || 1}</span>
  </button>`;
}

export function renderNarrativeMarkupHtml(content, { rosterMap = new Map(), boardTokenMap = new Map() } = {}) {
  if (!content) return '';

  let html = '';
  let lastIndex = 0;
  MARKUP_RE.lastIndex = 0;
  let match;

  while ((match = MARKUP_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(content.slice(lastIndex, match.index)).replace(/\n/g, '<br>');
    }

    if (match[2] !== undefined) {
      const url = match[2].trim();
      if (isValidHttpUrl(url)) {
        html += `<img src="${escapeHtml(url)}" alt="Imagen narrativa" class="swrp-post__img" loading="lazy">`;
      } else {
        html += escapeHtml(match[0]);
      }
    } else if (match[4] !== undefined) {
      const color = resolveColor(match[3]);
      const inner = escapeHtml(match[4]).replace(/\n/g, '<br>');
      html += `<span class="swrp-narrative-color" style="color:${escapeHtml(color)}">${inner}</span>`;
    } else if (match[5] !== undefined) {
      const mentionId = match[5].trim();
      const boardEntry = boardTokenMap.get(mentionId);
      if (boardEntry) {
        html += renderCharacterTagHtml(boardEntry.snapshot, {
          cell: boardEntry.cell,
          mentionId
        });
      } else {
        const snapshot = rosterMap.get(mentionId);
        html += snapshot
          ? renderCharacterTagHtml(snapshot, { mentionId })
          : escapeHtml(match[0]);
      }
    }

    lastIndex = MARKUP_RE.lastIndex;
  }

  if (lastIndex < content.length) {
    html += escapeHtml(content.slice(lastIndex)).replace(/\n/g, '<br>');
  }

  return html;
}

export function buildRosterMap(roster, posts = []) {
  const map = new Map();
  roster.forEach((c) => {
    if (c?.id) map.set(c.id, normalizeCharacter(c, c.id));
  });
  posts.forEach((post) => {
    if (post.characterSnapshot?.id) {
      map.set(
        post.characterSnapshot.id,
        normalizeCharacter(post.characterSnapshot, post.characterSnapshot.id)
      );
    }
  });
  return map;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveColor(raw) {
  if (!raw?.trim()) return 'var(--swrp-gold)';
  const value = raw.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^[a-z]+$/i.test(value)) return value;
  return 'var(--swrp-gold)';
}

function appendTextWithBreaks(parent, text) {
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (line) parent.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) parent.appendChild(document.createElement('br'));
  });
}

export function renderNarrativeContent(content, { rosterMap = new Map(), boardTokenMap = new Map(), onOpenCharacter } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'swrp-narrative-content';

  if (!content) return wrap;

  let lastIndex = 0;
  MARKUP_RE.lastIndex = 0;
  let match;

  while ((match = MARKUP_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      appendTextWithBreaks(wrap, content.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined) {
      const url = match[2].trim();
      if (isValidHttpUrl(url)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Imagen narrativa';
        img.className = 'swrp-post__img';
        img.loading = 'lazy';
        img.onerror = () => {
          img.replaceWith(document.createTextNode(`[img]${url}[/img]`));
        };
        wrap.appendChild(img);
      } else {
        appendTextWithBreaks(wrap, match[0]);
      }
    } else if (match[4] !== undefined) {
      const span = document.createElement('span');
      span.className = 'swrp-narrative-color';
      span.style.color = resolveColor(match[3]);
      appendTextWithBreaks(span, match[4]);
      wrap.appendChild(span);
    } else if (match[5] !== undefined) {
      const charId = match[5].trim();
      const boardEntry = boardTokenMap.get(charId);
      if (boardEntry) {
        const tag = renderCharacterTagWithCell(boardEntry.snapshot, boardEntry.cell, onOpenCharacter);
        if (tag) {
          tag.classList.add('swrp-char-tag--inline');
          wrap.appendChild(tag);
        } else {
          appendTextWithBreaks(wrap, match[0]);
        }
      } else {
        const snapshot = rosterMap.get(charId);
        if (snapshot) {
          const tag = renderCharacterTag(snapshot, onOpenCharacter);
          if (tag) {
            tag.classList.add('swrp-char-tag--inline');
            wrap.appendChild(tag);
          } else {
            appendTextWithBreaks(wrap, match[0]);
          }
        } else {
          appendTextWithBreaks(wrap, match[0]);
        }
      }
    }

    lastIndex = MARKUP_RE.lastIndex;
  }

  if (lastIndex < content.length) {
    appendTextWithBreaks(wrap, content.slice(lastIndex));
  }

  return wrap;
}

export function renderBoardMentionPickerItem(token, onSelect) {
  const snap = token.characterSnapshot || token;
  const meta = getClassMeta(snap.class || token.class);
  const cell = boardCellLabel(token.col, token.row);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `swrp-mention-picker__item theme-${meta.theme}`;
  btn.innerHTML = `
    <span class="swrp-mention-picker__name-row">
      <span class="swrp-mention-picker__name">${escapeHtml(token.name)}</span>
      <span class="board-cell-badge">${escapeHtml(cell)}</span>
    </span>
    <span class="swrp-mention-picker__meta">${escapeHtml(meta.label)} · ${escapeHtml(sideLabel(token))}</span>`;
  btn.addEventListener('click', () => onSelect(token));
  return btn;
}

function sideLabel(token) {
  return token.side === 'enemy' ? 'Enemigo' : 'Aliado';
}

export function renderMentionPickerItem(character, onSelect) {
  const meta = getClassMeta(character.class);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `swrp-mention-picker__item theme-${meta.theme}`;
  btn.innerHTML = `
    <span class="swrp-mention-picker__name">${escapeHtml(character.name)}</span>
    <span class="swrp-mention-picker__meta">${escapeHtml(meta.label)} · Nv.${Number(character.level) || 1}</span>`;
  btn.addEventListener('click', () => onSelect(character));
  return btn;
}
