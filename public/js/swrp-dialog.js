let modalEl = null;
let bsModal = null;
let pendingResolve = null;
let pendingMode = 'confirm';
let dialogConfirmed = false;

function ensureModal() {
  if (modalEl) return;

  modalEl = document.createElement('div');
  modalEl.id = 'swrp-dialog';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.setAttribute('aria-hidden', 'true');
  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content swrp-modal-card swrp-dialog">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title text-gold" id="swrp-dialog-title"></h5>
          <button type="button" class="btn-close btn-close-white" id="swrp-dialog-close" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body">
          <p class="swrp-dialog__message mb-0" id="swrp-dialog-message"></p>
        </div>
        <div class="modal-footer border-secondary border-opacity-25">
          <button type="button" class="btn btn-swrp btn-swrp-ghost" id="swrp-dialog-cancel">Cancelar</button>
          <button type="button" class="btn btn-swrp btn-swrp-primary" id="swrp-dialog-confirm">Aceptar</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modalEl);
  bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true });

  const titleEl = modalEl.querySelector('#swrp-dialog-title');
  const messageEl = modalEl.querySelector('#swrp-dialog-message');
  const cancelBtn = modalEl.querySelector('#swrp-dialog-cancel');
  const confirmBtn = modalEl.querySelector('#swrp-dialog-confirm');
  const closeBtn = modalEl.querySelector('#swrp-dialog-close');

  const finish = () => bsModal.hide();

  confirmBtn.addEventListener('click', () => {
    dialogConfirmed = true;
    finish();
  });

  cancelBtn.addEventListener('click', () => {
    dialogConfirmed = false;
    finish();
  });

  closeBtn.addEventListener('click', () => {
    dialogConfirmed = false;
    finish();
  });

  modalEl.addEventListener('hidden.bs.modal', () => {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    if (pendingMode === 'alert') {
      resolve();
    } else {
      resolve(dialogConfirmed);
    }
  });

  modalEl._refs = { titleEl, messageEl, cancelBtn, confirmBtn };
}

function showDialog({ title, message, confirmText, cancelText, danger, mode }) {
  ensureModal();
  const { titleEl, messageEl, cancelBtn, confirmBtn } = modalEl._refs;

  pendingMode = mode;
  dialogConfirmed = false;
  titleEl.textContent = title || (mode === 'alert' ? 'Aviso' : 'Confirmar');
  messageEl.textContent = message || '';

  confirmBtn.textContent = confirmText || (mode === 'alert' ? 'Aceptar' : 'Confirmar');
  confirmBtn.className = `btn btn-swrp ${danger ? 'btn-swrp-danger' : 'btn-swrp-primary'}`;

  if (mode === 'alert') {
    cancelBtn.classList.add('d-none');
  } else {
    cancelBtn.classList.remove('d-none');
    cancelBtn.textContent = cancelText || 'Cancelar';
  }

  return new Promise((resolve) => {
    pendingResolve = resolve;
    bsModal.show();
  });
}

/** Modal de confirmación. Resuelve true (confirmar) o false (cancelar). */
export function swrpConfirm({
  title = 'Confirmar',
  message = '',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false
} = {}) {
  return showDialog({ title, message, confirmText, cancelText, danger, mode: 'confirm' });
}

/** Modal informativo (sustituto de alert). */
export function swrpAlert({
  title = 'Aviso',
  message = '',
  confirmText = 'Aceptar'
} = {}) {
  return showDialog({ title, message, confirmText, mode: 'alert' });
}
