import { db, doc, updateDoc, serverTimestamp } from './firebase-config.js';
import { inferBoardTokenKind } from './board-vision.js';
import { isTokenDefeated, cellLabel } from './board.js';
import { swrpAlert } from './swrp-dialog.js';

export function normalizeNpcControlAssignments(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [userId, ids] of Object.entries(raw)) {
    if (!userId) continue;
    const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    if (list.length) out[userId] = [...new Set(list)];
  }
  return out;
}

/** userId que controla un NPC aliado por sourceId, o null. */
export function findNpcController(npcSourceId, assignments) {
  if (!npcSourceId || !assignments) return null;
  for (const [userId, ids] of Object.entries(assignments)) {
    if ((ids || []).includes(npcSourceId)) return userId;
  }
  return null;
}

export function allyNpcTokensOnBoard(tokens) {
  return (tokens || []).filter(
    (t) => t.side !== 'enemy'
      && inferBoardTokenKind(t) === 'npc'
      && !isTokenDefeated(t)
  );
}

export function resolveTokenControllerUserId(token, members, assignments) {
  if (!token || token.side === 'enemy') return null;
  const sourceId = token.sourceId;
  if (!sourceId) return null;

  const member = members.find(
    (m) => m.characterId === sourceId || m.npcId === sourceId
  );
  if (member?.userId) return member.userId;

  if (inferBoardTokenKind(token) === 'npc') {
    return findNpcController(sourceId, assignments);
  }
  return null;
}

export async function saveNpcControlAssignments(partyId, assignments) {
  const normalized = normalizeNpcControlAssignments(assignments);
  await updateDoc(doc(db, 'parties', partyId), {
    npcControlAssignments: normalized,
    updatedAt: serverTimestamp()
  });
  return normalized;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Panel GM (escaramuza): asigna NPC aliados en mesa a jugadores unidos.
 */
export function initNpcControlPanel({
  partyId,
  party,
  members,
  getBoard,
  isGM,
  getAssignments,
  setAssignments,
  onSaved
}) {
  const panel = document.getElementById('board-npc-control-panel');
  if (!panel) return null;

  const show = isGM && party?.type === 'Escaramuza';
  panel.classList.toggle('d-none', !show);
  if (!show) return null;

  const listEl = document.getElementById('board-npc-control-list');
  const statusEl = document.getElementById('board-npc-control-status');
  const saveBtn = document.getElementById('btn-save-npc-control');
  if (!listEl || !saveBtn) return null;

  let bound = false;

  function render() {
    const board = getBoard();
    const tokens = allyNpcTokensOnBoard(board?.tokens);
    const players = (members || []).filter((m) => m.playMode !== 'gm');

    if (!players.length) {
      listEl.innerHTML = '<p class="small text-muted mb-0">Ningún jugador unido a la escaramuza.</p>';
      saveBtn.disabled = true;
      return;
    }
    if (!tokens.length) {
      listEl.innerHTML = '<p class="small text-muted mb-0">Coloca NPC aliados en el tablero para asignarlos.</p>';
      saveBtn.disabled = true;
      return;
    }

    saveBtn.disabled = false;
    const assignments = getAssignments();

    listEl.innerHTML = players.map((m) => {
      const assigned = new Set(assignments[m.userId] || []);
      const checks = tokens.map((t) => {
        const checked = assigned.has(t.sourceId);
        return `
          <label class="form-check form-check-sm mb-1">
            <input type="checkbox" class="form-check-input"
              data-npc-user="${escapeHtml(m.userId)}"
              data-npc-source="${escapeHtml(t.sourceId)}"
              ${checked ? 'checked' : ''}>
            <span class="form-check-label">${escapeHtml(t.name)} <span class="text-muted">(${escapeHtml(cellLabel(t.col, t.row))})</span></span>
          </label>`;
      }).join('');
      return `
        <div class="board-npc-control-player mb-3">
          <div class="small text-gold mb-1">${escapeHtml(m.username || 'Jugador')}</div>
          ${checks}
        </div>`;
    }).join('');

    if (!bound) {
      bound = true;
      listEl.addEventListener('change', (e) => {
        const cb = e.target.closest('[data-npc-user][data-npc-source]');
        if (!cb) return;
        const userId = cb.dataset.npcUser;
        const sourceId = cb.dataset.npcSource;
        const next = normalizeNpcControlAssignments(getAssignments());

        for (const uid of Object.keys(next)) {
          next[uid] = (next[uid] || []).filter((id) => id !== sourceId);
          if (!next[uid].length) delete next[uid];
        }
        if (cb.checked) {
          next[userId] = [...(next[userId] || []), sourceId];
        }

        setAssignments(normalizeNpcControlAssignments(next));
        render();
      });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Guardando…';
        try {
          const saved = await saveNpcControlAssignments(partyId, getAssignments());
          setAssignments(saved);
          if (statusEl) statusEl.textContent = 'Asignaciones guardadas.';
          onSaved?.(saved);
        } catch (err) {
          if (statusEl) statusEl.textContent = '';
          await swrpAlert({ title: 'Error al guardar', message: err.message });
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  render();
  return { refresh: render };
}
