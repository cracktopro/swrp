import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from './firebase-config.js';
import { getClassMeta } from './character-card.js';
import { saveCharacterProgressFromBoard } from './party-members.js';
import {
  getEnemyTokens,
  normalizeBoardToken,
  inferBoardTokenKind,
  updateAlertedStates,
  computeEnemyStatusIcons,
  drawVisionConeOnCanvas,
  facingLabel,
  FACING_DIRS,
  resetEnemyVisionToSpawn
} from './board-vision.js';
import { swrpConfirm } from './swrp-dialog.js';
import { renderDiceResultHtml } from './dice.js';
import {
  buildBoardTokenMap,
  buildRosterMap,
  renderNarrativeMarkupHtml
} from './party-markup.js';

const ICON_BASE = 'icons';
export const COVER_DEFENSE_BONUS = 4;

const ENEMY_STATUS_MODIFIERS = {
  out_of_range: 'out-of-range',
  no_vision: 'no-vision',
  vision: 'vision',
  alarm: 'alarm',
  cover: 'cover'
};

function uniqueBoardTokenId(template) {
  const base = `${template.kind}_${template.sourceId}`;
  return `${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function cloneInstanceSnapshot(snapshot) {
  if (!snapshot) return null;
  const cloned = {
    ...snapshot,
    skills: Array.isArray(snapshot.skills)
      ? snapshot.skills.map((s) => (typeof s === 'string' ? s : stripUndefinedDeep({ ...s })))
      : []
  };
  return stripUndefinedDeep(cloned);
}

/** Firestore no acepta undefined en ningún nivel del documento. */
function stripUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined);
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    const cleaned = stripUndefinedDeep(val);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

const MOVE_RANGE = 5;
const MAX_TURN_ACTIONS = 2;
const MAX_ATTACKS_PER_TURN = 1;
const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function defaultTurnActions() {
  return { movesUsed: 0, attacksUsed: 0, activeMode: null };
}

function computeOrthogonalReachable(fromCol, fromRow, token, tokens, cols, rows, maxRange) {
  const blocked = new Set(
    tokens.filter((t) => t.id !== token.id).map((t) => `${t.col},${t.row}`)
  );
  const reachable = new Set();
  const queue = [[fromCol, fromRow, 0]];
  const visited = new Set([`${fromCol},${fromRow}`]);

  while (queue.length) {
    const [c, r, dist] = queue.shift();
    if (dist > 0) reachable.add(`${c},${r}`);
    if (dist >= maxRange) continue;
    for (const [dc, dr] of ORTHO_DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const key = `${nc},${nr}`;
      if (visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      queue.push([nc, nr, dist + 1]);
    }
  }
  return reachable;
}

function normalizeTurnActions(value) {
  if (!value || typeof value !== 'object') return defaultTurnActions();
  return {
    movesUsed: Number(value.movesUsed) || 0,
    attacksUsed: Number(value.attacksUsed) || 0,
    activeMode: value.activeMode === 'move' || value.activeMode === 'attack' ? value.activeMode : null
  };
}
const CELL = 48;
const DEFAULT_COLS = 24;
const DEFAULT_ROWS = 16;
const MIN_GRID = 4;
const MAX_GRID = 48;
const DRAG_THRESHOLD = 5;
const LABEL_SIZE = 28;

export class TacticalBoard {
  constructor(canvas, tokenLayer, logEl, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tokenLayer = tokenLayer;
    this.logEl = logEl;
    this.initiativeLogEl = options.initiativeLogEl || null;
    this.initiativeOrderEl = options.initiativeOrderEl || null;
    this.initiativeLog = [];
    this.initiativeOpen = false;
    this.turnOrder = [];
    this.turnOrderIndex = 0;
    this.turnActions = defaultTurnActions();
    this.colLabelsEl = options.colLabelsEl || null;
    this.rowLabelsEl = options.rowLabelsEl || null;
    this.tooltipEl = options.tooltipEl || null;
    this.partyId = options.partyId;
    this.isGM = options.isGM || false;
    this.cols = DEFAULT_COLS;
    this.rows = DEFAULT_ROWS;
    this.tokens = [];
    this.mapImage = null;
    this._mapUrl = null;
    this.pointer = null;
    this.combatStarted = false;
    this.activeTurn = null;
    this.highlightedTokenId = null;
    this.highlightSource = null;
    this.roster = options.roster || [];
    this.userId = options.userId || null;
    this.userCharacterSourceId = options.userCharacterSourceId || null;
    this.selectedTokenId = null;
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.onTokenClick = options.onTokenClick || (() => {});
    this.onTokensChange = options.onTokensChange || (() => {});
    this.onMapUrlChange = options.onMapUrlChange || (() => {});
    this.onCombatStateChange = options.onCombatStateChange || (() => {});
    this.onInitiativeStateChange = options.onInitiativeStateChange || (() => {});
    this.onGridSizeChange = options.onGridSizeChange || (() => {});
    this.onGMTokenControl = options.onGMTokenControl || (() => {});
    this.onActiveTurnChange = options.onActiveTurnChange || (() => {});
    this.init();
  }

  init() {
    this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this._onMove = (e) => this.onPointerMove(e);
    this._onUp = (e) => this.onPointerUp(e);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('mouseup', this._onUp);
    this.applyGridDimensions();
  }

  applyGridDimensions() {
    const w = this.cols * CELL;
    const h = this.rows * CELL;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.tokenLayer) {
      this.tokenLayer.style.width = `${w}px`;
      this.tokenLayer.style.height = `${h}px`;
    }
    this.renderAxisLabels();
    this.onGridSizeChange(this.cols, this.rows);
  }

  renderAxisLabels() {
    if (this.colLabelsEl) {
      this.colLabelsEl.innerHTML = '';
      this.colLabelsEl.style.width = `${this.cols * CELL}px`;
      for (let c = 0; c < this.cols; c++) {
        const el = document.createElement('span');
        el.className = 'board-axis-label board-axis-label--col';
        el.style.width = `${CELL}px`;
        el.textContent = colLetter(c);
        this.colLabelsEl.appendChild(el);
      }
    }
    if (this.rowLabelsEl) {
      this.rowLabelsEl.innerHTML = '';
      this.rowLabelsEl.style.height = `${this.rows * CELL}px`;
      for (let r = 0; r < this.rows; r++) {
        const el = document.createElement('span');
        el.className = 'board-axis-label board-axis-label--row';
        el.style.height = `${CELL}px`;
        el.textContent = String(r + 1);
        this.rowLabelsEl.appendChild(el);
      }
    }
  }

  async applyBoardData(data) {
    if (!data) return;
    this.tokens = (data.tokens || []).map((t) => normalizeBoardToken({ ...t }));
    this.combatStarted = !!data.combatStarted;
    this.activeTurn = data.activeTurn ?? null;
    this.initiativeOpen = this.combatStarted
      ? (data.initiativeOpen ?? false)
      : false;
    this.turnOrder = data.turnOrder || [];
    this.turnOrderIndex = data.turnOrderIndex ?? 0;
    this.turnActions = normalizeTurnActions(data.turnActions);
    if (data.grid?.cols) this.cols = clampGrid(data.grid.cols);
    if (data.grid?.rows) this.rows = clampGrid(data.grid.rows);
    this.tokens = this.tokens.filter(
      (t) => t.col >= 0 && t.col < this.cols && t.row >= 0 && t.row < this.rows
    );
    const mapUrl = data.mapUrl || null;
    if (mapUrl) {
      this._mapUrl = mapUrl;
      this.onMapUrlChange(mapUrl);
      await this.loadMap(mapUrl);
    } else {
      this._mapUrl = null;
      this.mapImage = null;
      this.onMapUrlChange('');
    }
    this.applyGridDimensions();
    this.render();
    this.initiativeLog = data.initiativeLog || [];
    this.renderLog(data.log || []);
    this.renderInitiativeLog(this.initiativeLog);
    this.renderInitiativeOrderPreview(
      this.turnOrder.length ? this.turnOrder : null
    );
    this.onCombatStateChange(this.combatStarted);
    this.onInitiativeStateChange?.(this.initiativeOpen);
    this.onTurnActionsChange?.(this.turnActions);
    this.onActiveTurnChange(this.activeTurn);
    this.onTokensChange(this.tokens);
  }

  async loadState() {
    if (!this.partyId) return;
    const snap = await getDoc(doc(db, 'parties', this.partyId, 'state', 'board'));
    if (snap.exists()) {
      await this.applyBoardData(snap.data());
    } else {
      this.tokens = [];
      this.combatStarted = false;
      this.activeTurn = null;
      this.initiativeOpen = false;
      this.turnOrder = [];
      this.turnOrderIndex = 0;
      this.turnActions = defaultTurnActions();
      this.initiativeLog = [];
      this._mapUrl = null;
      this.mapImage = null;
      this.onMapUrlChange('');
      this.applyGridDimensions();
      this.render();
      this.renderLog([]);
      this.renderInitiativeLog([]);
      this.onCombatStateChange(this.combatStarted);
      this.onInitiativeStateChange?.(this.initiativeOpen);
      this.onActiveTurnChange(this.activeTurn);
      this.onTokensChange(this.tokens);
    }
  }

  async captureBoardSnapshot() {
    if (!this.partyId) return null;
    updateAlertedStates(this.tokens, this.cols, this.rows);
    const snap = await getDoc(doc(db, 'parties', this.partyId, 'state', 'board'));
    const current = snap.exists() ? snap.data() : {};
    return stripUndefinedDeep({
      tokens: this.tokens.map((t) => stripUndefinedDeep(t)),
      mapUrl: this._mapUrl ?? current.mapUrl ?? null,
      combatStarted: this.combatStarted,
      grid: { cols: this.cols, rows: this.rows, cellSize: CELL },
      activeTurn: this.activeTurn,
      log: current.log || [],
      initiativeLog: this.initiativeLog,
      initiativeOpen: this.initiativeOpen,
      turnOrder: this.turnOrder,
      turnOrderIndex: this.turnOrderIndex,
      turnActions: normalizeTurnActions(this.turnActions)
    });
  }

  progressSaveTimestamp(data) {
    if (data?.savedAtMs != null) return Number(data.savedAtMs);
    const savedAt = data?.savedAt;
    if (savedAt?.toMillis) return savedAt.toMillis();
    if (savedAt?.seconds != null) return savedAt.seconds * 1000;
    return 0;
  }

  async listProgressSaves() {
    if (!this.partyId) return [];
    const snap = await getDocs(collection(db, 'parties', this.partyId, 'state'));
    return snap.docs
      .filter((d) => d.id.startsWith('progress_'))
      .map((d) => {
        const data = d.data();
        const savedAtMs = this.progressSaveTimestamp(data);
        return {
          id: d.id,
          name: data.name || 'Sin nombre',
          savedAtMs: savedAtMs || null
        };
      })
      .sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0));
  }

  async saveProgress(name) {
    if (!this.partyId) return null;
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Introduce un nombre para el guardado.');
    const board = await this.captureBoardSnapshot();
    const savedAtMs = Date.now();
    const id = `progress_${savedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    await setDoc(doc(db, 'parties', this.partyId, 'state', id), {
      type: 'boardSave',
      name: trimmed,
      savedAt: serverTimestamp(),
      savedAtMs,
      board: stripUndefinedDeep(board)
    });
    return { id, savedAtMs };
  }

  async deleteProgress(saveId) {
    if (!this.partyId || !saveId) return;
    if (!saveId.startsWith('progress_')) {
      throw new Error('Guardado no válido.');
    }
    const snap = await getDoc(doc(db, 'parties', this.partyId, 'state', saveId));
    if (!snap.exists()) throw new Error('Partida guardada no encontrada.');
    await deleteDoc(doc(db, 'parties', this.partyId, 'state', saveId));
  }

  async loadProgress(saveId) {
    if (!this.partyId || !saveId) return;
    const snap = await getDoc(doc(db, 'parties', this.partyId, 'state', saveId));
    if (!snap.exists()) throw new Error('Partida guardada no encontrada.');
    const { board: boardData } = snap.data();
    if (!boardData) throw new Error('El guardado no contiene datos del tablero.');
    await this.applyBoardData(boardData);
    await this.saveState({
      mapUrl: boardData.mapUrl ?? null,
      combatStarted: boardData.combatStarted,
      grid: boardData.grid,
      activeTurn: boardData.activeTurn ?? null,
      log: boardData.log || [],
      initiativeLog: boardData.initiativeLog || [],
      initiativeOpen: boardData.initiativeOpen,
      turnOrder: boardData.turnOrder || [],
      turnOrderIndex: boardData.turnOrderIndex ?? 0,
      turnActions: normalizeTurnActions(boardData.turnActions)
    });
  }

  watchState() {
    if (!this.partyId) return;
    return onSnapshot(doc(db, 'parties', this.partyId, 'state', 'board'), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      this.tokens = (data.tokens || []).map((t) => normalizeBoardToken({ ...t }));
      this.combatStarted = !!data.combatStarted;
      this.activeTurn = data.activeTurn ?? null;
      this.initiativeOpen = data.combatStarted
        ? (data.initiativeOpen ?? false)
        : false;
      this.turnOrder = data.turnOrder || [];
      this.turnOrderIndex = data.turnOrderIndex ?? 0;
      this.turnActions = normalizeTurnActions(data.turnActions);
      let gridChanged = false;
      if (data.grid?.cols && data.grid.cols !== this.cols) {
        this.cols = clampGrid(data.grid.cols);
        gridChanged = true;
      }
      if (data.grid?.rows && data.grid.rows !== this.rows) {
        this.rows = clampGrid(data.grid.rows);
        gridChanged = true;
      }
      if (gridChanged) {
        this.tokens = this.tokens.filter(
          (t) => t.col >= 0 && t.col < this.cols && t.row >= 0 && t.row < this.rows
        );
        this.applyGridDimensions();
      }
      if (data.mapUrl && data.mapUrl !== this._mapUrl) {
        this._mapUrl = data.mapUrl;
        this.onMapUrlChange(data.mapUrl);
        this.loadMap(data.mapUrl).then(() => this.render());
      } else if (!gridChanged) {
        this.render();
      }
      this.initiativeLog = data.initiativeLog || [];
      this.renderLog(data.log || []);
      this.renderInitiativeLog(this.initiativeLog);
      this.renderInitiativeOrderPreview(
        this.turnOrder.length ? this.turnOrder : null
      );
      this.onCombatStateChange(this.combatStarted);
      this.onInitiativeStateChange?.(this.initiativeOpen);
      this.onTurnActionsChange?.(this.turnActions);
      this.onActiveTurnChange(this.activeTurn);
      this.onTokensChange(this.tokens);
    });
  }

  async loadMap(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.mapImage = img;
        resolve(true);
      };
      img.onerror = () => {
        this.mapImage = null;
        resolve(false);
      };
      img.src = url;
    });
  }

  async setMapUrl(url) {
    const trimmed = url.trim();
    if (!trimmed) throw new Error('Indica una URL de imagen');
    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('La URL debe ser http o https');
      }
    } catch (err) {
      if (err.message.includes('http')) throw err;
      throw new Error('URL no válida');
    }
    await this.saveState({ mapUrl: trimmed });
    this._mapUrl = trimmed;
    this.onMapUrlChange(trimmed);
    const ok = await this.loadMap(trimmed);
    if (!ok) throw new Error('No se pudo cargar la imagen. Comprueba que la URL sea un enlace directo.');
    this.render();
    if (this.combatStarted) {
      await this.appendLog(logEntrySystem('cargó el mapa de fondo'));
    }
  }

  async clearMapUrl() {
    this._mapUrl = null;
    this.mapImage = null;
    await this.saveState({ mapUrl: null });
    this.onMapUrlChange('');
    this.render();
    if (this.combatStarted) {
      await this.appendLog(logEntrySystem('retiró el mapa de fondo'));
    }
  }

  async setGridSize(cols, rows) {
    if (!this.isGM) return;
    this.cols = clampGrid(cols);
    this.rows = clampGrid(rows);
    this.tokens = this.tokens.filter(
      (t) => t.col >= 0 && t.col < this.cols && t.row >= 0 && t.row < this.rows
    );
    this.applyGridDimensions();
    this.render();
    await this.saveState({ grid: { cols: this.cols, rows: this.rows, cellSize: CELL } });
    if (this.combatStarted) {
      await this.appendLog(logEntrySystem(`ajustó la cuadrícula a ${this.cols}×${this.rows}`));
    }
  }

  isStructuredCombat() {
    return this.combatStarted && !this.initiativeOpen;
  }

  isNarrativePhase() {
    return !this.combatStarted;
  }

  async startCombat({ fromSurpriseAttack = false } = {}) {
    if (this.combatStarted) return;
    if (!this.isGM && !fromSurpriseAttack) return;
    this.combatStarted = true;
    this.initiativeOpen = true;
    this.initiativeLog = [];
    this.activeTurn = null;
    this.turnOrder = [];
    this.turnOrderIndex = 0;
    this.resetTurnActions();
    await this.saveState({
      combatStarted: true,
      initiativeOpen: true,
      initiativeLog: [],
      activeTurn: null,
      turnOrder: [],
      turnOrderIndex: 0,
      turnActions: this.turnActions
    });
    this.renderInitiativeLog([]);
    this.renderInitiativeOrderPreview(null);
    await this.appendLog(logEntrySystem('abrió la tirada de iniciativa'), { force: true });
    this.onCombatStateChange(true);
    this.onInitiativeStateChange?.(this.initiativeOpen);
    this.onActiveTurnChange(null);
    this.renderTokenLayer();
  }

  async completeInitiative(turnOrder) {
    if (!this.isGM || !this.initiativeOpen || !turnOrder?.length) return;
    const hadPriorTurnOrder = this.turnOrder?.length > 0;
    this.combatStarted = true;
    this.initiativeOpen = false;
    this.turnOrder = turnOrder;
    this.turnOrderIndex = 0;
    this.activeTurn = turnOrder[0];
    this.initiativeLog = [];
    this.resetTurnActions();
    await this.saveState({
      combatStarted: true,
      initiativeOpen: false,
      turnOrder,
      turnOrderIndex: 0,
      activeTurn: this.activeTurn,
      initiativeLog: [],
      turnActions: this.turnActions
    });
    this.renderInitiativeLog([]);
    this.renderInitiativeOrderPreview(null);
    if (!hadPriorTurnOrder) {
      await this.appendLog(logEntrySystem('inició el combate'), { force: true });
    }
    const orderLabels = turnOrder.map((t) => t.label).join(' → ');
    await this.appendLog(logEntrySystem(`Orden de iniciativa: ${orderLabels}`));
    if (this.activeTurn?.label) {
      await this.appendLog(logEntrySystem(`cede el turno a ${this.activeTurn.label}`));
    }
    this.onCombatStateChange(true);
    this.onInitiativeStateChange?.(this.initiativeOpen);
    this.onActiveTurnChange(this.activeTurn);
    this.renderTokenLayer();
  }

  isActionPhase() {
    return this.isNarrativePhase() || this.isStructuredCombat();
  }

  usesRestrictedMovement() {
    if (this.turnActions.activeMode !== 'move') return false;
    if (this.isStructuredCombat()) return true;
    if (!this.isNarrativePhase() || !this.activeTurn) return false;
    return this.canControlActiveTurn();
  }

  async advanceTurn({ force = false } = {}) {
    if (force) {
      if (!this.canUserForceEndNarrativeTurn()) return;
    } else if (!this.canUserAdvanceTurn()) {
      return;
    }
    if (this.isNarrativePhase()) {
      this.activeTurn = null;
      this.resetTurnActions();
      const message = force
        ? 'fin del turno (anticipado) — a la espera de que el GM asigne el siguiente'
        : 'fin del turno — a la espera de que el GM asigne el siguiente';
      await this.appendLog(logEntrySystem(message), { force: true });
      await this.saveState({
        activeTurn: null,
        turnActions: this.turnActions
      });
      this.onActiveTurnChange(null);
      this.renderTokenLayer();
      return;
    }
    const prevIndex = this.turnOrderIndex;
    const cycleCompleted = prevIndex === this.turnOrder.length - 1;
    if (cycleCompleted) {
      this.initiativeOpen = true;
      this.initiativeLog = [];
      this.activeTurn = null;
      this.resetTurnActions();
      await this.appendLog(logEntrySystem('fin del ciclo de turnos — nueva tirada de iniciativa'));
      await this.saveState({
        initiativeOpen: true,
        initiativeLog: [],
        activeTurn: null
      });
      this.renderInitiativeLog([]);
      this.onInitiativeStateChange?.(this.initiativeOpen);
      this.onActiveTurnChange(null);
      this.renderTokenLayer();
      return;
    }
    const nextIndex = prevIndex + 1;
    this.turnOrderIndex = nextIndex;
    this.activeTurn = this.turnOrder[nextIndex];
    this.resetTurnActions();
    await this.saveState({
      activeTurn: this.activeTurn,
      turnOrderIndex: this.turnOrderIndex
    });
    if (this.activeTurn?.label) {
      await this.appendLog(logEntrySystem(`cede el turno a ${this.activeTurn.label}`));
    }
    this.onActiveTurnChange(this.activeTurn);
    this.renderTokenLayer();
  }

  async endCombat() {
    if (!this.isGM || !this.combatStarted) return;
    this.combatStarted = false;
    this.initiativeOpen = false;
    this.activeTurn = null;
    this.turnOrder = [];
    this.turnOrderIndex = 0;
    this.initiativeLog = [];
    this.resetTurnActions();
    await this.saveState({
      combatStarted: false,
      initiativeOpen: false,
      activeTurn: null,
      turnOrder: [],
      turnOrderIndex: 0,
      initiativeLog: [],
      turnActions: defaultTurnActions()
    });
    await this.appendLog(logEntrySystem('finalizó el combate'), { force: true });
    this.renderInitiativeLog([]);
    this.renderInitiativeOrderPreview(null);
    this.onCombatStateChange(false);
    this.onInitiativeStateChange?.(this.initiativeOpen);
    this.onActiveTurnChange(null);
    this.renderTokenLayer();
  }

  async setActiveTurn(turn) {
    if (!this.isGM) return;
    this.activeTurn = turn || null;
    this.resetTurnActions();
    if (this.turnOrder.length && turn) {
      const idx = this.turnOrder.findIndex((t) => turnKeyFromTurn(t) === turnKeyFromTurn(turn));
      if (idx >= 0) this.turnOrderIndex = idx;
    }
    await this.saveState({
      activeTurn: this.activeTurn,
      turnOrderIndex: this.turnOrderIndex
    });
    if (turn?.label) {
      const entry = logEntrySystem(`cede el turno a ${turn.label}`);
      if (this.combatStarted) {
        await this.appendLog(entry);
      } else {
        await this.appendLog(entry, { force: true });
      }
    }
    this.onActiveTurnChange(this.activeTurn);
    this.renderTokenLayer();
  }

  async updateTokenHp(tokenId, hp) {
    if (!this.isGM) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token) return;
    const maxHp = getTokenMaxHp(token);
    const clamped = Math.max(0, Math.min(Number(hp) || 0, maxHp));
    if (token.characterSnapshot) {
      token.characterSnapshot.hp = clamped;
    }
    await this.saveState({});
    this.render();
    this.onTokensChange(this.tokens);
  }

  async updateTokenForce(tokenId, force) {
    if (!this.isGM) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token || !tokenHasForceStat(token)) return;
    const clamped = Math.max(0, Number(force) || 0);
    if (token.characterSnapshot) {
      token.characterSnapshot.force = clamped;
    }
    await this.saveState({});
    this.render();
    this.onTokensChange(this.tokens);
  }

  async updateTokenFromStats(tokenId, entity) {
    if (!this.isGM || !entity) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token) return;

    const tokenKind = inferBoardTokenKind(token);
    token.kind = tokenKind;

    const meta = getClassMeta(entity.class || entity.classKey);
    const maxHp = Number(entity.maxHp ?? entity.hp) || 1;
    const currentHp = Math.min(getTokenHp(token), maxHp);
    const sourceId = token.characterSnapshot?.id || token.sourceId;
    const isHero = tokenKind === 'character';

    const snapshot = stripUndefinedDeep({
      id: sourceId,
      name: entity.name,
      species: entity.species || 'Humanos',
      class: entity.class || entity.classKey,
      classKey: entity.classKey || entity.class,
      level: Number(entity.level) || 1,
      type: token.characterSnapshot?.type || (isHero ? 'Heroe' : 'NPC'),
      portraitUrl: entity.portraitUrl || '',
      skills: entity.skills || [],
      attack: Number(entity.attack) || 0,
      defense: Number(entity.defense) || 0,
      damage: Number(entity.damage) || 0,
      hp: currentHp,
      maxHp,
      force: entity.force ?? null
    });

    token.name = entity.name;
    token.level = snapshot.level;
    token.class = snapshot.class;
    token.classLabel = meta.label;
    token.theme = meta.theme;
    token.color = meta.color;
    token.portraitUrl = snapshot.portraitUrl;
    token.characterSnapshot = cloneInstanceSnapshot(snapshot);

    if (isHero && sourceId) {
      await saveCharacterProgressFromBoard(this.partyId, sourceId, snapshot, { currentHp });
    }

    if (token.side === 'enemy') {
      updateAlertedStates(this.tokens, this.cols, this.rows);
    }

    await this.saveState({});
    this.render();
    this.onTokensChange(this.tokens);
  }

  resetTurnActions() {
    this.turnActions = defaultTurnActions();
    this.onTurnActionsChange?.(this.turnActions);
  }

  getActionsUsed() {
    return (this.turnActions.movesUsed || 0) + (this.turnActions.attacksUsed || 0);
  }

  isTurnActionsComplete() {
    return this.getActionsUsed() >= MAX_TURN_ACTIONS;
  }

  canControlActiveTurn() {
    if (!this.activeTurn) return false;
    if (!this.combatStarted) {
      if (this.activeTurn.kind === 'enemy') return this.isGM;
      return this.activeTurn.kind === 'player' && this.activeTurn.userId === this.userId;
    }
    if (this.initiativeOpen) return false;
    if (this.activeTurn.kind === 'enemy') return this.isGM;
    return this.activeTurn.kind === 'player' && this.activeTurn.userId === this.userId;
  }

  canUserAdvanceTurn() {
    if (!this.isTurnActionsComplete()) return false;
    if (this.isNarrativePhase()) {
      return this.canControlActiveTurn();
    }
    if (!this.combatStarted || this.initiativeOpen || !this.turnOrder.length) return false;
    return this.canControlActiveTurn();
  }

  canUserForceEndNarrativeTurn() {
    if (!this.isNarrativePhase() || !this.activeTurn) return false;
    if (this.isTurnActionsComplete()) return false;
    return this.canControlActiveTurn();
  }

  canUseAttackMode() {
    if (!this.canControlActiveTurn()) return false;
    if (this.getActionsUsed() >= MAX_TURN_ACTIONS) return false;
    if ((this.turnActions.attacksUsed || 0) >= MAX_ATTACKS_PER_TURN) return false;
    return true;
  }

  canUseMoveMode() {
    if (!this.canControlActiveTurn()) return false;
    if (this.getActionsUsed() >= MAX_TURN_ACTIONS) return false;
    return true;
  }

  async selectActionMode(mode) {
    if (!this.canControlActiveTurn()) return false;
    if (mode === 'move' && !this.canUseMoveMode()) return false;
    if (mode === 'attack' && !this.canUseAttackMode()) return false;
    this.turnActions.activeMode = mode;
    await this.saveState({ turnActions: this.turnActions });
    const actor = this.getActiveTurnActor();
    if (actor && mode === 'attack') {
      const actionKey = this.isNarrativePhase() ? 'surprise' : 'attack';
      await this.appendLog(logEntryTurnAction(actor, actionKey), {
        force: this.isNarrativePhase()
      });
    }
    this.onTurnActionsChange?.(this.turnActions);
    this.render();
    return true;
  }

  async consumeMoveAction() {
    this.turnActions.movesUsed = (this.turnActions.movesUsed || 0) + 1;
    this.turnActions.activeMode = null;
    await this.saveState({ turnActions: this.turnActions });
    this.onTurnActionsChange?.(this.turnActions);
    this.render();
  }

  async consumeAttackAction() {
    if (this.isNarrativePhase()) {
      await this.finishSurpriseAttack();
      return;
    }
    if ((this.turnActions.attacksUsed || 0) >= MAX_ATTACKS_PER_TURN) return;
    this.turnActions.attacksUsed = (this.turnActions.attacksUsed || 0) + 1;
    this.turnActions.activeMode = null;
    await this.saveState({ turnActions: this.turnActions });
    this.onTurnActionsChange?.(this.turnActions);
    this.render();
  }

  async finishSurpriseAttack() {
    if (!this.isNarrativePhase()) return;
    this.turnActions.movesUsed = MAX_TURN_ACTIONS;
    this.turnActions.attacksUsed = MAX_TURN_ACTIONS;
    this.turnActions.activeMode = null;
    await this.saveState({ turnActions: this.turnActions });
    this.onTurnActionsChange?.(this.turnActions);
    await this.appendLog(logEntrySystem('Ataque sorpresa — se abre la tirada de iniciativa'), { force: true });
    await this.startCombat({ fromSurpriseAttack: true });
  }

  getActiveTurnActor() {
    const turn = this.activeTurn;
    if (!turn) return null;
    if (turn.kind === 'enemy') {
      return { name: turn.label || 'Enemigos', class: 'soldado', color: '#ff1744' };
    }
    const token = this.tokens.find(
      (t) => t.kind === 'character' && t.sourceId === turn.sourceId
    );
    if (token) {
      const meta = getClassMeta(token.class);
      return {
        name: token.name,
        class: token.class,
        color: token.color || meta.color
      };
    }
    const char = this.roster.find((c) => c.id === turn.sourceId);
    if (char) {
      const meta = getClassMeta(char.class);
      return { name: char.name, class: char.class, color: meta.color };
    }
    return { name: turn.label || 'Jugador', class: 'soldado', color: getClassMeta('soldado').color };
  }

  getMovementTokenForTurn() {
    if (!this.activeTurn) return null;
    if (this.activeTurn.kind === 'enemy') return null;
    return this.tokens.find(
      (t) => t.kind === 'character' && t.sourceId === this.activeTurn.sourceId
    ) || null;
  }

  isCellReachableForMove(token, col, row, fromCol, fromRow) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const reachable = computeOrthogonalReachable(
      fromCol,
      fromRow,
      token,
      this.tokens,
      this.cols,
      this.rows,
      MOVE_RANGE
    );
    return reachable.has(`${col},${row}`);
  }

  canUserMoveToken(token) {
    if (isTokenDefeated(token)) return false;

    if (!this.combatStarted) {
      if (this.isGM && !this.activeTurn) return true;
      if (!this.activeTurn) return false;
      if (this.getActionsUsed() >= MAX_TURN_ACTIONS) return false;
      if (this.turnActions.activeMode !== 'move') return false;
      if (this.activeTurn.kind === 'enemy') {
        return this.isGM && token.side === 'enemy';
      }
      return this.activeTurn.kind === 'player'
        && this.activeTurn.userId === this.userId
        && token.kind === 'character'
        && token.sourceId === this.activeTurn.sourceId
        && token.side !== 'enemy';
    }

    if (this.initiativeOpen) return this.isGM;

    if (!this.canControlActiveTurn()) return false;
    if (this.turnActions.activeMode !== 'move') return false;
    if (this.getActionsUsed() >= MAX_TURN_ACTIONS) return false;

    if (this.activeTurn.kind === 'enemy') {
      return this.isGM && token.side === 'enemy';
    }

    return token.kind === 'character'
      && token.sourceId === this.activeTurn.sourceId
      && token.side !== 'enemy';
  }

  canUseAttackActions() {
    if (!this.canControlActiveTurn()) return false;
    if ((this.turnActions.attacksUsed || 0) >= MAX_ATTACKS_PER_TURN) return false;
    return this.turnActions.activeMode === 'attack' && this.getActionsUsed() < MAX_TURN_ACTIONS;
  }

  canUseDiceConsole() {
    if (this.isStructuredCombat()) return true;
    return this.canUseAttackActions();
  }

  isTokenActiveTurn(token) {
    if (!this.activeTurn || isTokenDefeated(token)) return false;
    if (this.activeTurn.kind === 'enemy') return token.side === 'enemy';
    if (this.activeTurn.kind === 'player') {
      return token.kind === 'character' && token.sourceId === this.activeTurn.sourceId;
    }
    return false;
  }

  setHighlightToken(tokenId, source = 'token') {
    if (this.highlightedTokenId === tokenId && this.highlightSource === source) return;
    this.highlightedTokenId = tokenId;
    this.highlightSource = source;
    this.renderGrid();
    this.renderTokenLayer();
  }

  clearHighlightToken(source) {
    if (source && this.highlightSource !== source) return;
    if (!this.highlightedTokenId) return;
    this.highlightedTokenId = null;
    this.highlightSource = null;
    this.renderGrid();
    this.renderTokenLayer();
  }

  async clearLog() {
    if (!this.isGM) return;
    const ok = await swrpConfirm({
      title: 'Borrar historial',
      message: '¿Borrar el historial del tablero y volver a la fase narrativa?',
      confirmText: 'Borrar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    this.combatStarted = false;
    this.activeTurn = null;
    this.initiativeOpen = false;
    this.turnOrder = [];
    this.turnOrderIndex = 0;
    this.initiativeLog = [];
    this.resetTurnActions();
    await this.saveState({
      combatStarted: false,
      activeTurn: null,
      initiativeOpen: false,
      turnOrder: [],
      turnOrderIndex: 0,
      log: [],
      initiativeLog: [],
      turnActions: defaultTurnActions()
    });
    this.renderLog([]);
    this.renderInitiativeLog([]);
    this.renderInitiativeOrderPreview(null);
    this.onCombatStateChange(false);
    this.onInitiativeStateChange?.(this.initiativeOpen);
    this.onActiveTurnChange(null);
    this.renderTokenLayer();
  }

  tokenOnBoard(sourceId, kind) {
    return this.tokens.find((t) => t.sourceId === sourceId && t.kind === kind);
  }

  tokensFromSource(sourceId, kind) {
    return this.tokens.filter((t) => t.sourceId === sourceId && t.kind === kind);
  }

  async placeTokenFromTemplate(template, { col, row, side, facing = 'left' }) {
    if (!this.isGM) throw new Error('Solo el GM puede colocar chapas');
    if (this.tokenAt(col, row)) throw new Error('Celda ocupada');
    if (template.kind === 'character' && this.tokenOnBoard(template.sourceId, template.kind)) {
      throw new Error('Este personaje ya está en el tablero');
    }

    const tokenData = stripUndefinedDeep({
      ...template,
      id: uniqueBoardTokenId(template),
      characterSnapshot: cloneInstanceSnapshot(template.characterSnapshot),
      initials: nameInitials(template.name),
      col,
      row,
      side: side === 'enemy' ? 'enemy' : 'ally',
      portraitUrl: template.portraitUrl || template.characterSnapshot?.portraitUrl || ''
    });

    if (tokenData.side === 'enemy') {
      tokenData.facing = facing;
      tokenData.alerted = false;
      tokenData.visionSuppressed = false;
    } else {
      delete tokenData.facing;
      delete tokenData.alerted;
      delete tokenData.visionSuppressed;
    }

    const token = normalizeBoardToken(stripUndefinedDeep(tokenData));
    if (token.characterSnapshot && token.characterSnapshot.hp == null) {
      token.characterSnapshot.hp = getTokenMaxHp(token);
    }

    this.tokens.push(token);
    updateAlertedStates(this.tokens, this.cols, this.rows);
    await this.saveState({});
    if (this.combatStarted) {
      await this.appendLog(logEntryToken(token, 'place', { cell: cellLabel(col, row) }));
    }
    this.render();
    this.onTokensChange(this.tokens);
    return token;
  }

  async updateTokenProperties(tokenId, { side, facing, inCover }) {
    if (!this.isGM) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token) return;

    const prevFacing = token.facing;
    token.side = side === 'enemy' ? 'enemy' : 'ally';
    if (inCover !== undefined) {
      token.inCover = !!inCover;
    }
    if (token.side === 'enemy') {
      token.facing = FACING_DIRS.includes(facing) ? facing : (token.facing || 'left');
      if (prevFacing !== token.facing) token.visionSuppressed = false;
    } else {
      delete token.facing;
      delete token.visionSuppressed;
    }

    updateAlertedStates(this.tokens, this.cols, this.rows);
    await this.saveState({});
    this.render();
    this.onTokensChange(this.tokens);
  }

  async resetTokenAlert(tokenId) {
    if (!this.isGM) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token || token.side !== 'enemy') return;
    resetEnemyVisionToSpawn(token);
    normalizeBoardToken(token);
    updateAlertedStates(this.tokens, this.cols, this.rows);
    await this.saveState({});
    this.render();
    this.onTokensChange(this.tokens);
  }

  selectToken(tokenId) {
    this.selectedTokenId = tokenId;
    const token = this.tokens.find((t) => t.id === tokenId) || null;
    this.onSelectionChange(token);
    this.renderTokenLayer();
  }

  async removeTokenBySource(sourceId, kind) {
    if (!this.isGM) return;
    const token = this.tokenOnBoard(sourceId, kind);
    if (!token) return;
    await this.removeToken(token.id);
  }

  async removeToken(tokenId) {
    if (!this.isGM) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token) return;
    this.tokens = this.tokens.filter((t) => t.id !== tokenId);
    if (this.selectedTokenId === tokenId) {
      this.selectedTokenId = null;
      this.onSelectionChange(null);
    }
    await this.saveState({});
    if (this.combatStarted) {
      await this.appendLog(logEntryToken(token, 'remove', { cell: cellLabel(token.col, token.row) }));
    }
    this.render();
    this.onTokensChange(this.tokens);
  }

  async deleteSelectedToken() {
    if (!this.isGM || !this.selectedTokenId) return;
    await this.removeToken(this.selectedTokenId);
  }

  cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return {
      col: Math.floor(x / CELL),
      row: Math.floor(y / CELL)
    };
  }

  tokenAt(col, row) {
    return this.tokens.find((t) => t.col === col && t.row === row);
  }

  onCanvasMouseDown(e) {
    if (this.pointer) return;
    const { col, row } = this.cellFromEvent(e);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;

    const token = this.tokenAt(col, row);
    if (token) {
      this.beginPointer(e, token);
      return;
    }

    if (this.isGM) {
      this.selectedTokenId = null;
      this.onSelectionChange(null);
      this.renderTokenLayer();
    }
  }

  beginPointer(e, token) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.hideTooltip();
    this.pointer = {
      token,
      startX: e.clientX,
      startY: e.clientY,
      fromCol: token.col,
      fromRow: token.row,
      dragging: false
    };
  }

  onPointerMove(e) {
    if (this.pointer?.dragging) {
      this.hideTooltip();
    }
    if (!this.pointer) return;
    const dx = e.clientX - this.pointer.startX;
    const dy = e.clientY - this.pointer.startY;

    if (!this.pointer.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (!this.canUserMoveToken(this.pointer.token)) {
        this.pointer = null;
        return;
      }
      this.pointer.dragging = true;
      this.selectToken(this.pointer.token.id);
    }

    const { col, row } = this.cellFromEvent(e);
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      const fromCol = this.pointer.fromCol;
      const fromRow = this.pointer.fromRow;
      const inRange = this.usesRestrictedMovement()
        ? this.isCellReachableForMove(this.pointer.token, col, row, fromCol, fromRow)
        : !this.tokens.find((t) => t.col === col && t.row === row && t.id !== this.pointer.token.id);
      if (inRange) {
        this.pointer.token.col = col;
        this.pointer.token.row = row;
        this.render();
      }
    }
  }

  async onPointerUp() {
    if (!this.pointer) return;
    const { token, dragging, fromCol, fromRow } = this.pointer;
    this.pointer = null;

    if (dragging) {
      if (token.col === fromCol && token.row === fromRow) return;
      const isActionMove = this.turnActions.activeMode === 'move' && this.usesRestrictedMovement();
      if (isActionMove && !this.isCellReachableForMove(token, token.col, token.row, fromCol, fromRow)) {
        token.col = fromCol;
        token.row = fromRow;
        this.render();
        const { swrpAlert } = await import('./swrp-dialog.js');
        await swrpAlert({
          title: 'Movimiento inválido',
          message: `Solo puedes moverte hasta ${MOVE_RANGE} casillas en línea recta (sin diagonales) por acción.`
        });
        return;
      }
      await this.saveState({});
      const actor = this.getActiveTurnActor();
      if (isActionMove && actor) {
        await this.appendLog(logEntryTokenMove(actor, {
          fromCell: cellLabel(fromCol, fromRow),
          toCell: cellLabel(token.col, token.row)
        }), { force: this.isNarrativePhase() });
        await this.consumeMoveAction();
      } else if (this.combatStarted && actor) {
        await this.appendLog(logEntryToken(token, 'move', {
          fromCell: cellLabel(fromCol, fromRow),
          toCell: cellLabel(token.col, token.row)
        }));
      } else if (this.isNarrativePhase() && this.isGM && !this.activeTurn) {
        await this.appendLog(logEntryToken(token, 'move', {
          fromCell: cellLabel(fromCol, fromRow),
          toCell: cellLabel(token.col, token.row)
        }), { force: true });
      }
      this.render();
      return;
    }

    if (!dragging) {
      if (this.isGM) {
        this.onGMTokenControl(token);
      } else {
        this.onTokenClick(token);
      }
      return;
    }
  }

  showTokenTooltip(token, clientX, clientY) {
    if (!this.tooltipEl || !token) return;
    this.tooltipEl.innerHTML = buildTokenTooltipHtml(token, this.tokens, this.cols, this.rows);
    this.tooltipEl.hidden = false;
    this.tooltipEl.style.left = `${clientX}px`;
    this.tooltipEl.style.top = `${clientY}px`;
  }

  hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.hidden = true;
  }

  async appendInitiativeRoll(actorMeta, roll) {
    if (!this.initiativeOpen) return;
    const entry = stripUndefinedDeep({
      actorKey: actorMeta.actorKey,
      actorName: actorMeta.name,
      actorClass: actorMeta.class || null,
      actorColor: actorMeta.color || null,
      kind: actorMeta.kind,
      userId: actorMeta.userId ?? null,
      sourceId: actorMeta.sourceId ?? null,
      tokenId: actorMeta.tokenId ?? null,
      roll,
      rollLabel: 'Iniciativa ',
      time: timeLabel()
    });
    const refDoc = doc(db, 'parties', this.partyId, 'state', 'board');
    const snap = await getDoc(refDoc);
    const current = snap.exists() ? snap.data() : {};
    const initiativeLog = [...(current.initiativeLog || []), stripUndefinedDeep(entry)];
    await setDoc(refDoc, { initiativeLog, updatedAt: serverTimestamp() }, { merge: true });
    this.initiativeLog = initiativeLog;
    this.renderInitiativeLog(initiativeLog);
    this.onInitiativeLogChange?.();
  }

  renderInitiativeLog(entries) {
    if (!this.initiativeLogEl) return;
    const list = entries || [];
    if (!list.length) {
      this.initiativeLogEl.innerHTML = '<p class="small text-muted mb-0">Las tiradas de iniciativa aparecerán aquí…</p>';
      return;
    }
    this.initiativeLogEl.innerHTML = list.map((entry) => {
      if (typeof entry === 'string') {
        return `<div class="board-initiative-log__line">${escapeHtml(entry)}</div>`;
      }
      return `<div class="board-initiative-log__line">${renderInitiativeLineHtml(entry)}</div>`;
    }).join('');
    this.initiativeLogEl.scrollTop = this.initiativeLogEl.scrollHeight;
  }

  renderInitiativeOrderPreview(order) {
    if (!this.initiativeOrderEl) return;
    if (!order?.length) {
      this.initiativeOrderEl.classList.add('d-none');
      this.initiativeOrderEl.innerHTML = '';
      return;
    }
    this.initiativeOrderEl.classList.remove('d-none');
    this.initiativeOrderEl.innerHTML = `
      <p class="small text-gold mb-1">Orden del primer turno</p>
      <ol class="board-initiative-order__list mb-0">
        ${order.map((item) => {
          const color = item.color || getClassMeta(item.class).color;
          return `<li><span style="color:${escapeHtml(color)}">${escapeHtml(item.label)}</span> <span class="text-muted">(${item.initiativeTotal})</span></li>`;
        }).join('')}
      </ol>`;
  }

  async appendLog(entry, { force = false } = {}) {
    if (!force && !this.combatStarted) return;
    const refDoc = doc(db, 'parties', this.partyId, 'state', 'board');
    const snap = await getDoc(refDoc);
    const current = snap.exists() ? snap.data() : { log: [] };
    const log = [...(current.log || []), stripUndefinedDeep(entry)].slice(-100);
    await setDoc(refDoc, { ...stripUndefinedDeep({ log }), updatedAt: serverTimestamp() }, { merge: true });
    this.renderLog(log);
  }

  async saveState(partial = {}) {
    if (!this.partyId) return;
    updateAlertedStates(this.tokens, this.cols, this.rows);
    const refDoc = doc(db, 'parties', this.partyId, 'state', 'board');
    const snap = await getDoc(refDoc);
    const current = snap.exists() ? snap.data() : { tokens: [], log: [] };
    const payload = {
      ...stripUndefinedDeep({
        tokens: this.tokens.map((t) => stripUndefinedDeep(t)),
        mapUrl: partial.mapUrl !== undefined ? partial.mapUrl : (current.mapUrl ?? null),
        combatStarted: partial.combatStarted ?? this.combatStarted,
        grid: partial.grid ?? current.grid ?? { cols: this.cols, rows: this.rows, cellSize: CELL },
        activeTurn: partial.activeTurn !== undefined
          ? partial.activeTurn
          : (this.activeTurn ?? current.activeTurn ?? null),
        log: partial.log !== undefined ? partial.log : (current.log || []),
        initiativeLog: partial.initiativeLog !== undefined
          ? partial.initiativeLog
          : (current.initiativeLog || []),
        initiativeOpen: partial.initiativeOpen !== undefined
          ? partial.initiativeOpen
          : (this.initiativeOpen ?? current.initiativeOpen ?? true),
        turnOrder: partial.turnOrder !== undefined
          ? partial.turnOrder
          : (this.turnOrder ?? current.turnOrder ?? []),
        turnOrderIndex: partial.turnOrderIndex !== undefined
          ? partial.turnOrderIndex
          : (this.turnOrderIndex ?? current.turnOrderIndex ?? 0),
        turnActions: partial.turnActions !== undefined
          ? partial.turnActions
          : normalizeTurnActions(this.turnActions ?? current.turnActions)
      }),
      updatedAt: serverTimestamp()
    };
    await setDoc(refDoc, payload, { merge: true });
  }

  renderLog(entries) {
    if (!this.logEl) return;
    const list = entries || [];
    if (!list.length) {
      this.logEl.innerHTML = '';
      return;
    }
    this.logEl.innerHTML = list.map((entry) => renderLogEntryHtml(entry, {
      boardTokens: this.tokens,
      roster: this.roster
    })).join('');
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  render() {
    this.renderGrid();
    this.renderTokenLayer();
  }

  renderGrid() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.mapImage) {
      ctx.drawImage(this.mapImage, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= this.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, this.canvas.height);
      ctx.stroke();
    }
    for (let r = 0; r <= this.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(this.canvas.width, r * CELL);
      ctx.stroke();
    }

    this.drawMoveRange();
    this.drawVisionCones();
  }

  drawMoveRange() {
    if (!this.usesRestrictedMovement()) return;
    if (!this.canControlActiveTurn()) return;
    const ctx = this.ctx;
    const originToken = this.pointer?.dragging
      ? this.pointer.token
      : (this.activeTurn?.kind === 'enemy'
        ? null
        : this.getMovementTokenForTurn());
    if (!originToken) return;

    const fromCol = this.pointer?.dragging ? this.pointer.fromCol : originToken.col;
    const fromRow = this.pointer?.dragging ? this.pointer.fromRow : originToken.row;

    ctx.fillStyle = 'rgba(57, 255, 20, 0.14)';
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (!this.isCellReachableForMove(originToken, c, r, fromCol, fromRow)) continue;
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
      }
    }
  }

  drawVisionCones() {
    const ctx = this.ctx;
    getEnemyTokens(this.tokens).forEach((enemy) => {
      if (isTokenDefeated(enemy)) return;
      const hovered = enemy.id === this.highlightedTokenId;
      drawVisionConeOnCanvas(ctx, enemy.col, enemy.row, enemy.facing || 'left', CELL, {
        tint: hovered ? '255, 214, 0' : '0, 229, 255',
        preview: hovered
      });
    });
  }

  renderTokenLayer() {
    if (!this.tokenLayer) return;
    this.tokenLayer.innerHTML = '';
    const pad = 0;

    this.tokens.forEach((token) => {
      const initials = token.initials || nameInitials(token.name);
      const side = token.side === 'enemy' ? 'enemy' : 'ally';
      const defeated = isTokenDefeated(token);
      const portraitUrl = getTokenPortraitUrl(token);
      const statusHtml = !defeated
        ? renderTokenStatusIcons(token, this.tokens, this.cols, this.rows)
        : '';

      const wrap = document.createElement('div');
      const highlighted = token.id === this.highlightedTokenId;
      wrap.className = `swrp-board-token-wrap swrp-board-token-wrap--${side}${defeated ? ' is-defeated' : ''}${this.isTokenActiveTurn(token) ? ' is-active-turn' : ''}${highlighted ? ' is-highlighted' : ''}`;
      wrap.style.left = `${token.col * CELL + pad}px`;
      wrap.style.top = `${token.row * CELL + pad}px`;

      if (statusHtml) {
        wrap.insertAdjacentHTML('afterbegin', statusHtml);
      }

      const chip = document.createElement('div');
      chip.className = `swrp-board-token swrp-board-token--${side} theme-${token.theme || 'soldado'}${defeated ? ' swrp-board-token--defeated' : ''}${this.selectedTokenId === token.id ? ' is-selected' : ''}${this.pointer?.token?.id === token.id && this.pointer.dragging ? ' is-dragging' : ''}`;
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      chip.style.setProperty('--token-color', token.color || '#00e5ff');

      const badgeEl = document.createElement('div');
      badgeEl.className = 'swrp-board-token__side-badge';
      badgeEl.textContent = defeated ? 'DERROTADO' : (side === 'enemy' ? 'ENEMIGO' : 'ALIADO');

      const faceEl = document.createElement('div');
      faceEl.className = 'swrp-board-token__face';

      if (portraitUrl) {
        const img = document.createElement('img');
        img.className = 'swrp-board-token__img';
        img.src = portraitUrl;
        img.alt = token.name;
        img.loading = 'lazy';
        img.addEventListener('error', () => {
          const initialsEl = document.createElement('span');
          initialsEl.className = 'swrp-board-token__initials';
          initialsEl.textContent = initials;
          img.replaceWith(initialsEl);
        });
        faceEl.appendChild(img);
      } else {
        const initialsEl = document.createElement('span');
        initialsEl.className = 'swrp-board-token__initials';
        initialsEl.textContent = initials;
        faceEl.appendChild(initialsEl);
      }

      chip.appendChild(badgeEl);
      chip.appendChild(faceEl);
      chip.insertAdjacentHTML('beforeend', renderTokenHealthBarHtml(token));

      chip.addEventListener('mousedown', (ev) => this.beginPointer(ev, token));
      if (this.isGM) {
        chip.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          this.onTokenClick(token);
        });
      }
      chip.addEventListener('mouseenter', (ev) => {
        if (this.pointer?.dragging) return;
        if (side === 'enemy' && !defeated) this.setHighlightToken(token.id, 'token');
        this.showTokenTooltip(token, ev.clientX, ev.clientY - 12);
      });
      chip.addEventListener('mousemove', (ev) => {
        if (this.pointer?.dragging || this.tooltipEl?.hidden) return;
        this.showTokenTooltip(token, ev.clientX, ev.clientY - 12);
      });
      chip.addEventListener('mouseleave', () => {
        if (side === 'enemy') this.clearHighlightToken('token');
        this.hideTooltip();
      });
      wrap.appendChild(chip);
      this.tokenLayer.appendChild(wrap);
    });
  }
}

