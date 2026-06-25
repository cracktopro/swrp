import { normalizeCharacter, getClassMeta, renderCharacterTag } from './character-card.js';
import { getClassList } from './compendium-store.js';
import { filterCharacters } from './npc-picker.js';
import { renderMentionPickerItem, renderBoardMentionPickerItem } from './party-markup.js';
import { inferBoardTokenKind } from './board-vision.js';
import {
  mentionToken,
  colorMarkup,
  urlMarkup,
  tokenizeNarrativeMarkup
} from './narrative-markup.js';

const COLOR_PRESETS = [
  { label: 'Dorado', value: '#d4af37' },
  { label: 'Cian', value: '#00e5ff' },
  { label: 'Verde', value: '#39ff14' },
  { label: 'Rojo', value: '#ff4569' },
  { label: 'Violeta', value: '#b24bf3' }
];

let modalsReady = false;
let mentionModal;
let colorModal;
let imageModal;
let mentionModalMode = 'party';
let mentionGetPartyRoster = () => [];
let mentionGetBoardTokens = () => [];
let mentionTab = 'players';
let mentionPendingInsert = null;
let colorPendingInsert = null;
let imagePendingInsert = null;
let selectedMentionEntity = null;

function ensureModals() {
  if (modalsReady) return;
  modalsReady = true;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal fade" id="composerMentionModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content swrp-modal-card">
          <div class="modal-header border-secondary border-opacity-25">
            <h5 class="modal-title text-gold">Mencionar</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <ul class="nav nav-tabs swrp-board-tabs mb-3" id="composer-mention-tabs">
              <li class="nav-item"><button type="button" class="nav-link active" data-composer-mention-tab="players">Jugadores</button></li>
              <li class="nav-item"><button type="button" class="nav-link" data-composer-mention-tab="npcs">NPCs</button></li>
            </ul>
            <div id="composer-mention-players-panel">
              <div class="row g-2 mb-2">
                <div class="col-md-6">
                  <label class="form-label small mb-1" for="composer-mention-player-name">Nombre</label>
                  <input type="search" class="form-control form-control-sm" id="composer-mention-player-name" placeholder="Buscar…" autocomplete="off">
                </div>
                <div class="col-md-6">
                  <label class="form-label small mb-1" for="composer-mention-player-class">Clase</label>
                  <select class="form-select form-select-sm" id="composer-mention-player-class"></select>
                </div>
              </div>
              <div id="composer-mention-players-list" class="swrp-npc-picker-list swrp-scrollbar-thin"></div>
            </div>
            <div id="composer-mention-npcs-panel" class="d-none">
              <div class="row g-2 mb-2">
                <div class="col-md-4">
                  <label class="form-label small mb-1" for="composer-mention-npc-name">Nombre</label>
                  <input type="search" class="form-control form-control-sm" id="composer-mention-npc-name" placeholder="Buscar…" autocomplete="off">
                </div>
                <div class="col-md-4">
                  <label class="form-label small mb-1" for="composer-mention-npc-class">Clase</label>
                  <select class="form-select form-select-sm" id="composer-mention-npc-class"></select>
                </div>
                <div class="col-md-4">
                  <label class="form-label small mb-1" for="composer-mention-npc-era">Era</label>
                  <select class="form-select form-select-sm" id="composer-mention-npc-era"></select>
                </div>
              </div>
              <div id="composer-mention-npcs-list" class="swrp-npc-picker-list swrp-scrollbar-thin"></div>
            </div>
          </div>
          <div class="modal-footer border-secondary border-opacity-25">
            <button type="button" class="btn btn-swrp btn-swrp-ghost" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" id="composer-mention-confirm" class="btn btn-swrp btn-swrp-primary" disabled>Insertar</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal fade" id="composerColorModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content swrp-modal-card">
          <div class="modal-header border-secondary border-opacity-25">
            <h5 class="modal-title text-gold">Texto con color</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <label class="form-label" for="composer-color-text">Texto</label>
            <input type="text" class="form-control mb-3" id="composer-color-text" placeholder="Ej. Cantina">
            <label class="form-label" for="composer-color-picker">Color personalizado</label>
            <div class="d-flex align-items-center gap-2 mb-3">
              <input type="color" class="form-control form-control-color" id="composer-color-picker" value="#d4af37" title="Elegir color">
              <span class="small text-muted" id="composer-color-picker-label">#d4af37</span>
            </div>
            <div class="d-flex flex-wrap gap-2" id="composer-color-presets"></div>
          </div>
          <div class="modal-footer border-secondary border-opacity-25">
            <button type="button" class="btn btn-swrp btn-swrp-ghost" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" id="composer-color-confirm" class="btn btn-swrp btn-swrp-primary">Insertar</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal fade" id="composerImageModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content swrp-modal-card">
          <div class="modal-header border-secondary border-opacity-25">
            <h5 class="modal-title text-gold">Insertar imagen</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <label class="form-label" for="composer-image-url">URL de la imagen</label>
            <input type="url" class="form-control mb-3" id="composer-image-url" placeholder="https://…">
            <div id="composer-image-preview" class="swrp-composer-image-preview text-muted small">Vista previa</div>
          </div>
          <div class="modal-footer border-secondary border-opacity-25">
            <button type="button" class="btn btn-swrp btn-swrp-ghost" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" id="composer-image-confirm" class="btn btn-swrp btn-swrp-primary" disabled>Insertar</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  mentionModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('composerMentionModal'));
  colorModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('composerColorModal'));
  imageModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('composerImageModal'));

  const presetsEl = document.getElementById('composer-color-presets');
  presetsEl.innerHTML = COLOR_PRESETS.map((p) =>
    `<button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost composer-color-preset" data-color="${p.value}">${p.label}</button>`
  ).join('');

  document.getElementById('composer-mention-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-composer-mention-tab]');
    if (!tab) return;
    mentionTab = tab.dataset.composerMentionTab;
    document.querySelectorAll('#composer-mention-tabs .nav-link').forEach((el) => {
      el.classList.toggle('active', el.dataset.composerMentionTab === mentionTab);
    });
    document.getElementById('composer-mention-players-panel')?.classList.toggle('d-none', mentionTab !== 'players');
    document.getElementById('composer-mention-npcs-panel')?.classList.toggle('d-none', mentionTab !== 'npcs');
  });

  document.getElementById('composer-color-picker')?.addEventListener('input', (e) => {
    document.getElementById('composer-color-picker-label').textContent = e.target.value;
  });

  presetsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.composer-color-preset');
    if (!btn) return;
    const picker = document.getElementById('composer-color-picker');
    picker.value = btn.dataset.color;
    document.getElementById('composer-color-picker-label').textContent = btn.dataset.color;
  });

  document.getElementById('composer-image-url')?.addEventListener('input', () => {
    const url = document.getElementById('composer-image-url').value.trim();
    const preview = document.getElementById('composer-image-preview');
    const confirm = document.getElementById('composer-image-confirm');
    if (!url || !isValidHttpUrl(url)) {
      preview.innerHTML = '<span class="text-muted">Introduce una URL https válida</span>';
      confirm.disabled = true;
      return;
    }
    preview.innerHTML = `<img src="${escapeAttr(url)}" alt="" class="swrp-post__img">`;
    confirm.disabled = false;
  });

  document.getElementById('composer-mention-confirm')?.addEventListener('click', () => {
    if (!selectedMentionEntity || !mentionPendingInsert) return;
    mentionPendingInsert(selectedMentionEntity.id);
    mentionModal.hide();
  });

  document.getElementById('composer-color-confirm')?.addEventListener('click', () => {
    const text = document.getElementById('composer-color-text').value;
    const color = document.getElementById('composer-color-picker').value;
    if (!text.trim() || !colorPendingInsert) return;
    colorPendingInsert(text.trim(), color);
    colorModal.hide();
  });

  document.getElementById('composer-image-confirm')?.addEventListener('click', () => {
    const url = document.getElementById('composer-image-url').value.trim();
    if (!url || !imagePendingInsert) return;
    imagePendingInsert(url);
    imageModal.hide();
  });

  bindMentionFilterListeners();
}

