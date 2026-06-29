import {
  db,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from './firebase-config.js';
import { buildFreshBoardState, buildLayoutFromBoard, DEFAULT_SCENARIO_ID } from './escaramuza-templates.js';

export { DEFAULT_SCENARIO_ID } from './escaramuza-templates.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

export function generateScenarioId() {
  return `scenario_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function scenarioDocId(scenarioId) {
  return scenarioId;
}

export async function ensurePartyScenariosInitialized(partyId, board) {
  const indexRef = doc(db, 'parties', partyId, 'state', 'scenarios');
  const indexSnap = await getDoc(indexRef);
  if (indexSnap.exists()) return indexSnap.data();

  const boardData = board.getLocalBoardData();
  const id = DEFAULT_SCENARIO_ID;
  await setDoc(doc(db, 'parties', partyId, 'state', scenarioDocId(id)), {
    ...boardData,
    updatedAt: serverTimestamp()
  });
  const index = {
    activeScenarioId: id,
    items: [{ id, name: 'Escenario 1', visibleToPlayers: true, order: 0 }]
  };
  await setDoc(indexRef, { ...index, updatedAt: serverTimestamp() });
  return index;
}

export function initBoardScenarios({
  board,
  isGM,
  partyId = null,
  editorMode = false,
  getStore = null,
  setStore = null,
  onAfterSwitch = () => {}
} = {}) {
  const tabsEl = document.getElementById('board-scenario-tabs');
  const addBtn = document.getElementById('btn-add-scenario');
  if (!tabsEl || !board) return null;

  let activeScenarioId = null;
  let items = [];
  let unsubscribe = null;
  let switching = false;

  addBtn?.classList.toggle('d-none', !isGM);

  function visibleItems() {
    return isGM ? items : items.filter((item) => item.visibleToPlayers);
  }

  function syncEditorStoreItems(nextItems, nextActiveId) {
    if (!editorMode || !getStore || !setStore) return;
    const store = getStore();
    const scenarios = nextItems.map((item) => {
      const existing = store.scenarios.find((s) => s.id === item.id);
      return {
        ...existing,
        id: item.id,
        name: item.name,
        visibleToPlayers: item.visibleToPlayers,
        order: item.order,
        boardLayout: existing?.boardLayout || {}
      };
    });
    setStore({ ...store, activeScenarioId: nextActiveId, scenarios });
  }

  async function persistIndex(nextItems, nextActiveId) {
    activeScenarioId = nextActiveId;
    items = nextItems;
    if (editorMode) {
      syncEditorStoreItems(nextItems, nextActiveId);
      return;
    }
    if (!partyId) return;
    await setDoc(doc(db, 'parties', partyId, 'state', 'scenarios'), {
      activeScenarioId: nextActiveId,
      items: nextItems,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async function saveCurrentScenarioBoard() {
    if (editorMode) {
      if (!getStore || !setStore || !activeScenarioId) return;
      const store = getStore();
      const boardLayout = buildLayoutFromBoard(board, { enemyOnly: false });
      const scenarios = store.scenarios.map((s) => (
        s.id === activeScenarioId ? { ...s, boardLayout } : s
      ));
      setStore({ ...store, scenarios });
      return;
    }
    if (!partyId || !activeScenarioId) return;
    const snapshot = board.getLocalBoardData();
    await setDoc(doc(db, 'parties', partyId, 'state', scenarioDocId(activeScenarioId)), {
      ...snapshot,
      updatedAt: serverTimestamp()
    });
  }

  async function switchToScenario(scenarioId) {
    if (!scenarioId || scenarioId === activeScenarioId || switching) return;
    const target = items.find((item) => item.id === scenarioId);
    if (!target) return;
    if (!isGM && !target.visibleToPlayers) return;

    switching = true;
    try {
      await saveCurrentScenarioBoard();

      let boardData;
      if (editorMode) {
        const store = getStore?.();
        const scenario = store?.scenarios?.find((s) => s.id === scenarioId);
        boardData = buildFreshBoardState(scenario?.boardLayout || {});
      } else {
        const snap = await getDoc(doc(db, 'parties', partyId, 'state', scenarioDocId(scenarioId)));
        boardData = snap.exists() ? snap.data() : buildFreshBoardState({});
      }

      await board.applyBoardData(boardData);
      await board.saveState();
      await persistIndex(items, scenarioId);
      renderTabs();
      onAfterSwitch();
    } finally {
      switching = false;
    }
  }

  async function toggleVisibility(scenarioId) {
    if (!isGM) return;
    const idx = items.findIndex((item) => item.id === scenarioId);
    if (idx < 0) return;
    const nextItems = items.map((item, i) => (
      i === idx ? { ...item, visibleToPlayers: !item.visibleToPlayers } : item
    ));
    if (editorMode && getStore && setStore) {
      const store = getStore();
      setStore({
        ...store,
        scenarios: store.scenarios.map((s) => (
          s.id === scenarioId ? { ...s, visibleToPlayers: !s.visibleToPlayers } : s
        ))
      });
    }
    items = nextItems;
    if (!editorMode && partyId) {
      await setDoc(doc(db, 'parties', partyId, 'state', 'scenarios'), {
        items: nextItems,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    renderTabs();
  }

  async function addScenario() {
    if (!isGM) return;
    await saveCurrentScenarioBoard();
    const newId = generateScenarioId();
    const name = `Escenario ${items.length + 1}`;
    const newItem = {
      id: newId,
      name,
      visibleToPlayers: false,
      order: items.length
    };
    const nextItems = [...items, newItem];

    if (editorMode && getStore && setStore) {
      const store = getStore();
      setStore({
        ...store,
        scenarios: [
          ...store.scenarios,
          { id: newId, name, visibleToPlayers: false, order: newItem.order, boardLayout: {} }
        ]
      });
    } else if (partyId) {
      const emptyBoard = buildFreshBoardState({});
      await setDoc(doc(db, 'parties', partyId, 'state', scenarioDocId(newId)), {
        ...emptyBoard,
        updatedAt: serverTimestamp()
      });
    }

    await persistIndex(nextItems, activeScenarioId);
    await switchToScenario(newId);
  }

  function renderTabs() {
    const list = visibleItems();
    if (!list.length) {
      tabsEl.innerHTML = '';
      return;
    }

    tabsEl.innerHTML = list.map((item) => {
      const isActive = item.id === activeScenarioId;
      const visTitle = item.visibleToPlayers
        ? 'Visible para jugadores — clic para ocultar'
        : 'Oculto para jugadores — clic para mostrar';
      const visLabel = item.visibleToPlayers ? 'Visible' : 'Oculto';
      return `
        <li class="nav-item board-scenario-tab-item" role="presentation">
          <div class="board-scenario-tab${isActive ? ' is-active' : ''}">
            <button type="button"
              class="nav-link${isActive ? ' active' : ''}"
              data-scenario-id="${escapeAttr(item.id)}"
              role="tab"
              ${isActive ? 'aria-selected="true"' : 'aria-selected="false"'}>
              ${escapeHtml(item.name)}
            </button>
            ${isGM ? `
              <button type="button"
                class="board-scenario-visibility btn btn-sm btn-swrp btn-swrp-ghost${item.visibleToPlayers ? ' is-visible' : ''}"
                data-scenario-visibility="${escapeAttr(item.id)}"
                title="${escapeAttr(visTitle)}"
                aria-label="${escapeAttr(visTitle)}">
                ${visLabel}
              </button>` : ''}
          </div>
        </li>`;
    }).join('');

    tabsEl.querySelectorAll('[data-scenario-id]').forEach((btn) => {
      btn.addEventListener('click', () => switchToScenario(btn.dataset.scenarioId));
    });
    tabsEl.querySelectorAll('[data-scenario-visibility]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleVisibility(btn.dataset.scenarioVisibility);
      });
    });
  }

  async function load() {
    if (editorMode) {
      const store = getStore?.();
      if (!store) return;
      items = store.scenarios.map(({ id, name, visibleToPlayers, order }) => ({
        id,
        name,
        visibleToPlayers: visibleToPlayers !== false,
        order
      }));
      activeScenarioId = store.activeScenarioId;
      renderTabs();
      return;
    }

    if (!partyId) return;
    await ensurePartyScenariosInitialized(partyId, board);
    const snap = await getDoc(doc(db, 'parties', partyId, 'state', 'scenarios'));
    if (!snap.exists()) return;
    const data = snap.data();
    activeScenarioId = data.activeScenarioId || DEFAULT_SCENARIO_ID;
    items = (data.items || []).map((item, index) => ({
      id: item.id,
      name: item.name || `Escenario ${index + 1}`,
      visibleToPlayers: item.visibleToPlayers !== false,
      order: Number.isFinite(item.order) ? item.order : index
    }));
    renderTabs();

    unsubscribe?.();
    unsubscribe = onSnapshot(doc(db, 'parties', partyId, 'state', 'scenarios'), (live) => {
      if (!live.exists() || switching) return;
      const liveData = live.data();
      activeScenarioId = liveData.activeScenarioId || activeScenarioId;
      items = (liveData.items || []).map((item, index) => ({
        id: item.id,
        name: item.name || `Escenario ${index + 1}`,
        visibleToPlayers: item.visibleToPlayers !== false,
        order: Number.isFinite(item.order) ? item.order : index
      }));
      renderTabs();
    });
  }

  addBtn?.addEventListener('click', () => { addScenario(); });

  load();

  return {
    switchToScenario,
    saveCurrentScenarioBoard,
    refresh: renderTabs,
    destroy: () => { unsubscribe?.(); }
  };
}
