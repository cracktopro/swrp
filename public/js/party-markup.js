import { normalizeCharacter, getClassMeta, renderCharacterTag, isNpcEntity } from './character-card.js';
import {
  mentionToken,
  colorMarkup,
  urlMarkup,
  tokenizeNarrativeMarkup,
  resolveNarrativeColor,
  isValidNarrativeImageUrl
} from './narrative-markup.js';

export { mentionToken, colorMarkup, urlMarkup, tokenizeNarrativeMarkup };

function boardCellLabel(col, row) {
  const letter = String.fromCharCode(65 + Number(col));
  return `${letter}${Number(row) + 1}`;
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
  const levelTag = isNpcEntity(snapshot)
    ? ''
    : `<span class="swrp-char-tag__level">Nv.${Number(snapshot.level) || 1}</span>`;
  return `<button type="button" class="swrp-char-tag theme-${escapeHtml(meta.theme)}${inline ? ' swrp-char-tag--inline' : ''}" data-mention-id="${escapeHtml(id)}" title="Ver carta de personaje">
    <span class="swrp-char-tag__name">${escapeHtml(snapshot.name)}</span>${cellBadge}${levelTag}
  </button>`;
}

export function renderNarrativeMarkupHtml(content, { rosterMap = new Map(), boardTokenMap = new Map() } = {}) {
  if (!content) return '';

  return tokenizeNarrativeMarkup(content).map((token) => {
    if (token.type === 'text') {
      return escapeHtml(token.text).replace(/\n/g, '<br>');
    }
    if (token.type === 'url' || token.type === 'img') {
      const url = token.url.trim();
      if (isValidNarrativeImageUrl(url)) {
        return `<img src="${escapeHtml(url)}" alt="Imagen narrativa" class="swrp-post__img" loading="lazy">`;
      }
      return escapeHtml(token.raw);
    }
    if (token.type === 'color') {
      const color = resolveNarrativeColor(token.color);
      const inner = escapeHtml(token.text).replace(/\n/g, '<br>');
      return `<span class="swrp-narrative-color" style="color:${escapeHtml(color)}">${inner}</span>`;
    }
    if (token.type === 'mention') {
      const mentionId = token.id;
      const boardEntry = boardTokenMap.get(mentionId);
      if (boardEntry) {
        return renderCharacterTagHtml(boardEntry.snapshot, {
          cell: boardEntry.cell,
          mentionId
        });
      }
      const snapshot = rosterMap.get(mentionId);
      return snapshot
        ? renderCharacterTagHtml(snapshot, { mentionId })
        : escapeHtml(token.raw);
    }
    return '';
  }).join('');
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

  tokenizeNarrativeMarkup(content).forEach((token) => {
    if (token.type === 'text') {
      appendTextWithBreaks(wrap, token.text);
      return;
    }
    if (token.type === 'url' || token.type === 'img') {
      const url = token.url.trim();
      if (isValidNarrativeImageUrl(url)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Imagen narrativa';
        img.className = 'swrp-post__img';
        img.loading = 'lazy';
        img.onerror = () => {
          img.replaceWith(document.createTextNode(token.raw));
        };
        wrap.appendChild(img);
      } else {
        appendTextWithBreaks(wrap, token.raw);
      }
      return;
    }
    if (token.type === 'color') {
      const span = document.createElement('span');
      span.className = 'swrp-narrative-color';
      span.style.color = resolveNarrativeColor(token.color);
      appendTextWithBreaks(span, token.text);
      wrap.appendChild(span);
      return;
    }
    if (token.type === 'mention') {
      const charId = token.id;
      const boardEntry = boardTokenMap.get(charId);
      if (boardEntry) {
        const tag = renderCharacterTagWithCell(boardEntry.snapshot, boardEntry.cell, onOpenCharacter);
        if (tag) {
          tag.classList.add('swrp-char-tag--inline');
          wrap.appendChild(tag);
        } else {
          appendTextWithBreaks(wrap, token.raw);
        }
        return;
      }
      const snapshot = rosterMap.get(charId);
      if (snapshot) {
        const tag = renderCharacterTag(snapshot, onOpenCharacter);
        if (tag) {
          tag.classList.add('swrp-char-tag--inline');
          wrap.appendChild(tag);
        } else {
          appendTextWithBreaks(wrap, token.raw);
        }
      } else {
        appendTextWithBreaks(wrap, token.raw);
      }
    }
  });

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
  return normalizeTokenSide(token.side) === 'enemy' ? 'Enemigo' : normalizeTokenSide(token.side) === 'neutral' ? 'Neutral' : 'Aliado';
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