function populateMentionClassSelect() {
  const classSelect = document.getElementById('composer-mention-player-class');
  if (!classSelect || classSelect.options.length) return;
  classSelect.innerHTML = [
    '<option value="">Todas las clases</option>',
    ...getClassList().map((c) => `<option value="${c.key}">${c.label}</option>`)
  ].join('');
}

function bindMentionFilterListeners() {
  if (bindMentionFilterListeners.done) return;
  bindMentionFilterListeners.done = true;
  const rerender = () => renderMentionModalLists();
  [
    'composer-mention-player-name',
    'composer-mention-player-class',
    'composer-mention-npc-name',
    'composer-mention-npc-class',
    'composer-mention-npc-era'
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', rerender);
    el?.addEventListener('change', rerender);
  });
}

function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}

function resolveColor(raw) {
  if (!raw?.trim()) return 'var(--swrp-gold)';
  const value = raw.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^[a-z]+$/i.test(value)) return value;
  return 'var(--swrp-gold)';
}

function insertNodeAtSelection(editor, node) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) {
    editor.appendChild(node);
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    editor.appendChild(node);
    return;
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function appendTextNode(editor, text) {
  if (!text) return;
  insertNodeAtSelection(editor, document.createTextNode(text));
}

function createMentionChip(snapshot, mentionId) {
  const chip = document.createElement('span');
  chip.className = 'swrp-composer-chip';
  chip.contentEditable = 'false';
  chip.dataset.markup = mentionToken(mentionId);
  const normalized = normalizeCharacter(snapshot, mentionId);
  const tag = renderCharacterTag(normalized, null);
  if (tag) {
    tag.classList.add('swrp-char-tag--inline');
    chip.appendChild(tag);
  } else {
    chip.textContent = mentionToken(mentionId);
  }
  return chip;
}

function createColorChip(text, color) {
  const markup = colorMarkup(text, color);
  const chip = document.createElement('span');
  chip.className = 'swrp-composer-chip swrp-composer-color';
  chip.contentEditable = 'false';
  chip.dataset.markup = markup;
  const inner = document.createElement('span');
  inner.className = 'swrp-narrative-color';
  inner.style.color = resolveColor(color);
  inner.textContent = text;
  chip.appendChild(inner);
  return chip;
}

function createImageChip(url) {
  const markup = urlMarkup(url);
  const chip = document.createElement('span');
  chip.className = 'swrp-composer-chip swrp-composer-image';
  chip.contentEditable = 'false';
  chip.dataset.markup = markup;
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Imagen';
  img.className = 'swrp-post__img swrp-composer-chip__img';
  img.loading = 'lazy';
  chip.appendChild(img);
  return chip;
}

function serializeEditor(editor) {
  let out = '';
  editor.childNodes.forEach((node) => {
    out += serializeNode(node);
  });
  return out;
}

function serializeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.dataset?.markup) return node.dataset.markup;
  if (node.tagName === 'BR') return '\n';
  if (node.classList?.contains('swrp-composer-chip')) return node.dataset.markup || '';
  let inner = '';
  node.childNodes.forEach((child) => { inner += serializeNode(child); });
  return inner;
}

