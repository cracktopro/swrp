import { getClassList } from './compendium-store.js';
import { getClassMeta } from './character-card.js';
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

  if (classSelect && !classSelect.options.length) {
    classSelect.innerHTML = [
      '<option value="">Todas las clases</option>',
      ...getClassList().map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
    ].join('');
  }

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
