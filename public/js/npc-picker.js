import { getClassList } from './compendium-store.js';
import { getClassMeta, readCharacterClass } from './character-card.js';
import {
  filterNpcs,
  buildNpcEraSelectOptions,
  readNpcClassKey,
  renderNpcPickerRow
} from './npcs.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nameInitials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function filterCharacters(characters, { nameQ = '', classQ = '' } = {}) {
  const needle = nameQ.trim().toLowerCase();
  return characters.filter((char) => {
    if (needle && !(char.name || '').toLowerCase().includes(needle)) return false;
    if (classQ && readCharacterClass(char) !== classQ) return false;
    return true;
  });
}

export function renderCharacterPickerRow(char, { selected = false, classMeta, showEra = false } = {}) {
  const meta = classMeta || {};
  const theme = meta.theme || 'soldado';
  const color = meta.color || '#00e5ff';
  const classLabel = meta.label || readCharacterClass(char) || '—';
  const url = char.portraitUrl || '';
  const species = char.species || 'Humanos';
  const level = Number(char.level) || 1;
  const era = char.era || '';
  const thumb = url
    ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">`
    : `<span class="swrp-npc-picker-row__initials">${escapeHtml(nameInitials(char.name))}</span>`;

  const eraBlock = showEra && era
    ? `<span class="swrp-npc-picker-row__dot" aria-hidden="true">·</span>
       <span><span class="swrp-card__era-label">Era:</span> ${escapeHtml(era)}</span>`
    : '';

  return `
    <button type="button"
      class="swrp-npc-picker-row theme-${escapeHtml(theme)}${selected ? ' is-selected' : ''}"
      data-char-id="${escapeHtml(char.id)}"
      style="--npc-class-color:${escapeHtml(color)}">
      <span class="swrp-npc-picker-row__thumb theme-${escapeHtml(theme)}">${thumb}</span>
      <span class="swrp-npc-picker-row__body">
        <span class="swrp-npc-picker-row__name">${escapeHtml(char.name || 'Sin nombre')}</span>
        <span class="swrp-npc-picker-row__meta">
          <span>${escapeHtml(classLabel)}</span>
          <span class="swrp-npc-picker-row__dot" aria-hidden="true">·</span>
          <span>${escapeHtml(species)}</span>
          ${eraBlock}
          <span class="swrp-npc-picker-row__dot" aria-hidden="true">·</span>
          <span>Nv.${level}</span>
        </span>
      </span>
    </button>`;
}

function renderOptionalNoneRow(selected) {
  return `
    <button type="button"
      class="swrp-npc-picker-row swrp-npc-picker-row--none${selected ? ' is-selected' : ''}"
      data-char-id="">
      <span class="swrp-npc-picker-row__thumb swrp-npc-picker-row__thumb--none" aria-hidden="true">—</span>
      <span class="swrp-npc-picker-row__body">
        <span class="swrp-npc-picker-row__name">Ninguno</span>
        <span class="swrp-npc-picker-row__meta">Participar solo como GM</span>
      </span>
    </button>`;
}