function turnKeyFromTurn(turn) {
  if (!turn) return '';
  return `${turn.kind}:${turn.userId || ''}:${turn.sourceId || ''}:${turn.tokenId || ''}`;
}

export function logEntrySystem(message) {
  return {
    time: timeLabel(),
    type: 'system',
    actor: { isGM: true, name: 'GM' },
    message
  };
}

export function logEntryTurnAction(actor, actionType) {
  const meta = getClassMeta(actor.class);
  const labels = { move: 'Movimiento', attack: 'Ataque', surprise: 'Ataque sorpresa' };
  return {
    time: timeLabel(),
    type: 'turn_action',
    actionType,
    actionLabel: labels[actionType] || actionType,
    actor: {
      isGM: false,
      name: actor.name,
      class: actor.class,
      color: actor.color || meta.color
    }
  };
}

export function logEntryTokenMove(actor, { fromCell, toCell }) {
  const meta = getClassMeta(actor.class);
  return {
    time: timeLabel(),
    type: 'move',
    actor: {
      isGM: false,
      name: actor.name,
      class: actor.class,
      color: actor.color || meta.color
    },
    fromCell,
    toCell,
    isActionMove: true
  };
}

export function logEntryToken(token, action, { cell, fromCell, toCell } = {}) {
  return {
    time: timeLabel(),
    type: action,
    actor: {
      isGM: false,
      name: token.name,
      class: token.class,
      color: token.color || getClassMeta(token.class).color
    },
    cell,
    fromCell,
    toCell
  };
}

