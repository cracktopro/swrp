import {
  db,
  collection,
  getDocs,
  updateDoc,
  doc
} from './firebase-config.js';
import { isAdmin } from './auth.js';

export async function loadAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.username || a.email || '').localeCompare(b.username || b.email || '', 'es'));
}

export async function setUserAdminRole(adminProfile, targetUserId, makeAdmin) {
  if (!isAdmin(adminProfile)) {
    throw new Error('Solo un administrador puede cambiar permisos');
  }
  await updateDoc(doc(db, 'users', targetUserId), {
    rol_global: makeAdmin ? 'Admin' : 'User'
  });
}

export function renderAdminPanel(users, container, { currentUserId, onToggleAdmin }) {
  container.innerHTML = `
    <section class="swrp-panel mb-4">
      <h2 class="swrp-panel__title">Panel de administración</h2>
      <p class="small text-muted mb-3">Otorga o retira permisos de administrador. Solo los admins pueden crear y editar partidas.</p>
      <div class="swrp-admin-list"></div>
    </section>`;

  const list = container.querySelector('.swrp-admin-list');
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'swrp-admin-row';
    const isTargetAdmin = u.rol_global === 'Admin';
    const isSelf = u.id === currentUserId;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(u.username || u.email || u.id)}</strong>
        <span class="small text-muted ms-2">${escapeHtml(u.email || '')}</span>
        ${isTargetAdmin ? '<span class="badge badge-class ms-2" style="border:1px solid var(--swrp-gold);color:var(--swrp-gold)">Admin</span>' : ''}
      </div>
      <button type="button" class="btn btn-sm btn-swrp ${isTargetAdmin ? 'btn-swrp-danger' : 'btn-swrp-primary'}" ${isSelf ? 'disabled' : ''}>
        ${isTargetAdmin ? 'Quitar admin' : 'Hacer admin'}
      </button>`;
    row.querySelector('button')?.addEventListener('click', () => onToggleAdmin(u, !isTargetAdmin));
    list.appendChild(row);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
