/** Profundidad máxima del cono de visión (en celdas). */
export const VISION_RANGE = 4;

/** Más de esta distancia (Chebyshev) → solo ataque a distancia. */
export const MELEE_RANGE = 2;

/** Radio (Chebyshev) en el que un enemigo alertado propaga el icono de alarma. */
export const ALARM_RADIUS = 4;

export const FACING_DIRS = ['up', 'down', 'left', 'right'];

const ENEMY_VISION_PREF_KEY = 'swrp.board.showEnemyVisionCones';

/** Preferencia local: mostrar conos de visión enemigos en el tablero (por usuario/dispositivo). */
export function readShowEnemyVisionConesPreference() {
  try {
    const v = localStorage.getItem(ENEMY_VISION_PREF_KEY);
    if (v === null) return true;
    return v === '1' || v === 'true';
  } catch {
    return true;
  }
}

export function writeShowEnemyVisionConesPreference(show) {
  try {
    localStorage.setItem(ENEMY_VISION_PREF_KEY, show ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const ICON_LABELS = {
  out_of_range: 'Fuera de alcance cuerpo a cuerpo',
  no_vision: 'Sin visión ni alerta',
  vision: 'Detecta o está alertado',
  alarm: 'Alarma a enemigos cercanos'
};

/** Distancia Chebyshev: aliado en celda adyacente (8 direcciones) siempre es visible. */
export const ADJACENT_VISION_RANGE = 1;

export function chebyshevDistance(c1, r1, c2, r2) {
  return Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));
}

/** Aliado en una celda colindante al enemigo (incluye diagonales). */
export function allyAdjacentToEnemy(enemy, allies) {
  return allies.some(
    (a) => chebyshevDistance(enemy.col, enemy.row, a.col, a.row) === ADJACENT_VISION_RANGE
  );
}

/**
 * Cono de visión: a distancia d el ancho es 2d-1 (1, 3, 5…), centrado en el eje perpendicular.
 */
export function getVisionCells(col, row, facing, cols, rows, range = VISION_RANGE) {
  const cells = [];
  const seen = new Set();

  const add = (c, r) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    const key = `${c},${r}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ col: c, row: r });
  };

  const dir = FACING_DIRS.includes(facing) ? facing : 'left';

  for (let d = 1; d <= range; d++) {
    const half = d - 1;
    for (let offset = -half; offset <= half; offset++) {
      if (dir === 'left') add(col - d, row + offset);
      else if (dir === 'right') add(col + d, row + offset);
      else if (dir === 'up') add(col + offset, row - d);
      else if (dir === 'down') add(col + offset, row + d);
    }
  }

  return cells;
}

export function normalizeTokenSide(side) {
  if (side === 'enemy') return 'enemy';
  if (side === 'neutral') return 'neutral';
  return 'ally';
}

export function getAllyTokens(tokens) {
  return tokens.filter((t) => normalizeTokenSide(t.side) === 'ally');
}

export function getNeutralTokens(tokens) {
  return tokens.filter((t) => normalizeTokenSide(t.side) === 'neutral');
}

export function getEnemyTokens(tokens) {
  return tokens.filter((t) => t.side === 'enemy');
}

export function allyInVisionCone(enemy, allies, cols, rows) {
  if (!allies.length) return false;
  const facing = enemy.facing || 'left';
  const cellSet = new Set(
    getVisionCells(enemy.col, enemy.row, facing, cols, rows).map((c) => `${c.col},${c.row}`)
  );
  return allies.some((a) => cellSet.has(`${a.col},${a.row}`));
}

/** Cono direccional o contacto en celda adyacente. */
export function enemySeesAlly(enemy, allies, cols, rows) {
  if (!allies.length) return false;
  if (allyAdjacentToEnemy(enemy, allies)) return true;
  return allyInVisionCone(enemy, allies, cols, rows);
}

export function inferBoardTokenKind(token) {
  if (!token) return 'character';
  if (token.kind === 'vehicle') return 'vehicle';
  if (token.npcCategory === 'vehicle' || token.characterSnapshot?.npcCategory === 'vehicle') return 'vehicle';
  if (token.kind === 'npc' || token.kind === 'character') return token.kind;
  if (token.characterSnapshot?.type === 'NPC') return 'npc';
  return 'character';
}

export function normalizeBoardToken(token) {
  if (!token) return token;
  token.kind = inferBoardTokenKind(token);
  token.side = normalizeTokenSide(token.side);
  if (token.inCover === undefined) token.inCover = false;
  if (!Array.isArray(token.dialogues)) token.dialogues = [];
  if (token.kind === 'vehicle') {
    token.spanCols = Math.max(1, Number(token.spanCols ?? token.characterSnapshot?.spanCols) || 1);
    token.spanRows = Math.max(1, Number(token.spanRows ?? token.characterSnapshot?.spanRows) || 1);
    const moveRange = Number(token.moveRange ?? token.characterSnapshot?.moveRange);
    if (Number.isFinite(moveRange) && moveRange > 0) token.moveRange = moveRange;
  }
  if (token.side === 'enemy') {
    if (!FACING_DIRS.includes(token.facing)) token.facing = 'left';
    if (token.alerted === undefined) token.alerted = false;
    if (token.visionSuppressed === undefined) token.visionSuppressed = false;
  }
  return token;
}

export function resetEnemyVisionToSpawn(token) {
  if (!token || token.side !== 'enemy') return;
  token.alerted = false;
  token.visionSuppressed = false;
}

/** Marca alerted=true en enemigos que ven a un aliado. Devuelve si hubo cambios. */
export function updateAlertedStates(tokens, cols, rows) {
  let changed = false;
  const allies = getAllyTokens(tokens);

  for (const token of tokens) {
    if (token.side !== 'enemy') continue;
    normalizeBoardToken(token);
    if (!token.visionSuppressed && !token.alerted && enemySeesAlly(token, allies, cols, rows)) {
      token.alerted = true;
      changed = true;
    }
  }

  return changed;
}

/** Enemigo que detecta o conserva alerta activa (no suprimida por el GM). */
export function isActivelyAlerted(enemy, allies, cols, rows) {
  if (enemy.side !== 'enemy' || enemy.visionSuppressed) return false;
  if (enemy.alerted) return true;
  return allies.length > 0 && enemySeesAlly(enemy, allies, cols, rows);
}

/** Hay otro enemigo alertado dentro del radio de alarma. */
export function hasNearbyAlertSource(enemy, enemies, allies, cols, rows, radius = ALARM_RADIUS) {
  return enemies.some(
    (other) => other.id !== enemy.id
      && isActivelyAlerted(other, allies, cols, rows)
      && chebyshevDistance(other.col, other.row, enemy.col, enemy.row) <= radius
  );
}

export function computeEnemyStatusIcons(enemy, tokens, cols, rows) {
  const icons = [];
  const allies = getAllyTokens(tokens);
  const enemies = getEnemyTokens(tokens);
  const seesAlly = allies.length > 0 && enemySeesAlly(enemy, allies, cols, rows);

  const minAllyDist = allies.length
    ? Math.min(...allies.map((a) => chebyshevDistance(enemy.col, enemy.row, a.col, a.row)))
    : Infinity;

  if (minAllyDist > MELEE_RANGE) {
    icons.push('out_of_range');
  }

  if (enemy.visionSuppressed) {
    icons.push('no_vision');
  } else if (seesAlly) {
    icons.push('vision');
  } else if (enemy.alerted) {
    icons.push('vision');
  } else {
    icons.push('no_vision');
  }

  if (
    isActivelyAlerted(enemy, allies, cols, rows)
    || hasNearbyAlertSource(enemy, enemies, allies, cols, rows)
  ) {
    icons.push('alarm');
  }

  return {
    icons,
    seesAlly,
    labels: icons.map((id) => ICON_LABELS[id] || id)
  };
}

export function getIconLabel(iconId) {
  return ICON_LABELS[iconId] || iconId;
}

/** Polígono unificado del cono (píxeles), no celda a celda. */
export function getVisionPolygonPoints(col, row, facing, cellSize, range = VISION_RANGE) {
  const cs = cellSize;
  const cx = (col + 0.5) * cs;
  const cy = (row + 0.5) * cs;
  const mouth = 0.24 * cs;
  const dir = FACING_DIRS.includes(facing) ? facing : 'left';

  if (dir === 'left') {
    return [
      [cx, cy],
      [col * cs, cy - mouth],
      [(col - range) * cs, (row - (range - 1)) * cs],
      [(col - range) * cs, (row + range) * cs],
      [col * cs, cy + mouth]
    ];
  }
  if (dir === 'right') {
    return [
      [cx, cy],
      [(col + 1) * cs, cy - mouth],
      [(col + 1 + range) * cs, (row - (range - 1)) * cs],
      [(col + 1 + range) * cs, (row + range) * cs],
      [(col + 1) * cs, cy + mouth]
    ];
  }
  if (dir === 'up') {
    return [
      [cx, cy],
      [cx - mouth, row * cs],
      [(col - (range - 1)) * cs, (row - range) * cs],
      [(col + range) * cs, (row - range) * cs],
      [cx + mouth, row * cs]
    ];
  }
  return [
    [cx, cy],
    [cx - mouth, (row + 1) * cs],
    [(col - (range - 1)) * cs, (row + 1 + range) * cs],
    [(col + range) * cs, (row + 1 + range) * cs],
    [cx + mouth, (row + 1) * cs]
  ];
}

/** Dibuja un cono de visión unificado con estilo “videojuego”. */
export function drawVisionConeOnCanvas(ctx, col, row, facing, cellSize, options = {}) {
  const points = getVisionPolygonPoints(col, row, facing, cellSize, options.range);
  if (points.length < 3) return;

  const tint = options.tint || '0, 229, 255';
  const preview = !!options.preview;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();

  const gx = points[0][0];
  const gy = points[0][1];
  const fx = points[Math.floor(points.length / 2)][0];
  const fy = points[Math.floor(points.length / 2)][1];
  const grad = ctx.createLinearGradient(gx, gy, fx, fy);
  grad.addColorStop(0, `rgba(${tint}, ${preview ? 0.38 : 0.28})`);
  grad.addColorStop(0.55, `rgba(${tint}, ${preview ? 0.16 : 0.1})`);
  grad.addColorStop(1, `rgba(${tint}, 0.02)`);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.clip();
  ctx.strokeStyle = `rgba(${tint}, 0.07)`;
  ctx.lineWidth = 1;
  for (let y = Math.min(...points.map((p) => p[1])); y < Math.max(...points.map((p) => p[1])); y += 5) {
    ctx.beginPath();
    ctx.moveTo(Math.min(...points.map((p) => p[0])), y);
    ctx.lineTo(Math.max(...points.map((p) => p[0])), y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.shadowColor = `rgba(${tint}, 0.75)`;
  ctx.shadowBlur = preview ? 10 : 16;
  ctx.strokeStyle = `rgba(${tint}, ${preview ? 0.75 : 0.55})`;
  ctx.lineWidth = preview ? 1.5 : 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(255, 255, 255, ${preview ? 0.25 : 0.18})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function facingLabel(facing) {
  const map = { up: 'Arriba', down: 'Abajo', left: 'Izquierda', right: 'Derecha' };
  return map[facing] || facing;
}

export function sideLabel(side) {
  const s = normalizeTokenSide(side);
  if (s === 'enemy') return 'Enemigo';
  if (s === 'neutral') return 'Neutral';
  return 'Aliado';
}