export function logEntryDice(actor, roll, rollLabel = '', cell = null) {
  const meta = getClassMeta(actor.class);
  return {
    time: timeLabel(),
    type: 'dice',
    actor: {
      isGM: false,
      name: actor.name,
      class: actor.class,
      color: actor.color || meta.color
    },
    roll,
    rollLabel,
    cell: cell || null
  };
}

export function logEntrySkill(actor, skill, cell = null) {
  const meta = getClassMeta(actor.class);
  return {
    time: timeLabel(),
    type: 'skill',
    actor: {
      isGM: false,
      name: actor.name,
      class: actor.class,
      color: actor.color || meta.color
    },
    skillName: skill.name,
    skillType: skill.type || '',
    message: skill.description || '',
    cell: cell || null
  };
}

export function logEntryAction(actor, message, cell = null) {
  const meta = getClassMeta(actor.class);
  return {
    time: timeLabel(),
    type: 'action',
    actor: {
      isGM: false,
      name: actor.name,
      class: actor.class,
      color: actor.color || meta.color
    },
    message,
    cell: cell || null
  };
}

export function getTokenMaxHp(token) {
  return Number(token.characterSnapshot?.maxHp ?? token.maxHp) || 1;
}

export function getTokenHp(token) {
  const max = getTokenMaxHp(token);
  const hp = token.characterSnapshot?.hp ?? token.hp;
  return hp == null ? max : Number(hp);
}

