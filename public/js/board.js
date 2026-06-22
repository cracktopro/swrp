import {
  db,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from './firebase-config.js';
import { getClassMeta } from './character-card.js';
import {
  getEnemyTokens,
  normalizeBoardToken,
  updateAlertedStates,
  computeEnemyStatusIcons,
  drawVisionConeOnCanvas,
  facingLabel,
  FACING_DIRS
} from './board-vision.js';
import { swrpConfirm } from './swrp-dialog.js';
import { formatRollResult, renderDiceResultHtml } from './dice.js';
import {
  buildBoardTokenMap,
  buildRosterMap,
  renderNarrativeMarkupHtml
} from './party-markup.js';

const ICON_BASE = 'icons';

const ENEMY_STATUS_MODIFIERS = {
  out_of_range: 'out-of-range',
  no_vision: 'no-vision',
  vision: 'vision',
  alarm: 'alarm'
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
    this.initiativeLog = [];
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

  async loadState() {
    if (!this.partyId) return;
    const snap = await getDoc(doc(db, 'parties', this.partyId, 'state', 'board'));
    if (snap.exists()) {
      const data = snap.data();
      this.tokens = (data.tokens || []).map((t) => normalizeBoardToken({ ...t }));
      this.combatStarted = !!data.combatStarted;
      this.activeTurn = data.activeTurn ?? null;
      if (data.grid?.cols) this.cols = clampGrid(data.grid.cols);
      if (data.grid?.rows) this.rows = clampGrid(data.grid.rows);
      this.tokens = this.tokens.filter(
        (t) => t.col >= 0 && t.col < this.cols && t.row >= 0 && t.row < this.rows
      );
      if (data.mapUrl) {
        this._mapUrl = data.mapUrl;
        this.onMapUrlChange(data.mapUrl);
        await this.loadMap(data.mapUrl);
      }
      this.applyGridDimensions();
      this.render();
      this.initiativeLog = data.initiativeLog || [];
      this.renderLog(data.log || []);
      this.renderInitiativeLog(this.initiativeLog);
    } else {
      this.tokens = [];
      this.combatStarted = false;
      this.activeTurn = null;
      this.initiativeLog = [];
      this.applyGridDimensions();
      this.render();
      this.renderLog([]);
      this.renderInitiativeLog([]);
    }
    this.onCombatStateChange(this.combatStarted);
    this.onActiveTurnChange(this.activeTurn);
    this.onTokensChange(this.tokens);
  }

  watchState() {
    if (!this.partyId) return;
    return onSnapshot(doc(db, 'parties', this.partyId, 'state', 'board'), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      this.tokens = (data.tokens || []).map((t) => normalizeBoardToken({ ...t }));
      this.combatStarted = !!data.combatStarted;
      this.activeTurn = data.activeTurn ?? null;
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
      this.onCombatStateChange(this.combatStarted);
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

  async startCombat() {
    if (!this.isGM || this.combatStarted) return;
    this.combatStarted = true;
    await this.saveState({ combatStarted: true });
    await this.appendLog(logEntrySystem('inició el combate'), { force: true });
    this.onCombatStateChange(true);
  }

  async setActiveTurn(turn) {
    if (!this.isGM) return;
    this.activeTurn = turn || null;
    await this.saveState({ activeTurn: this.activeTurn });
    if (this.combatStarted && turn?.label) {
      await this.appendLog(logEntrySystem(`cede el turno a ${turn.label}`));
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

  canUserMoveToken(token) {
    if (this.isGM) return true;
    if (!this.combatStarted || !this.activeTurn) return false;
    if (this.activeTurn.kind !== 'player') return false;
    if (this.activeTurn.userId !== this.userId) return false;
    return token.kind === 'character'
      && token.sourceId === this.userCharacterSourceId
      && token.side !== 'enemy';
  }

  isTokenActiveTurn(token) {
    if (!this.combatStarted || !this.activeTurn) return false;
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
    if (!this.isGM || !this.combatStarted) return;
    const ok = await swrpConfirm({
      title: 'Borrar historial',
      message: '¿Borrar el historial y reiniciar la partida? El combate volverá al estado previo al inicio.',
      confirmText: 'Borrar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    this.combatStarted = false;
    this.activeTurn = null;
    this.initiativeLog = [];
    await this.saveState({
      combatStarted: false,
      activeTurn: null,
      log: [],
      initiativeLog: []
    });
    this.renderLog([]);
    this.renderInitiativeLog([]);
    this.onCombatStateChange(false);
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

  async updateTokenProperties(tokenId, { side, facing }) {
    if (!this.isGM) return;
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token) return;

    const prevFacing = token.facing;
    token.side = side === 'enemy' ? 'enemy' : 'ally';
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
    token.alerted = false;
    token.visionSuppressed = true;
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
      const occupied = this.tokens.find(
        (t) => t.col === col && t.row === row && t.id !== this.pointer.token.id
      );
      if (!occupied) {
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
      await this.saveState({});
      if (this.combatStarted) {
        await this.appendLog(logEntryToken(token, 'move', {
          fromCell: cellLabel(fromCol, fromRow),
          toCell: cellLabel(token.col, token.row)
        }));
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

  async appendInitiativeRoll(actor, roll) {
    if (this.combatStarted) return;
    const entry = {
      actorName: actor.name,
      roll,
      rollLabel: 'Iniciativa ',
      time: timeLabel()
    };
    const refDoc = doc(db, 'parties', this.partyId, 'state', 'board');
    const snap = await getDoc(refDoc);
    const current = snap.exists() ? snap.data() : {};
    const initiativeLog = [...(current.initiativeLog || []), stripUndefinedDeep(entry)];
    await setDoc(refDoc, { initiativeLog, updatedAt: serverTimestamp() }, { merge: true });
    this.initiativeLog = initiativeLog;
    this.renderInitiativeLog(initiativeLog);
  }

  renderInitiativeLog(entries) {
    if (!this.initiativeLogEl) return;
    const lines = (entries || []).map((entry) => {
      if (typeof entry === 'string') return entry;
      return formatRollResult(
        entry.actorName,
        entry.roll,
        entry.rollLabel || 'Iniciativa '
      );
    });
    this.initiativeLogEl.value = lines.join('\n');
    this.initiativeLogEl.scrollTop = this.initiativeLogEl.scrollHeight;
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
          : (current.initiativeLog || [])
      }),
      updatedAt: serverTimestamp()
    };
    await setDoc(refDoc, payload, { merge: true });
  }

  renderLog(entries) {
    if (!this.logEl) return;
    if (!this.combatStarted) {
      this.logEl.innerHTML = '';
      return;
    }
    this.logEl.innerHTML = entries.map((entry) => renderLogEntryHtml(entry, {
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

    this.drawVisionCones();
  }

  drawVisionCones() {
    const ctx = this.ctx;
    getEnemyTokens(this.tokens).forEach((enemy) => {
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
      const portraitUrl = getTokenPortraitUrl(token);
      const statusHtml = side === 'enemy'
        ? renderEnemyStatusIcons(token, this.tokens, this.cols, this.rows)
        : '';

      const wrap = document.createElement('div');
      const highlighted = token.id === this.highlightedTokenId;
      wrap.className = `swrp-board-token-wrap swrp-board-token-wrap--${side}${this.isTokenActiveTurn(token) ? ' is-active-turn' : ''}${highlighted ? ' is-highlighted' : ''}`;
      wrap.style.left = `${token.col * CELL + pad}px`;
      wrap.style.top = `${token.row * CELL + pad}px`;

      if (statusHtml) {
        wrap.insertAdjacentHTML('afterbegin', statusHtml);
      }

      const chip = document.createElement('div');
      chip.className = `swrp-board-token swrp-board-token--${side} theme-${token.theme || 'soldado'}${this.selectedTokenId === token.id ? ' is-selected' : ''}${this.pointer?.token?.id === token.id && this.pointer.dragging ? ' is-dragging' : ''}`;
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      chip.style.setProperty('--token-color', token.color || '#00e5ff');

      const badgeEl = document.createElement('div');
      badgeEl.className = 'swrp-board-token__side-badge';
      badgeEl.textContent = side === 'enemy' ? 'ENEMIGO' : 'ALIADO';

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
        if (side === 'enemy') this.setHighlightToken(token.id, 'token');
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

export function logEntrySystem(message) {
  return {
    time: timeLabel(),
    type: 'system',
    actor: { isGM: true, name: 'GM' },
    message
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

export function getHealthBarSegments(hp, maxHp) {
  const max = Math.max(1, Number(maxHp) || 1);
  const current = Math.max(0, Math.min(Number(hp) ?? max, max));
  const ratio = current / max;
  if (ratio > 2 / 3) return ['green', 'green', 'green'];
  if (ratio > 1 / 3) return ['yellow', 'yellow', 'empty'];
  return ['red', 'empty', 'empty'];
}

export function renderTokenHealthBarHtml(token) {
  const segments = getHealthBarSegments(getTokenHp(token), getTokenMaxHp(token));
  const parts = segments.map(
    (seg) => `<span class="swrp-token-hp__seg swrp-token-hp__seg--${seg}"></span>`
  ).join('');
  return `<div class="swrp-token-hp" aria-hidden="true">${parts}</div>`;
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

  if (entry.type === 'move') {
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

function renderEnemyStatusIcons(token, tokens, cols, rows) {
  const { icons, labels } = computeEnemyStatusIcons(token, tokens, cols, rows);
  if (!icons.length) return '';

  const items = icons.map((iconId, i) => {
    const mod = ENEMY_STATUS_MODIFIERS[iconId] || iconId;
    const label = escapeHtml(labels[i] || iconId);
    return `
    <span class="swrp-board-token__status-icon-wrap swrp-board-token__status-icon-wrap--${mod}" title="${label}">
      <img
        class="swrp-board-token__status-icon"
        src="${ICON_BASE}/${iconId}.svg"
        alt="${label}"
      >
    </span>`;
  }).join('');

  return `<span class="swrp-board-token__status-icons">${items}</span>`;
}

export function buildTokenTooltipHtml(token, allTokens = [], cols = 0, rows = 0) {
  const meta = getClassMeta(token.class);
  const classLabel = token.classLabel || meta.label;
  const level = Number(token.level) || 1;
  const portraitUrl = getTokenPortraitUrl(token);
  const side = token.side === 'enemy' ? 'enemy' : 'ally';
  const sideLabel = side === 'enemy' ? 'Enemigo' : 'Aliado';

  const portraitBlock = portraitUrl
    ? `<img class="board-token-tooltip__img" src="${escapeHtml(portraitUrl)}" alt="">`
    : `<div class="board-token-tooltip__img board-token-tooltip__img--placeholder">${escapeHtml(nameInitials(token.name))}</div>`;

  let enemyExtra = '';
  if (side === 'enemy' && allTokens.length) {
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
        <span class="board-token-tooltip__side board-token-tooltip__side--${side}">${sideLabel}</span>
        ${enemyExtra}
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