function populateClassSelect(classSelect) {
  if (!classSelect || classSelect.options.length) return;
  classSelect.innerHTML = [
    '<option value="">Todas las clases</option>',
    ...getClassList().map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
  ].join('');
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.listEl
 * @param {HTMLElement} [opts.nameInput]
 * @param {HTMLElement} [opts.classSelect]
 * @param {HTMLElement} [opts.eraSelect]
 * @param {Array} opts.npcs
 * @param {string|null} [opts.selectedId]
 * @param {(npc: object|null) => void} [opts.onSelect]
 */
export function initNpcPicker({
  listEl,
  nameInput,
  classSelect,
  eraSelect,
  npcs,
  selectedId = null,
  onSelect
}) {
  if (!listEl) return { getSelected: () => null, refresh: () => {} };

  let selected = selectedId
    ? npcs.find((n) => n.id === selectedId) || null
    : null;

  populateClassSelect(classSelect);

  if (eraSelect && eraSelect.options.length <= 1) {
    eraSelect.innerHTML = buildNpcEraSelectOptions();
  }

  function getFiltered() {
    return filterNpcs(npcs, {
      nameQ: nameInput?.value || '',
      classQ: classSelect?.value || '',
      eraQ: eraSelect?.value || ''
    });
  }

  function render() {
    const filtered = getFiltered();
    if (!filtered.length) {
      listEl.innerHTML = '<p class="small text-muted mb-0">Ningún NPC coincide con los filtros.</p>';
      if (selected && !filtered.some((n) => n.id === selected.id)) {
        selected = null;
        onSelect?.(null);
      }
      return;
    }

    if (!selected || !filtered.some((n) => n.id === selected.id)) {
      selected = filtered[0];
      onSelect?.(selected);
    }

    listEl.innerHTML = filtered.map((npc) => {
      const meta = getClassMeta(readNpcClassKey(npc));
      return renderNpcPickerRow(npc, {
        selected: selected?.id === npc.id,
        classMeta: meta
      });
    }).join('');

    listEl.querySelectorAll('[data-npc-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const npc = filtered.find((n) => n.id === btn.dataset.npcId);
        if (!npc) return;
        selected = npc;
        onSelect?.(npc);
        render();
      });
    });
  }

  const rerender = () => render();
  nameInput?.addEventListener('input', rerender);
  classSelect?.addEventListener('change', rerender);
  eraSelect?.addEventListener('change', rerender);

  render();

  return {
    getSelected: () => selected,
    setSelected(id) {
      selected = npcs.find((n) => n.id === id) || null;
      onSelect?.(selected);
      render();
    },
    refresh(newNpcs) {
      if (newNpcs) npcs = newNpcs;
      render();
    }
  };
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.listEl
 * @param {HTMLElement} [opts.nameInput]
 * @param {HTMLElement} [opts.classSelect]
 * @param {Array} opts.characters
 * @param {string|null} [opts.selectedId]
 * @param {boolean} [opts.optional]
 * @param {(char: object|null) => void} [opts.onSelect]
 */
export function initCharacterPicker({
  listEl,
  nameInput,
  classSelect,
  characters,
  selectedId = null,
  optional = false,
  onSelect
}) {
  if (!listEl) return { getSelected: () => null, refresh: () => {} };

  let selected = selectedId
    ? characters.find((c) => c.id === selectedId) || null
    : (optional ? null : characters[0] || null);

  populateClassSelect(classSelect);

  function getFiltered() {
    return filterCharacters(characters, {
      nameQ: nameInput?.value || '',
      classQ: classSelect?.value || ''
    });
  }

  function render() {
    const filtered = getFiltered();

    if (!filtered.length && !optional) {
      listEl.innerHTML = '<p class="small text-muted mb-0">Ningún personaje coincide con los filtros. Crea uno desde el dashboard.</p>';
      selected = null;
      onSelect?.(null);
      return;
    }

    if (!optional) {
      if (!selected || !filtered.some((c) => c.id === selected.id)) {
        selected = filtered[0] || null;
        onSelect?.(selected);
      }
    } else if (selected && !filtered.some((c) => c.id === selected.id)) {
      // keep null or out-of-filter selection for optional GM
    }

    const rows = [];
    if (optional) {
      rows.push(renderOptionalNoneRow(!selected));
    }
    rows.push(...filtered.map((char) => {
      const meta = getClassMeta(readCharacterClass(char));
      return renderCharacterPickerRow(char, {
        selected: selected?.id === char.id,
        classMeta: meta
      });
    }));

    listEl.innerHTML = rows.join('');

    listEl.querySelectorAll('[data-char-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.charId;
        if (!id) {
          selected = null;
        } else {
          selected = filtered.find((c) => c.id === id) || characters.find((c) => c.id === id) || null;
        }
        onSelect?.(selected);
        render();
      });
    });
  }

  const rerender = () => render();
  nameInput?.addEventListener('input', rerender);
  classSelect?.addEventListener('change', rerender);

  render();

  return {
    getSelected: () => selected,
    setSelected(id) {
      selected = id ? characters.find((c) => c.id === id) || null : null;
      onSelect?.(selected);
      render();
    },
    refresh(newCharacters) {
      if (newCharacters) characters = newCharacters;
      render();
    }
  };
}