export function getTokenForce(token) {
  const snap = token?.characterSnapshot;
  if (snap?.force != null) return Number(snap.force);
  const meta = getClassMeta(token?.class);
  if (!meta.hasForce) return null;
  const base = snap?.force ?? token?.force;
  return base == null ? null : Number(base);
}

export function isTokenInCover(token) {
  return token?.inCover === true;
}

export function getTokenBaseDefense(token) {
  const snap = token?.characterSnapshot;
  if (snap?.defense != null) return Number(snap.defense);
  if (token?.defense != null) return Number(token.defense);
  return 0;
}

export function getTokenEffectiveDefense(token) {
  const base = getTokenBaseDefense(token);
  return base + (isTokenInCover(token) ? COVER_DEFENSE_BONUS : 0);
}

export function tokenHasForceStat(token) {
  if (!token) return false;
  if (getClassMeta(token.class).hasForce) return true;
  const snap = token.characterSnapshot;
  return snap?.force != null || token.force != null;
}

export function isTokenDefeated(token) {
  return getTokenHp(token) <= 0;
}

export function isCombatEnded(tokens) {
  const enemies = tokens.filter((t) => t.side === 'enemy');
  const allies = tokens.filter((t) => t.side !== 'enemy');
  const enemiesDefeated = enemies.length > 0 && enemies.every((t) => getTokenHp(t) <= 0);
  const alliesDefeated = allies.length > 0 && allies.every((t) => getTokenHp(t) <= 0);
  return enemiesDefeated || alliesDefeated;
}