function populateEditor(editor, markup, resolveMention) {
  editor.innerHTML = '';
  if (!markup) return;
  tokenizeNarrativeMarkup(markup).forEach((token) => {
    if (token.type === 'text') {
      appendTextWithBreaks(editor, token.text);
    } else if (token.type === 'mention') {
      const snapshot = resolveMention?.(token.id);
      if (snapshot) editor.appendChild(createMentionChip(snapshot, token.id));
      else appendTextNode(editor, mentionToken(token.id));
    } else if (token.type === 'color') {
      editor.appendChild(createColorChip(token.text, token.color));
    } else if (token.type === 'url' || token.type === 'img') {
      if (isValidHttpUrl(token.url)) editor.appendChild(createImageChip(token.url.trim()));
      else appendTextNode(editor, token.raw);
    }
  });
}

function appendTextWithBreaks(parent, text) {
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (line) parent.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) parent.appendChild(document.createElement('br'));
  });
}

function selectMentionEntity(entity, btn) {
  selectedMentionEntity = entity;
  document.getElementById('composer-mention-confirm').disabled = !entity;
  const listRoot = btn?.closest('#composer-mention-players-list, #composer-mention-npcs-list');
  listRoot?.querySelectorAll('.swrp-mention-picker__item').forEach((el) => {
    el.classList.toggle('is-selected', el === btn);
  });
}

function filterBoardTokens(tokens, { nameQ = '', npcOnly = false } = {}) {
  const needle = nameQ.trim().toLowerCase();
  return (tokens || []).filter((token) => {
    const isNpc = inferBoardTokenKind(token) === 'npc';
    if (npcOnly && !isNpc) return false;
    if (!npcOnly && isNpc) return false;
    if (!needle) return true;
    const name = token.name || token.characterSnapshot?.name || '';
    return name.toLowerCase().includes(needle);
  });
}

