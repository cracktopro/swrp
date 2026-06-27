import { swrpAlert, swrpConfirm } from './swrp-dialog.js';

export function normalizeObjectiveEntry(raw) {
  const text = String(raw?.text || '').trim();
  if (!text) return null;
  const id = String(raw?.id || '').trim()
    || `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    title: String(raw?.title || '').trim(),
    text
  };
}

export function normalizeObjectiveList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => normalizeObjectiveEntry(entry)).filter(Boolean);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatObjectiveText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

let modalEl = null;
let modalBs = null;
let editingId = null;

function ensureObjectiveModal() {
  if (modalEl) return;
  modalEl = document.createElement('div');
  modalEl.id = 'swrp-objective-modal';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content swrp-modal-card">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title text-gold" id="swrp-objective-modal-title">Objetivo</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <label class="form-label small" for="swrp-objective-title">Título (opcional)</label>
          <input type="text" class="form-control form-control-sm mb-3" id="swrp-objective-title"
            maxlength="120" placeholder="Ej. Misión principal" autocomplete="off">
          <label class="form-label small" for="swrp-objective-text">Contenido</label>
          <textarea class="form-control form-control-sm" id="swrp-objective-text" rows="6"
            maxlength="4000" placeholder="Regla, misión, pista u objetivo…"></textarea>
        </div>
        <div class="modal-footer border-secondary border-opacity-25">
          <button type="button" class="btn btn-swrp btn-swrp-ghost" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-swrp btn-swrp-primary" id="swrp-objective-save">Guardar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  modalBs = bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true });
}

function openObjectiveModal({ entry = null, onSave }) {
  ensureObjectiveModal();
  editingId = entry?.id || null;
  modalEl.querySelector('#swrp-objective-modal-title').textContent = entry
    ? 'Editar objetivo'
    : 'Nuevo objetivo';
  modalEl.querySelector('#swrp-objective-title').value = entry?.title || '';
  modalEl.querySelector('#swrp-objective-text').value = entry?.text || '';

  const saveBtn = modalEl.querySelector('#swrp-objective-save');
  const handler = async () => {
    const title = modalEl.querySelector('#swrp-objective-title').value;
    const text = modalEl.querySelector('#swrp-objective-text').value;
    if (!String(text || '').trim()) {
      await swrpAlert({ title: 'Contenido requerido', message: 'Escribe el texto del objetivo.' });
      return;
    }
    saveBtn.disabled = true;
    try {
      await onSave({ id: editingId, title, text });
      modalBs.hide();
    } catch (err) {
      await swrpAlert({ title: 'Error', message: err.message || 'No se pudo guardar.' });
    } finally {
      saveBtn.disabled = false;
    }
  };

  saveBtn.replaceWith(saveBtn.cloneNode(true));
  modalEl.querySelector('#swrp-objective-save').addEventListener('click', handler);
  modalBs.show();
  requestAnimationFrame(() => modalEl.querySelector('#swrp-objective-text')?.focus());
}

export function initBoardObjectivesPanel({ board, listEl, addBtn, hintEl, editable = false }) {
  if (!listEl || !board) return { refresh: () => {} };

  addBtn?.classList.toggle('d-none', !editable);
  if (hintEl) {
    hintEl.textContent = editable
      ? 'Añade reglas, misiones y pistas visibles para todos los jugadores.'
      : 'Reglas, misiones y pistas de la partida.';
  }

  function render() {
    const items = board.objectives || [];
    if (!items.length) {
      listEl.innerHTML = '<p class="small text-muted mb-0">No hay objetivos definidos.</p>';
      return;
    }
    listEl.innerHTML = items.map((entry, index) => {
      const titleHtml = entry.title
        ? `<strong class="swrp-objective-entry__title text-gold d-block mb-1">${escapeHtml(entry.title)}</strong>`
        : `<span class="swrp-objective-entry__index text-muted small d-block mb-1">#${index + 1}</span>`;
      const actions = editable
        ? `<div class="swrp-objective-entry__actions">
            <button type="button" class="btn btn-sm btn-swrp btn-swrp-ghost" data-edit="${escapeHtml(entry.id)}" title="Editar">Editar</button>
            <button type="button" class="btn btn-sm btn-swrp btn-swrp-danger" data-delete="${escapeHtml(entry.id)}" title="Eliminar">×</button>
          </div>`
        : '';
      return `
        <article class="swrp-objective-entry" data-id="${escapeHtml(entry.id)}">
          <div class="swrp-objective-entry__head">
            ${titleHtml}
            ${actions}
          </div>
          <div class="swrp-objective-entry__text">${formatObjectiveText(entry.text)}</div>
        </article>`;
    }).join('');

    if (editable) {
      listEl.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const entry = board.objectives.find((e) => e.id === btn.dataset.edit);
          if (!entry) return;
          openObjectiveModal({
            entry,
            onSave: async (data) => {
              await board.updateObjective(entry.id, { title: data.title, text: data.text });
              render();
            }
          });
        });
      });
      listEl.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const entry = board.objectives.find((e) => e.id === btn.dataset.delete);
          if (!entry) return;
          const ok = await swrpConfirm({
            title: 'Eliminar objetivo',
            message: entry.title
              ? `¿Eliminar «${entry.title}»?`
              : '¿Eliminar este objetivo?',
            confirmLabel: 'Eliminar',
            danger: true
          });
          if (!ok) return;
          try {
            await board.removeObjective(entry.id);
            render();
          } catch (err) {
            await swrpAlert({ title: 'Error', message: err.message || 'No se pudo eliminar.' });
          }
        });
      });
    }
  }

  addBtn?.addEventListener('click', () => {
    openObjectiveModal({
      onSave: async (data) => {
        await board.addObjective({ title: data.title, text: data.text });
        render();
      }
    });
  });

  render();
  return { refresh: render };
}