function renderInitiativeLineHtml(entry) {
  const color = entry.actorColor || getClassMeta(entry.actorClass).color;
  const who = `<span class="board-initiative__actor" style="color:${escapeHtml(color)}">[${escapeHtml(entry.actorName)}]</span>`;
  const roll = entry.roll;
  const label = entry.rollLabel || 'Iniciativa ';
  const modPart = roll.modifier ? ` ${roll.modifier >= 0 ? '+' : ''}${roll.modifier}` : '';
  return `${who} ${escapeHtml(label.trim())}${escapeHtml(roll.notation)}${modPart} = <strong>${roll.total}</strong>`;
}

export function getHealthBarFill(hp, maxHp) {
  const max = Math.max(1, Number(maxHp) || 1);
  const current = Math.max(0, Math.min(Number(hp) ?? max, max));
  const ratio = current / max;
  const widthPercent = ratio * 100;

  const green = { r: 57, g: 255, b: 20 };
  const yellow = { r: 255, g: 214, b: 0 };
  const red = { r: 255, g: 23, b: 68 };

  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const rgb = (c) => `rgb(${c.r}, ${c.g}, ${c.b})`;
  const mix = (c1, c2, t) => rgb({
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t)
  });

  let color;
  let glow;
  if (ratio > 2 / 3) {
    const t = (ratio - 2 / 3) / (1 / 3);
    color = mix(yellow, green, t);
    glow = 'green';
  } else if (ratio > 1 / 3) {
    const t = (ratio - 1 / 3) / (1 / 3);
    color = mix(red, yellow, t);
    glow = 'yellow';
  } else if (ratio > 0) {
    const t = ratio / (1 / 3);
    color = mix({ r: 140, g: 12, b: 36 }, red, t);
    glow = 'red';
  } else {
    color = rgb({ r: 80, g: 80, b: 80 });
    glow = 'red';
  }

  return { widthPercent, color, glow, ratio };
}