function renderPartyMentionList(roster) {
  const listEl = document.getElementById('composer-mention-players-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const filtered = filterCharacters(roster, {
    nameQ: document.getElementById('composer-mention-player-name')?.value || '',
    classQ: document.getElementById('composer-mention-player-class')?.value || ''
  });
  if (!filtered.length) {
    listEl.innerHTML = '<p class="small text-muted mb-0">No hay personajes unidos a la partida.</p>';
    return;
  }
  filtered.forEach((char) => {
    const btn = renderMentionPickerItem(char, (selected) => {
      selectMentionEntity(selected, btn);
    });
    listEl.appendChild(btn);
  });
}

function renderBoardMentionList(tokens, { npcOnly = false } = {}) {
  const listEl = document.getElementById(npcOnly ? 'composer-mention-npcs-list' : 'composer-mention-players-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const nameInputId = npcOnly ? 'composer-mention-npc-name' : 'composer-mention-player-name';
  const filtered = filterBoardTokens(tokens, {
    nameQ: document.getElementById(nameInputId)?.value || '',
    npcOnly
  });
  if (!filtered.length) {
    listEl.innerHTML = npcOnly
      ? '<p class="small text-muted mb-0">No hay NPCs en el tablero.</p>'
      : '<p class="small text-muted mb-0">No hay personajes en el tablero.</p>';
    return;
  }
  filtered.forEach((token) => {
    const btn = renderBoardMentionPickerItem(token, (selected) => {
      selectMentionEntity({ id: selected.id, token: selected }, btn);
    });
    listEl.appendChild(btn);
  });
}

function renderMentionModalLists() {
  if (mentionModalMode === 'board') {
    const tokens = mentionGetBoardTokens() || [];
    renderBoardMentionList(tokens, { npcOnly: false });
    renderBoardMentionList(tokens, { npcOnly: true });
    return;
  }
  renderPartyMentionList(mentionGetPartyRoster() || []);
}

function setMentionModalLayout(mode) {
  const isBoard = mode === 'board';
  document.getElementById('composer-mention-tabs')?.classList.toggle('d-none', !isBoard);
  document.getElementById('composer-mention-player-class')?.closest('.col-md-6')?.classList.toggle('d-none', isBoard);
  document.getElementById('composer-mention-npc-class')?.closest('.col-md-4')?.classList.toggle('d-none', isBoard);
  document.getElementById('composer-mention-npc-era')?.closest('.col-md-4')?.classList.toggle('d-none', isBoard);
  if (!isBoard) {
    document.getElementById('composer-mention-npcs-panel')?.classList.add('d-none');
    document.getElementById('composer-mention-players-panel')?.classList.remove('d-none');
  }
}

function openMentionModal({ mode, getPartyRoster, getBoardTokens, onInsert }) {
  ensureModals();
  mentionModalMode = mode || 'party';
  mentionGetPartyRoster = getPartyRoster || (() => []);
  mentionGetBoardTokens = getBoardTokens || (() => []);
  mentionPendingInsert = (id) => {
    onInsert(id);
    mentionPendingInsert = null;
  };
  selectedMentionEntity = null;
  document.getElementById('composer-mention-confirm').disabled = true;

  document.getElementById('composer-mention-player-name').value = '';
  document.getElementById('composer-mention-player-class').value = '';
  document.getElementById('composer-mention-npc-name').value = '';
  document.getElementById('composer-mention-npc-class').value = '';
  document.getElementById('composer-mention-npc-era').value = '';

  populateMentionClassSelect();

  if (mentionModalMode === 'board') {
    const tokens = mentionGetBoardTokens() || [];
    const playerTokens = filterBoardTokens(tokens, { npcOnly: false });
    const npcTokens = filterBoardTokens(tokens, { npcOnly: true });
    mentionTab = playerTokens.length ? 'players' : 'npcs';
  } else {
    mentionTab = 'players';
  }

  setMentionModalLayout(mentionModalMode);
  document.querySelectorAll('#composer-mention-tabs .nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.composerMentionTab === mentionTab);
  });
  if (mentionModalMode === 'board') {
    document.getElementById('composer-mention-players-panel')?.classList.toggle('d-none', mentionTab !== 'players');
    document.getElementById('composer-mention-npcs-panel')?.classList.toggle('d-none', mentionTab !== 'npcs');
  }

  renderMentionModalLists();
  mentionModal.show();
}