const HP_PER_VISUAL_SEGMENT = 20;

export function getHealthSegmentCount(maxHp) {
  const max = Math.max(1, Number(maxHp) || 1);
  return Math.max(1, Math.ceil(max / HP_PER_VISUAL_SEGMENT));
}

export function getSegmentFillPercent(segIndex, hp, maxHp) {
  const max = Math.max(1, Number(maxHp) || 1);
  const current = Math.max(0, Math.min(Number(hp) ?? max, max));
  const segStart = segIndex * HP_PER_VISUAL_SEGMENT;
  if (segStart >= max) return 0;
  const segSize = Math.min(HP_PER_VISUAL_SEGMENT, max - segStart);
  const inSeg = Math.max(0, Math.min(current - segStart, segSize));
  return (inSeg / segSize) * 100;
}

function buildHealthBarTrackHtml(hp, maxHp, color, glow) {
  const count = getHealthSegmentCount(maxHp);
  const segments = [];
  for (let i = 0; i < count; i++) {
    const width = getSegmentFillPercent(i, hp, maxHp);
    segments.push(
      `<div class="swrp-hp-bar__segment">` +
      `<div class="swrp-hp-bar__fill swrp-hp-bar__fill--${glow}" ` +
      `style="width:${width.toFixed(2)}%;background-color:${color}"></div>` +
      `</div>`
    );
  }
  return `<div class="swrp-hp-bar__track swrp-hp-bar__track--segmented" data-segments="${count}">${segments.join('')}</div>`;
}

/** @deprecated Usar getHealthBarFill / renderHealthBarHtml */
export function getHealthBarSegments(hp, maxHp) {
  const { ratio } = getHealthBarFill(hp, maxHp);
  if (ratio <= 0) return ['empty', 'empty', 'empty'];
  if (ratio > 2 / 3) return ['green', 'green', 'green'];
  if (ratio > 1 / 3) return ['yellow', 'yellow', 'empty'];
  return ['red', 'empty', 'empty'];
}

export function renderHealthBarHtml(hp, maxHp, { variant = 'token' } = {}) {
  const { color, glow } = getHealthBarFill(hp, maxHp);
  const variantClass = variant === 'modal' ? 'swrp-hp-bar--modal' : 'swrp-hp-bar--token';
  return `<div class="swrp-hp-bar ${variantClass}" aria-hidden="true">${buildHealthBarTrackHtml(hp, maxHp, color, glow)}</div>`;
}

export function updateHealthBarElement(barEl, hp, maxHp) {
  if (!barEl) return;
  const { color, glow } = getHealthBarFill(hp, maxHp);
  const count = getHealthSegmentCount(maxHp);
  const track = barEl.querySelector('.swrp-hp-bar__track');
  if (!track || Number(track.dataset.segments) !== count) {
    barEl.innerHTML = buildHealthBarTrackHtml(hp, maxHp, color, glow);
    return;
  }
  track.querySelectorAll('.swrp-hp-bar__segment').forEach((seg, i) => {
    const fill = seg.querySelector('.swrp-hp-bar__fill');
    if (!fill) return;
    fill.style.width = `${getSegmentFillPercent(i, hp, maxHp).toFixed(2)}%`;
    fill.style.backgroundColor = color;
    fill.classList.remove('swrp-hp-bar__fill--green', 'swrp-hp-bar__fill--yellow', 'swrp-hp-bar__fill--red');
    fill.classList.add(`swrp-hp-bar__fill--${glow}`);
  });
}