function openColorModal(onInsert) {
  ensureModals();
  document.getElementById('composer-color-text').value = '';
  document.getElementById('composer-color-picker').value = '#d4af37';
  document.getElementById('composer-color-picker-label').textContent = '#d4af37';
  colorPendingInsert = (text, color) => {
    onInsert(text, color);
    colorPendingInsert = null;
  };
  colorModal.show();
  setTimeout(() => document.getElementById('composer-color-text')?.focus(), 200);
}

function openImageModal(onInsert) {
  ensureModals();
  document.getElementById('composer-image-url').value = '';
  document.getElementById('composer-image-preview').innerHTML = '<span class="text-muted">Vista previa</span>';
  document.getElementById('composer-image-confirm').disabled = true;
  imagePendingInsert = (url) => {
    onInsert(url);
    imagePendingInsert = null;
  };
  imageModal.show();
  setTimeout(() => document.getElementById('composer-image-url')?.focus(), 200);
}

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {object} opts
 * @param {'party'|'board'} [opts.mentionMode]
 * @param {() => Array} [opts.getPartyRoster]
 * @param {() => Array} [opts.getBoardTokens]
 * @param {(id: string) => object|null} opts.resolveMention
 */
export function mountNarrativeComposer(textarea, {
  mentionMode = 'party',
  getPartyRoster,
  getBoardTokens,
  resolveMention
} = {}) {
  if (!textarea) return null;
  ensureModals();

  textarea.classList.add('d-none');

  const root = document.createElement('div');
  root.className = 'swrp-narrative-composer';

  const toolbar = document.createElement('div');
  toolbar.className = 'swrp-narrative-composer__toolbar';
  toolbar.innerHTML = `
    <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost" data-composer-action="mention" title="Mencionar">@ Mencionar</button>
    <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost" data-composer-action="color" title="Color">Color</button>
    <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost" data-composer-action="image" title="Imagen">Imagen</button>`;

  const editor = document.createElement('div');
  editor.className = 'form-control swrp-narrative-composer__editor';
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  editor.dataset.placeholder = textarea.placeholder || 'Escribe aquí…';

  root.appendChild(toolbar);
  root.appendChild(editor);
  textarea.parentNode.insertBefore(root, textarea);

  if (textarea.value) populateEditor(editor, textarea.value, resolveMention);

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-composer-action]');
    if (!btn) return;
    e.preventDefault();
    const action = btn.dataset.composerAction;
    if (action === 'mention') {
      openMentionModal({
        mode: mentionMode,
        getPartyRoster,
        getBoardTokens,
        onInsert: (id) => {
          const snapshot = resolveMention?.(id);
          if (snapshot) insertNodeAtSelection(editor, createMentionChip(snapshot, id));
          else appendTextNode(editor, mentionToken(id));
        }
      });
    } else if (action === 'color') {
      openColorModal((text, color) => {
        insertNodeAtSelection(editor, createColorChip(text, color));
      });
    } else if (action === 'image') {
      openImageModal((url) => {
        if (isValidHttpUrl(url)) insertNodeAtSelection(editor, createImageChip(url.trim()));
      });
    }
  });

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const form = textarea.closest('form');
      if (form && form.id) {
        // allow shift+enter for newline; plain enter stays as newline in composer
      }
    }
  });

  return {
    getValue() {
      const markup = serializeEditor(editor).trim();
      textarea.value = markup;
      return markup;
    },
    setValue(markup) {
      textarea.value = markup || '';
      populateEditor(editor, markup || '', resolveMention);
    },
    clear() {
      editor.innerHTML = '';
      textarea.value = '';
    },
    focus() {
      editor.focus();
    },
    getEditorEl() {
      return editor;
    }
  };
}

export function tokenToPickerEntity(token) {
  const snap = token.characterSnapshot || {};
  return normalizeCharacter({
    id: token.id,
    name: token.name || snap.name || 'Chapa',
    class: snap.class || token.class,
    level: snap.level || token.level,
    species: snap.species || 'Humanos',
    portraitUrl: snap.portraitUrl || token.portraitUrl || '',
    era: snap.era
  }, token.id);
}