export function renderTokenHealthBarHtml(token) {
  return renderHealthBarHtml(getTokenHp(token), getTokenMaxHp(token), { variant: 'token' });
}

export function renderLogEntryHtml(entry, context = {}) {
  if (typeof entry === 'string') {
    return `<div class="combat-log__entry combat-log__entry--legacy">${escapeHtml(entry)}</div>`;
  }

  const rosterMap = buildRosterMap(context.roster || []);
  const boardTokenMap = buildBoardTokenMap(context.boardTokens || []);
  const markupOpts = { rosterMap, boardTokenMap };

  const time = `<span class="combat-log__time">[${escapeHtml(entry.time || '')}]</span>`;

  if (entry.type === 'system' || entry.actor?.isGM) {
    const msg = escapeHtml(entry.message || '');
    return `<div class="combat-log__entry">${time} <span class="combat-log__gm">[GM]</span> ${msg}</div>`;
  }

  const color = entry.actor?.color || getClassMeta(entry.actor?.class).color;
  const name = `<span class="combat-log__actor" style="color:${escapeHtml(color)}">${escapeHtml(entry.actor?.name || '')}</span>`;
  const cell = (label) => `<span class="combat-log__cell">${escapeHtml(label)}</span>`;

  if (entry.type === 'turn_action') {
    const badgeClass = entry.actionType === 'move'
      ? 'combat-log__action-type--move'
      : 'combat-log__action-type--attack';
    const label = escapeHtml(entry.actionLabel || entry.actionType || 'Acción');
    return `<div class="combat-log__entry">${time} ${name} elige <span class="combat-log__action-type ${badgeClass}">${label}</span>.</div>`;
  }
  if (entry.type === 'move') {
    const arrow = '<span class="combat-log__arrow" aria-hidden="true">→</span>';
    if (entry.isActionMove) {
      return `<div class="combat-log__entry combat-log__entry--move">${time} ${name} <span class="combat-log__action-type combat-log__action-type--move">Movimiento</span> <span class="combat-log__move-path">${cell(entry.fromCell)}${arrow}${cell(entry.toCell)}</span></div>`;
    }
    return `<div class="combat-log__entry">${time} ${name} se movió de ${cell(entry.fromCell)} a ${cell(entry.toCell)}.</div>`;
  }
  if (entry.type === 'place') {
    return `<div class="combat-log__entry">${time} ${name} colocado en ${cell(entry.cell)}.</div>`;
  }
  if (entry.type === 'remove') {
    return `<div class="combat-log__entry">${time} ${name} retirado de ${cell(entry.cell)}.</div>`;
  }
  if (entry.type === 'dice') {
    const cellBadge = entry.cell ? ` ${cell(entry.cell)}` : '';
    const diceHtml = renderDiceResultHtml(entry.roll, entry.rollLabel || '');
    return `<div class="combat-log__entry combat-log__entry--dice">${time} ${name}${cellBadge} ${diceHtml}</div>`;
  }
  if (entry.type === 'skill') {
    const skill = escapeHtml(entry.skillName || 'Habilidad');
    const detail = entry.message ? `: ${escapeHtml(entry.message)}` : '';
    const cellBadge = entry.cell ? ` ${cell(entry.cell)}` : '';
    return `<div class="combat-log__entry">${time} ${name}${cellBadge} usa <span class="combat-log__skill">${skill}</span>${detail}</div>`;
  }
  if (entry.type === 'action') {
    const cellBadge = entry.cell ? ` ${cell(entry.cell)}` : '';
    const actionHtml = renderNarrativeMarkupHtml(entry.message || '', markupOpts);
    return `<div class="combat-log__entry">${time} ${name}${cellBadge}: <span class="combat-log__action">${actionHtml}</span></div>`;
  }

  return `<div class="combat-log__entry">${time} ${name}</div>`;
}

function getTokenPortraitUrl(token) {
  return token?.portraitUrl || token?.characterSnapshot?.portraitUrl || '';
}

function renderTokenStatusIcons(token, tokens, cols, rows) {
  const items = [];

  if (token.side === 'enemy') {
    const { icons, labels } = computeEnemyStatusIcons(token, tokens, cols, rows);
    icons.forEach((iconId, i) => {
      items.push({
        iconId,
        mod: ENEMY_STATUS_MODIFIERS[iconId] || iconId,
        label: labels[i] || iconId
      });
    });
  }

  if (isTokenInCover(token)) {
    items.push({ iconId: 'cover', mod: 'cover', label: 'A cubierto' });
  }

  if (!items.length) return '';

  const inner = items.map(({ iconId, mod, label }) => `
    <span class="swrp-board-token__status-icon-wrap swrp-board-token__status-icon-wrap--${mod}" title="${escapeHtml(label)}">
      <img
        class="swrp-board-token__status-icon"
        src="${ICON_BASE}/${iconId}.svg"
        alt="${escapeHtml(label)}"
      >
    </span>`).join('');

  return `<span class="swrp-board-token__status-icons">${inner}</span>`;
}

export function buildTokenTooltipHtml(token, allTokens = [], cols = 0, rows = 0) {
  const meta = getClassMeta(token.class);
  const classLabel = token.classLabel || meta.label;
  const level = Number(token.level) || 1;
  const portraitUrl = getTokenPortraitUrl(token);
  const side = token.side === 'enemy' ? 'enemy' : 'ally';
  const defeated = isTokenDefeated(token);
  const sideLabel = defeated ? 'Derrotado' : (side === 'enemy' ? 'Enemigo' : 'Aliado');
  const sideClass = defeated ? 'defeated' : side;

  const portraitBlock = portraitUrl
    ? `<img class="board-token-tooltip__img" src="${escapeHtml(portraitUrl)}" alt="">`
    : `<div class="board-token-tooltip__img board-token-tooltip__img--placeholder">${escapeHtml(nameInitials(token.name))}</div>`;

  let enemyExtra = '';
  if (!defeated && side === 'enemy' && allTokens.length) {
    const { icons, labels } = computeEnemyStatusIcons(token, allTokens, cols, rows);
    const facing = token.facing || 'left';
    const statusTags = icons.map((id, i) => {
      const mod = ENEMY_STATUS_MODIFIERS[id] || id;
      return `<span class="board-token-tooltip__tag board-token-tooltip__tag--${mod}">${escapeHtml(labels[i])}</span>`;
    }).join('');
    enemyExtra = `
      <span class="board-token-tooltip__facing">Mira: ${escapeHtml(facingLabel(facing))}</span>
      ${statusTags ? `<span class="board-token-tooltip__status">${statusTags}</span>` : ''}`;
  }

  let coverExtra = '';
  if (!defeated && isTokenInCover(token)) {
    coverExtra = `<span class="board-token-tooltip__status"><span class="board-token-tooltip__tag board-token-tooltip__tag--cover">A cubierto</span></span>`;
  }

  return `
    <div class="board-token-tooltip__layout">
      ${portraitBlock}
      <div class="board-token-tooltip__info">
        <div class="board-token-tooltip__name-row">
          <strong class="board-token-tooltip__name">${escapeHtml(token.name)}</strong>
          ${renderCellBadgeHtml(cellLabel(token.col, token.row))}
        </div>
        <span class="board-token-tooltip__class" style="color:${escapeHtml(meta.color)}">${escapeHtml(classLabel)}</span>
        <span class="board-token-tooltip__level" style="color:${escapeHtml(meta.color)}">Nv. ${level}</span>
        <span class="board-token-tooltip__side board-token-tooltip__side--${sideClass}">${sideLabel}</span>
        ${enemyExtra}
        ${coverExtra}
      </div>
    </div>`;
}

/** Iniciales: "Seyna Jun" → SJ, "Obi-Wan Kenobi" → OW */
export function nameInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0];
  if (words.length === 1) {
    if (first.includes('-')) {
      const parts = first.split('-').filter(Boolean);
      return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }
    return first.slice(0, 2).toUpperCase();
  }
  if (first.includes('-')) {
    const parts = first.split('-').filter(Boolean);
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }
  return `${first[0] || ''}${words[words.length - 1][0] || ''}`.toUpperCase();
}

export function renderCellBadgeHtml(label) {
  return `<span class="board-cell-badge">${escapeHtml(label)}</span>`;
}

export function cellLabel(col, row) {
  return `${colLetter(col)}${row + 1}`;
}

function colLetter(col) {
  if (col < 26) return String.fromCharCode(65 + col);
  return String.fromCharCode(65 + Math.floor(col / 26) - 1) + String.fromCharCode(65 + (col % 26));
}

function clampGrid(n) {
  return Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(Number(n) || MIN_GRID)));
}

function timeLabel() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { CELL, DEFAULT_COLS, DEFAULT_ROWS, MIN_GRID, MAX_GRID, LABEL_SIZE };
